// DEAD FRONTLINE: FOB WARFARE — entry point. Loads the real Toledo City battlefield, then runs menus,
// the campaign and the mission loop.
import { Battlefield } from "./game/Battlefield";
import { Session } from "./game/Session";
import { SceneRender } from "./game/rendering/SceneRender";
import { Controls } from "./game/input/Controls";
import { Hud } from "./game/ui/Hud";
import { Menus } from "./game/ui/Menus";
import { Sfx } from "./game/audio/Sfx";
import { Saves, Slot } from "./game/save/Saves";
import { IsoCamera } from "./game/camera/IsoCamera";
import type { Difficulty } from "./game/Game";
import { createSquad, setFormation, regroup, faceTo, setLeader, halt, squadOf, attached } from "./game/units/Squads";
import { infect } from "./game/zombies/Infection";
import { issue } from "./game/units/UnitAI";
// @ts-ignore engine is plain JS
import { PWA } from "./engine/pwa.js";

const $ = (id: string) => document.getElementById(id)!;
interface Settings { quality: "low" | "medium" | "high"; volume: number; ambient: number; edge: boolean; paths: boolean; fps: boolean; ui: number }
const DEFAULTS: Settings = { quality: matchMedia("(pointer: coarse)").matches ? "low" : "medium", volume: 0.7, ambient: 0.3, edge: true, paths: true, fps: false, ui: 1 };

class App {
  bf: Battlefield; saves = new Saves(); menus = new Menus(); sfx = new Sfx(); pwa: any;
  session!: Session; render!: SceneRender; controls!: Controls; hud!: Hud;
  settings: Settings = { ...DEFAULTS };
  playing = false; last = performance.now(); time = 0; frames = 0; fpsT = 0; fps = 0;
  menuCam!: IsoCamera; finishing = false; autosaveT = 0; back: () => void = () => {};
  /** automated tests drive the simulation themselves (deterministic): ?manualtick */
  manualTick = new URLSearchParams(location.search).has("manualtick");
  constructor() { this.bf = new Battlefield($("gl") as HTMLCanvasElement); }

  async boot() {
    this.menus.show("loading");
    try { const s = JSON.parse(localStorage.getItem("df-settings") || "{}"); this.settings = { ...DEFAULTS, ...s }; } catch (e) { /* storage blocked */ }
    this.applySettings();
    addEventListener("pointerdown", () => this.sfx.unlock(), { capture: true });
    addEventListener("keydown", () => this.sfx.unlock(), { capture: true });
    this.pwa = new PWA(() => this.offlineNote());
    this.pwa.start().catch(() => {});
    this.menus.loading("Opening save storage", 0.02);
    await this.saves.open();
    try {
      await this.bf.load("maps/toledo_poblacion.mapz", (m, f) => this.menus.loading(m, f));
    } catch (e: any) {
      const gl = /WebGL2/.test(String(e && e.message));
      this.menus.fatal(gl ? "This browser can't create a WebGL2 context, which the battlefield renderer needs.<br><br>In Brave, check that Shields are not blocking WebGL (fingerprinting protection set to <i>Strict</i> can do this) and that hardware acceleration is on; in other browsers enable hardware acceleration and update the graphics driver."
        : "The Toledo map data could not be loaded: " + String(e && e.message) + ". If you are offline, open the game once while online so it can be stored on this device.");
      return;
    }
    this.session = new Session(this.bf, this.saves);
    this.render = new SceneRender(this.bf, $("overlay") as HTMLCanvasElement);
    await this.render.sprites.load("sprites/"); // soldier and infected sprite sheets; the 3D figures stay as the fallback
    this.render.quality = this.settings.quality;
    this.controls = new Controls(this.session, $("gl"));
    this.controls.edgeScroll = this.settings.edge;
    this.hud = new Hud(this.session, this.controls);
    this.hud.onPause = () => this.pause();
    this.controls.onPause = () => this.pause();
    this.session.onGameCreated = (g) => {
      g.onSound = (k, x, y, v) => this.sfx.play(k, x, y, v);
      g.onEvent = (ev) => { if ((ev === "mission_complete" || ev === "mission_failed") && !this.finishing) { this.finishing = true; setTimeout(() => this.finishMission(), ev === "mission_complete" ? 5000 : 3500); } };
    };
    const lm = this.bf.landmark("city_plaza");
    const c = lm && lm.center ? lm.center : this.bf.map.center();
    this.menuCam = new IsoCamera(this.bf.playBounds, c[0], c[1]);
    this.menuCam.zoom = this.menuCam.tzoom = 160; this.menuCam.snap();
    this.wireMenus();
    this.menus.loading("Ready", 1);
    await this.mainMenu();
    addEventListener("pagehide", () => this.autosave());
    document.addEventListener("visibilitychange", () => { if (document.hidden) this.autosave(); });
    (window as any).__df = this;
    (this as any).__issue = issue; // used by the automated playthrough test
    (this as any).__squads = { createSquad, setFormation, regroup, faceTo, setLeader, halt, squadOf, attached, infect }; // formation tests
    requestAnimationFrame((t) => this.frame(t));
  }
  applySettings() {
    const s = this.settings;
    document.documentElement.style.setProperty("--ui", String(s.ui));
    this.sfx.setVolume(s.volume); this.sfx.setAmbient(s.ambient);
    if (this.bf.r) this.bf.r.maxDpr = s.quality === "low" ? 1 : s.quality === "high" ? 2 : 1.5;
    if (this.render) this.render.quality = s.quality;
    if (this.controls) this.controls.edgeScroll = s.edge;
    $("fps").hidden = !s.fps;
    try { localStorage.setItem("df-settings", JSON.stringify(s)); } catch (e) { /* storage blocked */ }
  }
  offlineNote() { if (this.pwa) { $("offlineNote").textContent = this.pwa.describe() + (this.pwa.installHint() ? " · " + this.pwa.installHint() : ""); $("mInstall").hidden = !this.pwa.state.canInstall; } }

  // ---------------------------------------------------------------- frame loop
  frame(t: number) {
    const dt = Math.min(0.1, (t - this.last) / 1000);
    this.last = t; this.time += dt;
    const s = this.session;
    let cam = this.menuCam;
    if (this.playing && s.game) {
      this.controls.update(dt);
      if (!this.manualTick) s.tick(dt);
      cam = s.cam;
      this.autosaveT += dt;
      if (this.autosaveT > 120) { this.autosaveT = 0; this.autosave(); }
    } else { this.menuCam.tyaw += dt * 0.04; }
    cam.update(dt, (x, y) => this.bf.h(x, y));
    this.sfx.listener.x = cam.x; this.sfx.listener.y = cam.y; this.sfx.listener.range = cam.zoom * 1.6 + 40;
    try {
      this.render.render(this.playing ? s.game : null, cam, this.time, { hover: this.controls.hover, box: this.controls.box, ghost: this.controls.ghost, showPaths: this.settings.paths });
    } catch (e) { console.error(e); }
    if (this.playing) this.hud.update(dt);
    this.frames++; this.fpsT += dt;
    if (this.fpsT > 0.5) { this.fps = this.frames / this.fpsT; this.frames = 0; this.fpsT = 0; if (this.settings.fps) $("fps").textContent = `${this.fps.toFixed(0)} fps · ${this.bf.r.stats.drawn ?? 0} chunks · ${s.game ? s.game.zombies.length : 0} infected`; }
    requestAnimationFrame((tt) => this.frame(tt));
  }
  // ---------------------------------------------------------------- flows
  async mainMenu() {
    this.playing = false; this.controls.enabled = false; $("hud").hidden = true;
    const auto = await this.saves.get("auto");
    $("mContinue").hidden = !auto;
    $("storageNote").textContent = this.saves.describe();
    this.offlineNote();
    this.menus.show("menu");
  }
  wireMenus() {
    $("mContinue").onclick = async () => { if (await this.session.load("auto")) this.campaign(); };
    $("mNew").onclick = () => this.menus.show("difficulty");
    for (const b of document.querySelectorAll<HTMLButtonElement>("#difficulty [data-diff]")) b.onclick = () => { this.session.newCampaign(b.dataset.diff as Difficulty); this.saves.put("auto", this.session.campaign!).catch(() => {}); this.campaign(); };
    $("mLoad").onclick = () => this.openSaves("load", () => this.mainMenu());
    $("mSettings").onclick = () => this.openSettings(() => this.mainMenu());
    $("mAbout").onclick = () => { this.menus.about(this.bf.attribution, this.bf.map.manifest.stats, this.saves.describe(), this.pwa ? this.pwa.describe() : ""); this.back = () => this.mainMenu(); };
    $("mInstall").onclick = () => this.pwa.install();
    $("aboutBack").onclick = () => this.back();
    for (const b of document.querySelectorAll<HTMLButtonElement>("#difficulty .back")) b.onclick = () => this.mainMenu();
    $("cMenu").onclick = () => this.mainMenu();
    $("cSave").onclick = () => this.openSaves("save", () => this.campaign());
    $("bBack").onclick = () => this.campaign();
    $("bDeploy").onclick = () => this.deploy();
    $("pResume").onclick = () => this.resume();
    $("pSave").onclick = () => this.openSaves("save", () => this.menus.show("pause"));
    $("pLoad").onclick = () => this.openSaves("load", () => this.menus.show("pause"));
    $("pSettings").onclick = () => this.openSettings(() => this.menus.show("pause"));
    $("pHelp").onclick = () => { this.menus.show("help"); this.back = () => this.menus.show("pause"); };
    $("helpBack").onclick = () => this.back();
    $("pQuit").onclick = async () => { await this.autosave(); this.session.teardown(); this.mainMenu(); };
    $("savesBack").onclick = () => this.back();
    $("settingsBack").onclick = () => { this.applySettings(); this.back(); };
    $("dContinue").onclick = () => this.campaign();
  }
  campaign() {
    this.playing = false; this.controls.enabled = false; $("hud").hidden = true;
    this.menus.campaignBoard(this.session.campaign!, (op) => { if (op === "op01") this.briefing(); });
  }
  briefing() {
    const c = this.session.campaign!;
    this.menus.briefing({ draw: (cv) => this.drawBriefMap(cv) }, !!c.mission);
  }
  drawBriefMap(cv: HTMLCanvasElement) {
    const x = cv.getContext("2d")!, W = cv.width, H = cv.height, b = this.bf.bounds;
    if (!this.hud.mmBase) this.hud.buildMinimapBase();
    x.drawImage(this.hud.mmBase!, 0, 0, W, H);
    const P = (px: number, py: number): [number, number] => [((px - b[0]) / (b[2] - b[0])) * W, ((b[3] - py) / (b[3] - b[1])) * H];
    const mark = (px: number, py: number, label: string, col: string) => { const [a, c] = P(px, py); x.fillStyle = col; x.beginPath(); x.arc(a, c, 5, 0, 7); x.fill(); x.fillStyle = "#fff"; x.font = "11px system-ui"; x.fillText(label, a + 7, c + 4); };
    const lz = this.bf.roads.nearestOn(2321, -190, "Naga-Toledo Road");
    mark(lz[0], lz[1], "LZ", "#6fd879");
    for (const [id, label] of [["city_hall", "City Hall"], ["tpc", "Power plant"], ["public_market", "Market"], ["general_hospital", "Hospital"], ["toledo_port", "Port"], ["city_plaza", "Plaza (nest)"]]) {
      const l = this.bf.landmark(id);
      if (l && l.center) mark(l.center[0], l.center[1], label, "#e0b72c");
    }
  }
  deploy() {
    const c = this.session.campaign!;
    const snap = c.mission;
    this.session.startMission(snap || null);
    c.mission = null;
    this.hud.attach();
    this.finishing = false; this.autosaveT = 0;
    this.menus.show(null);
    $("hud").hidden = false;
    this.playing = true; this.controls.enabled = true;
    for (const u of this.session.game!.units) u.selected = !u.vehicle;
    this.session.game!.radio(snap ? "Mission resumed." : "HQ: Task force, you are on the ground east of Toledo. Secure the LZ, then push west along the Naga–Toledo Road.", "radio");
    // a save made in the last seconds of a finished mission goes straight to the debrief
    const st = this.session.mission!.state;
    if ((st === "complete" || st === "failed") && !this.finishing) { this.finishing = true; setTimeout(() => this.finishMission(), 1500); }
    this.autosave();
  }
  pause() {
    if (!this.playing || !this.session.game) return;
    this.session.game.paused = true; this.controls.enabled = false;
    this.menus.show("pause");
  }
  resume() {
    if (!this.session.game) return;
    this.session.game.paused = false; this.controls.enabled = true; this.playing = true;
    this.menus.show(null); $("hud").hidden = false;
  }
  async openSaves(mode: "save" | "load", back: () => void) {
    this.back = back;
    await this.menus.saves(this.saves, mode, async (slot: Slot) => {
      if (mode === "save") {
        if (!this.session.campaign) return;
        await this.session.save(slot);
        this.hud.toast(`Saved to ${slot === "auto" ? "autosave" : "slot " + slot}`);
        await this.openSaves("save", back);
      } else {
        if (!(await this.session.load(slot))) return;
        if (this.session.campaign!.mission) { this.session.teardown(); this.deploy(); }
        else { this.session.teardown(); this.campaign(); }
      }
    });
  }
  openSettings(back: () => void) {
    this.back = back;
    const s = this.settings;
    const q = $("sQuality") as HTMLSelectElement, v = $("sVolume") as HTMLInputElement, a = $("sAmbient") as HTMLInputElement, e = $("sEdge") as HTMLInputElement, p = $("sPaths") as HTMLInputElement, f = $("sFps") as HTMLInputElement, u = $("sUi") as HTMLSelectElement;
    q.value = s.quality; v.value = String(s.volume); a.value = String(s.ambient); e.checked = s.edge; p.checked = s.paths; f.checked = s.fps; u.value = String(s.ui);
    const upd = () => { s.quality = q.value as any; s.volume = +v.value; s.ambient = +a.value; s.edge = e.checked; s.paths = p.checked; s.fps = f.checked; s.ui = +u.value; this.applySettings(); };
    for (const el of [q, v, a, e, p, f, u]) el.oninput = el.onchange = upd;
    this.menus.show("settings");
  }
  async autosave() {
    const s = this.session;
    if (!s || !s.campaign || !s.game || s.ended || !this.playing) return;
    try { await s.save("auto"); } catch (e) { /* storage unavailable */ }
  }
  async finishMission() {
    const d = await this.session.finish();
    this.playing = false; this.controls.enabled = false; $("hud").hidden = true;
    this.menus.debrief(d);
  }
}

new App().boot().catch((e) => { console.error(e); const f = document.getElementById("fatalMsg"); if (f) { f.textContent = String(e && e.message || e); document.getElementById("fatal")!.hidden = false; } });

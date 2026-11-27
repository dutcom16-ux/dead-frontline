// Full-screen menus: main menu, difficulty, strategic campaign map, briefing, pause, save/load,
// settings, controls, debrief, about & map data.
import { CAMPAIGN, OP01, unitDef } from "../data";
import { escHtml as E, fmtTime } from "../core";
import { PLAYABLE } from "../campaign/Campaign";
import type { CampaignState } from "../campaign/Campaign";
import type { Saves, Slot } from "../save/Saves";

const $ = (id: string) => document.getElementById(id)!;
export const SCREENS = ["loading", "menu", "difficulty", "campaign", "briefing", "pause", "saves", "settings", "help", "debrief", "about", "fatal"];

export const HELP = `<div class="keys">
<div><kbd>Left click</kbd>select unit · <kbd>drag</kbd> box select</div><div><kbd>Shift</kbd>+click add/remove · double-click: all of a type</div>
<div><kbd>Right click</kbd>move · on infected/nest: attack (focus fire)</div><div><kbd>Ctrl</kbd>/<kbd>Alt</kbd>+right click: attack-move · <kbd>Shift</kbd>: queue</div>
<div><kbd>Right click</kbd> a vehicle: board · a crate: collect · a survivor: rescue</div><div>Engineers: <kbd>right click</kbd> a wreck to clear it</div>
<div><kbd>W A S D</kbd>/arrows pan · screen edges pan</div><div><kbd>Q</kbd>/<kbd>E</kbd> rotate 90° · wheel zoom · middle/right drag pan</div>
<div><kbd>Z</kbd>attack-move <kbd>X</kbd>stop <kbd>H</kbd>hold <kbd>G</kbd>defend</div><div><kbd>P</kbd>patrol <kbd>F</kbd>follow <kbd>R</kbd>retreat <kbd>K</kbd>formation</div>
<div><kbd>Ctrl</kbd>+<kbd>1-9</kbd>set group · <kbd>1-9</kbd>select · twice: center</div><div><kbd>Space</kbd>center on selection · <kbd>Tab</kbd>next idle unit</div>
<div><kbd>L</kbd>logistics · <kbd>B</kbd>build (engineers) · <kbd>O</kbd>FOB</div><div><kbd>U</kbd>unload vehicle · <kbd>R</kbd> rotates while placing</div>
<div><kbd>+</kbd>/<kbd>−</kbd>game speed · <kbd>Esc</kbd>pause / cancel</div><div><kbd>Ctrl</kbd>+<kbd>T</kbd>select all</div>
<div><b>Touch:</b> tap select · tap ground/infected with units selected: move/attack</div><div>One finger drag: pan · pinch: zoom · long press or ▭ Box: box select</div>
</div>`;

export class Menus {
  current = "";
  constructor() { $("helpBody").innerHTML = HELP; $("bHelp").innerHTML = HELP; }
  show(id: string | null) {
    for (const s of SCREENS) $(s).hidden = s !== id;
    this.current = id || "";
  }
  loading(msg: string, f: number) { $("loadMsg").textContent = msg; ($("loadFill") as HTMLElement).style.width = `${Math.round(f * 100)}%`; }
  fatal(msg: string) { $("fatalMsg").innerHTML = msg; this.show("fatal"); }

  campaignBoard(c: CampaignState, onPlay: (op: string) => void) {
    const cv = $("campMap") as HTMLCanvasElement, x = cv.getContext("2d")!;
    const W = cv.width, H = cv.height, lat0 = 4.5, lat1 = 19.8, lon0 = 116.6, lon1 = 127.2;
    const P = (lat: number, lon: number): [number, number] => [((lon - lon0) / (lon1 - lon0)) * W, ((lat1 - lat) / (lat1 - lat0)) * H];
    x.fillStyle = "#152029"; x.fillRect(0, 0, W, H);
    x.strokeStyle = "rgba(160,190,210,.12)"; x.lineWidth = 1; x.fillStyle = "rgba(160,190,210,.4)"; x.font = "10px system-ui";
    for (let lat = 6; lat <= 19; lat += 2) { const [, py] = P(lat, lon0); x.beginPath(); x.moveTo(0, py); x.lineTo(W, py); x.stroke(); x.fillText(`${lat}°N`, 4, py - 2); }
    for (let lon = 118; lon <= 127; lon += 2) { const [px] = P(lat0, lon); x.beginPath(); x.moveTo(px, 0); x.lineTo(px, H); x.stroke(); x.fillText(`${lon}°E`, px + 2, H - 4); }
    const COL: Record<string, string> = { red: "#d23b2c", yellow: "#e0b72c", green: "#4cc35a", blue: "#4b7fe0" };
    // links between operations
    const all = CAMPAIGN.phases.flatMap((p) => p.operations);
    x.strokeStyle = "rgba(255,255,255,.18)";
    for (const o of all) if (o.requires) { const r = all.find((q) => q.id === o.requires); if (r) { const a = P(r.pos[0], r.pos[1]), b = P(o.pos[0], o.pos[1]); x.beginPath(); x.moveTo(a[0], a[1]); x.lineTo(b[0], b[1]); x.stroke(); } }
    for (const ph of CAMPAIGN.phases) {
      for (const o of ph.operations) {
        const [px, py] = P(o.pos[0], o.pos[1]), st = c.ops[o.id], terr = c.territory[o.id];
        x.beginPath(); x.arc(px, py, o.id === "op01" ? 8 : 5, 0, Math.PI * 2);
        x.fillStyle = st === "locked" ? "#3a3f44" : COL[terr] || "#d23b2c"; x.fill();
        if (st === "available" || st === "in_progress") { x.strokeStyle = "#ffd65a"; x.lineWidth = 2; x.stroke(); }
      }
      const c0 = ph.operations[0].pos;
      const [lx, ly] = P(c0[0], c0[1]);
      x.fillStyle = "rgba(230,240,220,.75)"; x.font = "600 12px system-ui"; x.fillText(ph.name, lx + 12, ly - 10);
    }
    if (c.fob) { const [px, py] = P(c.fob.lat, c.fob.lon); x.fillStyle = "#4b7fe0"; x.fillRect(px + 6, py - 12, 9, 9); x.strokeStyle = "#fff"; x.strokeRect(px + 6, py - 12, 9, 9); }
    x.fillStyle = "rgba(200,210,200,.45)"; x.font = "10px system-ui"; x.fillText("Schematic: operation markers at real coordinates; coastline outlines not included yet.", 8, 14);
    // side list
    const side = $("campSide");
    let h = `<p>${E(c.name)} · infection <b>${E(c.difficulty)}</b>${c.fob ? ` · FOB at ${c.fob.lat.toFixed(4)}, ${c.fob.lon.toFixed(4)}` : " · no FOB yet"}</p>`;
    h += `<p class="fine">Territory: <span style="color:#d23b2c">red</span> infected · <span style="color:#e0b72c">yellow</span> contested · <span style="color:#4cc35a">green</span> secured · <span style="color:#4b7fe0">blue</span> military controlled.</p>`;
    for (const ph of CAMPAIGN.phases) {
      h += `<h4>${E(ph.name)}</h4><ul class="ops">`;
      for (const o of ph.operations) {
        const st = c.ops[o.id], playable = PLAYABLE.has(o.id);
        const label = st === "complete" ? "secured" : st === "in_progress" ? "in progress" : st === "available" ? (playable ? "available" : "next — not built yet") : "locked";
        h += `<li class="${st} ${c.territory[o.id]}">${E(o.name)} <small>${label}</small>${playable && st !== "locked" ? `<button data-op="${o.id}" class="${st === "complete" ? "" : "primary"}">${st === "complete" ? "Replay" : st === "in_progress" && c.mission ? "Resume" : "Play"}</button>` : ""}</li>`;
      }
      h += `</ul>`;
    }
    h += `<p class="fine">Totals: ${c.totals.kills} infected killed · ${c.totals.rescued} survivors evacuated · ${c.totals.lost} soldiers lost · ${fmtTime(c.totals.playTime)} in the field.</p>`;
    side.innerHTML = h;
    side.onclick = (e) => { const b = (e.target as HTMLElement).closest("button") as HTMLButtonElement; if (b && b.dataset.op) onPlay(b.dataset.op); };
    this.show("campaign");
  }
  briefing(map: { draw: (cv: HTMLCanvasElement) => void }, resume: boolean) {
    $("bTitle").textContent = OP01.name;
    $("bText").innerHTML = (OP01.briefing as string[]).map((p) => `<p>${E(p)}</p>`).join("");
    $("bIntel").innerHTML = (OP01.intel as string[]).map((p) => `<li>${E(p)}</li>`).join("");
    $("bLogi").textContent = OP01.supplyLimits + " Victory: " + OP01.victory + " Defeat: " + OP01.defeat;
    $("bSquad").innerHTML = (OP01.squad as string[]).map((t) => `<li>${E(unitDef(t).name)}</li>`).join("");
    ($("bDeploy") as HTMLButtonElement).textContent = resume ? "Resume mission" : "Deploy to Toledo";
    map.draw($("bMap") as HTMLCanvasElement);
    this.show("briefing");
  }
  async saves(store: Saves, mode: "save" | "load", act: (slot: Slot) => void) {
    $("savesTitle").textContent = mode === "save" ? "Save game" : "Load game";
    $("savesNote").textContent = store.describe();
    const list = await store.list();
    $("slotList").innerHTML = list.filter((s) => mode === "load" || s.slot !== "auto").map((s) => `<div class="slot"><div><b>${s.slot === "auto" ? "Autosave" : "Slot " + s.slot}</b><small>${s.empty ? "empty" : E(s.label) + " · " + E(s.detail) + " · " + new Date(s.updated!).toLocaleString()}</small></div>
      <button data-slot="${s.slot}"${mode === "load" && s.empty ? " disabled" : ""}>${mode === "save" ? (s.empty ? "Save" : "Overwrite") : "Load"}</button></div>`).join("");
    $("slotList").onclick = (e) => { const b = (e.target as HTMLElement).closest("button") as HTMLButtonElement; if (b && !b.disabled) act(b.dataset.slot as Slot); };
    this.show("saves");
  }
  debrief(d: any) {
    $("dTitle").textContent = d.result === "victory" ? "Debrief — Toledo City liberated" : "Debrief — mission failed";
    const s = d.stats;
    const kills = Object.entries(s.kills as Record<string, number>).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(" · ");
    $("dBody").innerHTML = `<p><b>${E(d.rating)}</b> · score ${d.score} · time in the field ${fmtTime(d.time)}</p>
    <div class="dstats"><div><b>${s.killed}</b>infected killed</div><div><b>${s.rescued}</b>survivors evacuated</div><div><b>${s.lost}</b>soldiers / vehicles lost</div><div><b>${s.civLost}</b>civilians lost</div><div><b>${s.supplies}</b>supply deliveries</div><div><b>${s.reinforcements}</b>reinforcements deployed</div></div>
    <p class="fine">${E(kills)}</p>
    ${d.fob ? `<h4>Forward Operating Base</h4><p>Established at ${d.fob.latlon[0].toFixed(5)}, ${d.fob.latlon[1].toFixed(5)} with ${d.fob.facilities} facilities. It stays for the rest of the campaign.</p>` : ""}
    <h4>Objectives</h4><ul>${d.objectives.map((o: any) => `<li class="${o.state === "done" ? "objdone" : o.state === "failed" ? "objfail" : ""}">${o.state === "done" ? "✔" : "✗"} ${E(o.title)}</li>`).join("")}</ul>
    <h4>Survivors of the task force</h4><p>${d.survivors.map((u: any) => `${E(u.name)} (${u.kills} kills)`).join(" · ") || "none"}</p>`;
    this.show("debrief");
  }
  about(attr: string, stats: any, storage: string, offline: string) {
    $("aboutBody").innerHTML = `<p><b>DEAD FRONTLINE: FOB WARFARE</b> — a browser 2.5D real-time strategy game set on the real street plan of Toledo City, Cebu.</p>
    <h4>Map data</h4><p>${E(attr)}</p>
    <p class="fine">Roads, coastline, landmarks and named places come from OpenStreetMap. The map's original buildings have been removed; buildings are being added by hand. Landmark identification is matched by OSM names and tags and should be checked on the ground. No Google Maps imagery, tiles or models were used.</p>
    <table class="kv">${Object.entries(stats || {}).slice(0, 10).map(([k, v]) => `<tr><td class="fine">${E(k)}</td><td>${E(typeof v === "object" ? JSON.stringify(v) : v)}</td></tr>`).join("")}</table>
    <h4>Privacy</h4><p class="fine">No accounts, cookies, ads, trackers, analytics or third-party requests. Saves stay on this device. ${E(storage)} ${E(offline)}</p>
    <h4>Technology</h4><p class="fine">TypeScript game logic on a custom zero-dependency WebGL2 renderer with an orthographic isometric camera, chunk streaming, LOD and culling; 0.5 m navigation grid with A*, road-graph routing and Dijkstra flow fields; esbuild build; installable offline web app (service worker + IndexedDB saves).</p>`;
    this.show("about");
  }
}
export { E };

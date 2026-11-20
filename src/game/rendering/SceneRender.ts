// Feeds the WebGL renderer each frame: instanced units, infected, effects, defences, transports,
// markers and line overlays; draws the 2D overlay (selection box, health bars, labels, ghosts).
import type { Game } from "../Game";
import type { IsoCamera } from "../camera/IsoCamera";
import type { Battlefield } from "../Battlefield";
import { MODELS, UNIT_MODEL, rotFor } from "./Models";
import { Unit } from "../entities";
import { STRUCTURES } from "../data";
import { dist } from "../core";
import { Sprites } from "./Sprites";

type Inst = { x: number; y: number; z: number; rot: number; col: number[]; s: number };
const C = {
  sel: [0.35, 1.0, 0.45], hover: [1, 1, 1], focus: [1, 0.25, 0.2], obj: [1.0, 0.85, 0.25], objDone: [0.35, 0.9, 0.45],
  flash: [1.6, 1.3, 0.6], blood: [0.32, 0.03, 0.03], scorch: [0.09, 0.08, 0.07], ammo: [0.4, 0.46, 0.3], med: [0.86, 0.86, 0.84], kit: [0.62, 0.52, 0.3],
};

export interface Ghost { kind: "fob" | "deploy" | "strike" | "drop"; x: number; y: number; rot: number; ok: boolean; item?: string; reason?: string; radius?: number }

export class SceneRender {
  bf: Battlefield; lists = new Map<string, Inst[]>();
  overlay: HTMLCanvasElement; ctx: CanvasRenderingContext2D;
  quality = "medium";
  sprites = new Sprites();
  cam: IsoCamera | null = null; time = 0;
  constructor(bf: Battlefield, overlay: HTMLCanvasElement) {
    this.bf = bf; this.overlay = overlay; this.ctx = overlay.getContext("2d")!;
    for (const [k, fn] of Object.entries(MODELS)) bf.world.defineInstanced("m_" + k, fn());
  }
  private put(model: string, x: number, y: number, z: number, rot: number, col: number[], s = 1) {
    let l = this.lists.get(model);
    if (!l) this.lists.set(model, (l = []));
    l.push({ x, y, z, rot, col, s });
  }
  render(g: Game | null, cam: IsoCamera, time: number, ui: { hover: number | null; box: number[] | null; ghost: Ghost | null; showPaths: boolean }) {
    const bf = this.bf, w = bf.world;
    for (const l of this.lists.values()) l.length = 0;
    const aspect = bf.canvas.clientWidth / Math.max(1, bf.canvas.clientHeight);
    const R = cam.visibleRadius(aspect);
    const vis = (x: number, y: number, pad = 0) => Math.abs(x - cam.x) < R + pad && Math.abs(y - cam.y) < R + pad;
    const lines: { pts: Float32Array; color: number[]; strip?: boolean }[] = [];
    if (g) {
      const T = g.time;
      // ---- player units
      for (const u of g.units) {
        if (!u.alive || u.inVehicle !== null || !vis(u.x, u.y)) continue;
        const flash = u.hitT > 0 ? 1.8 : 1;
        const col = u.def.color.map((c) => c * flash);
        const spr = this.sprites.covers(u); // infantry come from the troop sprite sheet (overlay)
        if (!spr) this.put("m_" + (UNIT_MODEL[u.type] || "soldier"), u.x, u.y, u.z, rotFor(u.heading), col, 1);
        if (u.selected) this.put("m_ring", u.x, u.y, u.z, 0, C.sel, u.vehicle ? u.r * 1.4 : 1);
        else if (ui.hover === u.id) this.put("m_ring", u.x, u.y, u.z, 0, C.hover, u.vehicle ? u.r * 1.4 : 1);
        if (u.flashT > 0 && u.weapon && u.wid !== "flamer" && !spr) {
          const c = Math.cos(u.heading), s = Math.sin(u.heading), len = u.vehicle ? (u.wid === "tank_gun" ? 6.5 : 3) : 1.0;
          this.put("m_flash", u.x + c * len, u.y + s * len, u.z + (u.vehicle ? 2.4 : 1.17), rotFor(u.heading), C.flash, u.wid === "tank_gun" ? 3 : 0.9);
        }
        if (u.burn > 0) this.put("m_fire", u.x, u.y, u.z, T * 3, [1.4, 0.6, 0.15], 0.6);
      }
      // focus target ring
      const focusIds = new Set(g.units.filter((u) => u.selected && u.focus).map((u) => u.focus));
      // ---- infected
      for (const z of g.zombies) {
        if (z.dead || !vis(z.x, z.y)) continue;
        const k = z.hitT > 0 ? 1.7 : 1, b = z.burnT > 0;
        const col = b ? [0.9, 0.45, 0.15] : z.def.color.map((c) => c * k);
        const bob = z.state === "chase" ? Math.sin(T * 9 + z.id) * 0.06 : 0;
        if (!this.sprites.coversZombie(z)) this.put("m_" + (UNIT_MODEL[z.type] || "zombie"), z.x, z.y, z.z + bob, rotFor(z.heading), col, z.def.size);
        if (b) this.put("m_fire", z.x, z.y, z.z, T * 4 + z.id, [1.4, 0.6, 0.15], 0.5 * z.def.size);
        if (ui.hover === z.id || focusIds.has(z.id)) this.put("m_ring", z.x, z.y, z.z, 0, C.focus, z.def.size * 1.1);
      }
      for (const n of g.nests) {
        if (n.dead || !vis(n.x, n.y)) continue;
        const p = 1 + Math.sin(T * 2.2 + n.id) * 0.04;
        this.put("m_nest", n.x, n.y, n.z, n.id, n.hitT > 0 ? [0.9, 0.35, 0.4] : [0.55, 0.22, 0.28], n.size * p);
        this.put("m_puddle", n.x, n.y, n.z, 0, [0.25, 0.05, 0.07], 4.5 * n.size);
        if (ui.hover === n.id || focusIds.has(n.id)) this.put("m_ring", n.x, n.y, n.z, 0, C.focus, 3.5 * n.size);
      }
      // ---- survivors
      for (const c of g.civs) {
        if (c.dead || c.state === "gone" || !vis(c.x, c.y)) continue;
        if (!(c.military && (this.sprites.ready || this.sprites.inf))) this.put(c.military ? "m_soldier" : "m_civilian", c.x, c.y, c.z, rotFor(c.heading), c.color, 1);
        if (c.state === "hiding") this.put("m_beacon", c.x, c.y, c.z + 2.6 + Math.sin(T * 3 + c.id) * 0.15, T * 2, [0.3, 0.75, 1.0], 0.35);
      }
      for (const c of g.corpses) if (vis(c.x, c.y) && !this.sprites.coversCorpse(c)) this.put(c.model === "abomination" ? "m_abomination" : "m_corpse", c.x, c.y, c.z + (c.model === "abomination" ? -0.6 : 0), c.rot, c.col, c.s);
      // ---- objects
      for (const c of g.crates) if (!c.dead && vis(c.x, c.y)) this.put("m_crate", c.x, c.y, c.z, c.id, c.medical ? C.med : c.deploy || c.engineering ? C.kit : C.ammo, 1);
      for (const o of g.obstacles) {
        if (o.dead || !vis(o.x, o.y, 10)) continue;
        if (o.kind === "wreck") { this.put("m_wreck", o.x, o.y, o.z, -o.rot, [0.42 + (o.id % 3) * 0.1, 0.3, 0.24], 1); continue; }
        const model = "m_" + o.kind;
        if (o.built < 1) { this.put("m_site", o.x, o.y, o.z, -o.rot, [1, 1, 1], Math.max(o.w, o.d) * 0.5); continue; }
        const dmg = 0.55 + 0.45 * (o.hp / o.maxHp);
        const col = o.kind === "reinforced_gate" ? [0.5, 0.55, 0.52] : [1, 1, 1];
        if (o.kind === "reinforced_gate" && o.w > 6) { this.put(model, o.x, o.y, o.z, -o.rot, col.map((c) => c * dmg), o.w / 10.4); continue; }
        this.put(MODELS[o.kind] ? model : "m_site", o.x, o.y, o.z, -o.rot, col.map((c) => c * dmg), 1);
        if (o.kind === "lighting") this.put("m_flash", o.x, o.y, o.z + 4.15, 0, [2, 1.9, 1.4], 0.6);
      }
      // ---- FOB construction outlines and flag
      if (g.fob.site) {
        for (const f of g.fob.facilities) {
          if (f.built >= 1 || f.type === "perimeter") continue;
          lines.push({ pts: rectLine(bf, f.x, f.y, f.w, f.d, f.rot, 0.4), color: [1, 0.85, 0.2, 1], strip: true });
          if (f === g.fob.facilities.find((q) => q.built < 1)) {
            const hgt = (STRUCTURES[f.type]?.height || 3) * f.built;
            lines.push({ pts: rectLine(bf, f.x, f.y, f.w, f.d, f.rot, hgt + 0.3), color: [1, 0.85, 0.2, 1], strip: true });
            this.put("m_site", f.x, f.y, bf.h(f.x, f.y), -f.rot, [1, 1, 1], Math.min(f.w, f.d) * 0.3);
          }
        }
        const perim = g.fob.facilities.filter((f) => f.type === "perimeter" && f.built < 1);
        for (const f of perim) lines.push({ pts: rectLine(bf, f.x, f.y, f.w, f.d, f.rot, 0.3), color: [1, 0.85, 0.2, 1], strip: true });
        if (g.fob.established) this.put("m_flag", g.fob.site.x, g.fob.site.y, bf.h(g.fob.site.x, g.fob.site.y), T * 0.4, [0.25, 0.45, 0.95], 1.2);
        const cc = g.fob.facilities.find((f) => f.type === "communications" && f.built >= 1);
        if (cc) this.put("m_antenna", cc.x + 2.5, cc.y + 2.5, bf.h(cc.x, cc.y) + 4, 0, [1, 1, 1], 1);
      }
      // ---- transports
      for (const t of g.transports) {
        if (t.done) continue;
        if (t.kind === "heli") { this.put("m_heli", t.x, t.y, t.z, rotFor(t.heading), [0.3, 0.36, 0.27], 1); this.put("m_puddle", t.x, t.y, bf.h(t.x, t.y), 0, [0.2, 0.22, 0.18], 3 * Math.max(0, 1 - (t.z - bf.h(t.x, t.y)) / 50)); }
        else this.put("m_truck", t.x, t.y, t.z, rotFor(t.heading), [0.34, 0.37, 0.27], 1);
      }
      // ---- objective markers
      if (g.mission) for (const o of g.mission.objectives) {
        if (o.state === "locked" || (o.state === "done" && o.phase === "fob")) continue;
        if (o.phase === "fob" && !g.fob.site && o.kind !== "fob") continue;
        if (o.kind === "fob" && !g.fob.site) continue;
        const z = bf.h(o.x, o.y);
        const col = o.state === "done" ? C.objDone : C.obj;
        if (o.state === "active") this.put("m_beacon", o.x, o.y, z + 14 + Math.sin(T * 2) * 0.6, T * 1.5, col, 1.6);
        this.put("m_objmarker", o.x, o.y, z, 0, col, 1.4);
        if (o.state === "active") lines.push({ pts: circleLine(bf, o.x, o.y, o.r, 48), color: [1, 0.85, 0.25, 0.6], strip: true });
      }
      // ---- effects
      const tracers: number[] = [];
      const fxSprites = this.sprites.ready;
      for (const e of g.effects) {
        if (!vis(e.x, e.y, 20)) continue;
        if (fxSprites && (e.kind === "blast" || e.kind === "smoke" || e.kind === "hit" || e.kind === "spark")) continue; // sprite sheet effects
        const f = e.t / e.life;
        switch (e.kind) {
          case "tracer": tracers.push(e.x, e.z, -e.y, e.x2!, e.z2!, -e.y2!); break;
          case "blood": this.put("m_blood", e.x, e.y, e.z, e.x * 7, C.blood, e.s); break;
          case "scorch": this.put("m_blood", e.x, e.y, e.z + 0.01, e.y, C.scorch, e.s); break;
          case "blast": this.put("m_blast", e.x, e.y, e.z, 0, [2.2 - f, 1.2 - f * 0.9, 0.35], e.s * (0.3 + f * 0.8)); break;
          case "gas": this.put("m_blast", e.x, e.y, e.z, 0, [0.5, 0.8, 0.2], e.s * (0.3 + f * 0.7)); break;
          case "smoke": this.put("m_blast", e.x, e.y, e.z + f * 6, 0, [0.4 - f * 0.1, 0.4 - f * 0.1, 0.4 - f * 0.1], e.s * (0.6 + f)); break;
          case "dust": this.put("m_blast", e.x, e.y, e.z, 0, [0.6, 0.55, 0.45], e.s * (0.3 + f) * 0.6); break;
          case "fire": this.put("m_fire", e.x, e.y, e.z, e.t * 5 + e.x, [1.6, 0.7 - f * 0.4, 0.15], e.s * (1 - f * 0.5)); break;
          case "flame": {
            const c = Math.cos(e.rot!), s = Math.sin(e.rot!);
            for (let k = -2; k <= 2; k++) this.put("m_fire", e.x + c * k * e.s * 0.4, e.y + s * k * e.s * 0.4, e.z - 0.8, k + e.t * 9, [1.7, 0.8, 0.2], 0.45 + (k + 2) * 0.12);
            break;
          }
          case "hit": this.put("m_flash", e.x, e.y, e.z, e.t * 9, [1.0, 0.15, 0.1], 0.5); break;
          case "spark": this.put("m_flash", e.x, e.y, e.z, e.t * 9, [1.6, 1.4, 0.5], 0.4); break;
          case "heal": this.put("m_beacon", e.x, e.y, e.z + f, e.t * 6, [0.4, 1.0, 0.5], 0.3); break;
          case "order": this.put("m_ring", e.x, e.y, e.z, 0, e.col || C.sel, 0.6 + f * 1.6); break;
        }
      }
      for (const p of g.projectiles) this.put("m_flash", p.x, p.y, p.z, T * 20, [1.5, 1.1, 0.5], p.kind === "artillery" ? 1.2 : 0.7);
      if (tracers.length) lines.push({ pts: new Float32Array(tracers), color: [1.0, 0.9, 0.5, 1] });
      // paths of selected units
      if (ui.showPaths) {
        for (const u of g.units) {
          if (!u.selected || !u.path || u.pathIdx >= u.path.length) continue;
          const pts: number[] = [u.x, u.z + 0.3, -u.y];
          for (let k = u.pathIdx; k < u.path.length; k++) { const [px, py] = u.path[k]; pts.push(px, bf.h(px, py) + 0.3, -py); }
          lines.push({ pts: new Float32Array(pts), color: [0.4, 1, 0.5, 0.5], strip: true });
        }
      }
      // FOB / deployable / strike placement ghost
      if (ui.ghost) {
        const gh = ui.ghost, col = gh.ok ? [0.3, 1, 0.4, 1] : [1, 0.3, 0.25, 1];
        if (gh.kind === "fob") for (const p of g.fob.plan(gh.x, gh.y, gh.rot)) lines.push({ pts: rectLine(bf, p.x, p.y, p.w, p.d, p.rot, 0.5), color: col, strip: true });
        else if (gh.kind === "deploy" && gh.item) { const d = STRUCTURES[gh.item]; const sz = d.size || [2, 1]; lines.push({ pts: rectLine(bf, gh.x, gh.y, sz[0], sz[1], gh.rot, 0.4), color: col, strip: true }); }
        else lines.push({ pts: circleLine(bf, gh.x, gh.y, gh.radius || 6, 40), color: gh.kind === "strike" ? [1, 0.4, 0.2, 1] : col, strip: true });
      }
    }
    // push instance lists
    for (const k of w.instOrder) if (k.startsWith("m_")) w.setCharacters(k, this.lists.get(k) || []);
    // stream around the camera; LOD distances follow the zoom
    w.lod.near = this.quality === "low" ? 220 : this.quality === "high" ? 420 : 330;
    w.lod.far = Math.max(450, Math.min(2200, R + 250));
    const scene = w.update(cam.x, cam.y, Math.floor(time * 60), this.quality === "low" ? 6 : 10);
    scene.lines = lines;
    const view = cam.view(time);
    if (g && g.shake > 0) { const s = g.shake * 0.4 * (cam.zoom / 60); const j = Math.sin(time * 91.7) * 0.5; view.eye[0] += j * s; view.target[0] += j * s; }
    bf.r.render(view, scene);
    this.cam = cam; this.time = time;
    this.drawOverlay(g, cam, ui);
    return scene;
  }

  drawOverlay(g: Game | null, cam: IsoCamera, ui: { box: number[] | null; ghost: Ghost | null; hover: number | null }) {
    const cv = this.overlay, ctx = this.ctx, dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = cv.clientWidth, H = cv.clientHeight;
    if (cv.width !== Math.floor(W * dpr) || cv.height !== Math.floor(H * dpr)) { cv.width = Math.floor(W * dpr); cv.height = Math.floor(H * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    if (!g) return;
    const bf = this.bf;
    this.sprites.overlay(ctx, g, bf, W, H, this.time, "ground");
    this.sprites.draw(ctx, g, bf, cam, W, H, this.time);
    this.sprites.overlay(ctx, g, bf, W, H, this.time, "labels");
    const px = 1 / (cam.zoom / 60);
    const bar = (x: number, y: number, w: number, f: number, col: string, h = 4) => {
      ctx.fillStyle = "rgba(0,0,0,.6)"; ctx.fillRect(x - w / 2 - 1, y - 1, w + 2, h + 2);
      ctx.fillStyle = col; ctx.fillRect(x - w / 2, y, w * Math.max(0, Math.min(1, f)), h);
    };
    const bw = Math.max(16, Math.min(40, 26 * px));
    for (const u of g.units) {
      if (!u.alive || u.inVehicle !== null) continue;
      const show = u.selected || u.hp < u.maxHp * 0.98 || ui.hover === u.id;
      if (!show) continue;
      const s = bf.screen(u.x, u.y, u.z + (u.vehicle ? 3.6 : 2.3));
      if (!s || s[0] < -40 || s[1] < -40 || s[0] > W + 40 || s[1] > H + 40) continue;
      const f = u.hp / u.maxHp;
      bar(s[0], s[1], bw * (u.vehicle ? 1.6 : 1), f, f > 0.6 ? "#5fd36a" : f > 0.3 ? "#e8c44a" : "#e5533d");
      if (u.weapon && (u.selected || u.ammoFrac < 0.25)) bar(s[0], s[1] + 6, bw * (u.vehicle ? 1.6 : 1), u.reloadT > 0 ? 0 : u.mag / u.weapon.mag, u.ammoFrac < 0.15 ? "#e5533d" : "#d9c27a", 2);
      if (u.reloadT > 0 && u.selected) { ctx.fillStyle = "#ffd97a"; ctx.font = "10px system-ui"; ctx.textAlign = "center"; ctx.fillText("reloading", s[0], s[1] - 4); }
      if (u.group && u.selected) { ctx.fillStyle = "#fff"; ctx.font = "bold 10px system-ui"; ctx.textAlign = "left"; ctx.fillText(String(u.group), s[0] + bw / 2 + 3, s[1] + 5); }
      if (u.passengers.length) { ctx.fillStyle = "#cfe"; ctx.font = "10px system-ui"; ctx.textAlign = "center"; ctx.fillText(`${u.passengers.length}/${u.def.capacity}`, s[0], s[1] - 4); }
    }
    for (const z of g.zombies) {
      if (z.dead || (z.hp >= z.maxHp && ui.hover !== z.id && !z.def.boss)) continue;
      if (Math.abs(z.x - cam.x) > cam.zoom * 3 || Math.abs(z.y - cam.y) > cam.zoom * 3) continue;
      const s = bf.screen(z.x, z.y, z.z + 2.2 * z.def.size);
      if (!s || s[0] < 0 || s[1] < 0 || s[0] > W || s[1] > H) continue;
      bar(s[0], s[1], z.def.boss ? 80 : bw * 0.7, z.hp / z.maxHp, "#c43b3b", z.def.boss ? 5 : 3);
    }
    for (const n of g.nests) {
      if (n.dead) continue;
      const s = bf.screen(n.x, n.y, n.z + 4.5 * n.size);
      if (!s || s[0] < 0 || s[1] < 0 || s[0] > W || s[1] > H) continue;
      bar(s[0], s[1], 60, n.hp / n.maxHp, "#b0306a", 4);
      ctx.fillStyle = "#f2b"; ctx.font = "bold 11px system-ui"; ctx.textAlign = "center"; ctx.fillText("NEST", s[0], s[1] - 4);
    }
    for (const o of g.obstacles) {
      if (o.dead || o.kind === "wreck" || (o.hp >= o.maxHp && o.built >= 1)) continue;
      const s = bf.screen(o.x, o.y, o.z + 2.5);
      if (!s || s[0] < 0 || s[1] < 0 || s[0] > W || s[1] > H) continue;
      if (o.built < 1) bar(s[0], s[1], 30, o.built, "#e8c44a", 3); else bar(s[0], s[1], 30, o.hp / o.maxHp, "#9ab", 3);
    }
    // objective labels
    ctx.textAlign = "center"; ctx.font = "600 12px system-ui";
    const placed: [number, number][] = [];
    if (g.mission) for (const o of g.mission.active) {
      if (o.phase === "fob" && !g.fob.site && o.kind !== "fob") continue;
      if (o.kind === "fob" && !g.fob.site) continue;
      const s = bf.screen(o.x, o.y, bf.h(o.x, o.y) + 17);
      if (!s) continue;
      // off-screen objectives: arrow labels along the edges, clear of the HUD panels
      const left = W > 900 ? 360 : 70, top = 70, right = W > 900 ? W - 250 : W - 70, bottom = H - (W > 900 ? 170 : 240);
      const x = Math.max(left, Math.min(right, s[0]));
      let y = Math.max(top, Math.min(bottom, s[1]));
      const off = x !== s[0] || y !== s[1];
      while (placed.some(([px, py]) => Math.abs(px - x) < 120 && Math.abs(py - y) < 19)) y += 20; // stack labels that share a spot
      placed.push([x, y]);
      ctx.fillStyle = "rgba(10,12,10,.7)";
      const label = (off ? "➤ " : "") + o.short + (off ? ` · ${Math.round(dist(cam.x, cam.y, o.x, o.y))} m` : "");
      const tw = ctx.measureText(label).width + 12;
      ctx.fillRect(x - tw / 2, y - 14, tw, 18);
      ctx.fillStyle = "#ffd65a"; ctx.fillText(label, x, y);
    }
    // transport labels
    for (const t of g.transports) {
      if (t.done) continue;
      const s = bf.screen(t.x, t.y, t.z + 5);
      if (!s || s[0] < 0 || s[1] < 0 || s[0] > W || s[1] > H) continue;
      ctx.fillStyle = "#cde"; ctx.font = "11px system-ui"; ctx.fillText(t.delivery < 0 ? "EVAC" : t.kind === "heli" ? "SUPPLY HELO" : "CONVOY", s[0], s[1]);
    }
    for (const c of g.crates) {
      if (c.dead) continue;
      const s = bf.screen(c.x, c.y, c.z + 1.6);
      if (!s || s[0] < 0 || s[1] < 0 || s[0] > W || s[1] > H || cam.zoom > 120) continue;
      ctx.fillStyle = "#efe6c4"; ctx.font = "10px system-ui"; ctx.fillText(c.label, s[0], s[1]);
    }
    if (ui.ghost && ui.ghost.reason && !ui.ghost.ok) {
      const s = bf.screen(ui.ghost.x, ui.ghost.y, bf.h(ui.ghost.x, ui.ghost.y) + 3);
      if (s) { ctx.font = "600 12px system-ui"; const tw = ctx.measureText(ui.ghost.reason).width + 14; ctx.fillStyle = "rgba(60,0,0,.8)"; ctx.fillRect(s[0] - tw / 2, s[1] - 30, tw, 20); ctx.fillStyle = "#ffd0c8"; ctx.fillText(ui.ghost.reason, s[0], s[1] - 16); }
    }
    if (ui.box) {
      const [x0, y0, x1, y1] = ui.box;
      ctx.strokeStyle = "#7dff8a"; ctx.lineWidth = 1; ctx.fillStyle = "rgba(120,255,140,.08)";
      ctx.fillRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0));
      ctx.strokeRect(Math.min(x0, x1) + 0.5, Math.min(y0, y1) + 0.5, Math.abs(x1 - x0), Math.abs(y1 - y0));
    }
  }
}

function rectLine(bf: Battlefield, x: number, y: number, w: number, d: number, rot: number, up: number): Float32Array {
  const c = Math.cos(rot), s = Math.sin(rot), out: number[] = [];
  const corners = [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2], [-w / 2, -d / 2]];
  for (const [u, v] of corners) { const px = x + u * c - v * s, py = y + u * s + v * c; out.push(px, bf.h(px, py) + up, -py); }
  return new Float32Array(out);
}
function circleLine(bf: Battlefield, x: number, y: number, r: number, n: number): Float32Array {
  const out: number[] = [];
  for (let k = 0; k <= n; k++) { const a = (k / n) * Math.PI * 2, px = x + Math.cos(a) * r, py = y + Math.sin(a) * r; out.push(px, bf.h(px, py) + 0.4, -py); }
  return new Float32Array(out);
}
export { Unit };

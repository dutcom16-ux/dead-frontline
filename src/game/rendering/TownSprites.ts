// Pre-rendered town: the church, the hospital, school blocks, mid-rise shops and two-storey houses
// replace their map buildings, and coconut palms, mango trees and banana plants replace the 3D trees.
// public/sprites/town/town.json comes from tools/town3d/game_town.py, which also chose the buildings.
//
// A sprite building takes the sprite's footprint, height and door (collision, navigation, line of
// sight, cover and the minimap all follow) and shows its intact, damaged or destroyed frame as the
// building takes damage. The sprites are drawn for 8 views, so the camera turns in 90° steps from the
// town's street grid (gridYaw) and every chosen building lines up with the grid.
import type { Battlefield } from "../Battlefield";
import type { IsoCamera } from "../camera/IsoCamera";

type Frame = [number, number, number, number, number, number];        // x, y, w, h, anchor x, anchor y
interface BDef { page: string; size: [number, number]; frames: Frame[][]; fp: number[]; ent: [number, number]; box: number[]; lot: number[]; lv: number; h: number; rh: number }
interface TDef { views: [number, number, number, number, number, number, number][]; h: number; r: number }
interface Placement { id: string; type: string; x: number; y: number; front: number; s: number; hide?: string[] }
interface FxDef { page: string; ppm: number; frame: number[]; frames: number; fps: number; box: [number, number] }   // box: [metres toward the camera when hidden, height]
interface TownData {
  ppm: number; camera_yaw_deg: number; winding: number;
  buildings: Record<string, BDef>; trees: { page: string; size: [number, number]; kinds: Record<string, TDef> };
  placements: Placement[];
  /** fire and smoke loops, and each building's fire points: [kind, x, y, z (sprite metres), scale, phase,
   *  bit mask of the views (bit v = view v) in which the building does not hide it, and for a fire on a
   *  wall the yaw of the wall's outward normal (deg, sprite space) or null] */
  fx?: { fire: FxDef; smoke: FxDef; emitters: Record<string, Record<"damaged" | "destroyed", [string, number, number, number, number, number, number, number | null][]>> };
}
interface Placed { b: any; def: BDef; type: string; x: number; y: number; z: number; lift: number; front: number; s: number; cf: number; sf: number }
interface Batch { tex: any; ppm: number; slot: any; data: Float32Array; n: number; frames: number; fps: number; soft: boolean }

const D2R = Math.PI / 180;
const u = (c: number): [number, number] => [Math.sin(c * D2R), Math.cos(c * D2R)];
const hash = (x: number, y: number, k: number) => { const s = Math.sin(x * 12.9898 + y * 78.233 + k * 37.719) * 43758.5453; return s - Math.floor(s); };

export class TownSprites {
  data: TownData | null = null;
  imgs = new Map<string, HTMLImageElement>();
  tex = new Map<string, any>();
  placed: Placed[] = [];
  batches = new Map<string, Batch>();
  private r: any = null;
  private treeKey = "";
  /** the camera's heading in the town's street grid (radians); 90° steps keep the sprites lined up */
  get gridYaw() { return this.data ? this.data.camera_yaw_deg * D2R : Math.PI / 4; }

  async load(base = "sprites/town/") {
    try {
      const r = await fetch(base + "town.json");
      if (!r.ok) throw new Error("town.json: HTTP " + r.status);
      const d: TownData = await r.json();
      const pages = new Set<string>([d.trees.page, ...Object.values(d.buildings).map((b) => b.page)]);
      if (d.fx) { pages.add(d.fx.fire.page); pages.add(d.fx.smoke.page); }
      await Promise.all([...pages].map((p) => new Promise<void>((res, rej) => {
        const i = new Image();
        i.onload = () => { this.imgs.set(p, i); res(); };
        i.onerror = () => rej(new Error("sprite page " + p));
        i.src = base + p;
      })));
      this.data = d;
    } catch (e) {
      console.warn("town sprites unavailable, keeping the 3D buildings and trees", e);
      this.data = null;
    }
  }

  /** give the chosen map buildings their sprite's footprint, height and door (before the world is built) */
  apply(map: any) {
    const d = this.data;
    if (!d) return;
    for (const p of d.placements) {
      const b = map.getBuilding(p.id), def = d.buildings[p.type];
      if (!b || !def) continue;
      for (const id of p.hide || []) { const h = map.getBuilding(id); if (h) { h.hidden = true; h.enter = 0; } }
      const X = u(p.front - 90), Z = u(p.front), s = p.s;
      const w = (lx: number, lz: number): [number, number] => [p.x + s * (lx * X[0] + lz * Z[0]), p.y + s * (lx * X[1] + lz * Z[1])];
      let fp: number[] = [];
      for (let k = 0; k < def.fp.length; k += 2) fp.push(...w(def.fp[k], def.fp[k + 1]));
      let [ei, et] = def.ent;
      const n = fp.length / 2;
      let area = 0;
      for (let i = 0; i < n; i++) { const j = (i + 1) % n; area += fp[2 * i] * fp[2 * j + 1] - fp[2 * j] * fp[2 * i + 1]; }
      if (Math.sign(area) !== Math.sign(d.winding || 1)) {                        // the map's winding order
        const r: number[] = [];
        for (let k = n - 1; k >= 0; k--) r.push(fp[2 * k], fp[2 * k + 1]);
        fp = r; ei = (n - 2 - ei + n) % n; et = 1 - et;
      }
      const xs = fp.filter((_, k) => k % 2 === 0), ys = fp.filter((_, k) => k % 2 === 1);
      const bb = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
      const [bx0, bx1, bz0, bz1] = def.box, c = w((bx0 + bx1) / 2, (bz0 + bz1) / 2);
      const long = bx1 - bx0 > bz1 - bz0;
      Object.assign(b, {
        fp, bb, holes: undefined, ent: [ei, et], h: def.h * s, lv: def.lv, rh: def.rh * s, rf: def.rh > 0 ? "gabled" : "flat",
        area: Math.abs(area) / 2, ip: c, obb: [c[0], c[1], (long ? bx1 - bx0 : bz1 - bz0) * s, (long ? bz1 - bz0 : bx1 - bx0) * s, ((p.front + (long ? 90 : 0)) % 180 + 180) % 180],
        sprite: p.type,
      });
      b.src = { ...b.src, fp, h: b.h, lv: b.lv, rf: b.rf, rh: b.rh };
      // a footprint that now reaches into a neighbouring chunk is listed there too
      const cs = map.cs, home = b.chunk;
      for (let i = Math.floor(bb[0] / cs); i <= Math.floor(bb[2] / cs); i++)
        for (let j = Math.floor(bb[1] / cs); j <= Math.floor(bb[3] / cs); j++) {
          const k = i + "," + j;
          if (k === home) continue;
          let ch = map.chunks.get(k);
          if (!ch) { ch = { i, j, bounds: [i * cs, j * cs, (i + 1) * cs, (j + 1) * cs], buildings: [], xref: [], key: k, meta: null }; map.chunks.set(k, ch); }
          if (!ch.xref.some((x: any) => x[0] === b.id)) ch.xref.push([b.id, ...home.split(",").map(Number)]);
        }
      this.placed.push({ b, def, type: p.type, x: p.x, y: p.y, z: NaN, lift: 0, front: p.front, s, cf: Math.cos(p.front * D2R), sf: Math.sin(p.front * D2R) });
    }
  }

  /** upload the atlas pages and take over the trees (after the world is built) */
  attach(bf: Battlefield) {
    const d = this.data;
    if (!d) return;
    this.r = bf.r;
    for (const [p, img] of this.imgs) this.tex.set(p, bf.r.spriteTexture(img));
    const w = bf.world;
    // no trees on the forecourts, yards and plazas of the sprite buildings
    const lots = this.placed.map((q) => ({ q, lot: q.def.lot }));
    w.trees = w.trees.filter((t: any) => !lots.some(({ q, lot }) => {
      const dx = t.x - q.x, dy = t.y - q.y, X = u(q.front - 90), Z = u(q.front);
      const lx = (dx * X[0] + dy * X[1]) / q.s, lz = (dx * Z[0] + dy * Z[1]) / q.s;
      return lx > lot[0] - 1 && lx < lot[1] + 1 && lz > lot[2] - 1 && lz < lot[3] + 1;
    }));
    w.spriteTrees = true;
    // the sprite stands on the terrain at its pivot; for depth, its ground is lifted to the highest
    // terrain under the lot (forecourts, shadows and yards stay visible on a slope)
    for (const q of this.placed) {
      q.z = bf.map.groundZ(q.x, q.y);
      const [x0, x1, z0, z1] = q.def.lot, X = u(q.front - 90), Z = u(q.front);
      let top = q.z;
      for (const fx of [0, 0.25, 0.5, 0.75, 1]) for (const fz of [0, 0.25, 0.5, 0.75, 1]) {
        const lx = x0 + (x1 - x0) * fx, lz = z0 + (z1 - z0) * fz;
        top = Math.max(top, bf.h(q.x + q.s * (lx * X[0] + lz * Z[0]), q.y + q.s * (lx * X[1] + lz * Z[1])));
      }
      q.lift = (top - q.z) / q.s + 0.25;
    }
  }

  /** this frame's sprite batches for the renderer */
  frame(bf: Battlefield, cam: IsoCamera, radius: number): any[] {
    const d = this.data;
    if (!d || !this.tex.size) return [];
    const out: any[] = [];
    const yawDeg = cam.yaw / D2R, [fx, fy] = cam.forward;
    // ---- buildings: frame by damage, view by the camera's heading; damaged and destroyed ones burn
    const byPage = new Map<string, { q: Placed; dep: number; st: number }[]>();
    const burning: { q: Placed; st: number }[] = [];
    for (const q of this.placed) {
      if (Math.abs(q.x - cam.x) > radius + 60 || Math.abs(q.y - cam.y) > radius + 60 || q.b.removed) continue;
      const dmg = q.b.rs?.dmg || 0;
      const st = q.b.collapsed || dmg >= 3 ? 2 : dmg >= 1 ? 1 : 0;
      const l = byPage.get(q.def.page) || [];
      l.push({ q, dep: q.x * fx + q.y * fy, st });
      byPage.set(q.def.page, l);
      if (st > 0) burning.push({ q, st });
    }
    for (const [page, l] of byPage) {
      l.sort((a, b) => b.dep - a.dep);
      const data = new Float32Array(l.length * 20);
      l.forEach(({ q, st }, i) => {
        const view = ((Math.round((q.front - yawDeg) / 45) % 8) + 8) % 8;
        const f = q.def.frames[st][view], bx = q.def.box, o = i * 20;
        data.set([q.x, q.z, -q.y, q.s, f[0], f[1], f[2], f[3], f[4], f[5], q.cf, q.sf, bx[0], bx[1], bx[2], bx[3], bx[4], 0, 0, q.lift], o);
      });
      out.push(this.batch("b:" + page, page, data, l.length));
    }
    if (d.fx) out.push(...this.fires(burning, cam, yawDeg));
    // ---- trees (rebuilt when the camera moves, zooms or turns)
    const key = [Math.round(cam.x / 12), Math.round(cam.y / 12), Math.round(radius / 20), Math.round(yawDeg / 5)].join(",");
    const tb = this.batches.get("trees");
    if (key !== this.treeKey || !tb) {
      this.treeKey = key;
      const T = d.trees.kinds, list: { t: any; dep: number }[] = [];
      for (const t of bf.world.trees) {
        if (Math.abs(t.x - cam.x) > radius + 15 || Math.abs(t.y - cam.y) > radius + 15) continue;
        list.push({ t, dep: t.x * fx + t.y * fy });
      }
      list.sort((a, b) => b.dep - a.dep);
      const data = new Float32Array(list.length * 20);
      list.forEach(({ t }, i) => {
        const h = hash(t.x, t.y, 1);
        const kind = t.kind === 2 ? "palm" : h < 0.68 ? "mango" : "banana";
        const k = T[kind], v = k.views[hash(t.x, t.y, 2) < 0.5 ? 0 : 1];
        const s = Math.max(0.85, t.s) * (kind === "banana" ? 1.1 : 1);
        data.set([t.x, t.z, -t.y, s, v[0], v[1], v[2], v[3], v[5], v[6], 1, 0, -k.r, k.r, -k.r, k.r, k.h, v[4], hash(t.x, t.y, 3) * 4, 0.6], i * 20);
      });
      this.batch("trees", d.trees.page, data, list.length, { frames: 4, fps: 4 });
    }
    out.push(this.batches.get("trees"));
    return out;
  }

  /** fire and smoke over the burning buildings, back to front */
  /** fire and smoke over the burning buildings, back to front. Where the building hides a fire in
   *  this view (worked out from the model), it stands on a plane facing the camera at the fire, so
   *  the building covers the flames and only the smoke above the roof shows. Where it does not, its
   *  depth is brought in front of the building's depth box: for a fire on a wall, a slab parallel to
   *  the wall just outside the box (the flames lick up the facade); for one on a roof or in the
   *  rubble, a plane facing the camera, far enough forward for the whole flame or plume. */
  private fires(burning: { q: Placed; st: number }[], cam: IsoCamera, yawDeg: number): Batch[] {
    const F = this.data!.fx!, lists: Record<string, { dep: number; v: number[] }[]> = { fire: [], smoke: [] };
    const [fx, fy] = cam.forward, cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
    for (const { q, st } of burning) {
      const em = F.emitters[q.type]?.[st === 1 ? "damaged" : "destroyed"];
      if (!em) continue;
      const X = u(q.front - 90), Z = u(q.front);
      const view = ((Math.round((q.front - yawDeg) / 45) % 8) + 8) % 8;
      // the way to the camera in the building's own frame
      const dir = [-(fx * X[0] + fy * X[1]) * cp, sp, -(fx * Z[0] + fy * Z[1]) * cp];
      const b = q.def.box, lo = [b[0], q.lift, b[2]], hi = [b[1], b[4], b[3]];
      for (const [kind, lx, ly, lz, sc, ph, mask, wall] of em) {
        const D = (F as any)[kind] as FxDef;
        if (!D) continue;
        const x = q.x + q.s * (lx * X[0] + lz * Z[0]), y = q.y + q.s * (lx * X[1] + lz * Z[1]);
        const [near, top] = D.box, f = D.frame, k = sc * q.s, smoke = kind === "smoke";
        let rot = [1, 0], box = [0, 0, near / k, 0];             // hidden: a plane facing the camera at the fire
        if ((mask >> view) & 1) {
          const e = [lx, ly, lz];
          if (wall !== null && wall !== undefined) {
            // a slab parallel to the wall, just outside the building's depth box
            const nx = Math.round(Math.sin(wall * D2R)), nz = Math.round(Math.cos(wall * D2R));
            const gap = nx > 0 ? hi[0] - lx : nx < 0 ? lx - lo[0] : nz > 0 ? hi[2] - lz : lz - lo[2];
            const wx = nx * X[0] + nz * Z[0], wy = nx * X[1] + nz * Z[1], c = Math.atan2(wx, wy);
            const z0 = (Math.max(0, gap) * q.s + 0.25) / k, half = smoke ? 6.0 : 1.5;
            rot = [Math.cos(c), Math.sin(c)];
            box = [-half, half, z0, z0 + 1.0 / k];
          } else {
            let tf = Infinity;
            for (let a = 0; a < 3; a++) {
              if (Math.abs(dir[a]) < 1e-6) continue;
              const t0 = (lo[a] - e[a]) / dir[a], t1 = (hi[a] - e[a]) / dir[a];
              tf = Math.min(tf, Math.max(t0, t1));
            }
            const tall = (smoke ? 8.0 : 4.6) * k * 1.25;         // the whole flame or plume clears the box
            box = [0, 0, ((isFinite(tf) ? Math.max(0, tf) * q.s : 0) + 0.4 + tall) / k, 0];
          }
        }
        lists[kind].push({ dep: x * fx + y * fy, v: [x, q.z + q.s * ly, -y, k, f[0], f[1], f[2], f[3], f[5], f[6], rot[0], rot[1], ...box, top, f[4], ph, -1] });
      }
    }
    const out: Batch[] = [];
    for (const kind of ["fire", "smoke"]) {
      const l = lists[kind].sort((a, b) => b.dep - a.dep), D = (F as any)[kind] as FxDef;
      const data = new Float32Array(l.length * 20);
      l.forEach((e, i) => data.set(e.v, i * 20));
      out.push(this.batch("fx:" + kind, D.page, data, l.length, { frames: D.frames, fps: D.fps, soft: true, ppm: D.ppm }));
    }
    return out;
  }

  private batch(key: string, page: string, data: Float32Array, n: number, o: { frames?: number; fps?: number; soft?: boolean; ppm?: number } = {}): Batch {
    let b = this.batches.get(key);
    if (!b) {
      b = { tex: this.tex.get(page), ppm: o.ppm ?? this.data!.ppm, slot: null, data, n, frames: o.frames ?? 1, fps: o.fps ?? 0, soft: !!o.soft };
      this.batches.set(key, b);
    }
    b.data = data; b.n = n;
    b.slot = this.r.spriteBatch(b.slot, data, n);
    return b;
  }
}

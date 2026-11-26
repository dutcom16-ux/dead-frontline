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
interface TownData {
  ppm: number; camera_yaw_deg: number; winding: number;
  buildings: Record<string, BDef>; trees: { page: string; size: [number, number]; kinds: Record<string, TDef> };
  placements: Placement[];
}
interface Placed { b: any; def: BDef; type: string; x: number; y: number; z: number; lift: number; front: number; s: number; cf: number; sf: number }
interface Batch { tex: any; ppm: number; slot: any; data: Float32Array; n: number }

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
    // ---- buildings: frame by damage, view by the camera's heading
    const byPage = new Map<string, { q: Placed; dep: number; st: number }[]>();
    for (const q of this.placed) {
      if (Math.abs(q.x - cam.x) > radius + 60 || Math.abs(q.y - cam.y) > radius + 60 || q.b.removed) continue;
      const dmg = q.b.rs?.dmg || 0;
      const st = q.b.collapsed || dmg >= 3 ? 2 : dmg >= 1 ? 1 : 0;
      const l = byPage.get(q.def.page) || [];
      l.push({ q, dep: q.x * fx + q.y * fy, st });
      byPage.set(q.def.page, l);
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
      this.batch("trees", d.trees.page, data, list.length);
    }
    out.push(this.batches.get("trees"));
    return out;
  }

  private batch(key: string, page: string, data: Float32Array, n: number): Batch {
    let b = this.batches.get(key);
    if (!b) { b = { tex: this.tex.get(page), ppm: this.data!.ppm, slot: null, data, n }; this.batches.set(key, b); }
    b.data = data; b.n = n;
    b.slot = this.r.spriteBatch(b.slot, data, n);
    return b;
  }
}

// Gameplay physics on the real building footprints:
//  * collision: circle-vs-wall segments (exterior walls, courtyard walls, interior partitions,
//    door leaves). Enterable buildings have a door gap; the door blocks while closed.
//  * navigation: 0.5 m grid per chunk (walls, solid buildings, sea, rivers; bridges and piers
//    walkable), A* paths and Dijkstra flow fields for crowds.
//  * line of sight: 2.5D ray against walls (with their real heights) and terrain.
//  * cover, building damage states and destructible doors / light-material walls.
// Map 2D coordinates: x = east, y = north (metres).
import { interiorPlan } from "./meshgen.js";
import { ARCH } from "./archetypes.js";
import { pointInPoly } from "./geom.js";
import { T } from "./atlas.js";

export const CELL = 0.5;
const HCELL = 8; // collision hash cell (m)
export const NAV = { FREE: 0, WALL: 1, WATER: 2, DOOR: 3, INSIDE: 4 };

const DOOR_HP = { door_wood: 90, door_glass: 45, door_gate: 160, garage: 220, doorway: 0 };
export function doorTypeOf(b) {
  const A = ARCH[b.a] || ARCH.concrete_house_1f;
  for (const k of Object.keys(DOOR_HP)) if (A.door === T[k]) return k;
  return "door_wood";
}

export class Physics {
  constructor(map, world) {
    this.map = map;
    this.world = world;
    this.cs = map.cs;
    this.hash = new Map();      // "hx,hy" -> [seg]
    this.chunkDone = new Set(); // chunks whose buildings have segments
    this.nav = new Map();       // chunk key -> Uint8Array
    this.doorCells = new Map(); // "gx,gy" -> building
    this.n = Math.round(this.cs / CELL);
    map.on((ev) => {
      if (ev.type === "building") this.rebuildBuilding(ev.removed || map.getBuilding(ev.id));
      if (ev.type === "all") { this.hash.clear(); this.chunkDone.clear(); this.nav.clear(); this.doorCells.clear(); for (const b of map.buildings()) b._segs = null; }
    });
    this.prepWater();
  }

  // ------------------------------------------------------------ building state
  doorState(b) {
    if (!b.door) {
      const type = doorTypeOf(b);
      const hp = DOOR_HP[type] ?? 90;
      b.door = { type, hp, max: hp, open: type === "doorway", broken: false };
    }
    return b.door;
  }
  doorPassable(b) { const d = this.doorState(b); return !!(d.open || d.broken || b.collapsed); }
  setDoorOpen(b, open) {
    const d = this.doorState(b);
    if (d.broken) return;
    d.open = open;
    this.world && this.world.setState(b, { door: open ? 1 : 0 });
  }
  // structural hit points (estimated from footprint, storeys and archetype)
  hp(b) {
    if (b.hpMax === undefined) {
      const area = Math.abs(b.area || 50);
      const light = b.a === "light_material_house" || b.a === "utility_shed" || b.wm === "wood";
      b.hpMax = Math.round((light ? 3 : 14) * Math.sqrt(area) * Math.max(1, b.lv || 1) * 10);
      b.hpNow = b.hpMax;
      b.destructible = light;
    }
    return b.hpNow;
  }
  damageBuilding(b, amount) {
    this.hp(b);
    b.hpNow = Math.max(0, b.hpNow - amount);
    const lvl = Math.min(3, Math.floor((1 - b.hpNow / b.hpMax) * 4 + 1e-9));
    const prev = (b.rs && b.rs.dmg) || 0;
    if (lvl !== prev && this.world) this.world.setState(b, { dmg: lvl });
    if (lvl >= 3 && b.destructible && !b.collapsed) {
      b.collapsed = true; // light walls give way: no more collision, navigable
      this.rebuildBuilding(b);
    }
    return lvl;
  }
  damageDoor(b, amount) {
    const d = this.doorState(b);
    if (d.broken || d.open) return true;
    d.hp -= amount;
    this.damageBuilding(b, amount * 0.15);
    if (d.hp <= 0) {
      d.broken = true;
      this.world && this.world.setState(b, { door: 1 });
      return true;
    }
    return false;
  }

  // ------------------------------------------------------------ collision segments
  wallTop(b) { return this.base(b) + b.h + 0.5 * (b.rh || 0); }
  base(b) { return (b.z || 0) + (b.mh || 0); }
  segmentsOf(b) {
    const segs = [];
    if (b.part_of || b.collapsed || b.hidden) return segs;
    const z0 = this.base(b), z1 = this.wallTop(b);
    if (b.a === "canopy") {
      const f = b.fp;
      for (let i = 0; i < f.length; i += 2) {
        const x = f[i], y = f[i + 1], r = 0.12;
        segs.push({ ax: x - r, ay: y - r, bx: x + r, by: y + r, b, kind: 0, z0, z1 }, { ax: x - r, ay: y + r, bx: x + r, by: y - r, b, kind: 0, z0, z1 });
      }
      return segs;
    }
    const plan = b.enter ? interiorPlan(b) : null;
    const rings = [b.fp, ...(b.holes || [])];
    rings.forEach((r, ri) => {
      const n = r.length / 2;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const ax = r[2 * i], ay = r[2 * i + 1], bx = r[2 * j], by = r[2 * j + 1];
        if (plan && ri === 0 && i === plan.gap[0]) {
          const [, g0, g1] = plan.gap;
          const P = (t) => [ax + (bx - ax) * t, ay + (by - ay) * t];
          const p0 = P(g0), p1 = P(g1);
          segs.push({ ax, ay, bx: p0[0], by: p0[1], b, kind: 0, z0, z1 });
          segs.push({ ax: p1[0], ay: p1[1], bx, by, b, kind: 0, z0, z1 });
          const A = ARCH[b.a] || ARCH.concrete_house_1f;
          // door leaf (blocks while closed); the lintel above it still blocks sight
          segs.push({ ax: p0[0], ay: p0[1], bx: p1[0], by: p1[1], b, kind: 1, z0, z1: z0 + A.doorH, lintel: z1 });
        } else {
          segs.push({ ax, ay, bx, by, b, kind: 0, z0, z1 });
        }
      }
    });
    if (plan && plan.partition) {
      const [x0, y0, x1, y1, g0, g1] = plan.partition;
      const P = (t) => [x0 + (x1 - x0) * t, y0 + (y1 - y0) * t];
      const zt = z0 + Math.max(2.4, b.h / Math.max(1, b.lv || 1) - 0.1);
      const a = P(g0), c = P(g1);
      segs.push({ ax: x0, ay: y0, bx: a[0], by: a[1], b, kind: 2, z0, z1: zt }, { ax: c[0], ay: c[1], bx: x1, by: y1, b, kind: 2, z0, z1: zt });
    }
    return segs;
  }
  addBuilding(b) {
    if (b._segs) return;
    b._segs = this.segmentsOf(b);
    for (const s of b._segs) {
      const hx0 = Math.floor(Math.min(s.ax, s.bx) / HCELL), hx1 = Math.floor(Math.max(s.ax, s.bx) / HCELL);
      const hy0 = Math.floor(Math.min(s.ay, s.by) / HCELL), hy1 = Math.floor(Math.max(s.ay, s.by) / HCELL);
      for (let x = hx0; x <= hx1; x++) for (let y = hy0; y <= hy1; y++) {
        const k = x + "," + y;
        let l = this.hash.get(k);
        if (!l) this.hash.set(k, (l = []));
        l.push(s);
      }
    }
  }
  removeBuilding(b) {
    if (!b || !b._segs) return;
    const dead = new Set(b._segs);
    for (const [k, l] of this.hash) {
      const m = l.filter((s) => !dead.has(s));
      if (m.length !== l.length) this.hash.set(k, m);
    }
    b._segs = null;
  }
  rebuildBuilding(b) {
    if (!b) return;
    b._plan = null;
    this.removeBuilding(b);
    if (!b.removed) this.addBuilding(b);
    // nav chunks this building touches are rebuilt on next use
    const bb = b.bb || [0, 0, 0, 0];
    for (let i = Math.floor(bb[0] / this.cs); i <= Math.floor(bb[2] / this.cs); i++)
      for (let j = Math.floor(bb[1] / this.cs); j <= Math.floor(bb[3] / this.cs); j++) this.nav.delete(i + "," + j);
  }
  ensureChunk(i, j) {
    const k = i + "," + j;
    if (this.chunkDone.has(k)) return;
    this.chunkDone.add(k);
    for (const b of this.map.buildingsTouching(i, j)) this.addBuilding(b);
  }
  ensureArea(x0, y0, x1, y1) {
    for (let i = Math.floor(x0 / this.cs); i <= Math.floor(x1 / this.cs); i++)
      for (let j = Math.floor(y0 / this.cs); j <= Math.floor(y1 / this.cs); j++) this.ensureChunk(i, j);
  }
  *segsNear(x0, y0, x1, y1) {
    this.ensureArea(x0, y0, x1, y1);
    const seen = new Set();
    for (let hx = Math.floor(x0 / HCELL); hx <= Math.floor(x1 / HCELL); hx++)
      for (let hy = Math.floor(y0 / HCELL); hy <= Math.floor(y1 / HCELL); hy++) {
        const l = this.hash.get(hx + "," + hy);
        if (!l) continue;
        for (const s of l) if (!seen.has(s)) { seen.add(s); yield s; }
      }
  }
  blocks(s) {
    if (s.kind === 1) return !this.doorPassable(s.b);
    return true;
  }

  // move a circle (radius r) from (x,y) by (dx,dy) with wall sliding; returns [x, y]
  move(x, y, dx, dy, r = 0.3, who = "human") {
    const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) / (r * 0.8)));
    for (let k = 0; k < steps; k++) {
      let nx = x + dx / steps, ny = y + dy / steps;
      for (let it = 0; it < 3; it++) {
        let pushed = false;
        for (const s of this.segsNear(nx - r - 0.5, ny - r - 0.5, nx + r + 0.5, ny + r + 0.5)) {
          if (!this.blocks(s, who)) continue;
          const ex = s.bx - s.ax, ey = s.by - s.ay, L2 = ex * ex + ey * ey || 1e-9;
          const t = Math.max(0, Math.min(1, ((nx - s.ax) * ex + (ny - s.ay) * ey) / L2));
          const px = s.ax + ex * t, py = s.ay + ey * t;
          let ox = nx - px, oy = ny - py;
          let d = Math.hypot(ox, oy);
          if (d >= r) continue;
          if (d < 1e-6) { // exactly on the wall: push back toward where we came from
            ox = x - px; oy = y - py; d = Math.hypot(ox, oy) || 1; }
          nx = px + (ox / d) * (r + 1e-3);
          ny = py + (oy / d) * (r + 1e-3);
          pushed = true;
        }
        if (!pushed) break;
      }
      // never end up inside a solid building or in water
      if (!this.walkableAt(nx, ny, who)) {
        if (this.walkableAt(nx, y, who)) ny = y;
        else if (this.walkableAt(x, ny, who)) nx = x;
        else { nx = x; ny = y; }
      }
      x = nx; y = ny;
    }
    return [x, y];
  }

  // ------------------------------------------------------------ navigation grid
  prepWater() {
    const L = this.map.layers;
    const ringsOf = (a) => [a.outer, ...(a.holes || [])];
    this.waterPolys = L.water.map(ringsOf);
    this.landPolys = (this.map.manifest.coast && this.map.manifest.coast.coastline_ways > 0) ? L.land.map((r) => [r.outer]) : null;
    this.rivers = L.waterways.filter((w) => w.kind === "river" || w.kind === "canal" || w.w >= 3);
    // every road (not just tagged bridges) stays walkable where water polygons overlap it:
    // OSM bridge ways end at the bank line, and river/coast polygons often overlap the approaches
    this.decks = [...L.roads.filter((r) => !r.tunnel), ...L.piers.filter((p) => p.pts)];
    this.deckPolys = L.piers.filter((p) => p.outer).map(ringsOf);
  }
  // scanline fill of polygon rings (even-odd) into a chunk grid
  fill(g, i, j, rings, fn) {
    const n = this.n, x0 = i * this.cs, y0 = j * this.cs;
    let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
    for (const r of rings) for (let k = 0; k < r.length; k += 2) { bx0 = Math.min(bx0, r[k]); bx1 = Math.max(bx1, r[k]); by0 = Math.min(by0, r[k + 1]); by1 = Math.max(by1, r[k + 1]); }
    const r0 = Math.max(0, Math.floor((by0 - y0) / CELL)), r1 = Math.min(n - 1, Math.ceil((by1 - y0) / CELL));
    if (r1 < 0 || r0 > n - 1 || bx1 < x0 || bx0 > x0 + this.cs) return;
    const xs = [];
    for (let row = r0; row <= r1; row++) {
      const y = y0 + (row + 0.5) * CELL;
      xs.length = 0;
      for (const r of rings) {
        const m = r.length / 2;
        for (let k = 0; k < m; k++) {
          const ax = r[2 * k], ay = r[2 * k + 1], q = (k + 1) % m, bx = r[2 * q], by = r[2 * q + 1];
          if ((ay > y) !== (by > y)) xs.push(ax + ((y - ay) * (bx - ax)) / (by - ay));
        }
      }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const c0 = Math.max(0, Math.ceil((xs[k] - x0) / CELL - 0.5)), c1 = Math.min(n - 1, Math.floor((xs[k + 1] - x0) / CELL - 0.5));
        for (let c = c0; c <= c1; c++) fn(row * n + c);
      }
    }
  }
  // cells within w/2 of a polyline
  stroke(g, i, j, pts, half, fn) {
    const n = this.n, x0 = i * this.cs, y0 = j * this.cs;
    for (let k = 0; k + 3 < pts.length; k += 2) {
      const ax = pts[k], ay = pts[k + 1], bx = pts[k + 2], by = pts[k + 3];
      const c0 = Math.max(0, Math.floor((Math.min(ax, bx) - half - x0) / CELL)), c1 = Math.min(n - 1, Math.floor((Math.max(ax, bx) + half - x0) / CELL));
      const r0 = Math.max(0, Math.floor((Math.min(ay, by) - half - y0) / CELL)), r1 = Math.min(n - 1, Math.floor((Math.max(ay, by) + half - y0) / CELL));
      if (c0 > c1 || r0 > r1) continue;
      const ex = bx - ax, ey = by - ay, L2 = ex * ex + ey * ey || 1e-9;
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
        const px = x0 + (c + 0.5) * CELL, py = y0 + (r + 0.5) * CELL;
        const t = Math.max(0, Math.min(1, ((px - ax) * ex + (py - ay) * ey) / L2));
        if (Math.hypot(px - ax - ex * t, py - ay - ey * t) <= half) fn(r * n + c);
      }
    }
  }
  navChunk(i, j) {
    const key = i + "," + j;
    let g = this.nav.get(key);
    if (g) return g;
    const n = this.n;
    g = new Uint8Array(n * n);
    const x0 = i * this.cs, y0 = j * this.cs, x1 = x0 + this.cs, y1 = y0 + this.cs;
    const hit = (bb) => !(bb[2] < x0 || bb[0] > x1 || bb[3] < y0 || bb[1] > y1);
    // water: sea (outside land) + water polygons + rivers
    if (this.landPolys) {
      g.fill(NAV.WATER);
      for (const P of this.landPolys) this.fill(g, i, j, P, (c) => { g[c] = NAV.FREE; });
    }
    for (const P of this.waterPolys) this.fill(g, i, j, P, (c) => { g[c] = NAV.WATER; });
    for (const w of this.rivers) this.stroke(g, i, j, w.pts, w.w / 2, (c) => { g[c] = NAV.WATER; });
    for (const d of this.decks) this.stroke(g, i, j, d.pts, Math.max(1.5, (d.w || 3) / 2), (c) => { if (g[c] === NAV.WATER) g[c] = NAV.FREE; });
    for (const P of this.deckPolys) this.fill(g, i, j, P, (c) => { g[c] = NAV.FREE; });
    // buildings
    for (const b of this.map.buildingsTouching(i, j)) {
      if (b.part_of || b.collapsed || b.hidden || !hit(b.bb)) continue;
      if (b.a === "canopy") continue;
      const rings = [b.fp, ...(b.holes || [])];
      if (b.enter) this.fill(g, i, j, rings, (c) => { if (g[c] !== NAV.WATER) g[c] = NAV.INSIDE; });
      else this.fill(g, i, j, rings, (c) => { g[c] = NAV.WALL; });
    }
    // walls of enterable buildings (thin lines) and their doors
    for (const b of this.map.buildingsTouching(i, j)) {
      if (!b.enter || b.part_of || b.collapsed || !hit(b.bb)) continue;
      this.addBuilding(b);
      for (const s of b._segs) {
        const code = s.kind === 1 ? NAV.DOOR : NAV.WALL;
        const L = Math.hypot(s.bx - s.ax, s.by - s.ay), steps = Math.max(1, Math.ceil(L / 0.15));
        const stamp = (cx, cy) => {
          if (cx < 0 || cy < 0 || cx >= n || cy >= n) return;
          const c = cy * n + cx;
          if (code === NAV.WALL && g[c] === NAV.DOOR) return;
          g[c] = code;
          if (code === NAV.DOOR) this.doorCells.set((i * n + cx) + "," + (j * n + cy), b);
        };
        let pcx = null, pcy = null;
        for (let k = 0; k <= steps; k++) {
          const t = k / steps, x = s.ax + (s.bx - s.ax) * t, y = s.ay + (s.by - s.ay) * t;
          const cx = Math.floor((x - x0) / CELL), cy = Math.floor((y - y0) / CELL);
          // keep wall lines 4-connected so nothing slips through a diagonal step
          if (pcx !== null && cx !== pcx && cy !== pcy) stamp(cx, pcy);
          stamp(cx, cy);
          pcx = cx; pcy = cy;
        }
      }
    }
    this.nav.set(key, g);
    return g;
  }
  cellCode(gx, gy) {
    const i = Math.floor((gx * CELL) / this.cs), j = Math.floor((gy * CELL) / this.cs);
    const g = this.navChunk(i, j);
    return g[(gy - j * this.n) * this.n + (gx - i * this.n)];
  }
  passable(code, gx, gy, who) {
    if (code === NAV.FREE || code === NAV.INSIDE) return true;
    if (code === NAV.DOOR) {
      const b = this.doorCells.get(gx + "," + gy);
      return !b || this.doorPassable(b) || who === "plan";
    }
    return false;
  }
  walkableAt(x, y, who = "human") {
    const gx = Math.floor(x / CELL), gy = Math.floor(y / CELL);
    const code = this.cellCode(gx, gy);
    if (code === NAV.WALL) {
      // the grid marks wall lines coarsely; trust the exact footprint for solid buildings
      const b = this.map.buildingAt(x, y);
      return !(b && !b.enter && !b.collapsed && b.a !== "canopy");
    }
    if (code === NAV.DOOR) return true; // collision handles the door leaf exactly
    return code !== NAV.WATER;
  }

  // A* on the 0.5 m grid inside a window around start/goal. Returns [[x,y],...] or null.
  findPath(sx, sy, tx, ty, opts = {}) {
    const margin = opts.margin ?? 40, maxCells = opts.maxCells ?? 700;
    let wx0 = Math.floor((Math.min(sx, tx) - margin) / CELL), wy0 = Math.floor((Math.min(sy, ty) - margin) / CELL);
    let W = Math.ceil((Math.abs(tx - sx) + 2 * margin) / CELL) + 1, H = Math.ceil((Math.abs(ty - sy) + 2 * margin) / CELL) + 1;
    if (W > maxCells || H > maxCells) return null;
    const who = opts.who || "human";
    const N = W * H;
    const gs = new Float32Array(N).fill(Infinity), from = new Int32Array(N).fill(-1), closed = new Uint8Array(N), code = new Uint8Array(N).fill(255);
    const at = (c) => {
      if (code[c] === 255) {
        const gx = wx0 + (c % W), gy = wy0 + ((c / W) | 0);
        const k = this.cellCode(gx, gy);
        code[c] = this.passable(k, gx, gy, who) ? (k === NAV.DOOR ? 2 : 1) : 0;
      }
      return code[c];
    };
    const s = (Math.floor(sy / CELL) - wy0) * W + (Math.floor(sx / CELL) - wx0);
    const t = (Math.floor(ty / CELL) - wy0) * W + (Math.floor(tx / CELL) - wx0);
    const tcx = t % W, tcy = (t / W) | 0;
    const hfn = (c) => { const dx = Math.abs((c % W) - tcx), dy = Math.abs(((c / W) | 0) - tcy); return (dx + dy) + (1.4142 - 2) * Math.min(dx, dy); };
    const heap = new Heap();
    gs[s] = 0; heap.push(s, hfn(s));
    let found = false, expanded = 0;
    const D = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.4142], [1, -1, 1.4142], [-1, 1, 1.4142], [-1, -1, 1.4142]];
    while (heap.size) {
      const c = heap.pop();
      if (closed[c]) continue;
      closed[c] = 1;
      if (c === t) { found = true; break; }
      if (++expanded > (opts.maxExpand ?? 200000)) break;
      const cx = c % W, cy = (c / W) | 0;
      for (const [dx, dy, w] of D) {
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const nc = ny * W + nx;
        if (closed[nc] || !at(nc)) continue;
        if (dx && dy && (!at(cy * W + nx) || !at(ny * W + cx))) continue; // no corner cutting
        // keep off walls: cells touching a blocked cell cost extra (doorways stay usable)
        const near = !at(nc + 1 < N ? nc + 1 : nc) || !at(nc - 1 >= 0 ? nc - 1 : nc) || !at(nc + W < N ? nc + W : nc) || !at(nc - W >= 0 ? nc - W : nc);
        const g2 = gs[c] + w + (code[nc] === 2 ? 2 : 0) + (near ? 0.8 : 0);
        if (g2 < gs[nc]) { gs[nc] = g2; from[nc] = c; heap.push(nc, g2 + hfn(nc)); }
      }
    }
    if (!found) return null;
    const cells = [];
    for (let c = t; c !== -1; c = from[c]) cells.push(c);
    cells.reverse();
    const pts = cells.map((c) => [(wx0 + (c % W) + 0.5) * CELL, (wy0 + ((c / W) | 0) + 0.5) * CELL]);
    pts[0] = [sx, sy]; pts[pts.length - 1] = [tx, ty];
    // string pulling: keep only points where a straight walk would hit something
    const out = [pts[0]];
    let a = 0;
    while (a < pts.length - 1) {
      let b = Math.min(pts.length - 1, a + 1);
      for (let k = pts.length - 1; k > a + 1; k = k - Math.max(1, ((k - a) / 6) | 0)) {
        if (this.clearLine(pts[a][0], pts[a][1], pts[k][0], pts[k][1], who, 0.3)) { b = k; break; }
      }
      out.push(pts[b]);
      a = b;
    }
    return out;
  }
  // straight walk from a to b stays on passable cells (r = body radius to keep clear)
  clearLine(ax, ay, bx, by, who, r = 0) {
    const L = Math.hypot(bx - ax, by - ay), n = Math.ceil(L / (CELL * 0.5));
    const d = r * 0.7071;
    const offs = r ? [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r], [d, d], [-d, d], [d, -d], [-d, -d]] : [[0, 0]];
    for (let k = 1; k < n; k++) {
      const x = ax + ((bx - ax) * k) / n, y = ay + ((by - ay) * k) / n;
      for (const [ox, oy] of offs) {
        const gx = Math.floor((x + ox) / CELL), gy = Math.floor((y + oy) / CELL);
        if (!this.passable(this.cellCode(gx, gy), gx, gy, who)) return false;
      }
    }
    return true;
  }

  // Dijkstra flow field toward (tx, ty) within radius R. Closed doors cost extra (zombies break them).
  flowField(tx, ty, R = 90, who = "zombie") {
    const W = Math.ceil((2 * R) / CELL), H = W;
    const wx0 = Math.floor((tx - R) / CELL), wy0 = Math.floor((ty - R) / CELL);
    const N = W * H;
    const dist = new Uint32Array(N).fill(0xffffffff);
    const code = new Uint8Array(N);
    for (let c = 0; c < N; c++) {
      const gx = wx0 + (c % W), gy = wy0 + ((c / W) | 0);
      const k = this.cellCode(gx, gy);
      code[c] = k === NAV.DOOR ? (this.passable(k, gx, gy, who) ? 1 : 3) : (k === NAV.FREE || k === NAV.INSIDE ? 1 : 0);
    }
    const t = (Math.floor(ty / CELL) - wy0) * W + (Math.floor(tx / CELL) - wx0);
    // bucket queue (costs 10 / 14 / +80 through a closed door)
    const buckets = [];
    const push = (c, d) => { (buckets[d] || (buckets[d] = [])).push(c); };
    if (t >= 0 && t < N) { dist[t] = 0; push(t, 0); }
    const D = [[1, 0, 10], [-1, 0, 10], [0, 1, 10], [0, -1, 10], [1, 1, 14], [1, -1, 14], [-1, 1, 14], [-1, -1, 14]];
    for (let d = 0; d < buckets.length; d++) {
      const B = buckets[d];
      if (!B) continue;
      for (let q = 0; q < B.length; q++) {
        const c = B[q];
        if (dist[c] !== d) continue;
        const cx = c % W, cy = (c / W) | 0;
        for (const [dx, dy, w] of D) {
          const nx = cx + dx, ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const nc = ny * W + nx;
          if (!code[nc]) continue;
          if (dx && dy && (!code[cy * W + nx] || !code[ny * W + cx])) continue;
          const nd = d + w + (code[nc] === 3 ? 80 : 0);
          if (nd < dist[nc] && nd < 60000) { dist[nc] = nd; push(nc, nd); }
        }
      }
      buckets[d] = null;
    }
    return { W, H, wx0, wy0, dist, tx, ty, R };
  }
  // direction to walk from (x, y) following a flow field; null when outside it
  flowDir(f, x, y) {
    const cx = Math.floor(x / CELL) - f.wx0, cy = Math.floor(y / CELL) - f.wy0;
    if (cx < 1 || cy < 1 || cx >= f.W - 1 || cy >= f.H - 1) return null;
    const c0 = f.dist[cy * f.W + cx];
    let best = c0, bx = 0, by = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const d = f.dist[(cy + dy) * f.W + cx + dx];
      if (d < best) { best = d; bx = dx; by = dy; }
    }
    if (best === 0xffffffff || (!bx && !by)) return null;
    const l = Math.hypot(bx, by);
    return [bx / l, by / l, c0];
  }

  // ------------------------------------------------------------ line of sight
  // true when nothing (wall at its real height, closed door, terrain) blocks the 3D segment
  los(ax, ay, az, bx, by, bz, ignore = null) {
    const x0 = Math.min(ax, bx) - 0.5, y0 = Math.min(ay, by) - 0.5, x1 = Math.max(ax, bx) + 0.5, y1 = Math.max(ay, by) + 0.5;
    const rx = bx - ax, ry = by - ay;
    for (const s of this.segsNear(x0, y0, x1, y1)) {
      if (ignore && s.b === ignore) continue;
      const sx = s.bx - s.ax, sy = s.by - s.ay;
      const den = rx * sy - ry * sx;
      if (Math.abs(den) < 1e-9) continue;
      const t = ((s.ax - ax) * sy - (s.ay - ay) * sx) / den;
      const u = ((s.ax - ax) * ry - (s.ay - ay) * rx) / den;
      if (t <= 1e-4 || t >= 1 - 1e-4 || u < 0 || u > 1) continue;
      const z = az + (bz - az) * t;
      if (s.kind === 1) {
        if (z < s.z1 && !this.doorPassable(s.b) && z > s.z0) return false;
        if (z >= s.z1 && z < s.lintel) return false;
        continue;
      }
      if (z > s.z0 - 0.1 && z < s.z1) return false;
    }
    if (this.world && this.world.terrain) {
      const L = Math.hypot(rx, ry), n = Math.floor(L / 8);
      for (let k = 1; k < n; k++) {
        const t = k / n;
        if (az + (bz - az) * t < this.world.h(ax + rx * t, ay + ry * t) - 0.2) return false;
      }
    }
    return true;
  }
  // cover of a position against a threat: "full" (hidden standing), "half" (hidden crouched), "none"
  cover(x, y, z, tx, ty, tz) {
    if (!this.los(tx, ty, tz + 1.6, x, y, z + 1.6)) return "full";
    if (!this.los(tx, ty, tz + 1.6, x, y, z + 1.0)) return "half";
    return "none";
  }
  // candidate cover points within radius r: just outside walls, hidden from the threat
  coverPoints(x, y, r, tx, ty, tz = 0, max = 8) {
    const out = [];
    for (const s of this.segsNear(x - r, y - r, x + r, y + r)) {
      if (s.kind === 1) continue;
      const L = Math.hypot(s.bx - s.ax, s.by - s.ay);
      if (L < 1) continue;
      const nx = (s.by - s.ay) / L, ny = -(s.bx - s.ax) / L;
      for (let t = 0.5; t < L; t += 2) {
        for (const side of [1, -1]) {
          const px = s.ax + ((s.bx - s.ax) * t) / L + nx * 0.6 * side, py = s.ay + ((s.by - s.ay) * t) / L + ny * 0.6 * side;
          if (Math.hypot(px - x, py - y) > r || !this.walkableAt(px, py)) continue;
          const z = this.world ? this.world.surfaceZ(px, py) : 0;
          const c = this.cover(px, py, z, tx, ty, tz);
          if (c !== "none") out.push({ x: px, y: py, cover: c, d: Math.hypot(px - x, py - y), b: s.b.id });
        }
      }
    }
    out.sort((a, b) => (a.cover === b.cover ? a.d - b.d : a.cover === "full" ? -1 : 1));
    return out.slice(0, max);
  }

  // building the point is inside of (enterable or not), null outdoors
  inside(x, y) {
    const b = this.map.buildingAt(x, y);
    return b && !b.part_of ? b : null;
  }
  floorZ(b) { const A = ARCH[b.a] || {}; return this.base(b) + (A.raised || 0) + 0.15; }
  isInside(b, x, y) { return pointInPoly(x, y, b.fp, b.holes); }
}

class Heap {
  constructor() { this.k = []; this.p = []; }
  get size() { return this.k.length; }
  push(k, p) {
    const K = this.k, P = this.p;
    let i = K.length; K.push(k); P.push(p);
    while (i > 0) { const j = (i - 1) >> 1; if (P[j] <= p) break; K[i] = K[j]; P[i] = P[j]; i = j; }
    K[i] = k; P[i] = p;
  }
  pop() {
    const K = this.k, P = this.p, top = K[0], k = K.pop(), p = P.pop();
    if (K.length) {
      let i = 0;
      const n = K.length;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && P[c + 1] < P[c]) c++;
        if (P[c] >= p) break;
        K[i] = K[c]; P[i] = P[c]; i = c;
      }
      K[i] = k; P[i] = p;
    }
    return top;
  }
}

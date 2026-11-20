// Path requests are queued and solved within a per-frame time budget.
// Short moves: A* on the 0.5 m navigation grid (walls, doors, water).
// Long moves: A* on the real OSM road graph, joined to the start and goal by local A*.
import type { Battlefield } from "../Battlefield";
import { dist } from "../core";

export interface PathAgent { x: number; y: number; path: [number, number][] | null; pathIdx: number; pathPending: boolean; dead?: boolean }
interface Req { a: PathAgent; tx: number; ty: number; cb?: (ok: boolean) => void }

export class PathService {
  bf: Battlefield;
  queue: Req[] = [];
  stats = { solved: 0, failed: 0, road: 0, ms: 0 };
  constructor(bf: Battlefield) { this.bf = bf; }
  request(a: PathAgent, tx: number, ty: number, cb?: (ok: boolean) => void) {
    this.queue = this.queue.filter((q) => q.a !== a);
    a.pathPending = true;
    this.queue.push({ a, tx, ty, cb });
  }
  cancel(a: PathAgent) { this.queue = this.queue.filter((q) => q.a !== a); a.pathPending = false; }
  /** solve up to `maxPerStep` requests per simulation step (deterministic), with a wall-clock safety cap */
  maxPerStep = 3; timeCapMs = 16;
  update(_budgetMs = 4) {
    const t0 = performance.now();
    let n = 0;
    while (this.queue.length && n++ < this.maxPerStep && performance.now() - t0 < this.timeCapMs) {
      const q = this.queue.shift()!;
      if (q.a.dead) continue;
      const p = this.solve(q.a.x, q.a.y, q.tx, q.ty);
      q.a.pathPending = false;
      if (p) { q.a.path = p; q.a.pathIdx = 1; this.stats.solved++; }
      else {
        // unreachable goal (water, sealed building): go to the closest reachable point we can find
        const near = this.bf.freeNear(q.tx, q.ty, 25, false);
        const p2 = near && dist(near[0], near[1], q.tx, q.ty) > 0.5 ? this.solve(q.a.x, q.a.y, near[0], near[1]) : null;
        q.a.path = p2 || [[q.a.x, q.a.y], [q.tx, q.ty]]; q.a.pathIdx = 1; this.stats.failed++;
      }
      q.cb && q.cb(!!p);
    }
    this.stats.ms = performance.now() - t0;
  }
  local(sx: number, sy: number, tx: number, ty: number, margin = 24): [number, number][] | null {
    if (dist(sx, sy, tx, ty) < 1.2) return [[sx, sy], [tx, ty]];
    const ph = this.bf.phys;
    if (ph.clearLine(sx, sy, tx, ty, "plan", 0.3)) return [[sx, sy], [tx, ty]];
    const p = ph.findPath(sx, sy, tx, ty, { margin, maxCells: 420, maxExpand: 120000, who: "plan" });
    if (p) return p;
    // the way round a large building (market halls, plants) can leave a tight search window: widen once
    const d = dist(sx, sy, tx, ty);
    if (d > 260) return null;
    return ph.findPath(sx, sy, tx, ty, { margin: Math.max(70, d * 0.7), maxCells: 680, maxExpand: 300000, who: "plan" });
  }
  /** split long road legs and detour around anything (footprints on the carriageway, walls) that blocks them */
  repair(p: [number, number][]): [number, number][] {
    const ph = this.bf.phys, out: [number, number][] = [p[0]];
    let fixes = 0;
    for (let k = 1; k < p.length; k++) {
      const [ax, ay] = out[out.length - 1], [bx, by] = p[k];
      const L = dist(ax, ay, bx, by), n = Math.max(1, Math.ceil(L / 25));
      let px = ax, py = ay;
      for (let i = 1; i <= n; i++) {
        const qx = ax + ((bx - ax) * i) / n, qy = ay + ((by - ay) * i) / n;
        if (fixes < 40 && !ph.clearLine(px, py, qx, qy, "plan", 0.3)) {
          fixes++;
          const d = ph.findPath(px, py, qx, qy, { margin: 18, maxCells: 220, maxExpand: 40000, who: "plan" });
          if (d) for (let j = 1; j < d.length - 1; j++) out.push(d[j]);
        }
        out.push([qx, qy]); px = qx; py = qy;
      }
    }
    return out;
  }
  solve(sx: number, sy: number, tx: number, ty: number): [number, number][] | null {
    // goals on a wall line or in water snap to the nearest passable spot
    if (!this.bf.navOk(tx, ty)) { const q = this.bf.freeNear(tx, ty, 4, false); if (q) { tx = q[0]; ty = q[1]; } }
    let lead0: [number, number] | null = null;
    if (!this.bf.navOk(sx, sy)) { const q = this.bf.sameSide(sx, sy); if (q) { lead0 = [sx, sy]; sx = q[0]; sy = q[1]; } }
    // leaving or entering a building: go through its door first
    const map = this.bf.map, bs = map.buildingAt(sx, sy), bt = map.buildingAt(tx, ty);
    if (bs && bs.enter && bs.ent && bs !== bt && dist(sx, sy, tx, ty) > 12 && !lead0) {
      const e = map.entrancePoint(bs, 1.6), eo = this.bf.freeNear(e.x, e.y, 3) || [e.x, e.y];
      const inner = this.local(sx, sy, eo[0], eo[1], 8), rest = inner && this.solve(eo[0], eo[1], tx, ty);
      if (inner && rest) return [...inner, ...rest.slice(1)];
    }
    if (bt && bt.enter && bt.ent && bt !== bs && dist(sx, sy, tx, ty) > 12) {
      const e = map.entrancePoint(bt, 1.6), eo = this.bf.freeNear(e.x, e.y, 3) || [e.x, e.y];
      const inner = this.local(eo[0], eo[1], tx, ty, 8), first = inner && this.solve(sx, sy, eo[0], eo[1]);
      if (inner && first) return [...(lead0 ? [lead0] : []), ...first, ...inner.slice(1)];
    }
    const d = dist(sx, sy, tx, ty);
    const withLead = (p: [number, number][] | null) => (p && lead0 ? [lead0, ...p] : p);
    if (d < 150) { const p = this.local(sx, sy, tx, ty); if (p) return withLead(p); }
    // road route
    const G = this.bf.roads;
    let r = G.route(G.near(sx, sy, 140, 4), G.near(tx, ty, 140, 4));
    if (!r) r = G.route(G.near(sx, sy, 260, 6, true), G.near(tx, ty, 260, 6, true));
    if (!r) return d < 150 ? null : withLead(this.local(sx, sy, tx, ty, 30));
    this.stats.road++;
    const pts: [number, number][] = [[sx, sy]];
    for (const n of r) pts.push([G.nodes[n].x, G.nodes[n].y]);
    pts.push([tx, ty]);
    // skip road vertices behind the start / beyond the goal when a straight walk is clear
    const ph = this.bf.phys;
    let a = 0;
    for (let k = Math.min(pts.length - 2, 6); k > 0; k--) if (dist(sx, sy, pts[k][0], pts[k][1]) < 140 && ph.clearLine(sx, sy, pts[k][0], pts[k][1], "plan", 0.3)) { a = k; break; }
    let b = pts.length - 1;
    for (let k = Math.max(a + 1, pts.length - 7); k < pts.length - 1; k++) if (dist(pts[k][0], pts[k][1], tx, ty) < 140 && ph.clearLine(pts[k][0], pts[k][1], tx, ty, "plan", 0.3)) { b = k; break; }
    const out: [number, number][] = [[sx, sy]];
    for (let k = Math.max(1, a); k <= b && k < pts.length - 1; k++) {
      const last = out[out.length - 1];
      if (dist(last[0], last[1], pts[k][0], pts[k][1]) > 3) out.push(pts[k]);
    }
    // first and last legs off the road network
    const first = out.length > 1 ? out[1] : [tx, ty];
    const lead = this.local(sx, sy, first[0], first[1]);
    const fin: [number, number][] = lead ? lead.slice(0, -1) : [[sx, sy]];
    for (let k = 1; k < out.length; k++) fin.push(out[k]);
    const lastRoad = fin[fin.length - 1];
    const tail = this.local(lastRoad[0], lastRoad[1], tx, ty);
    if (tail) for (let k = 1; k < tail.length; k++) fin.push(tail[k]); else fin.push([tx, ty]);
    return withLead(this.repair(fin));
  }
}

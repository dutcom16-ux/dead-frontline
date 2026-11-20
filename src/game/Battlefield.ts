// The Toledo City battlefield: real map package (OSM + AI-detected footprints), renderer, streamed
// world, physics/navigation, road graph for long routes, ground picking and open-ground search.
// @ts-ignore engine is plain JS
import { Renderer } from "../engine/gl.js";
// @ts-ignore
import { World } from "../engine/world.js";
// @ts-ignore
import { MapData, PackageSource, loadPackedPackage } from "../engine/mapdata.js";
// @ts-ignore
import { Physics } from "../engine/physics.js";
import { dist } from "./core";

export interface Landmark { id: string; name: string; osm_name?: string; status: string; center: [number, number] | null; main_building: string | null; buildings: string[] }

export class RoadGraph {
  nodes: { x: number; y: number; e: number[]; w: number[]; road: string }[] = [];
  key = new Map<string, number>();
  grid = new Map<string, number[]>();
  comp: Int32Array = new Int32Array(0); main = 0;
  constructor(roads: any[], bounds?: [number, number, number, number]) {
    const inB = (x: number, y: number) => !bounds || (x > bounds[0] && y > bounds[1] && x < bounds[2] && y < bounds[3]);
    const id = (x: number, y: number, name: string) => {
      const k = Math.round(x * 2) + "," + Math.round(y * 2);
      let n = this.key.get(k);
      if (n === undefined) {
        n = this.nodes.length;
        this.nodes.push({ x, y, e: [], w: [], road: name });
        this.key.set(k, n);
        const g = Math.floor(x / 40) + "," + Math.floor(y / 40);
        (this.grid.get(g) || this.grid.set(g, []).get(g)!).push(n);
      }
      return n;
    };
    for (const r of roads) {
      if (r.class === "steps" || r.tunnel) continue;
      const p = r.pts;
      let prev = -1;
      for (let k = 0; k < p.length; k += 2) {
        if (!inB(p[k], p[k + 1])) { prev = -1; continue; } // the network ends at the playable area
        const n = id(p[k], p[k + 1], r.name || r.class);
        if (prev >= 0 && prev !== n) {
          const a = this.nodes[prev], b = this.nodes[n];
          // prefer real roads over footpaths and service lanes when routing a squad
          const pen = r.class === "path" || r.class === "footway" || r.class === "track" ? 1.6 : r.class === "service" ? 1.15 : 1;
          const w = dist(a.x, a.y, b.x, b.y) * pen;
          a.e.push(n); a.w.push(w); b.e.push(prev); b.w.push(w);
        }
        prev = n;
      }
    }
    // connected components: routes start and end on the main network
    const N = this.nodes.length, comp = new Int32Array(N).fill(-1), size: number[] = [];
    for (let i = 0; i < N; i++) {
      if (comp[i] >= 0) continue;
      const c = size.length; let n = 0; const st = [i]; comp[i] = c;
      while (st.length) { const k = st.pop()!; n++; for (const e of this.nodes[k].e) if (comp[e] < 0) { comp[e] = c; st.push(e); } }
      size.push(n);
    }
    this.comp = comp; this.main = size.indexOf(Math.max(...size));
  }
  near(x: number, y: number, max = 160, k = 6, mainOnly = false): number[] {
    const out: [number, number][] = [];
    const R = Math.ceil(max / 40);
    const gi = Math.floor(x / 40), gj = Math.floor(y / 40);
    for (let i = gi - R; i <= gi + R; i++) for (let j = gj - R; j <= gj + R; j++) {
      const l = this.grid.get(i + "," + j);
      if (!l) continue;
      for (const n of l) { if (mainOnly && this.comp[n] !== this.main) continue; const d = dist(x, y, this.nodes[n].x, this.nodes[n].y); if (d < max) out.push([d, n]); }
    }
    out.sort((a, b) => a[0] - b[0]);
    return out.slice(0, k).map((o) => o[1]);
  }
  /** A* between node sets; returns node indices */
  route(starts: number[], goals: number[]): number[] | null {
    if (!starts.length || !goals.length) return null;
    const goal = new Set(goals), N = this.nodes.length;
    const g = new Float64Array(N).fill(Infinity), from = new Int32Array(N).fill(-1), closed = new Uint8Array(N);
    const gx = this.nodes[goals[0]].x, gy = this.nodes[goals[0]].y;
    const open: [number, number][] = [];
    const push = (n: number, f: number) => { open.push([f, n]); let i = open.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (open[p][0] <= open[i][0]) break; [open[p], open[i]] = [open[i], open[p]]; i = p; } };
    const pop = () => { const top = open[0], last = open.pop()!; if (open.length) { open[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < open.length && open[l][0] < open[m][0]) m = l; if (r < open.length && open[r][0] < open[m][0]) m = r; if (m === i) break; [open[m], open[i]] = [open[i], open[m]]; i = m; } } return top[1]; };
    for (const s of starts) { g[s] = 0; push(s, dist(this.nodes[s].x, this.nodes[s].y, gx, gy)); }
    while (open.length) {
      const c = pop();
      if (closed[c]) continue;
      closed[c] = 1;
      if (goal.has(c)) { const out: number[] = []; for (let n = c; n !== -1; n = from[n]) out.push(n); return out.reverse(); }
      const nd = this.nodes[c];
      for (let k = 0; k < nd.e.length; k++) {
        const n = nd.e[k], v = g[c] + nd.w[k];
        if (v < g[n]) { g[n] = v; from[n] = c; push(n, v + dist(this.nodes[n].x, this.nodes[n].y, gx, gy)); }
      }
    }
    return null;
  }
  /** nearest point on any road of the given name (or any road) to (x, y) */
  nearestOn(x: number, y: number, name?: string): [number, number] {
    let best: [number, number] = [x, y], bd = Infinity;
    for (const n of this.nodes) {
      if (name && n.road !== name) continue;
      const d = dist(x, y, n.x, n.y);
      if (d < bd) { bd = d; best = [n.x, n.y]; }
    }
    return best;
  }
}

export class Battlefield {
  canvas: HTMLCanvasElement;
  r: any; map: any; world: any; phys: any;
  roads!: RoadGraph;
  landmarks = new Map<string, Landmark>();
  bounds!: [number, number, number, number];
  playBounds!: [number, number, number, number];
  attribution = "";
  constructor(canvas: HTMLCanvasElement) { this.canvas = canvas; }

  async load(url: string, progress: (msg: string, f: number) => void) {
    this.r = new Renderer(this.canvas); // throws when WebGL2 is unavailable
    progress("Downloading Toledo City map data", 0);
    const pkg = await loadPackedPackage(url, (got: number, total: number) => progress("Downloading Toledo City map data", total ? (got / total) * 0.6 : 0.3));
    progress("Reading OpenStreetMap layers and building footprints", 0.65);
    await new Promise((r) => setTimeout(r, 0));
    this.map = await MapData.load(new PackageSource(pkg));
    progress("Preparing terrain, roads and coast", 0.75);
    await new Promise((r) => setTimeout(r, 0));
    this.world = new World(this.r, this.map);
    this.phys = new Physics(this.map, this.world);
    progress("Building the road network", 0.88);
    for (const l of this.map.manifest.landmarks || []) this.landmarks.set(l.id, l);
    this.bounds = this.map.bounds();
    const b = this.bounds;
    this.playBounds = [b[0] + 30, b[1] + 30, b[2] - 30, b[3] - 30];
    this.roads = new RoadGraph(this.map.layers.roads, [b[0] + 40, b[1] + 40, b[2] - 40, b[3] - 40]);
    this.attribution = this.map.manifest.attribution_text || "© OpenStreetMap contributors (ODbL)";
    progress("Ready", 1);
  }
  h(x: number, y: number): number { return this.world.surfaceZ(x, y); }
  landmark(id: string): Landmark | null { return this.landmarks.get(id) || null; }
  walkable(x: number, y: number) {
    const b = this.playBounds;
    return x > b[0] && y > b[1] && x < b[2] && y < b[3] && this.phys.walkableAt(x, y, "human") && this.navOk(x, y);
  }
  /** nearest passable spot on the same side of a wall (inside the same building, or outdoors) */
  sameSide(x: number, y: number, maxR = 2.5): [number, number] | null {
    const here = this.map.buildingAt(x, y);
    for (let r = 0.25; r <= maxR; r += 0.25) {
      const n = Math.max(8, Math.round(r * 12));
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2, px = x + Math.cos(a) * r, py = y + Math.sin(a) * r;
        if (this.navOk(px, py) && this.map.buildingAt(px, py) === here) return [px, py];
      }
    }
    return null;
  }
  /** the 0.5 m navigation cell is passable (walls, water and closed-door lines are not) */
  navOk(x: number, y: number) {
    const gx = Math.floor(x / 0.5), gy = Math.floor(y / 0.5), ph = this.phys;
    return ph.passable(ph.cellCode(gx, gy), gx, gy, "plan");
  }
  /** closest walkable outdoor point near (x, y) (spiral search) */
  freeNear(x: number, y: number, maxR = 30, outdoors = true): [number, number] | null {
    const ok = (px: number, py: number) => this.walkable(px, py) && (!outdoors || !this.map.buildingAt(px, py));
    if (ok(x, y)) return [x, y];
    for (let r = 1; r <= maxR; r += 1) {
      const n = Math.max(8, Math.round(r * 4));
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2, px = x + Math.cos(a) * r, py = y + Math.sin(a) * r;
        if (ok(px, py)) return [px, py];
      }
    }
    return null;
  }
  /** ground point under a canvas pixel */
  pick(px: number, py: number, camZ: number): [number, number] | null {
    if (!this.r.IVP) return null;
    const { o, d } = this.r.rayAt(px, py);
    if (Math.abs(d[1]) < 1e-4) return null;
    let t = (camZ - o[1]) / d[1];
    for (let k = 0; k < 4; k++) {
      const x = o[0] + d[0] * t, y = -(o[2] + d[2] * t);
      t = (this.h(x, y) - o[1]) / d[1];
    }
    return [o[0] + d[0] * t, -(o[2] + d[2] * t)];
  }
  /** screen position of a map point (CSS px) */
  screen(x: number, y: number, z: number): [number, number] | null { return this.r.project(x, z, -y); }

  /** a public street (trunk down to residential; not service lanes or footpaths) vertex or segment midpoint inside the half-extents (hx, hy) around (x, y) */
  mainRoadNear(x: number, y: number, r: number, hx: number, hy: number): boolean {
    for (const rd of this.mainRoads) {
      const p = rd.pts;
      for (let k = 0; k + 3 < p.length; k += 2) {
        for (let t = 0; t <= 1; t += 0.25) {
          const px = p[k] + (p[k + 2] - p[k]) * t, py = p[k + 1] + (p[k + 3] - p[k + 1]) * t;
          if (Math.abs(px - x) < hx && Math.abs(py - y) < hy) return true;
        }
      }
    }
    void r;
    return false;
  }
  get mainRoads(): any[] { return this._main || (this._main = this.map.layers.roads.filter((r: any) => ["trunk", "primary", "secondary", "tertiary", "residential", "unclassified", "living_street"].includes(r.class))); }
  _main: any[] | null = null;
  /** open, flat, dry rectangles (w x d m) near roads: candidate FOB sites, best first */
  findOpenSites(w: number, d: number, near: [number, number][], max = 6): { x: number; y: number; score: number; rot: number }[] {
    const cell = 4, b = this.playBounds;
    const nx = Math.ceil((b[2] - b[0]) / cell), ny = Math.ceil((b[3] - b[1]) / cell);
    const occ = new Uint8Array(nx * ny);
    for (const bd of this.map.buildings()) {
      if (bd.hidden || bd.part_of) continue;
      const bb = bd.bb;
      for (let i = Math.max(0, Math.floor((bb[0] - 2 - b[0]) / cell)); i <= Math.min(nx - 1, Math.floor((bb[2] + 2 - b[0]) / cell)); i++)
        for (let j = Math.max(0, Math.floor((bb[1] - 2 - b[1]) / cell)); j <= Math.min(ny - 1, Math.floor((bb[3] + 2 - b[1]) / cell)); j++) occ[j * nx + i] = 1;
    }
    // integral image of occupied cells
    const I = new Uint32Array((nx + 1) * (ny + 1));
    for (let j = 0; j < ny; j++) { let row = 0; for (let i = 0; i < nx; i++) { row += occ[j * nx + i]; I[(j + 1) * (nx + 1) + i + 1] = I[j * (nx + 1) + i + 1] + row; } }
    const sum = (i0: number, j0: number, i1: number, j1: number) => I[j1 * (nx + 1) + i1] - I[j0 * (nx + 1) + i1] - I[j1 * (nx + 1) + i0] + I[j0 * (nx + 1) + i0];
    const out: { x: number; y: number; score: number; rot: number }[] = [];
    for (const rot of [0, 1]) {
      const W = Math.ceil((rot ? d : w) / cell), H = Math.ceil((rot ? w : d) / cell);
      for (let j = 0; j + H < ny; j += 2) for (let i = 0; i + W < nx; i += 2) {
        if (sum(i, j, i + W, j + H)) continue;
        const cx = b[0] + (i + W / 2) * cell, cy = b[1] + (j + H / 2) * cell;
        // dry land, gentle slope, near a road
        let ok = true, zmin = Infinity, zmax = -Infinity;
        for (const [fx, fy] of [[0, 0], [-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5], [0, 0.5], [0, -0.5], [0.5, 0], [-0.5, 0]]) {
          const px = cx + fx * W * cell, py = cy + fy * H * cell;
          if (!this.phys.walkableAt(px, py, "human")) { ok = false; break; }
          const z = this.h(px, py); zmin = Math.min(zmin, z); zmax = Math.max(zmax, z);
        }
        if (!ok || zmax - zmin > 5) continue;
        const road = this.roads.near(cx, cy, 70, 1);
        if (!road.length) continue;
        // keep through-roads open: no main road may run through the compound
        const half = Math.max(W, H) * cell * 0.5 + 2;
        if (this.mainRoadNear(cx, cy, half, (rot ? d : w) / 2 + 2, (rot ? w : d) / 2 + 2)) continue;
        let dn = Infinity;
        for (const [qx, qy] of near) dn = Math.min(dn, dist(cx, cy, qx, qy));
        out.push({ x: cx, y: cy, rot: rot ? Math.PI / 2 : 0, score: dn + (zmax - zmin) * 25 });
      }
    }
    out.sort((a, b2) => a.score - b2.score);
    const picked: typeof out = [];
    for (const s of out) { if (picked.every((p) => dist(p.x, p.y, s.x, s.y) > 150)) picked.push(s); if (picked.length >= max) break; }
    return picked;
  }
}

// World view: streams map chunks into GPU meshes around the camera.
//  * buildings: LOD0 (full detail + interiors) near the camera, LOD1 (simplified footprint, no
//    details) further out, nothing beyond the far distance (fog). Meshes are built a few per
//    frame inside a time budget and freed when far away.
//  * ground: land, landuse areas, water, roads, rivers, piers, clipped per chunk. With a DEM the
//    ground is draped on the terrain by clipping every triangle to the terrain grid cells, so
//    shared edges get identical vertices (no cracks).
//  * trees and characters are GPU-instanced.
// Coordinates: map 2D (x = east, y = north) -> 3D (X = east, Y = up, Z = -north).
import { MeshBuilder, genBuilding, roadColor, SURFACE_COLOR, SURFACE_LAYER, FL, NOTEX, NOBID, treeInstances } from "./meshgen.js";
import { triangulate, ribbon, hash01, ringBBox } from "./geom.js";

const ROAD_RANK = { footway: 0, path: 0, steps: 0, cycleway: 0, bridleway: 0, corridor: 0, pedestrian: 1, track: 1, service: 2,
  living_street: 3, residential: 3, unclassified: 3, road: 3, tertiary: 4, tertiary_link: 4, secondary: 5, secondary_link: 5,
  primary: 6, primary_link: 6, trunk: 7, trunk_link: 7, motorway: 8, motorway_link: 8 };

export const LOD = { near: 330, far: 1900, keep: 2600 };

// ---------------------------------------------------------------- polygon clipping helpers
function clipPolyRect(P, x0, y0, x1, y1) {
  // P: [[x,y],...] convex or not (Sutherland–Hodgman against an axis-aligned rect)
  const edge = (pts, inside, cut) => {
    const out = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      const ia = inside(a), ib = inside(b);
      if (ia) out.push(a);
      if (ia !== ib) out.push(cut(a, b));
    }
    return out;
  };
  const lx = (a, b, x) => { const t = (x - a[0]) / (b[0] - a[0]); return [x, a[1] + (b[1] - a[1]) * t]; };
  const ly = (a, b, y) => { const t = (y - a[1]) / (b[1] - a[1]); return [a[0] + (b[0] - a[0]) * t, y]; };
  let p = P;
  p = edge(p, (q) => q[0] >= x0, (a, b) => lx(a, b, x0)); if (p.length < 3) return p;
  p = edge(p, (q) => q[0] <= x1, (a, b) => lx(a, b, x1)); if (p.length < 3) return p;
  p = edge(p, (q) => q[1] >= y0, (a, b) => ly(a, b, y0)); if (p.length < 3) return p;
  p = edge(p, (q) => q[1] <= y1, (a, b) => ly(a, b, y1));
  return p;
}

function densify(pts, maxSeg, wl = null, wr = null) {
  const out = [pts[0], pts[1]], ol = wl ? [wl[0]] : null, or = wr ? [wr[0]] : null;
  for (let i = 2; i < pts.length; i += 2) {
    const ax = pts[i - 2], ay = pts[i - 1], bx = pts[i], by = pts[i + 1];
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / maxSeg));
    for (let k = 1; k <= n; k++) {
      out.push(ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n);
      if (ol) { const a = wl[i / 2 - 1], b = wl[i / 2]; ol.push(a + ((b - a) * k) / n); }
      if (or) { const a = wr[i / 2 - 1], b = wr[i / 2]; or.push(a + ((b - a) * k) / n); }
    }
  }
  return ol ? { pts: out, wl: ol, wr: or } : out;
}

// ---------------------------------------------------------------- instanced geometry
function geoBuilder() {
  const v = [], c = [], n = [], idx = [];
  const tri = (a, b, d, col) => {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], wx = d[0] - a[0], wy = d[1] - a[1], wz = d[2] - a[2];
    let nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
    const l = Math.hypot(nx, ny, nz) || 1;
    const base = v.length / 3;
    for (const p of [a, b, d]) { v.push(...p); c.push(...col); n.push(nx / l, ny / l, nz / l); }
    idx.push(base, base + 1, base + 2);
  };
  const quad = (a, b, d, e, col) => { tri(a, b, d, col); tri(a, d, e, col); };
  // box from (x0,y0,z0) to (x1,y1,z1)
  const box = (x0, y0, z0, x1, y1, z1, col) => {
    const p = (x, y, z) => [x, y, z];
    quad(p(x0, y0, z1), p(x1, y0, z1), p(x1, y1, z1), p(x0, y1, z1), col);
    quad(p(x1, y0, z0), p(x0, y0, z0), p(x0, y1, z0), p(x1, y1, z0), col);
    quad(p(x1, y0, z1), p(x1, y0, z0), p(x1, y1, z0), p(x1, y1, z1), col);
    quad(p(x0, y0, z0), p(x0, y0, z1), p(x0, y1, z1), p(x0, y1, z0), col);
    quad(p(x0, y1, z1), p(x1, y1, z1), p(x1, y1, z0), p(x0, y1, z0), col);
    quad(p(x0, y0, z0), p(x1, y0, z0), p(x1, y0, z1), p(x0, y0, z1), col);
  };
  const cone = (r, y0, y1, sides, col, r1 = 0) => {
    for (let i = 0; i < sides; i++) {
      const a0 = (i / sides) * 6.2832, a1 = ((i + 1) / sides) * 6.2832;
      const A = [Math.cos(a0) * r, y0, Math.sin(a0) * r], B = [Math.cos(a1) * r, y0, Math.sin(a1) * r];
      if (r1 > 0) quad(A, [Math.cos(a0) * r1, y1, Math.sin(a0) * r1], [Math.cos(a1) * r1, y1, Math.sin(a1) * r1], B, col);
      else tri(A, [0, y1, 0], B, col);
      tri(A, B, [0, y0, 0], col);
    }
  };
  return { v, c, n, idx, tri, quad, box, cone };
}
export function treeGeo() {
  const g = geoBuilder();
  g.cone(0.18, 0, 2.6, 5, [0.42, 0.32, 0.22], 0.12);
  g.cone(2.2, 1.8, 5.4, 7, [0.27, 0.45, 0.2], 1.2);
  g.cone(1.6, 4.2, 6.8, 6, [0.3, 0.5, 0.22]);
  return g;
}
export function palmGeo() {
  const g = geoBuilder();
  g.cone(0.2, 0, 8.5, 5, [0.5, 0.42, 0.32], 0.14);
  for (let k = 0; k < 7; k++) {
    const a = (k / 7) * 6.2832, ca = Math.cos(a), sa = Math.sin(a);
    const P = (r, y, w) => [ca * r - sa * w, y, sa * r + ca * w];
    g.quad(P(0, 8.5, -0.35), P(3.2, 7.1, -0.6), P(3.2, 7.1, 0.6), P(0, 8.5, 0.35), [0.32, 0.55, 0.22]);
  }
  return g;
}
export function personGeo() {
  const g = geoBuilder();
  g.box(-0.13, 0, -0.1, -0.02, 0.85, 0.1, [0.25, 0.27, 0.35]);   // legs
  g.box(0.02, 0, -0.1, 0.13, 0.85, 0.1, [0.25, 0.27, 0.35]);
  g.box(-0.21, 0.85, -0.13, 0.21, 1.45, 0.13, [1, 1, 1]);         // torso (instance colour)
  g.box(-0.29, 0.9, -0.08, -0.21, 1.42, 0.08, [0.85, 0.7, 0.55]); // arms
  g.box(0.21, 0.9, -0.08, 0.29, 1.42, 0.08, [0.85, 0.7, 0.55]);
  g.box(-0.11, 1.47, -0.11, 0.11, 1.72, 0.11, [0.8, 0.64, 0.5]);  // head
  g.box(-0.04, 1.55, 0.11, 0.04, 1.62, 0.2, [0.8, 0.64, 0.5]);    // nose = facing +Z
  return g;
}
export function markerGeo() {
  const g = geoBuilder();
  g.cone(0.6, 0, 1.6, 4, [1, 1, 1]);
  g.cone(0.6, 0, -0.01, 4, [1, 1, 1]);
  return g;
}

// ---------------------------------------------------------------- world
export class World {
  constructor(renderer, map) {
    this.r = renderer;
    this.map = map;
    this.cs = map.cs;
    this.views = new Map(); // chunk key -> view
    this.terrain = map.terrain || null;
    this.res = this.terrain ? this.terrain.res : 0;
    this.lod = { ...LOD };
    this.showInteriors = true;
    this.prepGround();
    this.prepRoads();
    this.prepTrees();
    this.chars = {
      person: renderer.instMesh(...(() => { const g = personGeo(); return [g.v, g.c, g.n, g.idx]; })()),
      marker: renderer.instMesh(...(() => { const g = markerGeo(); return [g.v, g.c, g.n, g.idx]; })()),
    };
    this.charData = { person: new Float32Array(8 * 512), marker: new Float32Array(8 * 64) };
    this.instOrder = ["person", "marker"];
    this.buildStats = { chunks: 0, ms: 0 };
    map.on((ev) => {
      if (ev.type === "building") this.invalidate(ev.chunk, true);
      if (ev.type === "all") for (const k of this.views.keys()) this.invalidate(k, true);
    });
  }

  // ------------------------------------------------------------ heights
  h(x, y) { return this.terrain ? this.map.groundZ(x, y) : 0; }
  nrm(x, y) {
    if (!this.terrain) return [0, 1, 0];
    const e = this.res * 0.5;
    const hx = (this.h(x + e, y) - this.h(x - e, y)) / (2 * e), hy = (this.h(x, y + e) - this.h(x, y - e)) / (2 * e);
    const l = Math.hypot(hx, 1, hy);
    return [-hx / l, 1 / l, hy / l];
  }

  // ------------------------------------------------------------ ground preparation
  prepGround() {
    const L = this.map.layers, m = this.map;
    const items = []; // {verts:[x,y..], tris:[..], layer, col, fl, bb}
    const add = (outer, holes, surface, fl = 0, yoff = null) => {
      if (!outer || outer.length < 6) return;
      let tr;
      try { tr = triangulate(outer, holes || []); } catch (e) { return; }
      if (!tr.tris.length) return;
      const col = SURFACE_COLOR[surface] || SURFACE_COLOR.land;
      const layer = surface === "land" ? 0 : (SURFACE_LAYER[surface] ?? 1);
      items.push({ verts: tr.verts, tris: tr.tris, layer, col, fl, bb: ringBBox(outer), surface, yoff });
    };
    this.hasSea = (m.manifest.coast && m.manifest.coast.coastline_ways > 0) || false;
    const b = m.bounds();
    if (this.hasSea) for (const r of L.land) add(r.outer, [], "land");
    else add([b[0] - 400, b[1] - 400, b[2] + 400, b[1] - 400, b[2] + 400, b[3] + 400, b[0] - 400, b[3] + 400], [], "land");
    for (const a of L.areas) add(a.outer, a.holes, a.surface);
    for (const w of L.water) add(w.outer, w.holes, "water", FL.WATER);
    for (const p of L.piers) if (p.outer) add(p.outer, p.holes, "pier", 0, 1.1);
    // index triangles by chunk
    this.groundIdx = new Map();
    const cs = this.cs;
    items.forEach((it, ii) => {
      for (let t = 0; t < it.tris.length; t += 3) {
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (let k = 0; k < 3; k++) {
          const v = it.tris[t + k];
          const x = it.verts[2 * v], y = it.verts[2 * v + 1];
          if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
        }
        for (let i = Math.floor(x0 / cs); i <= Math.floor(x1 / cs); i++)
          for (let j = Math.floor(y0 / cs); j <= Math.floor(y1 / cs); j++) {
            const key = i + "," + j;
            let lst = this.groundIdx.get(key);
            if (!lst) this.groundIdx.set(key, (lst = []));
            lst.push(ii, t);
          }
      }
    });
    this.groundItems = items;
    if (this.hasSea) {
      const M = new MeshBuilder(64);
      const e = 4000, y = -0.35, col = SURFACE_COLOR.water;
      const q = [[b[0] - e, b[1] - e], [b[2] + e, b[1] - e], [b[2] + e, b[3] + e], [b[0] - e, b[3] + e]];
      const ids = q.map(([x, yy]) => M.v(x, y, -yy, 0, 1, 0, x / 4, yy / 4, col, NOTEX, NOTEX, 0, FL.WATER, NOBID));
      M.quad(ids[0], ids[1], ids[2], ids[3]);
      this.sea = this.r.upload(M.finish());
    }
  }

  // emit polygon `P` ([[x,y]...], already clipped to the chunk) draped on terrain
  emitDraped(M, P, yoff, col, fl, uvs = 4, flatY = null) {
    const fan = (Q) => {
      if (Q.length < 3) return;
      const ids = Q.map(([x, y]) => {
        const yy = flatY !== null ? flatY : this.h(x, y) + yoff;
        const n = flatY !== null ? [0, 1, 0] : this.nrm(x, y);
        return M.v(x, yy, -y, n[0], n[1], n[2], x / uvs, y / uvs, col, NOTEX, NOTEX, 0, fl, NOBID);
      });
      for (let k = 1; k < ids.length - 1; k++) M.tri(ids[0], ids[k], ids[k + 1]);
    };
    if (!this.terrain || flatY !== null) return fan(P);
    const g = this.terrain, r = g.res;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of P) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    const i0 = Math.floor((x0 - g.x0) / r), i1 = Math.floor((x1 - g.x0) / r), j0 = Math.floor((y0 - g.y0) / r), j1 = Math.floor((y1 - g.y0) / r);
    if (i0 === i1 && j0 === j1) return fan(P);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const cx0 = g.x0 + i * r, cy0 = g.y0 + j * r;
      fan(clipPolyRect(P, cx0, cy0, cx0 + r, cy0 + r));
    }
  }

  buildGround(i, j) {
    const cs = this.cs, x0 = i * cs, y0 = j * cs, x1 = x0 + cs, y1 = y0 + cs;
    const layers = new Map();
    const get = (layer) => { let M = layers.get(layer); if (!M) layers.set(layer, (M = new MeshBuilder(4096))); return M; };
    const lst = this.groundIdx.get(i + "," + j) || [];
    for (let k = 0; k < lst.length; k += 2) {
      const it = this.groundItems[lst[k]], t = lst[k + 1];
      const P = [];
      for (let q = 0; q < 3; q++) { const v = it.tris[t + q]; P.push([it.verts[2 * v], it.verts[2 * v + 1]]); }
      const C = clipPolyRect(P, x0, y0, x1, y1);
      if (C.length < 3) continue;
      const flat = it.yoff !== null ? Math.max(0, this.h(...C[0])) + it.yoff : null;
      this.emitDraped(get(it.layer), C, 0.02 * it.layer, it.col, it.fl, 4, flat);
    }
    // roads / rivers / line piers: quads whose midpoint is in this chunk
    for (const q of this.roadQuads.get(i + "," + j) || []) q(get(q.layer));
    const out = [];
    for (const [layer, M] of layers) if (M.ni) out.push({ g: this.r.upload(M.finish()), layer });
    return out;
  }

  prepRoads() {
    const L = this.map.layers;
    this.roadQuads = new Map();
    const cs = this.cs;
    const put = (x, y, layer, fn) => {
      const key = Math.floor(x / cs) + "," + Math.floor(y / cs);
      let lst = this.roadQuads.get(key);
      if (!lst) this.roadQuads.set(key, (lst = []));
      fn.layer = layer;
      lst.push(fn);
    };
    const maxSeg = this.terrain ? Math.min(8, this.res) : 1e9;
    const strip = (pts0, w, yoff, col, fl, layer, opts = {}) => {
      let pts, wl = null, wr = null;
      if (opts.wl) ({ pts, wl, wr } = densify(pts0, maxSeg, opts.wl, opts.wr));
      else pts = densify(pts0, maxSeg);
      const { L: Lf, R: Rf, S } = ribbon(pts, w / 2, wl, wr);
      const n = pts.length / 2;
      const zS = this.h(pts[0], pts[1]), zE = this.h(pts[pts.length - 2], pts[pts.length - 1]);
      const tot = S[n - 1] || 1;
      const yAt = (k, x, y) => (opts.deck !== undefined ? opts.deck(S[k] / tot, zS, zE) : this.h(x, y) + yoff);
      for (let k = 0; k < n - 1; k++) {
        const mx = (pts[2 * k] + pts[2 * k + 2]) / 2, my = (pts[2 * k + 1] + pts[2 * k + 3]) / 2;
        put(mx, my, layer, (M) => {
          const P = [[Lf[2 * k], Lf[2 * k + 1], 0, S[k]], [Rf[2 * k], Rf[2 * k + 1], 1, S[k]],
            [Rf[2 * k + 2], Rf[2 * k + 3], 1, S[k + 1]], [Lf[2 * k + 2], Lf[2 * k + 3], 0, S[k + 1]]];
          const ys = [yAt(k, P[0][0], P[0][1]), yAt(k, P[1][0], P[1][1]), yAt(k + 1, P[2][0], P[2][1]), yAt(k + 1, P[3][0], P[3][1])];
          const nn = opts.deck !== undefined ? [0, 1, 0] : this.nrm(mx, my);
          const ids = P.map((p, q) => M.v(p[0], ys[q], -p[1], nn[0], nn[1], nn[2], p[2], p[3] / (opts.uvDiv || 1), col, NOTEX, NOTEX, 0, fl, NOBID));
          M.quad(ids[0], ids[1], ids[2], ids[3]);
          if (opts.sides) {
            for (const [E, s] of [[Lf, 1], [Rf, -1]]) {
              const ax = E[2 * k], ay = E[2 * k + 1], bx = E[2 * k + 2], by = E[2 * k + 3];
              const ya = s > 0 ? ys[0] : ys[1], yb = s > 0 ? ys[3] : ys[2];
              const dx = bx - ax, dy = by - ay, l = Math.hypot(dx, dy) || 1;
              const nx = (-dy / l) * s, ny = (dx / l) * s; // outward
              const sc = opts.sideCol || col.map((v) => v * 0.8);
              for (const [lo, hi, f] of [[-opts.sides, 0, 0], [0, opts.rail || 0, FL.TWO]]) {
                if (hi - lo < 0.01) continue;
                const q = [M.v(ax, ya + lo, -ay, nx, 0, -ny, 0, 0, sc, NOTEX, NOTEX, 0, f, NOBID), M.v(bx, yb + lo, -by, nx, 0, -ny, 0, 0, sc, NOTEX, NOTEX, 0, f, NOBID),
                  M.v(bx, yb + hi, -by, nx, 0, -ny, 0, 0, sc, NOTEX, NOTEX, 0, f, NOBID), M.v(ax, ya + hi, -ay, nx, 0, -ny, 0, 0, sc, NOTEX, NOTEX, 0, f, NOBID)];
                M.quad(q[0], q[1], q[2], q[3]);
              }
            }
          }
        });
      }
    };
    for (const w of L.waterways) strip(w.pts, w.w, 0.07, SURFACE_COLOR.water, FL.WATER, 4, { uvDiv: 4 });
    for (const rd of L.roads) {
      if (rd.tunnel) continue;
      const rank = ROAD_RANK[rd.class] ?? 3;
      const mark = rank >= 4 && !/unpaved|gravel|dirt/.test(rd.surface || "") ? FL.MARK : 0;
      const opts = rd.wl ? { wl: rd.wl, wr: rd.wr } : {};
      if (rd.bridge) {
        opts.deck = (s, a, b) => a + (b - a) * s + 0.5; // straight deck between the abutments (not draped into the river)
        opts.sides = 0.6; opts.rail = 1.0; opts.sideCol = [0.62, 0.62, 0.6];
      }
      strip(rd.pts, rd.w, 0.06 + 0.004 * rank, roadColor(rd), FL.NOISE | mark, rd.bridge ? 7 : 5 + (rank >= 4 ? 1 : 0), opts);
    }
    for (const p of L.piers) if (p.pts) {
      strip(p.pts, p.w, 0, [0.55, 0.5, 0.45], FL.NOISE, 6, { deck: (s, a, b) => Math.max(0, a + (b - a) * s) + 1.1, sides: 2.0, rail: 0.0 });
    }
    // bridge decks double as walkable surfaces for characters
    this.bridges = L.roads.filter((r) => r.bridge);
  }

  // height of a walkable surface at (x, y): bridge deck if on one, else ground
  surfaceZ(x, y) {
    for (const rd of this.bridges) {
      const p = rd.pts, n = p.length / 2;
      let acc = 0, tot = 0;
      for (let k = 0; k < n - 1; k++) tot += Math.hypot(p[2 * k + 2] - p[2 * k], p[2 * k + 3] - p[2 * k + 1]);
      for (let k = 0; k < n - 1; k++) {
        const ax = p[2 * k], ay = p[2 * k + 1], bx = p[2 * k + 2], by = p[2 * k + 3];
        const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy || 1;
        const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / L2));
        const d = Math.hypot(x - ax - t * dx, y - ay - t * dy);
        const segL = Math.sqrt(L2);
        if (d < rd.w / 2 + 0.3) {
          const s = (acc + t * segL) / (tot || 1);
          const zS = this.h(p[0], p[1]), zE = this.h(p[2 * n - 2], p[2 * n - 1]);
          return zS + (zE - zS) * s + 0.5;
        }
        acc += segL;
      }
    }
    return this.h(x, y);
  }

  prepTrees() {
    const all = treeInstances(this.map);
    this.trees = all.map(([x, y, kind, mapped]) => ({ x, y, kind, mapped, z: this.h(x, y), s: 0.75 + 0.5 * hash01(x.toFixed(1) + "," + y.toFixed(1), "s"), rot: hash01(x.toFixed(1), "r") * 6.28 }));
    const t = treeGeo(), p = palmGeo();
    this.treeMesh = this.r.instMesh(t.v, t.c, t.n, t.idx);
    this.palmMesh = this.r.instMesh(p.v, p.c, p.n, p.idx);
    this.treeCenter = null;
  }
  updateTrees(cx, cy, radius = 650) {
    if (this.treeCenter && Math.hypot(cx - this.treeCenter[0], cy - this.treeCenter[1]) < 60) return;
    this.treeCenter = [cx, cy];
    const A = [], B = [];
    for (const t of this.trees) {
      if (Math.abs(t.x - cx) > radius || Math.abs(t.y - cy) > radius) continue;
      const tint = t.mapped ? 1 : 0.92;
      (t.kind === 2 ? B : A).push(t.x, t.z, -t.y, t.s, t.rot, tint, tint, tint);
    }
    this.r.setInstances(this.treeMesh, new Float32Array(A), A.length / 8);
    this.r.setInstances(this.palmMesh, new Float32Array(B), B.length / 8);
  }

  // register another instanced model (units, zombies, vehicles, effects...)
  defineInstanced(kind, geo) {
    if (this.chars[kind]) return;
    this.chars[kind] = this.r.instMesh(geo.v, geo.c, geo.n, geo.idx);
    this.charData[kind] = new Float32Array(8 * 64);
    this.instOrder.push(kind);
  }
  // characters: list of {x, y, z, rot, col:[r,g,b], s}
  setCharacters(kind, list) {
    let d = this.charData[kind];
    if (d.length < list.length * 8) d = this.charData[kind] = new Float32Array(list.length * 16);
    list.forEach((c, k) => {
      const o = k * 8;
      d[o] = c.x; d[o + 1] = c.z; d[o + 2] = -c.y; d[o + 3] = c.s || 1;
      d[o + 4] = c.rot || 0; d[o + 5] = c.col[0]; d[o + 6] = c.col[1]; d[o + 7] = c.col[2];
    });
    this.r.setInstances(this.chars[kind], d, list.length);
  }

  // ------------------------------------------------------------ chunk views
  view(key) {
    let v = this.views.get(key);
    if (!v) {
      const [i, j] = key.split(",").map(Number);
      const c = this.map.chunks.get(key);
      v = { key, i, j, ground: null, b0: null, b1: null, dirty0: true, dirty1: true, n: c ? c.buildings.length : 0, state: null, lastUsed: 0 };
      if (v.n) v.state = this.r.createState(v.n);
      this.views.set(key, v);
    }
    return v;
  }
  invalidate(key, buildingsOnly) {
    const v = this.views.get(key);
    if (!v) return;
    v.dirty0 = v.dirty1 = true;
    if (!buildingsOnly) { this.freeGround(v); }
  }
  freeGround(v) { if (v.ground) for (const it of v.ground) this.r.free(it.g); v.ground = null; }
  freeBuildings(v, lod) {
    if (lod !== 1 && v.b0) { this.r.free(v.b0); v.b0 = null; v.dirty0 = true; }
    if (lod !== 0 && v.b1) { this.r.free(v.b1); v.b1 = null; v.dirty1 = true; }
  }
  buildBuildings(v, lod) {
    const c = this.map.chunks.get(v.key);
    if (!c || !c.buildings.length) return null;
    // buildings can be added at run time (FOB, checkpoints, sandbags): grow the state texture
    if (!v.state || c.buildings.length > v.state.w * v.state.h) {
      const old = v.state;
      v.state = this.r.createState(c.buildings.length + 64);
      if (old) v.state.data.set(old.data.subarray(0, Math.min(old.data.length, v.state.data.length)));
      v.state.dirty = true;
    }
    v.n = c.buildings.length;
    const M = new MeshBuilder(lod === 0 ? 16384 : 4096);
    c.buildings.forEach((b, idx) => {
      try { genBuilding(M, b, idx, lod, this.map); } catch (e) { console.warn("mesh", b.id, e); }
    });
    return M.ni ? this.r.upload(M.finish()) : null;
  }

  // per-building state: dmg 0..3, door open, roof cut, selected, highlighted
  setState(b, patch) {
    const v = this.view(b.chunk);
    if (!v.state) return;
    const s = (b.rs = { dmg: 0, door: 0, roof: 0, sel: 0, hl: 0, ...(b.rs || {}), ...patch });
    const o = b.idx * 4, d = v.state.data;
    d[o] = Math.min(3, s.dmg) * 64;
    d[o + 1] = (s.door ? 1 : 0) | (s.roof ? 2 : 0) | (s.sel ? 4 : 0) | (s.hl ? 8 : 0);
    v.state.dirty = true;
  }

  // stream around (cx, cy) (map metres); returns the scene for the renderer
  update(cx, cy, frame, budgetMs = 10) {
    const cs = this.cs, t0 = performance.now();
    const far = this.lod.far, near = this.lod.near;
    const want = [];
    const r = Math.ceil(far / cs) + 1;
    const ci = Math.floor(cx / cs), cj = Math.floor(cy / cs);
    for (let i = ci - r; i <= ci + r; i++) for (let j = cj - r; j <= cj + r; j++) {
      const ccx = (i + 0.5) * cs, ccy = (j + 0.5) * cs;
      const d = Math.max(0, Math.hypot(ccx - cx, ccy - cy) - cs * 0.71);
      if (d > far) continue;
      const key = i + "," + j;
      if (!this.groundIdx.has(key) && !this.roadQuads.has(key) && !this.map.chunks.has(key)) continue;
      want.push({ key, d });
    }
    want.sort((a, b) => a.d - b.d);
    const scene = { ground: [], buildings: [], inst: [], lines: [] };
    if (this.sea) scene.ground.push({ g: this.sea, layer: 0 });
    let built = 0;
    for (const { key, d } of want) {
      const v = this.view(key);
      v.lastUsed = frame;
      const canBuild = () => performance.now() - t0 < budgetMs || built === 0;
      if (!v.ground && canBuild()) { v.ground = this.buildGround(v.i, v.j); built++; }
      if (v.ground) for (const it of v.ground) scene.ground.push(it);
      const cc = this.map.chunks.get(key);
      if (cc && cc.buildings.length !== v.n) { v.n = cc.buildings.length; v.dirty0 = v.dirty1 = true; }
      if (!v.n) continue;
      const lod = d < near ? 0 : 1;
      if (lod === 0 && (v.dirty0 || !v.b0) && canBuild()) { if (v.b0) this.r.free(v.b0); v.b0 = this.buildBuildings(v, 0); v.dirty0 = false; built++; }
      if ((lod === 1 || !v.b0 || v.dirty0) && (v.dirty1 || !v.b1) && canBuild()) { if (v.b1) this.r.free(v.b1); v.b1 = this.buildBuildings(v, 1); v.dirty1 = false; built++; }
      const g = lod === 0 && v.b0 && !v.dirty0 ? v.b0 : v.b1 || v.b0;
      if (g) scene.buildings.push({ g, state: v.state, chunk: key });
      if (lod === 1 && v.b0 && d > near + 150) this.freeBuildings(v, 0);
    }
    // free far chunks
    for (const v of this.views.values()) {
      if (frame - v.lastUsed > 120) {
        const d = Math.hypot((v.i + 0.5) * cs - cx, (v.j + 0.5) * cs - cy);
        if (d > this.lod.keep) { this.freeGround(v); this.freeBuildings(v); }
      }
    }
    this.updateTrees(cx, cy);
    if (!this.spriteTrees) scene.inst.push({ m: this.treeMesh }, { m: this.palmMesh });   // else drawn as sprites
    for (const k of this.instOrder) scene.inst.push({ m: this.chars[k] });
    this.buildStats = { built, ms: performance.now() - t0, pending: want.filter((w) => { const v = this.views.get(w.key); return !v.ground || (v.n && !v.b0 && !v.b1); }).length };
    return scene;
  }
}

// Mesh generation from map data. Every building mesh is extruded from its own real footprint;
// archetypes only choose facade tiles, roof form and details.
import { T } from "./atlas.js";
import { ARCH } from "./archetypes.js";
import { triangulate, ribbon, hash01, ringArea, ringBBox, pointInPoly } from "./geom.js";

export const FL = { ROOF: 1, INTERIOR: 2, DOOR: 4, MARK: 8, TWO: 16, WATER: 32, NOISE: 64 };
export const NOTEX = 255, NOBID = 65535;
export const STRIDE = 36;

export class MeshBuilder {
  constructor(cap = 2048) {
    this.nv = 0; this.ni = 0; this.cap = 0;
    this.alloc(cap);
    this.idx = new Uint32Array(cap * 2);
    this.min = [Infinity, Infinity, Infinity];
    this.max = [-Infinity, -Infinity, -Infinity];
  }
  alloc(cap) {
    const buf = new ArrayBuffer(cap * STRIDE);
    if (this.buf) new Uint8Array(buf).set(new Uint8Array(this.buf, 0, this.nv * STRIDE));
    this.buf = buf; this.f32 = new Float32Array(buf); this.i8 = new Int8Array(buf);
    this.u8 = new Uint8Array(buf); this.u16 = new Uint16Array(buf); this.cap = cap;
  }
  v(x, y, z, nx, ny, nz, u, w, col, tA, tB, lv, fl, bid) {
    if (this.nv >= this.cap) this.alloc(this.cap * 2);
    const k = this.nv * 9, o = this.nv * STRIDE;
    const f = this.f32;
    f[k] = x; f[k + 1] = y; f[k + 2] = z; f[k + 4] = u; f[k + 5] = w;
    this.i8[o + 12] = Math.round(nx * 127); this.i8[o + 13] = Math.round(ny * 127); this.i8[o + 14] = Math.round(nz * 127);
    const u8 = this.u8;
    u8[o + 24] = clamp255(col[0]); u8[o + 25] = clamp255(col[1]); u8[o + 26] = clamp255(col[2]); u8[o + 27] = 255;
    u8[o + 28] = tA; u8[o + 29] = tB; u8[o + 30] = lv; u8[o + 31] = fl;
    this.u16[(o + 32) >> 1] = bid;
    if (x < this.min[0]) this.min[0] = x; if (y < this.min[1]) this.min[1] = y; if (z < this.min[2]) this.min[2] = z;
    if (x > this.max[0]) this.max[0] = x; if (y > this.max[1]) this.max[1] = y; if (z > this.max[2]) this.max[2] = z;
    return this.nv++;
  }
  tri(a, b, c) {
    if (this.ni + 3 > this.idx.length) {
      const n = new Uint32Array(this.idx.length * 2);
      n.set(this.idx);
      this.idx = n;
    }
    this.idx[this.ni++] = a; this.idx[this.ni++] = b; this.idx[this.ni++] = c;
  }
  quad(a, b, c, d) { this.tri(a, b, c); this.tri(a, c, d); }
  finish() {
    return {
      vb: new Uint8Array(this.buf.slice(0, this.nv * STRIDE)), ib: this.idx.slice(0, this.ni),
      nv: this.nv, ni: this.ni, min: this.min.slice(), max: this.max.slice(),
    };
  }
}
function clamp255(v) { return v <= 0 ? 0 : v >= 1 ? 255 : Math.round(v * 255); }

// planar polygon face (3 or 4 points) with automatic winding toward `hint`
function face(M, P, hint, uvf, col, tA, tB, lv, fl, bid) {
  const [a, b, c] = P;
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const l = Math.hypot(nx, ny, nz) || 1;
  nx /= l; ny /= l; nz /= l;
  let pts = P;
  if (nx * hint[0] + ny * hint[1] + nz * hint[2] < 0) { pts = P.slice().reverse(); nx = -nx; ny = -ny; nz = -nz; }
  const ids = pts.map((p) => { const uv = uvf(p); return M.v(p[0], p[1], p[2], nx, ny, nz, uv[0], uv[1], col, tA, tB, lv, fl, bid); });
  if (ids.length === 3) M.tri(ids[0], ids[1], ids[2]);
  else M.quad(ids[0], ids[1], ids[2], ids[3]);
}
// 3D point from map (x, y) and height z
const P3 = (x, y, z) => [x, z, -y];

// axis box (map coords, centre cx,cy, half sizes, rotation dir d=(dx,dy)), z from z0 to z1
function box(M, cx, cy, hx, hy, z0, z1, d, col, tile, fl, bid) {
  const px = -d[1], py = d[0];
  const c = (sx, sy) => [cx + d[0] * hx * sx + px * hy * sy, cy + d[1] * hx * sx + py * hy * sy];
  const q = [c(-1, -1), c(1, -1), c(1, 1), c(-1, 1)];
  for (let i = 0; i < 4; i++) {
    const a = q[i], b = q[(i + 1) % 4];
    const mx = (a[0] + b[0]) / 2 - cx, my = (a[1] + b[1]) / 2 - cy;
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    face(M, [P3(a[0], a[1], z0), P3(b[0], b[1], z0), P3(b[0], b[1], z1), P3(a[0], a[1], z1)], [mx, 0, -my],
      (p) => [0, 0], col, tile, tile, 0, fl, bid);
    void L;
  }
  face(M, [P3(...q[0], z1), P3(...q[1], z1), P3(...q[2], z1), P3(...q[3], z1)], [0, 1, 0], () => [0, 0], col, tile, tile, 0, fl, bid);
}
function prism(M, cx, cy, r, z0, z1, sides, col, fl, bid, cap = true) {
  for (let i = 0; i < sides; i++) {
    const a0 = (i / sides) * Math.PI * 2, a1 = ((i + 1) / sides) * Math.PI * 2;
    const ax = cx + Math.cos(a0) * r, ay = cy + Math.sin(a0) * r, bx = cx + Math.cos(a1) * r, by = cy + Math.sin(a1) * r;
    face(M, [P3(ax, ay, z0), P3(bx, by, z0), P3(bx, by, z1), P3(ax, ay, z1)], [(ax + bx) / 2 - cx, 0, -((ay + by) / 2 - cy)], () => [0, 0], col, NOTEX, NOTEX, 0, fl, bid);
  }
  if (cap) {
    const c = M.v(cx, z1, -cy, 0, 1, 0, 0, 0, col, NOTEX, NOTEX, 0, fl, bid);
    const ring = [];
    for (let i = 0; i < sides; i++) { const a = (i / sides) * Math.PI * 2; ring.push(M.v(cx + Math.cos(a) * r, z1, -(cy + Math.sin(a) * r), 0, 1, 0, 0, 0, col, NOTEX, NOTEX, 0, fl, bid)); }
    for (let i = 0; i < sides; i++) M.tri(c, ring[i], ring[(i + 1) % sides]);
  }
}

// ---------------------------------------------------------------- oriented box (JS, for corrected footprints)
export function minAreaRect(f) {
  const pts = [];
  for (let i = 0; i < f.length; i += 2) pts.push([f[i], f[i + 1]]);
  pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], hi = [];
  for (const p of pts) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
  for (let i = pts.length - 1; i >= 0; i--) { const p = pts[i]; while (hi.length >= 2 && cross(hi[hi.length - 2], hi[hi.length - 1], p) <= 0) hi.pop(); hi.push(p); }
  const hull = lo.slice(0, -1).concat(hi.slice(0, -1));
  let best = null;
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i], b = hull[(i + 1) % hull.length];
    const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
    const c = Math.cos(-ang), s = Math.sin(-ang);
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const [x, y] of hull) { const rx = x * c - y * s, ry = x * s + y * c; x0 = Math.min(x0, rx); x1 = Math.max(x1, rx); y0 = Math.min(y0, ry); y1 = Math.max(y1, ry); }
    const area = (x1 - x0) * (y1 - y0);
    if (!best || area < best.area) {
      const mx = (x0 + x1) / 2, my = (y0 + y1) / 2, ci = Math.cos(ang), si = Math.sin(ang);
      best = { area, w: x1 - x0, h: y1 - y0, ang, cx: mx * ci - my * si, cy: mx * si + my * ci };
    }
  }
  let { w, h, ang } = best;
  if (h > w) { [w, h] = [h, w]; ang += Math.PI / 2; }
  const brg = ((90 - (ang * 180) / Math.PI) % 180 + 180) % 180;
  return [best.cx, best.cy, w, h, brg];
}

// Interior plan for enterable buildings (shared by mesh, collision and nav so they agree).
export function interiorPlan(b) {
  if (b._plan && b._plan.fp === b.fp) return b._plan;
  const plan = { fp: b.fp, partition: null, doorW: 0, gap: null };
  const A = ARCH[b.a] || ARCH.concrete_house_1f;
  const f = b.fp, n = f.length / 2;
  const [ei, t] = b.ent;
  const i = ei % n, j = (i + 1) % n;
  const L = Math.hypot(f[2 * j] - f[2 * i], f[2 * j + 1] - f[2 * i + 1]);
  const dw = Math.min(A.doorW, L * 0.7);
  plan.doorW = dw;
  plan.gap = [i, Math.max(0.02, t - dw / 2 / L), Math.min(0.98, t + dw / 2 / L)];
  const obb = b.corr && b.corr.footprint_wgs84 ? minAreaRect(f) : b.obb;
  const area = Math.abs(ringArea(f));
  if (area > 60 && area / (obb[2] * obb[3]) > 0.82 && obb[2] > 9) {
    const br = (obb[4] * Math.PI) / 180;
    const d = [Math.sin(br), Math.cos(br)], p = [Math.cos(br), -Math.sin(br)];
    const hw = obb[3] / 2 - 0.15;
    plan.partition = [obb[0] - p[0] * hw, obb[1] - p[1] * hw, obb[0] + p[0] * hw, obb[1] + p[1] * hw, 0.42, 0.58];
    void d;
  }
  b._plan = plan;
  return plan;
}

export function buildingBase(b, map) {
  return (b.z || (map ? map.groundZ(b.ip[0], b.ip[1]) : 0)) + (b.mh || 0);
}

// ---------------------------------------------------------------- buildings
export function genBuilding(M, b, bid, lod, map) {
  if (b.has_parts || b.hidden) return; // simple-3D-buildings convention: parts replace the outline
  const A = ARCH[b.a] || ARCH.concrete_house_1f;
  const key = b.id;
  const f = lod === 0 ? b.fp : (b.corr && b.corr.footprint_wgs84 ? b.fp : (b.lod || b.fp));
  const holes = lod === 0 ? b.holes || [] : [];
  const base = buildingBase(b, map);
  const raised = A.raised || 0;
  const top = base + b.h;
  const flat = b.rf === "flat";
  const lv = A.rows || Math.max(1, Math.min(60, b.lv | 0));
  const fh = Math.max(2.2, (b.h - (flat ? 0.8 : 0.3) - raised) / lv);
  const wc = b.wc, rc = b.rc;
  const enter = lod === 0 && b.enter && b.a !== "canopy";
  const plan = enter ? interiorPlan(b) : null;
  const n = f.length / 2;
  const entEdge = lod === 0 ? b.ent[0] % (b.fp.length / 2) : -1;
  const canopy = b.a === "canopy";

  if (!canopy) {
    const rings = [f, ...holes];
    rings.forEach((r, ri) => {
      const m = r.length / 2;
      for (let i = 0; i < m; i++) {
        const j = (i + 1) % m;
        const ax = r[2 * i], ay = r[2 * i + 1], bx = r[2 * j], by = r[2 * j + 1];
        const L = Math.hypot(bx - ax, by - ay);
        if (L < 0.05) continue;
        const nx = (by - ay) / L, ny = -(bx - ax) / L;
        const nmod = L < 1.4 ? 0 : Math.max(1, Math.round(L / A.module));
        const us = nmod ? nmod / L : 1 / A.module;
        const isEnt = ri === 0 && i === entEdge;
        const tA = nmod ? (isEnt ? A.front : A.ground) : T.plain, tB = nmod ? A.upper : T.plain;
        const zb = base + raised - (raised ? 0 : 0.4), zt = top;
        const wallSeg = (t0, t1, z0, z1) => {
          const x0 = ax + (bx - ax) * t0, y0 = ay + (by - ay) * t0, x1 = ax + (bx - ax) * t1, y1 = ay + (by - ay) * t1;
          const u0 = t0 * L * us, u1 = t1 * L * us, v0 = (z0 - base - raised) / fh, v1 = (z1 - base - raised) / fh;
          const a0 = M.v(x0, z0, -y0, nx, 0, -ny, u0, v0, wc, tA, tB, lv, 0, bid);
          const a1 = M.v(x1, z0, -y1, nx, 0, -ny, u1, v0, wc, tA, tB, lv, 0, bid);
          const a2 = M.v(x1, z1, -y1, nx, 0, -ny, u1, v1, wc, tA, tB, lv, 0, bid);
          const a3 = M.v(x0, z1, -y0, nx, 0, -ny, u0, v1, wc, tA, tB, lv, 0, bid);
          M.quad(a0, a1, a2, a3);
        };
        if (isEnt && plan) {
          const [, g0, g1] = plan.gap;
          const dz = base + raised + Math.min(A.doorH, fh * 0.9);
          wallSeg(0, g0, zb, zt);
          wallSeg(g1, 1, zb, zt);
          wallSeg(g0, g1, dz, zt);
          // door leaf filling the gap (removed when opened / destroyed: DOOR flag + state)
          const x0 = ax + (bx - ax) * g0, y0 = ay + (by - ay) * g0, x1 = ax + (bx - ax) * g1, y1 = ay + (by - ay) * g1;
          const ins = 0.06;
          face(M, [P3(x0 - nx * ins, y0 - ny * ins, base + raised), P3(x1 - nx * ins, y1 - ny * ins, base + raised),
            P3(x1 - nx * ins, y1 - ny * ins, dz), P3(x0 - nx * ins, y0 - ny * ins, dz)], [nx, 0, -ny],
          (p) => { const s = ((p[0] - x0) * (x1 - x0) + (-p[2] - y0) * (y1 - y0)) / ((x1 - x0) ** 2 + (y1 - y0) ** 2 || 1); return [s, (p[1] - base - raised) / (dz - base - raised)]; },
          [1, 1, 1], A.door, A.door, 0, FL.DOOR | FL.TWO, bid);
        } else {
          wallSeg(0, 1, zb, zt);
          if (isEnt && lod === 0) {
            // decorative door on non-enterable buildings
            const dw = Math.min(A.doorW, L * 0.6), dh = Math.min(A.doorH, fh * 0.9);
            const t = b.ent[1];
            const t0 = Math.max(0, t - dw / 2 / L), t1 = Math.min(1, t + dw / 2 / L);
            const o = 0.035;
            const x0 = ax + (bx - ax) * t0 + nx * o, y0 = ay + (by - ay) * t0 + ny * o, x1 = ax + (bx - ax) * t1 + nx * o, y1 = ay + (by - ay) * t1 + ny * o;
            const z0 = base + raised, z1 = z0 + dh;
            const q = [M.v(x0, z0, -y0, nx, 0, -ny, 0, 0, [1, 1, 1], A.door, A.door, 0, 0, bid), M.v(x1, z0, -y1, nx, 0, -ny, 1, 0, [1, 1, 1], A.door, A.door, 0, 0, bid),
              M.v(x1, z1, -y1, nx, 0, -ny, 1, 1, [1, 1, 1], A.door, A.door, 0, 0, bid), M.v(x0, z1, -y0, nx, 0, -ny, 0, 1, [1, 1, 1], A.door, A.door, 0, 0, bid)];
            M.quad(q[0], q[1], q[2], q[3]);
          }
        }
      }
    });
  }

  // ---- roof
  const obb = b.corr && b.corr.footprint_wgs84 ? minAreaRect(f) : b.obb;
  const roofTile = b.rm === "concrete" || flat ? T.roof_concrete : (A.roofTile === T.roof_gi && hash01(key, "rust") < 0.35 ? T.roof_gi_rust : A.roofTile);
  if (flat || !obb) {
    const deck = canopy ? top : top - (lod === 0 ? 0.7 : 0.05);
    const tr = triangulate(f, holes);
    const ids = [];
    for (let k = 0; k < tr.verts.length; k += 2) ids.push(M.v(tr.verts[k], deck, -tr.verts[k + 1], 0, 1, 0, tr.verts[k] / 3, tr.verts[k + 1] / 3, rc, roofTile, roofTile, 0, FL.ROOF, bid));
    for (let k = 0; k < tr.tris.length; k += 3) M.tri(ids[tr.tris[k]], ids[tr.tris[k + 1]], ids[tr.tris[k + 2]]);
    if (lod === 0 && !canopy && A.details.includes("tank?") && hash01(key, "tank") < 0.3 && Math.abs(ringArea(f)) > 40) {
      const [cx, cy] = b.ip;
      prism(M, cx + 1.2, cy + 0.8, 0.55, deck, deck + 1.1, 8, hash01(key, "tankc") < 0.5 ? [0.12, 0.25, 0.55] : [0.12, 0.12, 0.13], FL.ROOF, bid);
    }
  } else {
    pitchedRoof(M, obb, b.rf, top, b.rh, canopy ? 0.3 : A.overhang, rc, wc, roofTile, bid);
  }

  if (lod !== 0) return;
  // ---- details (estimated decoration on real footprints)
  const fe = b.fp, ne = fe.length / 2, ei = b.ent[0] % ne, ej = (ei + 1) % ne;
  const ex = fe[2 * ei], ey = fe[2 * ei + 1], fx = fe[2 * ej], fy = fe[2 * ej + 1];
  const EL = Math.hypot(fx - ex, fy - ey) || 1;
  const enx = (fy - ey) / EL, eny = -(fx - ex) / EL, edx = (fx - ex) / EL, edy = (fy - ey) / EL;
  const at = (t, out) => [ex + (fx - ex) * t + enx * out, ey + (fy - ey) * t + eny * out];
  for (const dtl of A.details) {
    if (dtl === "stilts" || dtl === "posts") {
      const ph = dtl === "stilts" ? raised : b.h;
      for (let i = 0; i < n; i++) box(M, f[2 * i], f[2 * i + 1], 0.1, 0.1, base, base + ph, [1, 0], [0.35, 0.27, 0.2], NOTEX, 0, bid);
    } else if (dtl === "awning") {
      const z0 = base + Math.min(fh, 3.0) * 0.86, w = Math.min(EL, 9), t0 = Math.max(0, b.ent[1] - w / 2 / EL), t1 = Math.min(1, b.ent[1] + w / 2 / EL);
      const pal = [[0.75, 0.18, 0.15], [0.15, 0.35, 0.65], [0.2, 0.5, 0.3], [0.85, 0.65, 0.2], [0.6, 0.62, 0.65]];
      const col = pal[Math.floor(hash01(key, "awn") * pal.length)];
      const a = at(t0, 0.05), c = at(t1, 0.05), a2 = at(t0, 1.3), c2 = at(t1, 1.3);
      face(M, [P3(a[0], a[1], z0), P3(c[0], c[1], z0), P3(c2[0], c2[1], z0 - 0.45), P3(a2[0], a2[1], z0 - 0.45)], [enx, 1, -eny], () => [0, 0], col, NOTEX, NOTEX, 0, FL.TWO, bid);
    } else if (dtl === "sign") {
      const z0 = base + fh * 0.84 + (b.a === "commercial_block" ? fh : 0), w = Math.min(EL * 0.8, 10);
      const t0 = Math.max(0, 0.5 - w / 2 / EL), t1 = Math.min(1, 0.5 + w / 2 / EL);
      const a = at(t0, 0.08), c = at(t1, 0.08);
      face(M, [P3(a[0], a[1], z0), P3(c[0], c[1], z0), P3(c[0], c[1], z0 + 0.7), P3(a[0], a[1], z0 + 0.7)], [enx, 0, -eny],
        (p) => [((p[0] - a[0]) * edx + (-p[2] - a[1]) * edy) / 3, 0.62 + ((p[1] - z0) / 0.7) * 0.3], [1, 1, 1], T.sign_band, T.sign_band, 0, 0, bid);
    } else if (dtl === "cross") {
      const z0 = base + Math.min(b.h - 2, fh * 1.3), a = at(0.5 - 1.0 / EL, 0.1), c = at(0.5 + 1.0 / EL, 0.1);
      face(M, [P3(a[0], a[1], z0), P3(c[0], c[1], z0), P3(c[0], c[1], z0 + 2), P3(a[0], a[1], z0 + 2)], [enx, 0, -eny],
        (p) => [((p[0] - a[0]) * edx + (-p[2] - a[1]) * edy) / 2, (p[1] - z0) / 2], [1, 1, 1], T.sign_cross, T.sign_cross, 0, 0, bid);
    } else if (dtl === "portico") {
      const depth = 3.2, h = Math.min(fh * 1.6, b.h), w = Math.min(EL * 0.5, 12);
      for (let k = 0; k < 4; k++) {
        const t = b.ent[1] + ((k - 1.5) / 3) * (w / EL);
        const p = at(t, depth);
        prism(M, p[0], p[1], 0.32, base, base + h, 10, [0.95, 0.94, 0.9], 0, bid, false);
      }
      const t0 = b.ent[1] - (w / 2 + 0.6) / EL, t1 = b.ent[1] + (w / 2 + 0.6) / EL;
      const a = at(t0, 0), c = at(t1, 0), a2 = at(t0, depth + 0.6), c2 = at(t1, depth + 0.6);
      for (const zz of [base + h, base + h + 0.6]) face(M, [P3(a[0], a[1], zz), P3(c[0], c[1], zz), P3(c2[0], c2[1], zz), P3(a2[0], a2[1], zz)], [0, 1, 0], () => [0, 0], [0.93, 0.92, 0.88], NOTEX, NOTEX, 0, FL.TWO, bid);
      face(M, [P3(a2[0], a2[1], base + h), P3(c2[0], c2[1], base + h), P3(c2[0], c2[1], base + h + 0.6), P3(a2[0], a2[1], base + h + 0.6)], [enx, 0, -eny], () => [0, 0], [0.93, 0.92, 0.88], NOTEX, NOTEX, 0, 0, bid);
      const m = at(b.ent[1], depth + 0.6);
      face(M, [P3(a2[0], a2[1], base + h + 0.6), P3(c2[0], c2[1], base + h + 0.6), P3(m[0], m[1], base + h + 2.2)], [enx, 0, -eny], () => [0, 0], [0.93, 0.92, 0.88], NOTEX, NOTEX, 0, FL.TWO, bid);
    } else if (dtl === "flagpole") {
      const p = at(b.ent[1] + 0.5 * Math.min(1, 8 / EL), 9);
      prism(M, p[0], p[1], 0.07, base, base + 10, 6, [0.85, 0.85, 0.85], 0, bid);
      const q0 = [p[0], p[1]], q1 = [p[0] + edx * 2.4, p[1] + edy * 2.4];
      face(M, [P3(q0[0], q0[1], base + 8.6), P3(q1[0], q1[1], base + 8.6), P3(q1[0], q1[1], base + 9.2), P3(q0[0], q0[1], base + 9.2)], [enx, 0, -eny], () => [0, 0], [0.75, 0.12, 0.15], NOTEX, NOTEX, 0, FL.TWO, bid);
      face(M, [P3(q0[0], q0[1], base + 9.2), P3(q1[0], q1[1], base + 9.2), P3(q1[0], q1[1], base + 9.8), P3(q0[0], q0[1], base + 9.8)], [enx, 0, -eny], () => [0, 0], [0.05, 0.22, 0.6], NOTEX, NOTEX, 0, FL.TWO, bid);
      face(M, [P3(q0[0], q0[1], base + 8.6), P3(q0[0] + edx * 1.0, q0[1] + edy * 1.0, base + 9.2), P3(q0[0], q0[1], base + 9.8)], [enx, 0, -eny], () => [0, 0], [0.97, 0.97, 0.97], NOTEX, NOTEX, 0, FL.TWO, bid);
    } else if (dtl === "belltower") {
      const s = Math.min(5, EL * 0.3) / 2, p = at(0.12 + s / EL, -s);
      const th = b.h + 9;
      box(M, p[0], p[1], s, s, base, base + th, [edx, edy], wc, NOTEX, 0, bid);
      const c = [P3(p[0] + (edx + enx) * s * 1.1, p[1] + (edy + eny) * s * 1.1, base + th)];
      const corner = (sx, sy) => P3(p[0] + edx * s * 1.1 * sx + enx * s * 1.1 * sy, p[1] + edy * s * 1.1 * sx + eny * s * 1.1 * sy, base + th);
      const apex = P3(p[0], p[1], base + th + 4);
      const cs = [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)];
      for (let k = 0; k < 4; k++) {
        const a = cs[k], bb = cs[(k + 1) % 4];
        face(M, [a, bb, apex], [(a[0] + bb[0]) / 2 - apex[0], 0.5, (a[2] + bb[2]) / 2 - apex[2]], () => [0, 0], rc, NOTEX, NOTEX, 0, FL.ROOF, bid);
      }
      void c;
    } else if (dtl === "facade") {
      const a = at(0, 0.02), c = at(1, 0.02), m = at(0.5, 0.02);
      face(M, [P3(a[0], a[1], top), P3(c[0], c[1], top), P3(m[0], m[1], top + Math.min(5, EL * 0.3))], [enx, 0, -eny], () => [0, 0], wc, NOTEX, NOTEX, 0, FL.TWO, bid);
    } else if (dtl === "stacks") {
      const br = (obb[4] * Math.PI) / 180, d = [Math.sin(br), Math.cos(br)];
      for (const s of [-0.25, 0.25]) prism(M, obb[0] + d[0] * obb[2] * s, obb[1] + d[1] * obb[2] * s, 2.2, top, base + 45, 10, [0.72, 0.72, 0.7], 0, bid);
    } else if (dtl === "canopy_front") {
      const a = at(b.ent[1] - 4 / EL, 0), c = at(b.ent[1] + 4 / EL, 0), a2 = at(b.ent[1] - 4 / EL, 6), c2 = at(b.ent[1] + 4 / EL, 6);
      face(M, [P3(a[0], a[1], base + 3.6), P3(c[0], c[1], base + 3.6), P3(c2[0], c2[1], base + 3.6), P3(a2[0], a2[1], base + 3.6)], [0, 1, 0], () => [0, 0], [0.9, 0.9, 0.88], NOTEX, NOTEX, 0, FL.TWO, bid);
      for (const q of [a2, c2]) prism(M, q[0], q[1], 0.2, base, base + 3.6, 6, [0.9, 0.9, 0.88], 0, bid, false);
    }
  }

  // ---- interior (generated; there is no interior survey data)
  if (plan) {
    const tr = triangulate(b.fp, b.holes || []);
    const ids = [];
    const zf = base + raised + 0.15; // floor slab above the street surface
    for (let k = 0; k < tr.verts.length; k += 2) ids.push(M.v(tr.verts[k], zf, -tr.verts[k + 1], 0, 1, 0, tr.verts[k] / 3, tr.verts[k + 1] / 3, [1, 1, 1], T.floor_tiles, T.floor_tiles, 0, FL.INTERIOR, bid));
    for (let k = 0; k < tr.tris.length; k += 3) M.tri(ids[tr.tris[k]], ids[tr.tris[k + 1]], ids[tr.tris[k + 2]]);
    if (plan.partition) {
      const [px0, py0, px1, py1, g0, g1] = plan.partition;
      const ph = Math.min(fh, b.h) - 0.1;
      const seg = (t0, t1) => {
        const x0 = px0 + (px1 - px0) * t0, y0 = py0 + (py1 - py0) * t0, x1 = px0 + (px1 - px0) * t1, y1 = py0 + (py1 - py0) * t1;
        const L = Math.hypot(x1 - x0, y1 - y0) || 1;
        face(M, [P3(x0, y0, zf), P3(x1, y1, zf), P3(x1, y1, zf + ph), P3(x0, y0, zf + ph)], [(y1 - y0) / L, 0, (x1 - x0) / L], () => [0, 0], [0.85, 0.83, 0.78], NOTEX, NOTEX, 0, FL.INTERIOR, bid);
      };
      seg(0, g0); seg(g1, 1);
    }
  }
}

function pitchedRoof(M, obb, kind, top, rh, ov, rc, wc, tile, bid) {
  const [cx, cy, len, wid, brgDeg] = obb;
  const br = (brgDeg * Math.PI) / 180;
  const d = [Math.sin(br), Math.cos(br)], p = [Math.cos(br), -Math.sin(br)];
  const hl = len / 2, hw = wid / 2;
  rh = Math.max(0.3, rh || hw * 0.36);
  const slope = kind === "skillion" ? rh / wid : rh / hw;
  const pt = (sd, sp, z) => P3(cx + d[0] * sd + p[0] * sp, cy + d[1] * sd + p[1] * sp, z);
  const uv = (q) => { const x = q[0] - cx, y = -q[2] - cy; return [(x * d[0] + y * d[1]) / 2, (x * p[0] + y * p[1]) / 2]; };
  const zE = top - ov * slope;
  const R = (q, hint) => face(M, q, hint, uv, rc, tile, tile, 0, FL.ROOF, bid);
  const W = (q, hint) => face(M, q, hint, () => [0, 0], wc, T.plain, T.plain, 0, 0, bid);
  const L = hl + ov, Wd = hw + ov;
  const up = (sp) => [p[0] * sp, 1, -p[1] * sp];
  if (kind === "skillion") {
    const zH = top + rh + ov * slope;
    R([pt(-L, -Wd, zE), pt(L, -Wd, zE), pt(L, Wd, zH), pt(-L, Wd, zH)], [-p[0] * 0.3, 1, p[1] * 0.3]);
    W([pt(-hl, hw, top), pt(hl, hw, top), pt(hl, hw, top + rh), pt(-hl, hw, top + rh)], [p[0], 0, -p[1]]);
    W([pt(-hl, -hw, top), pt(-hl, hw, top), pt(-hl, hw, top + rh)], [-d[0], 0, d[1]]);
    W([pt(hl, -hw, top), pt(hl, hw, top), pt(hl, hw, top + rh)], [d[0], 0, -d[1]]);
    return;
  }
  if (kind === "gabled") {
    R([pt(-L, -Wd, zE), pt(L, -Wd, zE), pt(L, 0, top + rh), pt(-L, 0, top + rh)], up(-1));
    R([pt(-L, Wd, zE), pt(L, Wd, zE), pt(L, 0, top + rh), pt(-L, 0, top + rh)], up(1));
    W([pt(-hl, -hw, top), pt(-hl, hw, top), pt(-hl, 0, top + rh)], [-d[0], 0, d[1]]);
    W([pt(hl, -hw, top), pt(hl, hw, top), pt(hl, 0, top + rh)], [d[0], 0, -d[1]]);
    return;
  }
  // hipped / pyramidal
  const rl = kind === "pyramidal" ? 0 : Math.max(0, L - Wd);
  const zr = top + rh;
  const ends = (s) => [s * d[0], 1, -s * d[1]];
  R([pt(-L, -Wd, zE), pt(L, -Wd, zE), pt(rl, 0, zr), pt(-rl, 0, zr)].filter((q, k, a) => k < 2 || rl > 0 || k === 2), up(-1));
  R([pt(-L, Wd, zE), pt(L, Wd, zE), pt(rl, 0, zr), pt(-rl, 0, zr)].filter((q, k, a) => k < 2 || rl > 0 || k === 2), up(1));
  R([pt(L, -Wd, zE), pt(L, Wd, zE), pt(rl, 0, zr)], ends(1));
  R([pt(-L, -Wd, zE), pt(-L, Wd, zE), pt(-rl, 0, zr)], ends(-1));
}

// ---------------------------------------------------------------- ground layers
export const SURFACE_COLOR = {
  land: [0.5, 0.53, 0.4], grass: [0.42, 0.56, 0.3], forest: [0.26, 0.42, 0.22], scrub: [0.38, 0.48, 0.28],
  farmland: [0.56, 0.58, 0.36], sand: [0.86, 0.8, 0.62], rock: [0.56, 0.54, 0.5], quarry: [0.64, 0.56, 0.46],
  mangrove: [0.22, 0.36, 0.24], wetland: [0.34, 0.45, 0.35], pitch: [0.36, 0.58, 0.32], cemetery: [0.5, 0.58, 0.42],
  paved: [0.63, 0.62, 0.6], port: [0.56, 0.56, 0.54], industrial: [0.58, 0.56, 0.53], commercial: [0.6, 0.58, 0.54],
  site: [0.58, 0.6, 0.5], residential: [0.55, 0.55, 0.47], construction: [0.62, 0.55, 0.42], bridge: [0.6, 0.6, 0.6],
  pier: [0.55, 0.5, 0.45], water: [0.18, 0.38, 0.5],
};
export const SURFACE_LAYER = { residential: 1, commercial: 1, industrial: 1, port: 1, construction: 1, site: 2, grass: 2, forest: 2, scrub: 2,
  farmland: 2, cemetery: 2, mangrove: 2, wetland: 2, quarry: 2, sand: 2, rock: 2, paved: 3, pitch: 3, bridge: 3, water: 4 };

export function genPolygon(M, outer, holes, y, col, fl, uvScale = 4) {
  const tr = triangulate(outer, holes);
  const ids = [];
  for (let k = 0; k < tr.verts.length; k += 2) ids.push(M.v(tr.verts[k], y, -tr.verts[k + 1], 0, 1, 0, tr.verts[k] / uvScale, tr.verts[k + 1] / uvScale, col, NOTEX, NOTEX, 0, fl, NOBID));
  for (let k = 0; k < tr.tris.length; k += 3) M.tri(ids[tr.tris[k]], ids[tr.tris[k + 1]], ids[tr.tris[k + 2]]);
}

const ROAD_RANK = { footway: 0, path: 0, steps: 0, cycleway: 0, bridleway: 0, corridor: 0, pedestrian: 1, track: 1, service: 2,
  living_street: 3, residential: 3, unclassified: 3, road: 3, tertiary: 4, tertiary_link: 4, secondary: 5, secondary_link: 5,
  primary: 6, primary_link: 6, trunk: 7, trunk_link: 7, motorway: 8, motorway_link: 8 };
export function roadColor(rd) {
  const s = rd.surface || "";
  if (/asphalt/.test(s)) return [0.24, 0.24, 0.25];
  if (/unpaved|gravel|dirt|ground|earth|compacted|sand|fine_gravel/.test(s)) return [0.55, 0.47, 0.36];
  if (/paving|sett|brick/.test(s)) return [0.6, 0.55, 0.5];
  if (["footway", "path", "steps", "pedestrian", "cycleway", "corridor"].includes(rd.class)) return [0.68, 0.65, 0.6];
  if (rd.class === "track") return [0.55, 0.47, 0.36];
  return [0.48, 0.48, 0.47]; // concrete is the common Philippine road surface (estimate when untagged)
}
// splits the ribbon into per-chunk pieces through `emit(chunkKey) -> MeshBuilder`
export function genRoad(emit, chunkOf, rd) {
  const rank = ROAD_RANK[rd.class] ?? 3;
  const bridge = rd.bridge;
  const y = bridge ? 0.45 : 0.004 * rank;
  const { L, R, S } = ribbon(rd.pts, rd.w / 2);
  const col = roadColor(rd);
  const mark = rank >= 4 && !/unpaved|gravel|dirt/.test(rd.surface || "") ? FL.MARK : 0;
  const n = rd.pts.length / 2;
  for (let i = 0; i < n - 1; i++) {
    const mx = (rd.pts[2 * i] + rd.pts[2 * i + 2]) / 2, my = (rd.pts[2 * i + 1] + rd.pts[2 * i + 3]) / 2;
    const M = emit(chunkOf(mx, my), bridge ? 5 : rank >= 4 ? 6 : 5);
    const a = M.v(L[2 * i], y, -L[2 * i + 1], 0, 1, 0, 0, S[i], col, NOTEX, NOTEX, 0, FL.NOISE | mark, NOBID);
    const b = M.v(R[2 * i], y, -R[2 * i + 1], 0, 1, 0, 1, S[i], col, NOTEX, NOTEX, 0, FL.NOISE | mark, NOBID);
    const c = M.v(R[2 * i + 2], y, -R[2 * i + 3], 0, 1, 0, 1, S[i + 1], col, NOTEX, NOTEX, 0, FL.NOISE | mark, NOBID);
    const d = M.v(L[2 * i + 2], y, -L[2 * i + 3], 0, 1, 0, 0, S[i + 1], col, NOTEX, NOTEX, 0, FL.NOISE | mark, NOBID);
    M.quad(a, b, c, d);
    if (bridge) {
      const side = [0.62, 0.62, 0.6];
      for (const [E, s] of [[L, 1], [R, -1]]) {
        const x0 = E[2 * i], y0 = E[2 * i + 1], x1 = E[2 * i + 2], y1 = E[2 * i + 3];
        const q = (z0, z1, fl) => face(M, [P3(x0, y0, z0), P3(x1, y1, z0), P3(x1, y1, z1), P3(x0, y0, z1)], [-(y1 - y0) * s, 0, -(x1 - x0) * s], () => [0, 0], side, NOTEX, NOTEX, 0, fl, NOBID);
        q(-0.4, y, 0); q(y, y + 1.0, FL.TWO);
      }
    }
  }
}
export function genLine(emit, chunkOf, pts, w, y, col, fl, layer, sides = 0) {
  const { L, R, S } = ribbon(pts, w / 2);
  const n = pts.length / 2;
  for (let i = 0; i < n - 1; i++) {
    const M = emit(chunkOf((pts[2 * i] + pts[2 * i + 2]) / 2, (pts[2 * i + 1] + pts[2 * i + 3]) / 2), layer);
    const a = M.v(L[2 * i], y, -L[2 * i + 1], 0, 1, 0, 0, S[i] / 4, col, NOTEX, NOTEX, 0, fl, NOBID);
    const b = M.v(R[2 * i], y, -R[2 * i + 1], 0, 1, 0, 1, S[i] / 4, col, NOTEX, NOTEX, 0, fl, NOBID);
    const c = M.v(R[2 * i + 2], y, -R[2 * i + 3], 0, 1, 0, 1, S[i + 1] / 4, col, NOTEX, NOTEX, 0, fl, NOBID);
    const d = M.v(L[2 * i + 2], y, -L[2 * i + 3], 0, 1, 0, 0, S[i + 1] / 4, col, NOTEX, NOTEX, 0, fl, NOBID);
    M.quad(a, b, c, d);
    if (sides) for (const [E, s] of [[L, 1], [R, -1]]) {
      const x0 = E[2 * i], y0 = E[2 * i + 1], x1 = E[2 * i + 2], y1 = E[2 * i + 3];
      face(M, [P3(x0, y0, y - sides), P3(x1, y1, y - sides), P3(x1, y1, y), P3(x0, y0, y)], [-(y1 - y0) * s, 0, -(x1 - x0) * s], () => [0, 0], col.map((v) => v * 0.8), NOTEX, NOTEX, 0, 0, NOBID);
    }
  }
}

// trees: mapped trees (OSM natural=tree / tree_row) + decorative fill of mapped vegetation areas
export function treeInstances(map) {
  const out = [];
  for (const [x, y, row] of map.layers.trees) out.push([x, y, row ? 1 : 0, 1]);
  const dens = { forest: 70, mangrove: 55, scrub: 160, grass: 260, pitch: 0, farmland: 140, cemetery: 220, site: 400, residential: 0 };
  let budget = 60000;
  for (const a of map.layers.areas) {
    const sp = dens[a.surface];
    if (!sp) continue;
    const step = Math.sqrt(sp);
    const bb = ringBBox(a.outer);
    for (let y = Math.ceil(bb[1] / step) * step; y < bb[3]; y += step) {
      for (let x = Math.ceil(bb[0] / step) * step; x < bb[2]; x += step) {
        const key = x.toFixed(0) + "," + y.toFixed(0);
        const jx = x + (hash01(key, "tx") - 0.5) * step * 0.9, jy = y + (hash01(key, "ty") - 0.5) * step * 0.9;
        if (!pointInPoly(jx, jy, a.outer, a.holes)) continue;
        if (map.buildingAt(jx, jy)) continue;
        out.push([jx, jy, a.surface === "farmland" || hash01(key, "palm") < 0.35 ? 2 : 0, 0]);
        if (--budget <= 0) return out;
      }
    }
  }
  return out;
}

// Instanced 3D models built from primitives (placeholder art: replace with supplied assets later;
// see docs/ASSETS.md). Each model's nose points to +Z; vertex colour [1,1,1] parts take the
// per-instance tint (team colour, zombie skin, vehicle paint).
export type Geo = { v: number[]; c: number[]; n: number[]; idx: number[] };
type C3 = [number, number, number];
const W: C3 = [1, 1, 1];

class G implements Geo {
  v: number[] = []; c: number[] = []; n: number[] = []; idx: number[] = [];
  tri(a: number[], b: number[], d: number[], col: C3) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], wx = d[0] - a[0], wy = d[1] - a[1], wz = d[2] - a[2];
    let nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
    const l = Math.hypot(nx, ny, nz) || 1;
    const base = this.v.length / 3;
    for (const p of [a, b, d]) { this.v.push(p[0], p[1], p[2]); this.c.push(...col); this.n.push(nx / l, ny / l, nz / l); }
    this.idx.push(base, base + 1, base + 2);
  }
  quad(a: number[], b: number[], d: number[], e: number[], col: C3) { this.tri(a, b, d, col); this.tri(a, d, e, col); }
  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, col: C3) {
    const p = (x: number, y: number, z: number) => [x, y, z];
    this.quad(p(x0, y0, z1), p(x1, y0, z1), p(x1, y1, z1), p(x0, y1, z1), col);
    this.quad(p(x1, y0, z0), p(x0, y0, z0), p(x0, y1, z0), p(x1, y1, z0), col);
    this.quad(p(x1, y0, z1), p(x1, y0, z0), p(x1, y1, z0), p(x1, y1, z1), col);
    this.quad(p(x0, y0, z0), p(x0, y0, z1), p(x0, y1, z1), p(x0, y1, z0), col);
    this.quad(p(x0, y1, z1), p(x1, y1, z1), p(x1, y1, z0), p(x0, y1, z0), col);
    this.quad(p(x0, y0, z0), p(x1, y0, z0), p(x1, y0, z1), p(x0, y0, z1), col);
  }
  /** a box whose bottom face is shifted by dz along z (a leg stepping forward or back) */
  skewBox(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, dz: number, col: C3) {
    const b = (x: number, z: number) => [x, y0, z + dz], t = (x: number, z: number) => [x, y1, z];
    this.quad(b(x0, z1), b(x1, z1), t(x1, z1), t(x0, z1), col);
    this.quad(b(x1, z0), b(x0, z0), t(x0, z0), t(x1, z0), col);
    this.quad(b(x1, z1), b(x1, z0), t(x1, z0), t(x1, z1), col);
    this.quad(b(x0, z0), b(x0, z1), t(x0, z1), t(x0, z0), col);
    this.quad(t(x0, z1), t(x1, z1), t(x1, z0), t(x0, z0), col);
    this.quad(b(x0, z0), b(x1, z0), b(x1, z1), b(x0, z1), col);
  }
  cyl(cx: number, cz: number, r: number, y0: number, y1: number, sides: number, col: C3, r1 = r, cap = true) {
    for (let i = 0; i < sides; i++) {
      const a0 = (i / sides) * Math.PI * 2, a1 = ((i + 1) / sides) * Math.PI * 2;
      const A = [cx + Math.cos(a0) * r, y0, cz + Math.sin(a0) * r], B = [cx + Math.cos(a1) * r, y0, cz + Math.sin(a1) * r];
      const A1 = [cx + Math.cos(a0) * r1, y1, cz + Math.sin(a0) * r1], B1 = [cx + Math.cos(a1) * r1, y1, cz + Math.sin(a1) * r1];
      if (r1 > 0.001) this.quad(A, A1, B1, B, col); else this.tri(A, [cx, y1, cz], B, col);
      if (cap && r1 > 0.001) this.tri(A1, [cx, y1, cz], B1, col);
    }
  }
  ball(cx: number, cy: number, cz: number, r: number, col: C3, rings = 4, seg = 8) {
    for (let i = 0; i < rings; i++) {
      const t0 = (i / rings) * Math.PI, t1 = ((i + 1) / rings) * Math.PI;
      for (let k = 0; k < seg; k++) {
        const p0 = (k / seg) * Math.PI * 2, p1 = ((k + 1) / seg) * Math.PI * 2;
        const P = (t: number, p: number) => [cx + r * Math.sin(t) * Math.cos(p), cy + r * Math.cos(t), cz + r * Math.sin(t) * Math.sin(p)];
        this.quad(P(t0, p0), P(t0, p1), P(t1, p1), P(t1, p0), col);
      }
    }
  }
  ring(r0: number, r1: number, y: number, seg: number, col: C3) {
    for (let k = 0; k < seg; k++) {
      const a0 = (k / seg) * Math.PI * 2, a1 = ((k + 1) / seg) * Math.PI * 2;
      const P = (r: number, a: number) => [Math.cos(a) * r, y, Math.sin(a) * r];
      this.quad(P(r0, a0), P(r1, a0), P(r1, a1), P(r0, a1), col);
    }
  }
}

const SKIN: C3 = [0.78, 0.6, 0.46], BOOT: C3 = [0.13, 0.12, 0.1], GUN: C3 = [0.1, 0.1, 0.11];

function human(g: G, opts: { helmet?: boolean; gun?: number; hunch?: number; arms?: "gun" | "forward" | "down"; skin?: C3; pants?: C3; step?: number }) {
  const h = opts.hunch || 0, sk = opts.skin || SKIN, pants = opts.pants || [0.24, 0.26, 0.22];
  // legs: `step` = -1..1 puts the left foot forward / back (the right one opposite) for walking poses
  const st = (opts.step || 0) * 0.2;
  g.skewBox(-0.14, 0, -0.1, -0.03, 0.82, 0.1, st, pants); g.skewBox(0.03, 0, -0.1, 0.14, 0.82, 0.1, -st, pants);
  g.box(-0.14, 0, -0.12 + st, -0.03, 0.12, 0.14 + st, BOOT); g.box(0.03, 0, -0.12 - st, 0.14, 0.12, 0.14 - st, BOOT);
  g.box(-0.22, 0.82, -0.14 + h * 0.3, 0.22, 1.42, 0.14 + h * 0.3, W);                  // torso (tinted)
  const hy = 1.44 - h * 0.12, hz = h * 0.45;
  g.box(-0.11, hy, -0.11 + hz, 0.11, hy + 0.25, 0.11 + hz, sk);                       // head
  if (opts.helmet) g.box(-0.135, hy + 0.15, -0.135 + hz, 0.135, hy + 0.3, 0.135 + hz, W);
  if (opts.arms === "forward") { g.box(-0.3, 1.2, 0.0, -0.2, 1.3, 0.55, sk); g.box(0.2, 1.2, 0.0, 0.3, 1.3, 0.55, sk); }
  else if (opts.arms === "gun") { g.box(-0.3, 1.0, -0.05, -0.2, 1.38, 0.1, W); g.box(0.2, 1.05, 0.05, 0.3, 1.32, 0.38, W); }
  else { const sw = -st * 0.45; g.skewBox(-0.3, 0.88, -0.07, -0.21, 1.4, 0.07, sw, sk); g.skewBox(0.21, 0.88, -0.07, 0.3, 1.4, 0.07, -sw, sk); }   // arms swing against the legs
  if (opts.gun) g.box(-0.04, 1.12, 0.05, 0.04, 1.22, 0.05 + opts.gun, GUN);
}

export function soldierGeo(): Geo { const g = new G(); human(g, { helmet: true, gun: 0.85, arms: "gun", pants: [0.27, 0.31, 0.22] }); g.box(-0.2, 1.0, -0.2, 0.2, 1.35, -0.13, [0.2, 0.22, 0.17]); return g; }
export function heavyGeo(): Geo { const g = new G(); human(g, { helmet: true, gun: 1.15, arms: "gun", pants: [0.27, 0.31, 0.22] }); g.box(-0.08, 1.05, 0.3, 0.08, 1.25, 1.25, GUN); g.box(-0.24, 0.95, -0.28, 0.24, 1.38, -0.13, [0.22, 0.2, 0.16]); return g; }
export function launcherGeo(): Geo { const g = new G(); human(g, { helmet: true, gun: 0.4, arms: "gun", pants: [0.27, 0.31, 0.22] }); g.cyl(0.16, 0.2, 0.07, 1.42, 1.5, 6, [0.25, 0.28, 0.2]); g.box(0.09, 1.38, -0.45, 0.23, 1.52, 0.75, [0.25, 0.28, 0.2]); return g; }
export function flamerGeo(): Geo { const g = new G(); human(g, { helmet: true, gun: 0.75, arms: "gun", pants: [0.3, 0.27, 0.2] }); g.cyl(-0.1, -0.24, 0.1, 0.9, 1.45, 8, [0.55, 0.15, 0.1]); g.cyl(0.1, -0.24, 0.1, 0.9, 1.45, 8, [0.55, 0.15, 0.1]); return g; }
export function civilianGeo(step = 0): Geo { const g = new G(); human(g, { arms: "down", pants: [0.2, 0.22, 0.32], step }); return g; }
export function zombieGeo(): Geo { const g = new G(); human(g, { hunch: 0.5, arms: "forward", skin: [0.55, 0.62, 0.48], pants: [0.25, 0.22, 0.2] }); return g; }
export function bruteGeo(): Geo {
  const g = new G(); const sk: C3 = [0.5, 0.45, 0.4];
  g.box(-0.24, 0, -0.16, -0.05, 0.9, 0.16, [0.25, 0.2, 0.18]); g.box(0.05, 0, -0.16, 0.24, 0.9, 0.16, [0.25, 0.2, 0.18]);
  g.box(-0.42, 0.85, -0.28, 0.42, 1.6, 0.3, W); g.box(-0.13, 1.5, 0.12, 0.13, 1.74, 0.38, sk);
  g.box(-0.62, 0.7, -0.12, -0.42, 1.55, 0.14, sk); g.box(0.42, 0.7, -0.12, 0.62, 1.55, 0.14, sk);
  return g;
}
export function bloaterGeo(): Geo { const g = new G(); g.box(-0.15, 0, -0.1, 0.15, 0.7, 0.1, [0.3, 0.3, 0.2]); g.ball(0, 1.15, 0, 0.55, W, 5, 10); g.box(-0.1, 1.68, -0.08, 0.1, 1.9, 0.14, [0.6, 0.66, 0.42]); return g; }
export function crawlerGeo(): Geo {
  const g = new G(); const sk: C3 = [0.5, 0.55, 0.42];
  g.box(-0.2, 0.1, -0.7, 0.2, 0.42, 0.25, W); g.box(-0.11, 0.18, 0.25, 0.11, 0.42, 0.48, sk);
  g.box(-0.34, 0, 0.1, -0.24, 0.3, 0.75, sk); g.box(0.24, 0, 0.1, 0.34, 0.3, 0.75, sk);
  return g;
}
export function abominationGeo(): Geo {
  const g = new G(); const sk: C3 = [0.55, 0.32, 0.3];
  g.box(-0.3, 0, -0.25, -0.08, 0.8, 0.2, sk); g.box(0.08, 0, -0.25, 0.3, 0.8, 0.2, sk);
  g.ball(0, 1.25, -0.05, 0.62, W, 5, 10); g.ball(0.25, 1.55, 0.25, 0.32, sk, 3, 8); g.ball(-0.3, 1.5, -0.2, 0.35, W, 3, 8);
  g.box(-0.85, 0.5, -0.1, -0.55, 1.6, 0.2, sk); g.box(0.55, 0.5, -0.1, 0.95, 1.7, 0.25, sk);
  return g;
}
export function corpseGeo(): Geo { const g = new G(); g.box(-0.22, 0.02, -0.85, 0.22, 0.24, 0.55, W); g.box(-0.11, 0.02, 0.55, 0.11, 0.2, 0.78, [0.45, 0.4, 0.35]); return g; }
export function bloodGeo(): Geo { const g = new G(); g.ring(0, 0.9, 0.03, 10, W); return g; }
export function ringGeo(): Geo { const g = new G(); g.ring(0.55, 0.68, 0.06, 20, W); return g; }
export function markerGeo(): Geo { const g = new G(); g.cyl(0, 0, 0.06, 0, 3.2, 6, [0.85, 0.85, 0.85]); g.box(0.05, 2.3, -0.02, 1.2, 3.1, 0.02, W); return g; }
export function beaconGeo(): Geo { const g = new G(); g.cyl(0, 0, 0.5, 0, 0.6, 4, W, 0); g.cyl(0, 0, 0.5, 0, -0.6, 4, W, 0); return g; }
export function flashGeo(): Geo { const g = new G(); g.cyl(0, 0, 0.22, -0.2, 0.2, 5, W, 0); g.cyl(0, 0, 0.22, 0.2, 0.55, 5, W, 0); return g; }
export function blastGeo(): Geo { const g = new G(); g.ball(0, 0, 0, 1, W, 4, 9); return g; }
export function fireGeo(): Geo { const g = new G(); for (const [x, z, h] of [[0, 0, 1.4], [0.35, 0.2, 0.9], [-0.3, 0.25, 1.0], [0.1, -0.35, 0.8]]) g.cyl(x, z, 0.32, 0, h, 5, W, 0); return g; }
export function crateGeo(): Geo { const g = new G(); g.box(-0.6, 0, -0.45, 0.6, 0.8, 0.45, W); g.box(-0.62, 0.32, -0.47, 0.62, 0.42, 0.47, [0.2, 0.2, 0.18]); return g; }
export function wreckGeo(): Geo {
  const g = new G();
  g.box(-0.85, 0.25, -2.1, 0.85, 0.95, 2.1, W); g.box(-0.75, 0.95, -1.0, 0.75, 1.42, 0.9, W);
  g.box(-0.72, 1.0, 0.92, 0.72, 1.36, 0.95, [0.15, 0.18, 0.2]);
  for (const [x, z] of [[-0.85, -1.3], [0.85, -1.3], [-0.85, 1.3], [0.85, 1.3]]) g.box(x - 0.12, 0, z - 0.32, x + 0.12, 0.55, z + 0.32, [0.08, 0.08, 0.08]);
  return g;
}
export function wireGeo(): Geo { const g = new G(); for (let k = -2; k <= 2; k++) g.cyl(k, 0, 0.32, 0, 0.7, 7, [0.35, 0.33, 0.3], 0.32, false); return g; }
export function lightGeo(): Geo { const g = new G(); g.cyl(0, 0, 0.06, 0, 4.2, 5, [0.3, 0.3, 0.3]); g.box(-0.35, 4.0, -0.15, 0.35, 4.3, 0.15, [0.95, 0.92, 0.7]); return g; }
export function turretGeo(): Geo { const g = new G(); g.cyl(0, 0, 0.12, 0, 1.0, 6, GUN); g.box(-0.1, 1.0, -0.3, 0.1, 1.18, 1.1, GUN); return g; }
export function antennaGeo(): Geo { const g = new G(); g.cyl(0, 0, 0.12, 0, 14, 5, [0.6, 0.6, 0.6], 0.03); g.box(-1.2, 12.5, -0.05, 1.2, 12.7, 0.05, [0.6, 0.6, 0.6]); return g; }
export function flagGeo(): Geo { const g = new G(); g.cyl(0, 0, 0.05, 0, 8, 5, [0.85, 0.85, 0.85]); g.box(0.04, 6.6, -0.02, 2.2, 7.9, 0.02, W); return g; }

function vehicleBase(g: G, w: number, l: number, h: number) {
  g.box(-w / 2, 0.45, -l / 2, w / 2, h * 0.62, l / 2, W);
  for (const s of [-1, 1]) g.box(s * w / 2 - (s > 0 ? 0.08 : -0.08) - 0.16, 0, -l / 2 + 0.3, s * w / 2 + (s > 0 ? 0.06 : -0.06), 0.62, l / 2 - 0.3, [0.1, 0.1, 0.1]);
}
export function jeepGeo(): Geo { const g = new G(); vehicleBase(g, 2.0, 4.2, 1.9); g.box(-0.95, 1.15, -0.4, 0.95, 1.9, 1.2, W); g.box(-0.9, 1.2, 1.2, 0.9, 1.55, 1.25, [0.12, 0.16, 0.18]); g.cyl(0, -0.2, 0.08, 1.9, 2.3, 6, GUN); g.box(-0.06, 2.2, -0.2, 0.06, 2.32, 1.0, GUN); return g; }
export function apcGeo(): Geo { const g = new G(); vehicleBase(g, 2.6, 6.4, 2.5); g.box(-1.25, 1.5, -3.1, 1.25, 2.45, 2.6, W); g.cyl(0.5, 0.6, 0.35, 2.45, 2.85, 8, W); g.box(0.44, 2.6, 0.6, 0.56, 2.72, 2.0, GUN); return g; }
export function ifvGeo(): Geo { const g = new G(); vehicleBase(g, 3.0, 6.6, 2.8); g.box(-1.45, 1.6, -3.2, 1.45, 2.4, 3.0, W); g.box(-0.9, 2.4, -0.8, 0.9, 3.0, 1.0, W); g.box(-0.08, 2.62, 1.0, 0.08, 2.78, 3.4, GUN); return g; }
export function tankGeo(): Geo { const g = new G(); vehicleBase(g, 3.6, 8.0, 2.6); g.box(-1.5, 1.3, -2.0, 1.5, 2.3, 1.6, W); g.cyl(0, 1.6, 0.12, 1.75, 1.75, 6, GUN); g.box(-0.12, 1.7, 1.6, 0.12, 1.94, 6.4, GUN); return g; }
export function truckGeo(): Geo { const g = new G(); vehicleBase(g, 2.5, 7.5, 3.0); g.box(-1.2, 1.1, 1.8, 1.2, 2.7, 3.7, W); g.box(-1.25, 1.1, -3.7, 1.25, 3.0, 1.7, [0.36, 0.38, 0.3]); g.box(-1.1, 1.8, 3.7, 1.1, 2.4, 3.75, [0.12, 0.16, 0.18]); return g; }
export function arvGeo(): Geo { const g = new G(); vehicleBase(g, 3.4, 7.6, 2.8); g.box(-1.5, 1.3, -3.6, 1.5, 2.6, 2.4, W); g.box(-0.15, 2.6, -1.0, 0.15, 5.0, -0.7, [0.6, 0.55, 0.2]); g.box(-0.1, 4.6, -1.0, 0.1, 4.8, 2.6, [0.6, 0.55, 0.2]); return g; }
export function heliGeo(): Geo { const g = new G(); g.box(-0.9, 0, -2.2, 0.9, 1.6, 2.0, W); g.box(-0.25, 0.6, -6.2, 0.25, 1.1, -2.2, W); g.box(-6, 1.85, -0.15, 6, 1.9, 0.15, [0.15, 0.15, 0.15]); g.box(-0.15, 1.85, -6, 0.15, 1.9, 6, [0.15, 0.15, 0.15]); return g; }
export function boatGeo(): Geo { const g = new G(); g.box(-1.6, 0, -5.5, 1.6, 1.2, 4.5, W); g.cyl(0, 4.5, 1.6, 0, 1.2, 3, W, 0.01, false); g.box(-1.0, 1.2, -3.0, 1.0, 2.6, 0.0, [0.75, 0.77, 0.72]); return g; }

export const MODELS: Record<string, () => Geo> = {
  soldier: soldierGeo, heavy: heavyGeo, launcher: launcherGeo, flamer: flamerGeo, civilian: () => civilianGeo(0),
  civilian_l: () => civilianGeo(1), civilian_r: () => civilianGeo(-1),
  zombie: zombieGeo, brute: bruteGeo, bloater: bloaterGeo, crawler: crawlerGeo, abomination: abominationGeo,
  corpse: corpseGeo, blood: bloodGeo, ring: ringGeo, objmarker: markerGeo, beacon: beaconGeo, flash: flashGeo, blast: blastGeo,
  fire: fireGeo, crate: crateGeo, wreck: wreckGeo, wire: wireGeo, light: lightGeo, turret: turretGeo, antenna: antennaGeo, flag: flagGeo,
  jeep: jeepGeo, apc: apcGeo, ifv: ifvGeo, tank: tankGeo, truck: truckGeo, arv: arvGeo, heli: heliGeo, boat: boatGeo,
};

/** model per unit / zombie type */
export const UNIT_MODEL: Record<string, string> = {
  rifleman: "soldier", assault: "soldier", sniper: "soldier", machine_gunner: "heavy", shotgunner: "soldier", flamethrower: "flamer",
  rocket: "launcher", medic: "soldier", engineer: "soldier", special_forces: "soldier",
  walker: "zombie", runner: "zombie", crawler: "crawler", brute: "brute", bloater: "bloater", screamer: "zombie", mutant: "brute", abomination: "abomination",
  jeep: "jeep", apc: "apc", ifv: "ifv", tank: "tank", truck: "truck", arv: "arv",
};
/** instance rotation for a map heading (radians, atan2(dy, dx)); models face +Z */
export const rotFor = (heading: number) => -heading - Math.PI / 2;

// ---- defences (sizes match data/structures/structures.json; local X = width, Z = depth)
const SAND: C3 = [0.64, 0.56, 0.4], CONC: C3 = [0.72, 0.71, 0.68], WOOD: C3 = [0.46, 0.36, 0.24], STEEL: C3 = [0.36, 0.38, 0.37];
function sandRow(g: G, x0: number, x1: number, z: number, layers: number, y0 = 0) {
  for (let l = 0; l < layers; l++) {
    const off = l % 2 ? 0.25 : 0;
    for (let x = x0 + off; x < x1 - 0.2; x += 0.55) g.box(x, y0 + l * 0.27, z - 0.3, Math.min(x1, x + 0.52), y0 + l * 0.27 + 0.26, z + 0.3, l % 2 ? SAND : [0.6, 0.52, 0.37]);
  }
}
export function sandbagGeo(): Geo { const g = new G(); sandRow(g, -2, 2, 0, 4); return g; }
export function barrierGeo(): Geo { const g = new G(); g.box(-1.6, 0, -0.35, 1.6, 0.3, 0.35, CONC); g.box(-1.6, 0.3, -0.2, 1.6, 1.0, 0.2, CONC); return g; }
export function barricadeGeo(): Geo { const g = new G(); for (const x of [-1.1, 1.1]) g.box(x - 0.08, 0, -0.25, x + 0.08, 1.7, 0.25, WOOD); for (const y of [0.4, 0.9, 1.4]) g.box(-1.3, y, -0.06, 1.3, y + 0.22, 0.06, WOOD); g.box(-1.3, 0.5, -0.04, 1.3, 0.62, 0.04, [0.55, 0.45, 0.3]); return g; }
export function mgNestGeo(): Geo { const g = new G(); sandRow(g, -1.6, 1.6, 1.3, 3); sandRow(g, -1.6, 1.6, -1.3, 2); g.cyl(0, 0, 0.12, 0, 1.0, 6, GUN); g.box(-0.1, 1.0, -0.3, 0.1, 1.15, 1.2, GUN); return g; }
export function towerGeo(): Geo { const g = new G(); for (const [x, z] of [[-1.3, -1.3], [1.3, -1.3], [1.3, 1.3], [-1.3, 1.3]]) g.box(x - 0.12, 0, z - 0.12, x + 0.12, 5.2, z + 0.12, WOOD); g.box(-1.6, 5.0, -1.6, 1.6, 5.25, 1.6, WOOD); g.box(-1.6, 5.25, -1.6, 1.6, 6.1, -1.45, SAND); g.box(-1.6, 5.25, 1.45, 1.6, 6.1, 1.6, SAND); g.box(-1.6, 5.25, -1.6, -1.45, 6.1, 1.6, SAND); g.box(1.45, 5.25, -1.6, 1.6, 6.1, 1.6, SAND); g.cyl(0, 0, 2.3, 6.9, 7.6, 4, [0.3, 0.34, 0.26], 0); return g; }
export function bunkerGeo(): Geo { const g = new G(); g.box(-3, 0, -2, 3, 1.5, 2, CONC); g.box(-3.2, 1.5, -2.2, 3.2, 2.2, 2.2, CONC); g.box(-2.2, 1.0, 2.0, 2.2, 1.35, 2.05, [0.08, 0.08, 0.08]); sandRow(g, -3.2, 3.2, 2.6, 3); return g; }
export function gateGeo(): Geo { const g = new G(); for (const x of [-5.2, 5.2]) g.box(x - 0.35, 0, -0.45, x + 0.35, 3.0, 0.45, CONC); for (const s of [-1, 1]) { const x0 = s < 0 ? -4.95 : 0.05, x1 = s < 0 ? -0.05 : 4.95; g.box(x0, 0.1, -0.15, x1, 2.6, 0.15, STEEL); for (let x = x0 + 0.5; x < x1; x += 1.1) g.box(x - 0.05, 0.1, -0.2, x + 0.05, 2.6, 0.2, [0.3, 0.32, 0.31]); } return g; }
export function siteGeo(): Geo { const g = new G(); for (const [x, z] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) g.box(x - 0.05, 0, z - 0.05, x + 0.05, 1.0, z + 0.05, [0.8, 0.7, 0.2]); g.box(-0.5, 0, -0.4, 0.5, 0.5, 0.4, WOOD); return g; }
export function nestGeo(): Geo {
  const g = new G(); const f: C3 = [0.45, 0.2, 0.24];
  g.ball(0, 0.4, 0, 2.0, W, 4, 10); g.ball(1.4, 0.6, 0.6, 1.0, f, 3, 8); g.ball(-1.2, 0.5, -0.9, 1.1, f, 3, 8); g.ball(0.3, 1.9, -0.2, 0.7, W, 3, 8);
  for (let k = 0; k < 7; k++) { const a = (k / 7) * Math.PI * 2; g.cyl(Math.cos(a) * 2.2, Math.sin(a) * 2.2, 0.25, 0, 1.6 + (k % 3) * 0.5, 4, f, 0.05); }
  return g;
}
export function puddleGeo(): Geo { const g = new G(); g.ring(0, 1, 0.04, 14, W); return g; }
MODELS.sandbags = sandbagGeo; MODELS.concrete_barrier = barrierGeo; MODELS.barricade = barricadeGeo; MODELS.mg_emplacement = mgNestGeo;
MODELS.watchtower = towerGeo; MODELS.bunker = bunkerGeo; MODELS.reinforced_gate = gateGeo; MODELS.barbed_wire = wireGeo; MODELS.lighting = lightGeo;
MODELS.site = siteGeo; MODELS.nest = nestGeo; MODELS.puddle = puddleGeo;

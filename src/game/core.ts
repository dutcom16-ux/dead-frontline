// Shared types and small utilities. Map coordinates: x = east, y = north (metres).
export type Vec2 = { x: number; y: number };
export const TAU = Math.PI * 2;
export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
export const dist = (ax: number, ay: number, bx: number, by: number) => Math.hypot(bx - ax, by - ay);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Deterministic RNG (mulberry32); state is saved with the mission. */
export class Rng {
  s: number;
  constructor(seed: number) { this.s = seed >>> 0; }
  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(a: number, b: number) { return a + (b - a) * this.next(); }
  int(n: number) { return Math.floor(this.next() * n); }
  pick<T>(arr: T[]): T { return arr[this.int(arr.length)]; }
  weighted<T extends string>(w: Record<T, number>): T {
    const keys = Object.keys(w) as T[];
    let tot = 0;
    for (const k of keys) tot += w[k];
    let r = this.next() * tot;
    for (const k of keys) { r -= w[k]; if (r <= 0) return k; }
    return keys[keys.length - 1];
  }
}

/** Uniform grid of entities, rebuilt every frame (cheap for a few thousand objects). */
export class SpatialHash<T extends { x: number; y: number }> {
  cell: number;
  map = new Map<number, T[]>();
  constructor(cell: number) { this.cell = cell; }
  private k(i: number, j: number) { return (i + 32768) * 65536 + (j + 32768); }
  clear() { this.map.clear(); }
  insert(e: T) {
    const k = this.k(Math.floor(e.x / this.cell), Math.floor(e.y / this.cell));
    let l = this.map.get(k);
    if (!l) this.map.set(k, (l = []));
    l.push(e);
  }
  /** calls fn for every entity within r of (x, y) */
  query(x: number, y: number, r: number, fn: (e: T, d: number) => void) {
    const c = this.cell, r2 = r * r;
    for (let i = Math.floor((x - r) / c); i <= Math.floor((x + r) / c); i++)
      for (let j = Math.floor((y - r) / c); j <= Math.floor((y + r) / c); j++) {
        const l = this.map.get(this.k(i, j));
        if (!l) continue;
        for (const e of l) {
          const dx = e.x - x, dy = e.y - y, d2 = dx * dx + dy * dy;
          if (d2 <= r2) fn(e, Math.sqrt(d2));
        }
      }
  }
  nearest(x: number, y: number, r: number, pred?: (e: T) => boolean): T | null {
    let best: T | null = null, bd = Infinity;
    this.query(x, y, r, (e, d) => { if (d < bd && (!pred || pred(e))) { bd = d; best = e; } });
    return best;
  }
}

export function pointInRing(x: number, y: number, f: number[]): boolean {
  let c = false;
  const n = f.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = f[2 * i], yi = f[2 * i + 1], xj = f[2 * j], yj = f[2 * j + 1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

export function fmtTime(s: number) {
  const m = Math.floor(s / 60), r = Math.floor(s % 60);
  return `${m}:${r.toString().padStart(2, "0")}`;
}

export const escHtml = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" } as any)[c]);

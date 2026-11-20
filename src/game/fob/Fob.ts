// The one permanent Forward Operating Base. It can only be established after Toledo is liberated,
// only once per campaign, and only on clear, dry, gently sloping ground near a road. Facilities are
// added to the live map as real buildings (collision, navigation, rendering) as construction finishes.
import type { Game } from "../Game";
import { STRUCTURES } from "../data";
import { dist } from "../core";

export interface Facility { type: string; x: number; y: number; w: number; d: number; rot: number; built: number; bid: string | null; obstacle: number | null; time: number }
const W = 78, D = 60; // compound size (m), perimeter included

// facility layout in compound coordinates (u along W, v along D, gate on the -v side)
const LAYOUT: [string, number, number, number][] = [
  ["command_center", 0, 4, 0], ["supply_depot", 22, 16, 0], ["barracks", -22, -10, 0], ["field_hospital", 24, -10, 0],
  ["communications", 0, 22, 0], ["ammo_storage", 30, 4, Math.PI / 2], ["motor_pool", -22, 16, 0], ["repair_facility", -31, 3, Math.PI / 2],
];
const TOWERS: [number, number][] = [[-36, -27], [36, -27], [-36, 27], [36, 27]];
const BUILD_TIME: Record<string, number> = { command_center: 35, supply_depot: 25, barracks: 25, field_hospital: 25, communications: 20, ammo_storage: 15, motor_pool: 30, repair_facility: 25, watchtower: 12, perimeter: 30, reinforced_gate: 10 };

export class Fob {
  g: Game;
  site: { x: number; y: number; rot: number } | null = null;
  facilities: Facility[] = [];
  established = false;
  inventory: Record<string, number> = { sandbags: 4, barbed_wire: 2, concrete_barrier: 0, barricade: 2 };
  engineering = 0;
  allowed = false; // set by the mission once Toledo is liberated
  attackT = -1;
  constructor(g: Game) { this.g = g; }
  has(type: string) { return this.facilities.some((f) => f.type === type && f.built >= 1); }
  get progress() { return this.facilities.length ? this.facilities.filter((f) => f.built >= 1).length / this.facilities.length : 0; }
  depot(): [number, number] {
    const f = this.facilities.find((q) => q.type === "supply_depot");
    const s = this.site!;
    return f ? this.toMap(s, 22, 6) : [s.x, s.y];
  }
  gate(): [number, number] { return this.toMap(this.site!, 0, -D / 2 - 6); }
  toMap(s: { x: number; y: number; rot: number }, u: number, v: number): [number, number] {
    const c = Math.cos(s.rot), sn = Math.sin(s.rot);
    return [s.x + u * c - v * sn, s.y + u * sn + v * c];
  }
  /** every footprint of a compound at (x, y, rot): facilities, towers, walls */
  plan(x: number, y: number, rot: number) {
    const s = { x, y, rot };
    const out: { type: string; x: number; y: number; w: number; d: number; rot: number }[] = [];
    for (const [type, u, v, r] of LAYOUT) {
      const sz = STRUCTURES[type].size!;
      const [px, py] = this.toMap(s, u, v);
      out.push({ type, x: px, y: py, w: sz[0], d: sz[1], rot: rot + r });
    }
    for (const [u, v] of TOWERS) { const [px, py] = this.toMap(s, u * 0.97, v * 0.93); out.push({ type: "watchtower", x: px, y: py, w: 3, d: 3, rot }); }
    // perimeter: north wall, east/west walls, two south walls either side of a 10 m gate
    const t = 0.7;
    const walls: [number, number, number, number][] = [[0, D / 2, W, t], [-W / 2, 0, t, D], [W / 2, 0, t, D], [-(W / 4 + 2.5), -D / 2, W / 2 - 5, t], [W / 4 + 2.5, -D / 2, W / 2 - 5, t]];
    // walls in short sections so each follows the terrain
    for (const [u, v, w, d] of walls) {
      const L = Math.max(w, d), n = Math.ceil(L / 13), along = w >= d;
      for (let k = 0; k < n; k++) {
        const o = -L / 2 + (L / n) * (k + 0.5);
        const [px, py] = this.toMap(s, u + (along ? o : 0), v + (along ? 0 : o));
        out.push({ type: "perimeter", x: px, y: py, w: along ? L / n + 0.05 : d, d: along ? d : L / n + 0.05, rot });
      }
    }
    const [gx, gy] = this.toMap(s, 0, -D / 2);
    out.push({ type: "reinforced_gate", x: gx, y: gy, w: 10, d: 0.6, rot });
    return out;
  }
  /** "" when a compound fits at (x, y, rot), otherwise the reason */
  check(x: number, y: number, rot: number): string {
    if (this.site) return "The task force already has its FOB (one permanent FOB per campaign).";
    if (!this.allowed) return "The FOB can only be established after Toledo City is liberated.";
    const g = this.g, bf = g.bf, map = bf.map;
    const s = { x, y, rot };
    let zmin = Infinity, zmax = -Infinity;
    for (let u = -W / 2; u <= W / 2; u += 3) for (let v = -D / 2; v <= D / 2; v += 3) {
      const [px, py] = this.toMap(s, u, v);
      if (!bf.walkable(px, py)) return "Water, the map edge or a wall is in the way.";
      if (map.buildingAt(px, py)) return "Existing buildings are in the way: choose open ground (parking, fields, lots).";
      const z = bf.h(px, py); zmin = Math.min(zmin, z); zmax = Math.max(zmax, z);
    }
    if (zmax - zmin > 5) return `Ground too steep (${(zmax - zmin).toFixed(1)} m height difference).`;
    if (!bf.roads.near(x, y, 90, 1).length) return "Too far from a road for supply convoys.";
    const c = Math.cos(rot), sn = Math.sin(rot);
    const hx = Math.abs(c) * W / 2 + Math.abs(sn) * D / 2, hy = Math.abs(sn) * W / 2 + Math.abs(c) * D / 2;
    if (bf.mainRoadNear(x, y, 0, hx * 0.9, hy * 0.9)) return "A street runs through this site: keep the streets open.";
    let infected = 0;
    g.zHash.query(x, y, 70, () => { infected++; });
    if (infected > 6) return `Area not secure: ${infected} infected within 70 m.`;
    return "";
  }
  establish(x: number, y: number, rot: number): string {
    const why = this.check(x, y, rot);
    if (why) return why;
    this.site = { x, y, rot };
    for (const p of this.plan(x, y, rot)) this.facilities.push({ ...p, built: 0, bid: null, obstacle: null, time: BUILD_TIME[p.type] || 20 });
    const ll = this.g.bf.map.latlon(x, y);
    this.g.radio(`FOB site confirmed at ${ll[0].toFixed(5)}, ${ll[1].toFixed(5)}. Engineers: begin construction. Command Center first.`, "radio");
    this.g.onEvent("fob_site", this.site);
    return "";
  }
  update(dt: number) {
    if (!this.site) return;
    const g = this.g;
    // build in order; engineers nearby speed it up
    const cur = this.facilities.find((f) => f.built < 1);
    if (cur) {
      let eng = 0;
      g.uHash.query(this.site.x, this.site.y, 55, (u) => { if (u.type === "engineer") eng++; });
      cur.built = Math.min(1, cur.built + (dt / cur.time) * (1 + 0.75 * eng) * (1 + Math.min(2, this.engineering) * 0.25));
      if (Math.random() < dt * 4) g.effect("spark", cur.x + (Math.random() - 0.5) * cur.w * 0.6, cur.y + (Math.random() - 0.5) * cur.d * 0.6, g.bf.h(cur.x, cur.y) + 1, 0.3, 1);
      if (cur.built >= 1) this.complete(cur);
    }
    // facility services
    const svc = (type: string, r: number, fn: (u: any) => void) => {
      const f = this.facilities.find((q) => q.type === type && q.built >= 1);
      if (f) g.uHash.query(f.x, f.y, r, fn);
    };
    svc("field_hospital", 26, (u) => { if (!u.vehicle && u.hp < u.maxHp) u.hp = Math.min(u.maxHp, u.hp + 6 * dt); if (u.def.heal) u.medkits = u.def.heal.kits; });
    svc("supply_depot", 22, (u) => { if (u.weapon && u.reserve < u.weapon.reserve) u.reserve = Math.min(u.weapon.reserve, u.reserve + u.weapon.mag * dt * 0.5); });
    svc("ammo_storage", 16, (u) => { if (u.weapon && u.reserve < u.weapon.reserve) u.reserve = Math.min(u.weapon.reserve, u.reserve + u.weapon.mag * dt * 0.5); });
    svc("repair_facility", 22, (u) => { if (u.vehicle && u.hp < u.maxHp) u.hp = Math.min(u.maxHp, u.hp + 30 * dt); });
  }
  complete(f: Facility) {
    const g = this.g, def = STRUCTURES[f.type];
    if (f.type === "watchtower" || f.type === "reinforced_gate") {
      const o = g.addObstacle(f.type, f.x, f.y, f.rot);
      o.fob = true; o.w = f.w; o.d = f.d;
      f.obstacle = o.id;
    } else {
      const id = `fob_${f.type}_${Math.round(f.x)}_${Math.round(f.y)}`;
      const h = def.height || 3;
      const b = mkBuilding(g, id, f, h, f.type === "perimeter" ? "ruin" : def.model || "warehouse", f.type === "perimeter" ? "utility" : "government", f.type === "perimeter" ? "flat" : def.roof || "flat", def.color || [0.5, 0.5, 0.45], !!def.enter, def.name);
      g.bf.map.addBuilding(b);
      f.bid = id;
    }
    if (f.type !== "perimeter") g.radio(`FOB: ${def.name} complete.`, "good");
    if (f.type === "command_center" && !this.established) {
      this.established = true;
      g.radio("FOB established. Land convoys, the full logistics list and reinforcements are now available.", "good");
      g.onEvent("fob_established", this.site);
    }
    g.onEvent("facility", f);
  }
  serialize() { return { site: this.site, facilities: this.facilities.map((f) => ({ type: f.type, built: f.built })), inventory: this.inventory, engineering: this.engineering, allowed: this.allowed, established: this.established }; }
  restore(s: any) {
    this.inventory = s.inventory || this.inventory; this.engineering = s.engineering || 0; this.allowed = !!s.allowed;
    if (!s.site) return;
    this.site = s.site;
    const plan = this.plan(s.site.x, s.site.y, s.site.rot);
    plan.forEach((p, k) => {
      const f: Facility = { ...p, built: 0, bid: null, obstacle: null, time: BUILD_TIME[p.type] || 20 };
      this.facilities.push(f);
      const saved = s.facilities && s.facilities[k];
      if (saved && saved.built >= 1) { f.built = 1; this.completeQuiet(f); } else if (saved) f.built = saved.built;
    });
    this.established = this.has("command_center");
  }
  completeQuiet(f: Facility) { const r = this.g.radio; this.g.radio = () => {}; const ev = this.g.onEvent; this.g.onEvent = () => {}; try { this.complete(f); } finally { this.g.radio = r; this.g.onEvent = ev; } }
}

function mkBuilding(g: Game, id: string, f: Facility, h: number, arch: string, cat: string, roof: string, col: number[], enter: boolean, name: string) {
  const c = Math.cos(f.rot), s = Math.sin(f.rot), hw = f.w / 2, hd = f.d / 2;
  const fp: number[] = [];
  for (const [u, v] of [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]]) fp.push(+(f.x + u * c - v * s).toFixed(2), +(f.y + u * s + v * c).toFixed(2));
  const rotDeg = (f.rot * 180) / Math.PI;
  const brg = f.w >= f.d ? (((90 - rotDeg) % 180) + 180) % 180 : (((-rotDeg) % 180) + 180) % 180;
  return {
    id, fp, c: cat, cs: "game:FOB facility", a: arch, as: "game", lv: Math.max(1, Math.round(h / 3.3)), lvs: "game", h, hs: "game",
    rf: roof, rfs: "game", rh: roof === "flat" ? 0 : Math.min(f.w, f.d) * 0.16, rhs: "game", wc: col, wcs: "game", rc: [0.36, 0.4, 0.33], rcs: "game",
    wm: "concrete", rm: "metal_sheet", ent: [0, 0.5], ents: "game", obb: [f.x, f.y, Math.max(f.w, f.d), Math.min(f.w, f.d), brg], brg,
    area: f.w * f.d, ip: [f.x, f.y], nav: enter ? "rooms" : "solid", los: "full", z: g.bf.h(f.x, f.y), fps: "game", name, enter: enter ? 1 : 0, fob: true,
  };
}
export const FOB_SIZE = { W, D };
export function fobCentreOk(g: Game, x: number, y: number) { return g.fob.check(x, y, 0) === "" || g.fob.check(x, y, Math.PI / 2) === ""; }
export { dist };

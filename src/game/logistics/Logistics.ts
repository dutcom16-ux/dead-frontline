// Military logistics — the only economy in the game (no gathering): limited stock per mission,
// delivery times, cooldowns and restrictions (FOB, communications, motor pool, campaign phase).
import type { Game } from "../Game";
import { createSquad, ensureSquads } from "../units/Squads";
import { SUPPLIES, SupplyDef } from "../data";
import { Transport } from "../entities";
import { dist } from "../core";
import { strike } from "../combat/Combat";

export interface Pending { id: number; item: string; x: number; y: number; eta: number; transport: number | null; heading?: number }

export class Logistics {
  g: Game;
  stock: Record<string, number> = {};
  ready: Record<string, number> = {};
  pending: Pending[] = [];
  delivered = 0;
  unlockedUnits = new Set<string>(["rifleman", "assault", "machine_gunner", "sniper", "medic", "engineer"]);
  campaignFlags = new Set<string>();
  constructor(g: Game) {
    this.g = g;
    for (const [k, d] of Object.entries(SUPPLIES)) { this.stock[k] = d.stock; this.ready[k] = 0; }
  }
  def(id: string): SupplyDef { return SUPPLIES[id]; }
  /** why an item cannot be requested now ("" when it can) */
  blocked(id: string): string {
    const d = SUPPLIES[id], g = this.g;
    if (!d) return "unknown item";
    if (d.requires) {
      const r = d.requires;
      if (r === "fob" && !g.fob.established) return "Needs the FOB";
      if (r === "comms" && !g.fob.has("communications")) return "Needs the FOB Communications Center";
      if (r === "motor_pool" && !g.fob.has("motor_pool")) return "Needs the FOB Motor Pool";
      if (r.startsWith("campaign:") && !this.campaignFlags.has(r.slice(9))) return d.note || "Not available in this campaign phase";
    }
    if (d.via === "land" && !g.fob.established) return "Land convoys need the FOB";
    if (this.stock[id] <= 0) return "Out of stock this mission";
    if (g.time < this.ready[id]) return `Cooldown ${Math.ceil(this.ready[id] - g.time)} s`;
    return "";
  }
  /** request an item to (x, y); land convoys always deliver to the FOB */
  request(id: string, x: number, y: number, heading = 0): string {
    const why = this.blocked(id);
    if (why) return why;
    const d = SUPPLIES[id], g = this.g;
    if (d.via === "land" && g.fob.site) { x = g.fob.depot()[0]; y = g.fob.depot()[1]; }
    if (!d.strike) {
      const p = g.bf.freeNear(x, y, 40);
      if (!p) return "No clear ground to deliver to there";
      [x, y] = p;
    }
    this.stock[id]--;
    this.ready[id] = g.time + d.cooldown;
    const p: Pending = { id: g.newTransportId(), item: id, x, y, eta: g.time + d.delivery, transport: null, heading };
    this.pending.push(p);
    const how = d.strike ? (id === "artillery" ? "Fire mission" : "Gun run") : d.via === "air" ? "Air drop" : "Convoy";
    g.radio(`${how} approved: ${d.name}, ETA ${d.delivery} s.`, "radio");
    g.onSound("radio", x, y, 0.5);
    g.onEvent("requested", p);
    return "";
  }
  update(dt: number) {
    const g = this.g;
    for (const p of this.pending) {
      const d = SUPPLIES[p.item];
      const lead = d.strike ? 0 : d.via === "air" ? 14 : 22;
      if (p.transport === null && !d.strike && g.time >= p.eta - lead) p.transport = this.dispatch(p, d, lead).id;
      if (d.strike && g.time >= p.eta) { strike(g, p.x, p.y, d.strike, p.heading || 0); g.radio(`${d.name}: rounds on target.`, "radio"); p.eta = Infinity; p.transport = -1; }
    }
    this.pending = this.pending.filter((p) => p.transport !== -1);
    // transports in flight (deliveries and evacuations)
    for (const t of g.transports) this.move(t, dt);
  }
  dispatch(p: Pending, d: SupplyDef, lead: number): Transport {
    const g = this.g;
    let sx: number, sy: number, path: [number, number][] | undefined;
    if (d.via === "air") { const a = Math.random() * Math.PI * 2; sx = p.x + Math.cos(a) * 260; sy = p.y + Math.sin(a) * 260; }
    else {
      // convoy: arrive along the road network from ~180 m out
      const r = g.bf.roads.near(p.x, p.y, 400, 40);
      const far = r.map((n) => g.bf.roads.nodes[n]).sort((a, b) => dist(b.x, b.y, p.x, p.y) - dist(a.x, a.y, p.x, p.y))[0];
      sx = far ? far.x : p.x + 150; sy = far ? far.y : p.y;
      path = g.paths.solve(sx, sy, p.x, p.y) || [[sx, sy], [p.x, p.y]];
    }
    const t: Transport = { id: p.id, kind: d.via === "air" ? "heli" : "truck", x: sx, y: sy, z: d.via === "air" ? 60 : g.bf.h(sx, sy), sx, sy, tx: p.x, ty: p.y, t: 0, arrive: lead, stay: d.via === "air" ? 6 : 8, delivery: 0, heading: 0, done: false, path, pathIdx: 1 };
    g.transports.push(t);
    g.onSound(d.via === "air" ? "heli" : "truck", p.x, p.y, 0.5);
    return t;
  }
  move(t: Transport, dt: number) {
    const g = this.g;
    t.t += dt;
    if (t.done) return;
    if (t.t < t.arrive) {
      const f = t.t / t.arrive;
      if (t.kind === "heli" || !t.path) {
        const e = 1 - Math.pow(1 - f, 2);
        const nx = t.sx + (t.tx - t.sx) * e, ny = t.sy + (t.ty - t.sy) * e;
        if (Math.hypot(nx - t.x, ny - t.y) > 1e-3) t.heading = Math.atan2(ny - t.y, nx - t.x);
        t.x = nx; t.y = ny;
        t.z = g.bf.h(t.x, t.y) + (t.kind === "heli" ? 46 * (1 - e) : 0);
      } else this.alongPath(t, f);
      return;
    }
    if (t.delivery === 0) {
      t.delivery = 1;
      t.x = t.tx; t.y = t.ty; t.z = g.bf.h(t.x, t.y);
      const p = this.pending.find((q) => q.id === t.id);
      if (p) { this.deliver(p); this.pending = this.pending.filter((q) => q !== p); }
    }
    if (t.delivery === -1) {
      // evacuation: wait on the ground until every assigned survivor has boarded (max 90 s)
      t.x = t.tx; t.y = t.ty; t.z = g.bf.h(t.x, t.y);
      const waiting = g.civs.some((c) => c.state === "evac" && c.leader === t.id && !c.dead);
      if (waiting && t.t < t.arrive + 90) return;
      t.delivery = -2; t.stay = t.t - t.arrive + 1.5;
      g.radio("Evac bird is wheels-up with the survivors.", "good");
      g.onSound("heli", t.x, t.y, 0.5);
    }
    const leaveAt = t.arrive + t.stay;
    if (t.t < leaveAt) return;
    const f = Math.min(1, (t.t - leaveAt) / 12);
    if (t.kind === "truck" && t.path) this.alongPath(t, 1 - f);
    else {
      t.x = t.tx + (t.sx - t.tx) * f * f; t.y = t.ty + (t.sy - t.ty) * f * f;
      t.heading = Math.atan2(t.sy - t.ty, t.sx - t.tx);
      t.z = g.bf.h(t.x, t.y) + 46 * f;
    }
    if (f >= 1) t.done = true;
  }
  alongPath(t: Transport, f: number) {
    const p = t.path!;
    let L = 0;
    const seg: number[] = [];
    for (let k = 1; k < p.length; k++) { const l = dist(p[k - 1][0], p[k - 1][1], p[k][0], p[k][1]); seg.push(l); L += l; }
    let s = f * L;
    for (let k = 1; k < p.length; k++) {
      if (s <= seg[k - 1] || k === p.length - 1) {
        const q = seg[k - 1] ? Math.min(1, s / seg[k - 1]) : 1;
        const nx = p[k - 1][0] + (p[k][0] - p[k - 1][0]) * q, ny = p[k - 1][1] + (p[k][1] - p[k - 1][1]) * q;
        t.heading = Math.atan2(p[k][1] - p[k - 1][1], p[k][0] - p[k - 1][0]);
        t.x = nx; t.y = ny; t.z = this.g.bf.h(nx, ny);
        return;
      }
      s -= seg[k - 1];
    }
  }
  deliver(p: Pending) {
    const g = this.g, d = SUPPLIES[p.item];
    this.delivered++; g.stats.supplies++;
    if (d.crate) {
      const c = g.addCrate(p.x, p.y, d.name);
      c.ammo = d.crate.ammo || 0; c.medical = d.crate.medical || 0; c.heal = d.crate.heal || 0;
    }
    if (d.deploy) { const c = g.addCrate(p.x, p.y, d.name); c.deploy = { ...d.deploy }; }
    if (d.engineering) { const c = g.addCrate(p.x, p.y, d.name); c.engineering = d.engineering.clear; }
    if (d.unlocks) { for (const u of d.unlocks) this.unlockedUnits.add(u); g.radio(`Specialist weapons delivered: ${d.unlocks.join(", ").replace(/_/g, " ")} now available for reinforcements.`, "good"); }
    if (d.units) {
      const made = d.units.map((type, k) => g.addUnit(type, p.x + (k % 3) * 2 - 2, p.y + Math.floor(k / 3) * 2));
      g.stats.reinforcements += made.length;
      // a team arrives as its own squad
      const inf = made.filter((u) => !u.vehicle);
      const sq = inf.length >= 2 ? createSquad(g, inf) : null;
      if (!sq) ensureSquads(g);
      g.radio(`Reinforcements on the ground${sq ? ` as squad ${sq.name}` : ""}: ${made.map((u) => u.name).join(", ")}.`, "good");
      g.onEvent("reinforced", made);
    }
    if (d.vehicle) { const gp = g.fob.site ? g.fob.gate() : [p.x, p.y]; const v = g.addUnit(d.vehicle, gp[0], gp[1]); g.radio(`${v.name} delivered to the motor pool.`, "good"); g.onEvent("reinforced", [v]); }
    if (!d.units && !d.vehicle) g.radio(`${d.name} delivered.`, "good");
    g.onSound("drop", p.x, p.y, 0.7);
    g.onEvent("delivered", p);
  }
  serialize() { return { stock: this.stock, ready: Object.fromEntries(Object.entries(this.ready).map(([k, v]) => [k, v - this.g.time])), pending: this.pending.map((p) => ({ ...p, eta: p.eta - this.g.time, transport: null })), delivered: this.delivered, unlocked: [...this.unlockedUnits], flags: [...this.campaignFlags] }; }
  restore(s: any) {
    Object.assign(this.stock, s.stock);
    for (const [k, v] of Object.entries(s.ready || {})) this.ready[k] = this.g.time + (v as number);
    this.pending = (s.pending || []).map((p: Pending) => ({ ...p, eta: this.g.time + Math.max(0, p.eta), transport: null }));
    this.delivered = s.delivered || 0;
    this.unlockedUnits = new Set(s.unlocked || []);
    this.campaignFlags = new Set(s.flags || []);
  }
}

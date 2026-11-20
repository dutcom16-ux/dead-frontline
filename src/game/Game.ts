// Simulation state and the fixed-step update. Rendering and UI read from this; nothing here touches the DOM.
import { Battlefield } from "./Battlefield";
import { Rng, SpatialHash, dist, clamp } from "./core";
import { Unit, Zombie, Civilian, Nest, Obstacle, Crate, Projectile, Effect, Corpse, Fire, Noise, Transport, nextId } from "./entities";
import { PathService } from "./pathfinding/PathService";
import { updateUnits } from "./units/UnitAI";
import { updateZombies, FlowFields } from "./zombies/ZombieAI";
import { updateCombat } from "./combat/Combat";
import { updateCivilians } from "./units/Civilians";
import { ZOMBIES, RANKS, SURNAMES } from "./data";
import type { Mission } from "./missions/Mission";
import type { Logistics } from "./logistics/Logistics";
import type { Fob } from "./fob/Fob";

export type Difficulty = "low" | "medium" | "high";
export interface RadioMsg { t: number; text: string; kind: "info" | "warn" | "good" | "bad" | "radio" }

export class Game {
  bf: Battlefield; paths: PathService; rng: Rng; flow: FlowFields;
  units: Unit[] = []; zombies: Zombie[] = []; civs: Civilian[] = []; nests: Nest[] = []; obstacles: Obstacle[] = []; crates: Crate[] = [];
  projectiles: Projectile[] = []; effects: Effect[] = []; corpses: Corpse[] = []; fires: Fire[] = []; noises: Noise[] = []; transports: Transport[] = [];
  byId = new Map<number, any>();
  uHash = new SpatialHash<Unit>(10); zHash = new SpatialHash<Zombie>(6); cHash = new SpatialHash<Civilian>(10);
  time = 0; difficulty: Difficulty = "medium";
  stats = { kills: {} as Record<string, number>, killed: 0, lost: 0, rescued: 0, civLost: 0, shots: 0, supplies: 0, reinforcements: 0 };
  radioLog: RadioMsg[] = [];
  mission!: Mission; logistics!: Logistics; fob!: Fob;
  onSound: (kind: string, x: number, y: number, vol?: number) => void = () => {};
  onRadio: (m: RadioMsg) => void = () => {};
  onEvent: (ev: string, data?: any) => void = () => {};
  shake = 0;
  usedNames = new Set<string>();
  bossId = 0;
  paused = false;
  constructor(bf: Battlefield, seed = 1234) {
    this.bf = bf; this.paths = new PathService(bf); this.rng = new Rng(seed); this.flow = new FlowFields(this);
  }

  // ---------------------------------------------------------------- spawning
  soldierName(): string {
    for (let k = 0; k < 40; k++) {
      const n = SURNAMES[this.rng.int(SURNAMES.length)];
      if (!this.usedNames.has(n)) { this.usedNames.add(n); return n; }
    }
    return SURNAMES[this.rng.int(SURNAMES.length)] + " " + (1 + this.rng.int(9));
  }
  addUnit(type: string, x: number, y: number, name?: string): Unit {
    const p = this.bf.freeNear(x, y, 25, false) || [x, y];
    const u = new Unit(type, p[0], p[1]);
    if (!u.vehicle) { u.rank = this.rng.int(3); u.name = name || `${RANKS[u.rank]} ${this.soldierName()}`; }
    else u.name = name || `${u.def.name} ${String.fromCharCode(65 + this.units.filter((q) => q.vehicle).length)}`;
    u.z = this.bf.h(u.x, u.y);
    this.units.push(u); this.byId.set(u.id, u);
    return u;
  }
  addZombie(type: string, x: number, y: number, zone = "", indoors = false): Zombie | null {
    const p = this.bf.freeNear(x, y, 14, !indoors);
    if (!p) return null;
    const z = new Zombie(type, p[0], p[1]);
    z.zone = zone; z.z = this.bf.h(z.x, z.y);
    const k = this.difficulty === "low" ? 0.85 : this.difficulty === "high" ? 1.2 : 1;
    z.hp = z.maxHp = Math.round(z.def.hp * k);
    this.zombies.push(z); this.byId.set(z.id, z);
    return z;
  }
  /** a group of infected around (x, y); types drawn by weight unless given */
  spawnGroup(x: number, y: number, n: number, r: number, zone: string, mix?: Record<string, number>) {
    const w: Record<string, number> = mix || Object.fromEntries(Object.entries(ZOMBIES).filter(([, d]) => d.weight > 0).map(([k, d]) => [k, d.weight]));
    const out: Zombie[] = [];
    for (let k = 0; k < n; k++) {
      const a = this.rng.next() * Math.PI * 2, d = Math.sqrt(this.rng.next()) * r;
      const z = this.addZombie(this.rng.weighted(w), x + Math.cos(a) * d, y + Math.sin(a) * d, zone);
      if (z) out.push(z);
    }
    return out;
  }
  addCivilian(x: number, y: number, objective: string, military: string | null = null) {
    const c = new Civilian(x, y, objective, military);
    c.z = this.bf.h(x, y);
    this.civs.push(c); this.byId.set(c.id, c);
    return c;
  }
  addNest(x: number, y: number, zone: string, size = 1) {
    const p = this.bf.freeNear(x, y, 30) || [x, y];
    const n = new Nest(p[0], p[1], zone);
    n.size = size; n.hp = n.maxHp = Math.round(1600 * size);
    n.z = this.bf.h(n.x, n.y);
    this.nests.push(n); this.byId.set(n.id, n);
    return n;
  }
  addObstacle(kind: string, x: number, y: number, rot: number, built = 1) {
    const o = new Obstacle(kind, x, y, rot);
    o.z = this.bf.h(x, y); o.built = built;
    this.obstacles.push(o); this.byId.set(o.id, o);
    return o;
  }
  addCrate(x: number, y: number, label: string) {
    const p = this.bf.freeNear(x, y, 20) || [x, y];
    const c = new Crate(p[0], p[1], label);
    c.z = this.bf.h(c.x, c.y);
    this.crates.push(c); this.byId.set(c.id, c);
    return c;
  }
  get(id: number | null | undefined): any { return id == null ? null : this.byId.get(id) || null; }
  liveUnits() { return this.units.filter((u) => u.alive && u.inVehicle === null); }

  // ---------------------------------------------------------------- messages
  radio(text: string, kind: RadioMsg["kind"] = "radio") {
    const last = this.radioLog[this.radioLog.length - 1];
    if (last && last.text === text && this.time - last.t < 6) return;
    const m = { t: this.time, text, kind };
    this.radioLog.push(m);
    if (this.radioLog.length > 60) this.radioLog.shift();
    this.onRadio(m);
  }
  noise(x: number, y: number, r: number) {
    for (const n of this.noises) if (Math.abs(n.x - x) < 12 && Math.abs(n.y - y) < 12) { n.r = Math.max(n.r, r); return; }
    this.noises.push({ x, y, r, t: this.time });
  }
  effect(kind: string, x: number, y: number, z: number, life: number, s = 1, extra: Partial<Effect> = {}) {
    if (this.effects.length > 900) this.effects.shift();
    this.effects.push({ kind, x, y, z, t: 0, life, s, ...extra });
  }

  // ---------------------------------------------------------------- damage
  /** apply damage to any entity; `src` = id of the attacker */
  damage(e: any, amount: number, src: number | null, kind: "bullet" | "blast" | "fire" | "melee" | "crush" = "bullet") {
    if (!e || e.dead) return;
    if (e instanceof Obstacle) { e.hp -= amount; if (e.hp <= 0) this.destroyObstacle(e); return; }
    const armor = e instanceof Unit ? e.def.armor : e instanceof Zombie ? e.def.armor : 0;
    const k = kind === "fire" ? 1 - armor * 0.3 : kind === "blast" ? 1 - armor * 0.6 : 1 - armor;
    e.hp -= amount * k;
    e.hitT = 0.15;
    if (e instanceof Unit) e.suppression = clamp(e.suppression + amount / 120 * (1 - (e.def.suppressionResist || 0.5)), 0, 1);
    if (e instanceof Zombie && !e.awake) { e.awake = true; }
    if (e instanceof Zombie && src && e.state !== "chase") {
      const s = this.get(src);
      if (s && s instanceof Unit) { e.state = "chase"; e.target = s.id; e.lastSeenX = s.x; e.lastSeenY = s.y; e.lastSeenT = this.time; }
    }
    if (e.hp > 0) return;
    e.hp = 0; e.dead = true;
    if (e instanceof Zombie) this.zombieDied(e, src);
    else if (e instanceof Unit) this.unitDied(e);
    else if (e instanceof Civilian) { this.stats.civLost++; this.radio("A civilian has been killed.", "bad"); this.corpse(e.x, e.y, e.z, e.heading, [0.5, 0.45, 0.42], 1, "corpse"); }
    else if (e instanceof Nest) {
      this.radio("Infected nest destroyed.", "good");
      this.explode(e.x, e.y, e.z, 6, 0, null, "gore");
      this.onEvent("nest", e);
    }
  }
  zombieDied(z: Zombie, src: number | null) {
    this.stats.killed++;
    this.stats.kills[z.type] = (this.stats.kills[z.type] || 0) + 1;
    const s = this.get(src);
    if (s instanceof Unit) { s.kills++; if (s.kills % 25 === 0 && s.rank < 3) { s.rank++; if (!s.vehicle) s.name = s.name.replace(/^\S+/, RANKS[s.rank]); } }
    this.corpse(z.x, z.y, z.z, z.heading, z.def.color, z.def.size, z.type === "abomination" ? "abomination" : "corpse");
    this.effect("blood", z.x, z.y, z.z, 40, 0.8 + z.def.size * 0.5);
    if (z.def.explode) { this.onSound("bloater", z.x, z.y); this.explode(z.x, z.y, z.z, z.def.explode.radius, z.def.explode.damage, null, "gas"); }
    if (z.def.boss) { this.radio("The Abomination is down!", "good"); this.onEvent("boss", z); this.shake = 1; }
    this.onEvent("zkill", z);
  }
  unitDied(u: Unit) {
    this.stats.lost++;
    if (u.selected) u.selected = false;
    this.radio(`${u.name} is down${u.vehicle ? " (vehicle destroyed)" : " — KIA"}.`, "bad");
    if (u.vehicle) {
      this.explode(u.x, u.y, u.z, 5, 120, null, "blast");
      for (const pid of u.passengers) { const p = this.get(pid); if (p) { p.inVehicle = null; p.x = u.x + this.rng.range(-3, 3); p.y = u.y + this.rng.range(-3, 3); this.damage(p, 40, null, "blast"); } }
      u.passengers = [];
      this.addObstacle("wreck", u.x, u.y, u.heading);
    } else {
      this.corpse(u.x, u.y, u.z, u.heading, u.def.color, 1, "corpse");
      const c = this.corpses[this.corpses.length - 1];
      c.sprite = true; c.flip = Math.cos(u.heading) < 0; // drawn with the troop sprite sheet's death animation
    }
    this.onEvent("udeath", u);
  }
  corpse(x: number, y: number, z: number, rot: number, col: [number, number, number], s: number, model: string) {
    this.corpses.push({ x, y, z, rot, col: [col[0] * 0.75, col[1] * 0.7, col[2] * 0.7], s, t: this.time, model });
    if (this.corpses.length > 320) this.corpses.shift();
  }
  destroyObstacle(o: Obstacle) {
    o.dead = true;
    this.radio(`${o.def ? o.def.name : "Barrier"} destroyed.`, "warn");
    this.effect("smoke", o.x, o.y, o.z + 1, 3, 2);
    this.onEvent("obstacle", o);
  }
  explode(x: number, y: number, z: number, r: number, dmg: number, src: number | null, kind: "blast" | "gas" | "gore" = "blast") {
    this.effect(kind === "gas" ? "gas" : "blast", x, y, z + 0.5, kind === "gas" ? 1.2 : 0.7, r);
    if (kind === "blast") { this.effect("smoke", x, y, z + 1, 4, r * 0.6); this.effect("scorch", x, y, z, 60, r * 0.5); this.shake = Math.min(1, this.shake + r / 20); }
    this.onSound(kind === "blast" ? "explosion" : "splat", x, y, Math.min(1, r / 6));
    this.noise(x, y, kind === "blast" ? 130 : 40);
    if (dmg <= 0) return;
    const hit = (e: any, d: number, friendly: boolean) => {
      const f = 1 - d / r;
      if (f <= 0) return;
      this.damage(e, dmg * f * (friendly ? 0.45 : 1), src, "blast");
    };
    this.zHash.query(x, y, r, (zz, d) => hit(zz, d, false));
    this.uHash.query(x, y, r, (u, d) => hit(u, d, true));
    this.cHash.query(x, y, r, (c, d) => hit(c, d, true));
    for (const n of this.nests) { const d = dist(x, y, n.x, n.y); if (d < r + n.r) hit(n, Math.max(0, d - n.r), false); }
    for (const o of this.obstacles) if (!o.dead && o.kind !== "wreck" && o.distTo(x, y) < r) this.damage(o, dmg * 0.4, src, "blast");
    // building structure damage (estimated hit points from the footprint and storeys)
    if (kind === "blast" && dmg >= 100) {
      const seen = new Set<any>();
      for (const [ox, oy] of [[0, 0], [r * 0.5, 0], [-r * 0.5, 0], [0, r * 0.5], [0, -r * 0.5]]) {
        const b = this.bf.map.buildingAt(x + ox, y + oy);
        if (b && !seen.has(b)) { seen.add(b); try { this.bf.phys.damageBuilding(b, dmg * 0.5); } catch (e) { /* non-structural */ } }
      }
    }
  }

  // ---------------------------------------------------------------- main step
  step(dt: number) {
    if (this.paused) return;
    this.time += dt;
    this.uHash.clear(); this.zHash.clear(); this.cHash.clear();
    for (const u of this.units) if (u.alive && u.inVehicle === null) this.uHash.insert(u);
    for (const z of this.zombies) if (!z.dead) this.zHash.insert(z);
    for (const c of this.civs) if (!c.dead && c.state !== "gone") this.cHash.insert(c);
    this.paths.update(3);
    updateUnits(this, dt);
    this.flow.update(dt);
    updateZombies(this, dt);
    updateCivilians(this, dt);
    updateCombat(this, dt);
    this.logistics && this.logistics.update(dt);
    this.fob && this.fob.update(dt);
    this.mission && this.mission.update(dt);
    this.noises.length = 0;
    this.shake = Math.max(0, this.shake - dt * 2);
    // compact dead entities every second
    if (Math.floor(this.time) !== Math.floor(this.time - dt)) this.compact();
  }
  compact() {
    const keep = <T extends { dead: boolean; id: number }>(arr: T[]) => {
      const out = arr.filter((e) => !e.dead);
      for (const e of arr) if (e.dead) this.byId.delete(e.id);
      return out;
    };
    this.zombies = keep(this.zombies);
    this.nests = keep(this.nests);
    this.obstacles = keep(this.obstacles);
    this.crates = keep(this.crates);
    this.civs = this.civs.filter((c) => { const k = !c.dead && c.state !== "gone"; if (!k) this.byId.delete(c.id); return k; });
    const deadUnits = this.units.filter((u) => u.dead);
    if (deadUnits.length) { this.units = this.units.filter((u) => !u.dead); for (const u of deadUnits) this.byId.delete(u.id); }
    this.transports = this.transports.filter((t) => !t.done);
  }
  newTransportId() { return nextId(); }
}

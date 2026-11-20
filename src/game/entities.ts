// Game entities. All positions are map metres (x east, y north); z is the ground height.
import { unitDef, isVehicleType, WEAPONS, ZOMBIES, STRUCTURES, UnitDef, WeaponDef, ZombieDef, StructureDef } from "./data";

let NEXT_ID = 1;
export const nextId = () => NEXT_ID++;
export const setNextId = (n: number) => { NEXT_ID = Math.max(NEXT_ID, n); };

export type OrderKind = "idle" | "move" | "attackMove" | "attack" | "hold" | "defend" | "patrol" | "follow" | "retreat" | "interact" | "board" | "build" | "clear" | "formation";
export interface Order {
  kind: OrderKind; x?: number; y?: number; target?: number; ax?: number; ay?: number; bx?: number; by?: number; leg?: number;
  item?: string; rot?: number; t?: number;
}
export type Formation = "line" | "column" | "wedge" | "spread" | "box" | "circle" | "defensive";

export class Unit {
  id = nextId(); type: string; def: UnitDef; vehicle: boolean; name: string;
  x: number; y: number; z = 0; heading = 0; hp: number; maxHp: number;
  weapon: WeaponDef | null; wid: string | null; mag = 0; reserve = 0; reloadT = 0; cool = 0;
  order: Order = { kind: "idle" }; queue: Order[] = [];
  path: [number, number][] | null = null; pathIdx = 0; pathPending = false; pathGoal: [number, number] | null = null;
  stuckT = 0; stuckN = 0; lastX = 0; lastY = 0; moving = false; speedNow = 0;
  target: number | null = null; focus: number | null = null; scanT = Math.random() * 0.3; losOk = false; losT = 0;
  suppression = 0; kills = 0; dead = false; selected = false; group = 0;
  medkits = 0; healT = 0; buildT = 0; clearT = 0;
  passengers: number[] = []; inVehicle: number | null = null;
  burn = 0; flashT = 0; aimX = 0; aimY = 0; hitT = 0;
  defendAt: [number, number] | null = null;
  rank = 0;
  // squad and formation (see units/Squads.ts)
  squad = 0; detached = false; task = false;
  slotX = NaN; slotY = NaN; slotFace = NaN; rawX = NaN; rawY = NaN; slotT = -99;
  formT = -99; formClear = true; formClearT = -99; formStuckT = 0; formLastX = 0; formLastY = 0;
  speedCap = Infinity; squadHalt = false;
  // infection: bitten soldiers turn after incubation (see zombies/Infection.ts)
  infectedAt = -1; turnAt = -1;
  constructor(type: string, x: number, y: number, name?: string) {
    this.type = type; this.def = unitDef(type); this.vehicle = isVehicleType(type);
    this.x = this.lastX = x; this.y = this.lastY = y;
    this.hp = this.maxHp = this.def.hp;
    this.wid = this.def.weapon; this.weapon = this.wid ? WEAPONS[this.wid] : null;
    if (this.weapon) { this.mag = this.weapon.mag; this.reserve = this.weapon.reserve; }
    if (this.def.heal) this.medkits = this.def.heal.kits;
    this.name = name || this.def.name;
  }
  get r() { return this.vehicle ? (this.def.size ? Math.max(this.def.size[0], this.def.size[1] * 0.55) * 0.5 : 1.4) : 0.32; }
  get alive() { return !this.dead && this.hp > 0; }
  get ammoFrac() { return this.weapon ? (this.mag + this.reserve) / (this.weapon.mag + this.weapon.reserve) : 1; }
}

export type ZState = "idle" | "wander" | "investigate" | "chase" | "attack";
export class Zombie {
  id = nextId(); type: string; def: ZombieDef;
  x: number; y: number; z = 0; heading = Math.random() * 6.28; hp: number; maxHp: number;
  state: ZState = "idle"; target: number | null = null; goalX = 0; goalY = 0;
  lastSeenX = 0; lastSeenY = 0; lastSeenT = -99; senseT = Math.random() * 0.5; attackT = 0; stuckT = 0; lastX = 0; lastY = 0;
  homeX: number; homeY: number; wanderT = Math.random() * 6; burn = 0; burnT = 0; stagger = 0; screamT = 0; leapT = 0;
  dead = false; awake = false; zone = ""; nest = 0; hitT = 0; breakT = 0;
  climbT = 0;                       // climbing over a defence on a corpse pile
  soldier: string | null = null;    // a soldier who turned: his unit type (drawn in uniform)
  formerSquad = 0;
  constructor(type: string, x: number, y: number) {
    this.type = type; this.def = ZOMBIES[type];
    this.x = this.lastX = this.homeX = x; this.y = this.lastY = this.homeY = y;
    this.hp = this.maxHp = this.def.hp;
  }
  get r() { return 0.3 * this.def.size + (this.type === "crawler" ? 0.15 : 0); }
}

export type CivState = "hiding" | "following" | "evac" | "gone" | "dead";
export class Civilian {
  id = nextId(); x: number; y: number; z = 0; heading = 0; hp = 60; maxHp = 60; dead = false;
  state: CivState = "hiding"; objective: string; military: string | null; leader: number | null = null;
  path: [number, number][] | null = null; pathIdx = 0; pathPending = false; panicT = 0; exiting = false; stuckT = 0; stuckN = 0; lastX = 0; lastY = 0;
  color: [number, number, number];
  constructor(x: number, y: number, objective: string, military: string | null = null) {
    this.x = x; this.y = y; this.objective = objective; this.military = military;
    const pal: [number, number, number][] = [[0.85, 0.3, 0.3], [0.3, 0.45, 0.8], [0.9, 0.8, 0.35], [0.85, 0.85, 0.85], [0.4, 0.7, 0.45], [0.75, 0.45, 0.75]];
    this.color = military ? [0.33, 0.4, 0.27] : pal[Math.floor(Math.random() * pal.length)];
  }
  get r() { return 0.3; }
}

export class Nest {
  id = nextId(); x: number; y: number; z = 0; hp = 1600; maxHp = 1600; dead = false; spawnT = 6; hitT = 0; zone: string; cap = 24; size = 1;
  constructor(x: number, y: number, zone: string) { this.x = x; this.y = y; this.zone = zone; }
  get r() { return 2.2 * this.size; }
}

/** wrecked vehicles, deployables, FOB gate/perimeter defences: obstacles at game level */
export class Obstacle {
  id = nextId(); kind: string; def: StructureDef | null; x: number; y: number; z = 0; rot: number; w: number; d: number;
  hp: number; maxHp: number; dead = false; blocksUnits: boolean; blocksZombies: boolean;
  built = 1; // construction progress 0..1
  fob = false; turretCool = 0; turretTarget: number | null = null; mag = 0;
  constructor(kind: string, x: number, y: number, rot: number) {
    this.kind = kind; this.x = x; this.y = y; this.rot = rot;
    this.def = STRUCTURES[kind] || null;
    const sz = kind === "wreck" ? [2.0, 4.6] : this.def && this.def.size ? this.def.size : [2, 1];
    this.w = sz[0]; this.d = sz[1];
    this.hp = this.maxHp = kind === "wreck" ? 9999 : kind === "reinforced_gate" ? 1400 : kind === "concrete_barrier" ? 1100 : kind === "sandbags" ? 700 :
      kind === "barricade" ? 450 : kind === "barbed_wire" ? 300 : kind === "mg_emplacement" ? 900 : kind === "watchtower" ? 1000 : kind === "bunker" ? 2200 : 300;
    this.blocksUnits = kind === "wreck";
    this.blocksZombies = !["barbed_wire", "lighting"].includes(kind);
    if (this.def && this.def.turret) this.mag = 9999;
  }
  /** local (u along w, v along d) coordinates of a map point */
  local(x: number, y: number): [number, number] {
    const c = Math.cos(this.rot), s = Math.sin(this.rot), dx = x - this.x, dy = y - this.y;
    return [dx * c + dy * s, -dx * s + dy * c];
  }
  /** push a circle out of this obstacle; returns the corrected position or null when not touching */
  push(x: number, y: number, r: number): [number, number] | null {
    const [u, v] = this.local(x, y), hw = this.w / 2 + r, hd = this.d / 2 + r;
    if (Math.abs(u) >= hw || Math.abs(v) >= hd) return null;
    const pu = hw - Math.abs(u), pv = hd - Math.abs(v);
    let nu = u, nv = v;
    if (pu < pv) nu = Math.sign(u || 1) * hw; else nv = Math.sign(v || 1) * hd;
    const c = Math.cos(this.rot), s = Math.sin(this.rot);
    return [this.x + nu * c - nv * s, this.y + nu * s + nv * c];
  }
  distTo(x: number, y: number) {
    const [u, v] = this.local(x, y);
    const du = Math.max(0, Math.abs(u) - this.w / 2), dv = Math.max(0, Math.abs(v) - this.d / 2);
    return Math.hypot(du, dv);
  }
}

export class Crate {
  id = nextId(); x: number; y: number; z = 0; ammo = 0; medical = 0; heal = 0; deploy: Record<string, number> | null = null; engineering = 0;
  dead = false; landT = 0; label: string;
  constructor(x: number, y: number, label: string) { this.x = x; this.y = y; this.label = label; }
}

export interface Projectile { x: number; y: number; z: number; tx: number; ty: number; tz: number; speed: number; radius: number; damage: number; owner: number; kind: string; t: number }
export interface Effect { kind: string; x: number; y: number; z: number; t: number; life: number; s: number; rot?: number; col?: [number, number, number]; x2?: number; y2?: number; z2?: number }
export interface Corpse { x: number; y: number; z: number; rot: number; col: [number, number, number]; s: number; t: number; model: string; sprite?: boolean; flip?: boolean; pk?: number; w?: number; kind?: string; id?: number; soldier?: string }
export interface Fire { x: number; y: number; r: number; t: number; dps: number }
export interface Noise { x: number; y: number; r: number; t: number }
/** transport visuals (helicopters, convoy trucks): fly or drive in, deliver, leave */
export interface Transport { id: number; kind: "heli" | "truck"; x: number; y: number; z: number; sx: number; sy: number; tx: number; ty: number; t: number; arrive: number; stay: number; delivery: number; heading: number; done: boolean; path?: [number, number][]; pathIdx?: number }
export const isZombie = (e: any): e is Zombie => e instanceof Zombie;
export const isUnit = (e: any): e is Unit => e instanceof Unit;

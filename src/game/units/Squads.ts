// Squads and formations (spec §12–§18).
//
// A squad is a group of soldiers with one designated leader. The acting leader carries out the
// squad's order with the ordinary unit order code (move, attack-move, attack, follow, patrol,
// retreat). Every other member holds the "formation" order and tracks a slot. While the squad
// travels, slots are placed relative to the leader and rotate with a smoothed facing, so a turn
// sweeps the soldiers round on curved paths. Once the squad halts, slots are fixed around a centre
// and the formation turns to face threats. A soldier whose straight line to its slot is blocked
// plans its own path; a slot that falls inside a wall or behind one is replaced by a point on the
// leader's trail, which turns any formation into a file in narrow streets.
//
// Losing a member re-assigns the remaining slots. Losing the leader (killed or infected) passes
// command to the best remaining soldier. Too many infected at close range breaks the formation:
// soldiers fall back on their own and the squad regroups when the pressure drops.
import type { Game } from "../Game";
import { Unit, Zombie, Nest, Obstacle, Order } from "../entities";
import { dist, clamp } from "../core";

export type FormationKind = "wedge" | "line" | "column" | "box" | "circle" | "defensive";
export const FORMATIONS: FormationKind[] = ["wedge", "line", "column", "box", "circle", "defensive"];
export const FORMATION_LABEL: Record<FormationKind, string> = { wedge: "Wedge", line: "Line", column: "Column", box: "Box", circle: "Circle", defensive: "Defensive" };
export const FORMATION_ICON: Record<FormationKind, string> = { wedge: "⋀", line: "═", column: "‖", box: "□", circle: "○", defensive: "✣" };
export const isFormation = (f: any): f is FormationKind => FORMATIONS.includes(f);
/** formations that cover every direction: soldiers face outward and the shape does not swing round */
export const OMNI = new Set<FormationKind>(["box", "circle", "defensive"]);
const NAMES = ["Alpha", "Bravo", "Charlie", "Delta", "Echo", "Foxtrot", "Golf", "Hotel", "India", "Juliet", "Kilo", "Lima"];
const LEAD_ORDER = ["special_forces", "rifleman", "assault", "machine_gunner", "shotgunner", "rocket", "sniper", "flamethrower", "engineer", "medic"];
const SUPPORT = new Set(["medic", "engineer"]);
const TURN_RATE = 1.3;      // rad/s the formation swings round
export const SQUAD_ORDERS = new Set(["move", "attackMove", "retreat", "patrol", "attack", "follow", "hold", "defend"]);
const COVER_KINDS = new Set(["sandbags", "concrete_barrier", "barricade", "mg_emplacement", "bunker", "watchtower"]);

/** slot in formation space: f = metres forward, s = metres to the left, face = facing offset (NaN = formation facing) */
export interface Slot { f: number; s: number; face: number }

export class Squad {
  id: number; name: string; members: number[] = [];
  leader = 0;            // designated leader
  acting = 0;            // the attached member actually leading (the designated leader unless detached)
  formation: FormationKind = "wedge";
  facing = 0; want = 0; faceLock: number | null = null;
  cx = 0; cy = 0; halted = true; hold = false; defendAt: [number, number] | null = null;
  order: Order | null = null;   // the travel order the acting leader carries out
  route: [number, number][] | null = null; routeIdx = 0; routeGoal: [number, number] | null = null; // the leader's current path, for a change of leader
  slots = new Map<number, Slot>(); leaderSlot: Slot = { f: 0, s: 0, face: NaN }; dirty = true;
  trail: number[] = [];  // leader breadcrumbs x,y,x,y… newest first
  scanT = 0; threatN = 0; threatA = 0; quads = 0; closeN = 0; engagedN = 0;
  broken = 0; overT = 0; losses: number[] = []; hintT = -99; climbT = -99;
  assault = 0;           // id of a nest/structure the squad is assaulting (each soldier takes his own firing position)
  waitT = 0; lag = 0;
  joined = new Map<number, number>();   // when each member last (re)joined the formation
  constructor(id: number, name: string) { this.id = id; this.name = name; }
}

// ---------------------------------------------------------------- membership
export function squadOf(g: Game, u: Unit): Squad | null {
  if (!u.squad) return null;
  for (const s of g.squads) if (s.id === u.squad) return s;
  return null;
}
export function liveMembers(g: Game, s: Squad): Unit[] {
  const out: Unit[] = [];
  for (const id of s.members) { const u = g.get(id); if (u && u.alive && u.squad === s.id) out.push(u); }
  return out;
}
/** members on foot and following the squad (not detached on their own orders, not in a vehicle) */
export function attached(g: Game, s: Squad): Unit[] { return liveMembers(g, s).filter((u) => u.inVehicle === null && !u.detached); }
function score(u: Unit) { return u.rank * 100 - LEAD_ORDER.indexOf(u.type) * 2 + Math.min(40, u.kills) * 0.1 + (u.hp / u.maxHp) * 0.5 - (u.infectedAt >= 0 ? 10000 : 0); }
function best(us: Unit[]): Unit | null { let b: Unit | null = null; for (const u of us) if (!b || score(u) > score(b)) b = u; return b; }
function nextName(g: Game) { for (const n of NAMES) if (!g.squads.some((s) => s.name === n)) return n; return "Squad " + (g.squads.length + 1); }

function leave(g: Game, u: Unit) {
  const s = squadOf(g, u);
  if (s) { s.members = s.members.filter((id) => id !== u.id); s.dirty = true; if (s.leader === u.id) s.leader = 0; if (s.acting === u.id) s.acting = 0; }
  u.squad = 0;
}
/** form a new squad from these soldiers (they leave their old squads) */
export function createSquad(g: Game, units: Unit[], name?: string, formation?: FormationKind): Squad | null {
  const inf = units.filter((u) => u.alive && !u.vehicle);
  if (!inf.length) return null;
  for (const u of inf) leave(g, u);
  const s = new Squad(++g.squadSeq, name || nextName(g));
  if (formation) s.formation = formation;
  s.members = inf.map((u) => u.id);
  for (const u of inf) { u.squad = s.id; u.detached = false; u.task = false; }
  const L = best(inf)!;
  s.leader = s.acting = L.id;
  s.facing = s.want = L.heading;
  g.squads.push(s);
  halt(g, s);
  g.squads = g.squads.filter((q) => q.members.length > 0);
  return s;
}
export function joinSquad(g: Game, u: Unit, s: Squad) {
  if (u.vehicle) return;
  leave(g, u);
  s.members.push(u.id); u.squad = s.id; u.detached = false; u.task = false;
  if (u.inVehicle === null) { u.order = { kind: "formation" }; u.queue = []; u.path = null; }
  s.dirty = true;
}
/** every soldier belongs to a squad: loose soldiers join the nearest squad with room, or form a new one */
export function ensureSquads(g: Game, joinRange = 80) {
  const loose = g.units.filter((u) => u.alive && !u.vehicle && !squadOf(g, u));
  if (!loose.length) return;
  for (const u of loose) {
    let bs: Squad | null = null, bd = joinRange;
    for (const s of g.squads) {
      if (s.members.length >= 12) continue;
      const L = g.get(s.acting) || g.get(s.leader);
      if (L && dist(L.x, L.y, u.x, u.y) < bd) { bd = dist(L.x, L.y, u.x, u.y); bs = s; }
    }
    if (bs) joinSquad(g, u, bs);
  }
  const rest = loose.filter((u) => !squadOf(g, u));
  if (rest.length) createSquad(g, rest);
}
export function setLeader(g: Game, u: Unit) {
  const s = squadOf(g, u);
  if (!s || !u.alive || s.leader === u.id) return;
  const order = s.halted ? null : s.order;
  s.leader = u.id; s.dirty = true;
  if (u.detached) { u.detached = false; u.task = false; }
  g.radio(`${u.name} now leads ${s.name}.`, "radio");
  if (order) handOver(g, s, u, order);
}

// ---------------------------------------------------------------- orders
/** the squad stops where it is and forms up (hold: every soldier stays exactly where he stands) */
export function halt(g: Game, s: Squad, hold = false, keepCentre = false) {
  const att = attached(g, s);
  if (!att.length) return;
  const L = acting(g, s, att);
  if (!hold && !s.defendAt && !keepCentre) {
    if (!s.halted && L) {
      // keep the formation where it is: the centre is wherever the leader's slot puts it
      const c = Math.cos(s.facing), sn = Math.sin(s.facing), ls = s.leaderSlot;
      s.cx = L.x - (ls.f * c - ls.s * sn); s.cy = L.y - (ls.f * sn + ls.s * c);
    } else if (s.halted) {
      let x = 0, y = 0;
      for (const u of att) { x += u.x; y += u.y; }
      s.cx = x / att.length; s.cy = y / att.length;
    }
  }
  s.halted = true; s.hold = hold; s.order = null; s.route = null; s.routeGoal = null; s.assault = 0;
  for (const u of att) {
    u.order = { kind: "formation" }; u.queue = []; u.path = null; u.squadHalt = false; u.speedCap = Infinity;
    if (hold) { u.slotX = u.x; u.slotY = u.y; u.slotFace = u.heading; }
    g.paths.cancel(u);
  }
  s.trail = [];
  s.dirty = true;
}
function acting(g: Game, s: Squad, att: Unit[]): Unit | null {
  const D = g.get(s.leader) as Unit | null, cur = g.get(s.acting) as Unit | null;
  const curOk = !!cur && att.includes(cur) && cur.infectedAt < 0;
  if (D && att.includes(D)) {
    // a leader rejoining a squad on the move falls in behind the stand-in and takes over once he has
    // caught up and stayed with the squad for a few seconds (no flip-flopping of command)
    const settled = g.time - (s.joined.get(D.id) ?? -99) > 3;
    if (s.halted || !curOk || cur === D || (settled && dist(D.x, D.y, cur!.x, cur!.y) < 6)) return D;
    return cur;
  }
  if (curOk) return cur; // keep the same stand-in while the leader is away
  return best(att.filter((u) => u.infectedAt < 0)) || best(att);
}
function handOver(g: Game, s: Squad, L: Unit, o: Order) {
  s.acting = L.id;
  L.order = { ...o }; L.queue = []; L.path = null;
  g.paths.cancel(L);
  L.stuckT = 0; L.stuckN = 0; L.lastX = L.x; L.lastY = L.y;
  const dest = o.x !== undefined ? [o.x, o.y!] : null;
  if (s.route && s.routeGoal && s.routeIdx < s.route.length) {
    // carry on along the route the squad was already following (no stop to re-plan)
    L.path = s.route.slice(); L.pathIdx = s.routeIdx; L.pathGoal = [s.routeGoal[0], s.routeGoal[1]];
  } else if (dest) { L.pathGoal = [dest[0], dest[1]]; g.paths.request(L, dest[0], dest[1]); }
  else if (o.target != null) { const t = g.get(o.target); if (t) { L.pathGoal = [t.x, t.y]; g.paths.request(L, t.x, t.y); } }
  L.focus = o.kind === "attack" ? (o.target ?? null) : null;
  L.speedCap = Infinity;
}

/**
 * squad orders for whole squads. `give` starts a unit order (UnitAI's), so the leader uses the same
 * order code as any soldier. Several squads ordered to one point are placed side by side.
 */
export function squadOrders(g: Game, squads: Squad[], o: Order, opts: { queue?: boolean; formation?: string }, give: (u: Unit, o: Order, queue?: boolean) => void) {
  const travel = o.kind === "move" || o.kind === "attackMove" || o.kind === "retreat" || o.kind === "patrol";
  // lateral offsets for several squads going to one point
  let gx = 0, gy = 0;
  for (const s of squads) { const L = g.get(s.acting) || g.get(s.leader); if (L) { gx += L.x; gy += L.y; } }
  gx /= squads.length; gy /= squads.length;
  const a = travel ? Math.atan2(o.y! - gy, o.x! - gx) : 0, px = -Math.sin(a), py = Math.cos(a);
  const sorted = squads.slice().sort((p, q) => { const P = g.get(p.acting) || g.get(p.leader), Q = g.get(q.acting) || g.get(q.leader); return ((P?.x || 0) - gx) * px + ((P?.y || 0) - gy) * py - (((Q?.x || 0) - gx) * px + ((Q?.y || 0) - gy) * py); });
  sorted.forEach((s, k) => {
    if (isFormation(opts.formation)) { if (s.formation !== opts.formation) s.dirty = true; s.formation = opts.formation; }
    for (const u of liveMembers(g, s)) { if (u.inVehicle === null) { u.detached = false; u.task = false; } }
    const att = attached(g, s);
    if (!att.length) return;
    s.broken = 0; s.overT = 0;
    if (o.kind === "hold") { s.defendAt = null; s.faceLock = null; halt(g, s, true); return; }
    if (o.kind === "defend") {
      let x = 0, y = 0;
      for (const u of att) { x += u.x; y += u.y; }
      const p: [number, number] = o.x !== undefined ? [o.x, o.y!] : [x / att.length, y / att.length];
      s.defendAt = p; s.cx = p[0]; s.cy = p[1];
      if (!OMNI.has(s.formation)) s.formation = "defensive";
      s.faceLock = null;
      s.halted = true; halt(g, s); return;
    }
    s.defendAt = null; s.hold = false; s.assault = 0;
    const L = acting(g, s, att)!;
    // assaulting a fixed target (a nest, a structure): soldiers spread to firing positions round it,
    // still as one squad, and form up on the leader again once it is destroyed
    const tgt = o.kind === "attack" ? g.get(o.target) : null;
    if (tgt && (tgt instanceof Nest || tgt instanceof Obstacle)) {
      s.assault = tgt.id; s.halted = false; s.order = { ...o }; s.acting = L.id; s.route = null; s.routeGoal = null;
      for (const u of att) { u.focus = tgt.id; give(u, { ...o }, false); u.speedCap = Infinity; u.squadHalt = false; }
      s.dirty = true;
      return;
    }
    const off = travel && sorted.length > 1 ? (k - (sorted.length - 1) / 2) * (width(s, att.length) + 5) : 0;
    const oo: Order = { ...o };
    if (travel) {
      let tx = o.x! + px * off, ty = o.y! + py * off;
      const q = off ? g.bf.freeNear(tx, ty, 8, false) : null;
      if (q) { tx = q[0]; ty = q[1]; }
      oo.x = tx; oo.y = ty;
      if (o.kind === "patrol") { oo.ax = L.x; oo.ay = L.y; oo.bx = tx; oo.by = ty; oo.leg = 1; }
    }
    if (opts.queue && !s.halted && s.order) { L.queue.push(oo); return; }
    if (s.halted) {
      // set off from the halted formation: keep the facing, the leader's slot becomes the reference
      s.trail = [];
    }
    s.halted = false; s.hold = false; s.order = oo; s.acting = L.id; s.route = null; s.routeGoal = null;
    if (travel) s.faceLock = null;
    for (const u of att) {
      if (u === L) continue;
      u.order = { kind: "formation" }; u.queue = []; u.path = null; g.paths.cancel(u);
      u.focus = o.kind === "attack" ? (o.target ?? null) : null;
    }
    give(L, oo, false);
    s.dirty = true;
  });
}
/** regroup: detached members rejoin, the squad forms up around its leader */
export function regroup(g: Game, s: Squad, quiet = false) {
  for (const u of liveMembers(g, s)) if (u.inVehicle === null) { u.detached = false; u.task = false; }
  s.broken = 0; s.overT = 0; s.defendAt = null; s.hold = false; s.assault = 0;
  const att = attached(g, s);
  const L = acting(g, s, att);
  if (!L) return;
  s.acting = L.id;
  const c = Math.cos(s.facing), sn = Math.sin(s.facing);
  s.halted = true;
  s.dirty = true;
  assign(g, s, att, L);
  const ls = s.leaderSlot;
  s.cx = L.x - (ls.f * c - ls.s * sn); s.cy = L.y - (ls.f * sn + ls.s * c);
  halt(g, s, false, true);
  if (!quiet) g.radio(`${s.name}, regroup on ${L.name}.`, "radio");
}
export function setFormation(g: Game, s: Squad, f: FormationKind) {
  if (s.formation === f) return;
  s.formation = f; s.dirty = true;
  if (f === "defensive" && s.halted && !s.defendAt) {
    const att = attached(g, s);
    let x = 0, y = 0; for (const u of att) { x += u.x; y += u.y; }
    if (att.length) { s.defendAt = [x / att.length, y / att.length]; s.cx = s.defendAt[0]; s.cy = s.defendAt[1]; }
  }
  if (f !== "defensive") s.defendAt = null;
  if (s.hold) { s.hold = false; halt(g, s); }
}
export function faceTo(g: Game, s: Squad, x: number, y: number) {
  const L = g.get(s.acting) || g.get(s.leader);
  const ox = s.halted ? s.cx : L ? L.x : s.cx, oy = s.halted ? s.cy : L ? L.y : s.cy;
  s.faceLock = Math.atan2(y - oy, x - ox);
  if (s.hold) { s.hold = false; halt(g, s); }
}

// ---------------------------------------------------------------- formation shapes
function width(s: Squad, n: number) {
  if (s.formation === "line") return n * 3;
  if (s.formation === "column") return 2;
  if (s.formation === "wedge") return Math.ceil((n - 1) / 2) * 4.8 + 1;
  return Math.max(5, (n * 2.6) / Math.PI);
}
/** slots around the centre (local frame, facing +f). Returns the slots, the leader's slot index and centre slots for medics/engineers. */
function shape(g: Game, s: Squad, n: number, support: number): { slots: Slot[]; lead: number; centre: number[] } {
  const out: Slot[] = [];
  const centre: number[] = [];
  switch (s.formation) {
    case "line": {
      for (let k = 0; k < n; k++) out.push({ f: 0, s: ((n - 1) / 2 - k) * 3.0, face: NaN });
      return { slots: out, lead: Math.floor(n / 2), centre };
    }
    case "column": {
      for (let k = 0; k < n; k++) out.push({ f: ((n - 1) / 2 - k) * 2.6, s: k === 0 ? 0 : (k % 2 ? 0.55 : -0.55), face: NaN });
      return { slots: out, lead: 0, centre };
    }
    case "wedge": {
      const rows = Math.ceil((n - 1) / 2);
      for (let k = 0; k < n; k++) {
        const row = Math.ceil(k / 2);
        out.push({ f: (rows / 2 - row) * 2.4, s: k === 0 ? 0 : (k % 2 ? 1 : -1) * row * 2.4, face: NaN });
      }
      return { slots: out, lead: 0, centre };
    }
    case "box": {
      const nc = n >= 6 ? Math.min(2, support) : 0, P = n - nc;
      const h = Math.max(3.0, (P * 3.0) / 8), L = 8 * h;
      for (let k = 0; k < P; k++) {
        let t = ((k / P) * L + 0) % L; // start front-centre, go round to the left
        let f: number, sd: number, face: number;
        if (t < h) { f = h; sd = t; face = 0; }
        else if ((t -= h) < 2 * h) { f = h - t; sd = h; face = Math.PI / 2; }
        else if ((t -= 2 * h) < 2 * h) { f = -h; sd = h - t; face = Math.PI; }
        else if ((t -= 2 * h) < 2 * h) { f = -h + t; sd = -h; face = -Math.PI / 2; }
        else { t -= 2 * h; f = h; sd = -h + t; face = 0; }
        if (Math.abs(Math.abs(f) - h) < 0.4 && Math.abs(Math.abs(sd) - h) < 0.4) face = Math.atan2(sd, f); // corners look diagonally out
        out.push({ f, s: sd, face });
      }
      for (let k = 0; k < nc; k++) { centre.push(out.length); out.push({ f: 0, s: k ? -1.2 : 1.2, face: k ? Math.PI : 0 }); }
      return { slots: out, lead: 0, centre };
    }
    case "circle": {
      const nc = n >= 6 ? Math.min(2, support) : 0, P = n - nc;
      const R = Math.max(3.4, (P * 3.0) / (2 * Math.PI));
      for (let k = 0; k < P; k++) { const a = (2 * Math.PI * k) / P; out.push({ f: Math.cos(a) * R, s: Math.sin(a) * R, face: a }); }
      for (let k = 0; k < nc; k++) { centre.push(out.length); out.push({ f: 0, s: k ? -1.2 : 1.2, face: k ? Math.PI : 0 }); }
      return { slots: out, lead: 0, centre };
    }
    case "defensive": {
      // a wider ring around the defended point, firing positions behind defences first
      const R = Math.max(5, (n * 3.4) / (2 * Math.PI));
      const c = Math.cos(s.facing), sn = Math.sin(s.facing);
      const toLocal = (x: number, y: number): [number, number] => { const dx = x - s.cx, dy = y - s.cy; return [dx * c + dy * sn, -dx * sn + dy * c]; };
      const cover: Slot[] = [];
      for (const o of s.halted && s.defendAt ? g.obstacles : []) {
        if (o.dead || o.built < 1 || !COVER_KINDS.has(o.kind) || dist(o.x, o.y, s.cx, s.cy) > 16) continue;
        const spots: [number, number][] = [];
        if (o.kind === "mg_emplacement" || o.kind === "bunker" || o.kind === "watchtower") spots.push([o.x, o.y]);
        else {
          // stand on the defended side of the wall, one soldier per ~2 m of wall
          const [, v] = o.local(s.cx, s.cy), side = v >= 0 ? 1 : -1;
          const nx = -Math.sin(o.rot) * side, ny = Math.cos(o.rot) * side, ux = Math.cos(o.rot), uy = Math.sin(o.rot);
          const k = Math.max(1, Math.min(3, Math.floor(o.w / 1.8)));
          for (let i = 0; i < k; i++) { const u = (i - (k - 1) / 2) * (o.w / k); spots.push([o.x + ux * u + nx * (o.d / 2 + 0.7), o.y + uy * u + ny * (o.d / 2 + 0.7)]); }
        }
        for (const [x, y] of spots) {
          if (cover.length >= n) break;
          const [f, sd] = toLocal(x, y);
          cover.push({ f, s: sd, face: Math.atan2(sd, f) });
        }
      }
      const P = n - cover.length;
      // spread the open positions round the gaps between covered bearings
      const taken = cover.map((q) => Math.atan2(q.s, q.f));
      for (let k = 0; k < P; k++) {
        let bestA = (2 * Math.PI * k) / Math.max(1, P), bestGap = -1;
        for (let j = 0; j < 36; j++) {
          const a = (j / 36) * 2 * Math.PI;
          let gap = Math.PI;
          for (const t of taken) gap = Math.min(gap, Math.abs(Math.atan2(Math.sin(a - t), Math.cos(a - t))));
          if (gap > bestGap + 1e-6) { bestGap = gap; bestA = a; }
        }
        taken.push(bestA);
        out.push({ f: Math.cos(bestA) * R, s: Math.sin(bestA) * R, face: bestA });
      }
      out.push(...cover);
      // the leader takes the open position nearest the front
      let lead = 0, bf = -Infinity;
      out.forEach((q, i) => { if (q.f > bf) { bf = q.f; lead = i; } });
      return { slots: out, lead, centre };
    }
  }
}
/** assign members to slots: leader to the leader slot, medics/engineers to centre slots, the rest greedily by distance */
function assign(g: Game, s: Squad, att: Unit[], L: Unit) {
  const support = att.filter((u) => u !== L && SUPPORT.has(u.type));
  const sh = shape(g, s, att.length, support.length);
  s.slots.clear();
  const free = new Set(sh.slots.map((_, i) => i));
  s.slots.set(L.id, sh.slots[sh.lead]); free.delete(sh.lead);
  s.leaderSlot = sh.slots[sh.lead];
  const rest = att.filter((u) => u !== L);
  const left: Unit[] = [];
  for (const u of rest) {
    if (SUPPORT.has(u.type) && sh.centre.length) { const i = sh.centre.shift()!; s.slots.set(u.id, sh.slots[i]); free.delete(i); }
    else left.push(u);
  }
  for (const i of sh.centre) free.delete(i);
  // greedy nearest pairs in world space (stable: a soldier keeps roughly the same place when the shape changes)
  const pairs: [number, Unit, number][] = [];
  for (const u of left) for (const i of free) { const [x, y] = world(s, L, sh.slots[i]); pairs.push([dist(u.x, u.y, x, y), u, i]); }
  pairs.sort((a, b) => a[0] - b[0]);
  const done = new Set<Unit>();
  for (const [, u, i] of pairs) { if (done.has(u) || !free.has(i)) continue; s.slots.set(u.id, sh.slots[i]); free.delete(i); done.add(u); }
  for (const u of left) if (!done.has(u)) s.slots.set(u.id, { f: -2, s: 0, face: NaN });
  s.dirty = false;
}
/** world position of a slot */
function world(s: Squad, L: Unit, sl: Slot): [number, number] {
  const c = Math.cos(s.facing), sn = Math.sin(s.facing);
  let df = sl.f, ds = sl.s, ox = s.cx, oy = s.cy;
  if (!s.halted) { df -= s.leaderSlot.f; ds -= s.leaderSlot.s; ox = L.x; oy = L.y; }
  return [ox + df * c - ds * sn, oy + df * sn + ds * c];
}
/** a point on the leader's trail `d` metres behind it */
function trailAt(s: Squad, L: Unit, d: number): [number, number] {
  let px = L.x, py = L.y, acc = 0;
  for (let i = 0; i < s.trail.length; i += 2) {
    const x = s.trail[i], y = s.trail[i + 1], seg = dist(px, py, x, y);
    if (acc + seg >= d) { const t = (d - acc) / Math.max(1e-6, seg); return [px + (x - px) * t, py + (y - py) * t]; }
    acc += seg; px = x; py = y;
  }
  return [px, py];
}

// ---------------------------------------------------------------- per-step update
export function updateSquads(g: Game, dt: number) {
  // every soldier belongs to a squad (new arrivals included)
  if (Math.floor(g.time / 2) !== Math.floor((g.time - dt) / 2)) ensureSquads(g);
  for (const s of g.squads) updateSquad(g, s, dt);
  if (g.squads.some((s) => !s.members.length)) g.squads = g.squads.filter((s) => s.members.length > 0);
}

function updateSquad(g: Game, s: Squad, dt: number) {
  // ---- membership and command
  const n0 = s.members.length;
  s.members = s.members.filter((id) => { const u = g.get(id); return u && u.alive && u.squad === s.id; });
  if (s.members.length < n0) { s.dirty = true; for (let k = s.members.length; k < n0; k++) s.losses.push(g.time); }
  if (!s.members.length) return;
  const D = g.get(s.leader) as Unit | null;
  if (!D || !D.alive || D.squad !== s.id || D.infectedAt >= 0) {
    const all = liveMembers(g, s);
    const nl = best(all.filter((u) => u.infectedAt < 0)) || best(all);
    if (nl && nl.id !== s.leader) {
      const why = D && D.alive && D.infectedAt >= 0 ? ` — ${D.name} is infected` : "";
      s.leader = nl.id; s.dirty = true;
      g.radio(`${nl.name} takes command of ${s.name}${why}.`, "warn");
      g.onEvent("command", { squad: s, leader: nl });
    }
  }
  const att = attached(g, s);
  for (const id of [...s.joined.keys()]) if (!att.some((u) => u.id === id)) s.joined.delete(id);
  for (const u of att) if (!s.joined.has(u.id)) s.joined.set(u.id, g.time);
  if (!att.length) return;
  const L = acting(g, s, att)!;
  if (L.id !== s.acting) {
    const prev = g.get(s.acting) as Unit | null;
    s.acting = L.id; s.dirty = true;
    if (prev && prev.alive && prev.squad === s.id && !prev.detached) { prev.order = { kind: "formation" }; prev.path = null; prev.speedCap = Infinity; prev.squadHalt = false; g.paths.cancel(prev); }
    // the new leader carries on with the squad's order, along the same route
    if (!s.halted && s.order) handOver(g, s, L, s.order);
    else if (L.order.kind !== "formation") L.order = { kind: "formation" };
  }
  // ---- assault on a fixed target: everyone fights on his own until it is destroyed
  if (s.assault) {
    const t = g.get(s.assault);
    if (t && !t.dead && att.some((u) => u.order.kind === "attack")) { for (const u of att) u.speedCap = Infinity; s.scanT -= dt; if (s.scanT <= 0) { s.scanT = 0.33; scan(g, s, att, L); } return; }
    s.assault = 0; s.halted = true;
    regroup(g, s, true);
    return;
  }
  for (const u of att) if (u !== L && u.order.kind !== "formation" && !(s.broken > 0)) { u.order = { kind: "formation" }; u.path = null; u.queue = []; }

  // ---- threats (about three times a second)
  s.scanT -= dt;
  if (s.scanT <= 0) { s.scanT = 0.33; scan(g, s, att, L); }
  if (s.broken > 0) {
    s.broken -= dt;
    if (s.broken <= 0) {
      if (s.closeN < Math.max(2, att.length * 0.5)) { regroup(g, s, true); g.radio(`${s.name} regrouping on ${L.name}.`, "radio"); g.onEvent("regroup", s); }
      else s.broken = 2;
    }
    return;
  }
  // ---- the leader's order decides whether the squad travels
  if (!s.halted && (L.order.kind === "idle" || L.order.kind === "formation" || L.order.kind === "hold" || L.order.kind === "defend")) halt(g, s);
  if (!s.halted && L.path && L.pathGoal) { s.route = L.path; s.routeIdx = L.pathIdx; s.routeGoal = L.pathGoal; }
  if (!s.halted && s.trail.length === 0) s.trail.push(L.x, L.y);
  if (!s.halted && dist(L.x, L.y, s.trail[0], s.trail[1]) > 0.7) { s.trail.unshift(L.x, L.y); if (s.trail.length > 160) s.trail.length = 160; }

  // ---- facing: travel direction on the move, the threat once halted
  const directional = !OMNI.has(s.formation);
  if (!s.halted) {
    if (L.moving) s.want = L.heading;
    else if (s.threatN > 0 && directional) s.want = s.threatA;
  } else if (s.faceLock !== null) s.want = s.faceLock;
  else if (s.threatN > 0 && directional && Math.abs(angDiff(s.want, s.threatA)) > 0.6) s.want = s.threatA;
  if (!s.halted || directional || s.faceLock !== null) {
    const d = angDiff(s.facing, s.want);
    s.facing += clamp(d, -TURN_RATE * dt, TURN_RATE * dt);
  }
  if (s.dirty) assign(g, s, att, L);

  // ---- attack-move: the squad stops while it fights
  L.squadHalt = !s.halted && (L.order.kind === "attackMove" || L.order.kind === "patrol") && s.engagedN > 0;

  // ---- slots
  let lag = 0, nl = 0, minSp = Infinity;
  const ranked = att.filter((u) => u !== L || s.halted).sort((a, b) => (s.slots.get(b.id)?.f ?? 0) - (s.slots.get(a.id)?.f ?? 0));
  ranked.forEach((u, rank) => {
    minSp = Math.min(minSp, u.def.speed);
    let sl = s.slots.get(u.id);
    if (!sl) { s.dirty = true; return; }
    if (s.hold) return; // hold: every soldier keeps the spot where the order found him
    const [rx, ry] = world(s, L, sl);
    const face = isNaN(sl.face) ? s.facing : s.facing + sl.face;
    // re-validate the slot when it has moved, or twice a second
    if (!(Math.abs(rx - u.rawX) < 0.6 && Math.abs(ry - u.rawY) < 0.6 && g.time - u.slotT < 0.5)) {
      u.rawX = rx; u.rawY = ry; u.slotT = g.time;
      const ox = s.halted ? s.cx : L.x, oy = s.halted ? s.cy : L.y;
      let p: [number, number] | null = null;
      if (g.bf.walkable(rx, ry) && g.bf.phys.clearLine(ox, oy, rx, ry, "human", 0.2)) p = [rx, ry];
      else if (!s.halted) p = trailAt(s, L, (rank + 1) * 2.1);   // narrow street: fall in behind the leader
      else {
        for (const t of [0.7, 0.45, 0.2]) {
          const x = ox + (rx - ox) * t, y = oy + (ry - oy) * t;
          if (g.bf.walkable(x, y) && g.bf.phys.clearLine(ox, oy, x, y, "human", 0.2)) { p = [x, y]; break; }
        }
        if (!p) p = g.bf.freeNear(ox + (rx - ox) * 0.3, oy + (ry - oy) * 0.3, 4, false) || [ox, oy];
      }
      u.slotX = p[0]; u.slotY = p[1];
    }
    u.slotFace = face;
    if (u !== L) { lag += dist(u.x, u.y, u.slotX, u.slotY); nl++; }
  });
  // ---- the leader sets the pace and waits for stragglers
  if (!s.halted) {
    minSp = Math.min(minSp, L.def.speed);
    s.lag = nl ? lag / nl : 0;
    // the slowest soldier's pace; a little slower in contact so the formation holds together
    let cap = minSp * (s.threatN > 0 ? 0.9 : 1.0) * (L.order.kind === "retreat" ? 1.15 : 1);
    if (s.lag > 9 && s.waitT < 6) { s.waitT += dt; cap = 0.3; }
    else if (s.lag > 5) cap *= 0.6;
    else if (s.lag < 3) s.waitT = 0;
    L.speedCap = cap;
  } else L.speedCap = Infinity;
}

function scan(g: Game, s: Squad, att: Unit[], L: Unit) {
  const ox = s.halted ? s.cx : L.x, oy = s.halted ? s.cy : L.y;
  let n = 0, sx = 0, sy = 0, quads = 0;
  g.zHash.query(ox, oy, 36, (z: Zombie, d: number) => {
    if (z.dead || !z.awake) return;
    if (!(z.state === "chase" || z.state === "attack") && d > 14) return;
    n++;
    const w = 1 / Math.max(3, d);
    sx += ((z.x - ox) / Math.max(0.1, d)) * w; sy += ((z.y - oy) / Math.max(0.1, d)) * w;
    if (d < 18) { const a = angDiff(s.facing, Math.atan2(z.y - oy, z.x - ox)); quads |= 1 << (Math.floor(((a + Math.PI) / (2 * Math.PI)) * 4) & 3); }
  });
  s.threatN = n; s.quads = quads;
  if (n) s.threatA = Math.atan2(sy, sx);
  let close = 0, eng = 0;
  for (const u of att) {
    g.zHash.query(u.x, u.y, 3.2, (z: Zombie) => { if (!z.dead) close++; });
    const t = g.get(u.target);
    if (t && !t.dead && u.losOk && dist(u.x, u.y, t.x, t.y) < 30 && (t instanceof Zombie ? t.state === "chase" || t.state === "attack" || dist(u.x, u.y, t.x, t.y) < 18 : true)) eng++;
  }
  s.closeN = close; s.engagedN = eng;
  // ---- surrounded: suggest an all-round formation
  const sides = (quads & 1) + ((quads >> 1) & 1) + ((quads >> 2) & 1) + ((quads >> 3) & 1);
  if (sides >= 3 && !OMNI.has(s.formation) && g.time - s.hintT > 40) { s.hintT = g.time; g.radio(`${s.name} is being surrounded — switch to Circle or Box (K).`, "warn"); g.onEvent("surrounded", s); }
  // ---- overwhelmed: the formation breaks
  if (s.broken > 0) return;
  const M = att.length;
  s.overT = close >= Math.max(4, M * 1.5) ? s.overT + 0.33 : Math.max(0, s.overT - 0.33);
  s.losses = s.losses.filter((t) => g.time - t < 15);
  const heavy = s.losses.length >= Math.max(2, Math.ceil((M + s.losses.length) * 0.4)) && close >= 2;
  if (M >= 2 && (s.overT > 2.5 || heavy)) breakFormation(g, s, att);
}
function breakFormation(g: Game, s: Squad, att: Unit[]) {
  s.broken = 8; s.overT = 0; s.losses = [];
  g.radio(`${s.name}'s formation is breaking — soldiers falling back!`, "bad");
  g.onEvent("broken", s);
  for (const u of att) {
    // fall back away from the infected around this soldier
    let x = 0, y = 0, n = 0;
    g.zHash.query(u.x, u.y, 10, (z: Zombie) => { if (!z.dead) { x += z.x; y += z.y; n++; } });
    let ax: number, ay: number;
    if (n) { const dx = u.x - x / n, dy = u.y - y / n, l = Math.hypot(dx, dy) || 1; ax = dx / l; ay = dy / l; }
    else { ax = -Math.cos(s.facing); ay = -Math.sin(s.facing); }
    const q = g.bf.freeNear(u.x + ax * 11, u.y + ay * 11, 6, false) || [u.x, u.y];
    // a fighting withdrawal: a move order, so riflemen keep shooting as they fall back
    u.order = { kind: "move", x: q[0], y: q[1] }; u.queue = []; u.squadHalt = false; u.speedCap = Infinity;
    u.path = null; u.pathGoal = [q[0], q[1]]; g.paths.request(u, q[0], q[1]);
  }
  s.halted = true; s.order = null;
}

export const angDiff = (a: number, b: number) => Math.atan2(Math.sin(b - a), Math.cos(b - a));

// ---------------------------------------------------------------- save / load
export function serializeSquads(g: Game) {
  const r2 = (v: number) => Math.round(v * 100) / 100;
  return g.squads.map((s) => ({ n: s.name, m: s.members, l: s.leader, f: s.formation, fa: r2(s.facing), cx: r2(s.cx), cy: r2(s.cy), fl: s.faceLock, d: s.defendAt, h: s.hold ? 1 : 0 }));
}
export function restoreSquads(g: Game, data: any[] | undefined, idMap: Map<number, Unit>) {
  for (const q of data || []) {
    const us = (q.m as number[]).map((id) => idMap.get(id)).filter((u): u is Unit => !!u && !u.vehicle);
    if (!us.length) continue;
    const s = createSquad(g, us, q.n, isFormation(q.f) ? q.f : "wedge");
    if (!s) continue;
    const L = idMap.get(q.l);
    if (L && us.includes(L)) s.leader = s.acting = L.id;
    s.facing = s.want = q.fa || 0; s.faceLock = q.fl ?? null;
    s.cx = q.cx; s.cy = q.cy; s.defendAt = q.d || null; s.dirty = true;
    for (const u of us) if (u.inVehicle !== null) u.detached = true;
    halt(g, s, !!q.h, true);
  }
  ensureSquads(g, 1e9);
}

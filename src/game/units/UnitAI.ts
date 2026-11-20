// Player units: orders, movement along paths with local avoidance, target acquisition, firing,
// reloading, medics, engineers, vehicles (crushing, passengers, repair, cargo resupply).
import type { Game } from "../Game";
import { Unit, Zombie, Obstacle, Crate, Civilian, Nest, Order, Formation } from "../entities";
import { dist, clamp } from "../core";
import { fire } from "../combat/Combat";
import { STRUCTURES } from "../data";
import { Squad, squadOf, liveMembers, squadOrders, SQUAD_ORDERS, angDiff } from "./Squads";

const TURN = 7;
/** orders that pull one soldier out of his squad until the job is done */
const TASK_ORDERS = new Set(["interact", "build", "clear"]);

/**
 * Give an order to a selection. Squads that are selected whole take it as a squad (formation
 * movement, see Squads.ts). Soldiers picked out of a squad act on their own (detached) until the
 * squad is ordered as a whole again or regroups.
 */
export function issue(g: Game, units: Unit[], o: Order, opts: { queue?: boolean; formation?: Formation | string } = {}) {
  const sel = units.filter((u) => u.alive && u.inVehicle === null);
  if (!sel.length) return;
  const live: Unit[] = [];
  const whole: Squad[] = [];
  if (SQUAD_ORDERS.has(o.kind)) {
    const by = new Map<Squad, Unit[]>();
    for (const u of sel) {
      const sq = u.vehicle ? null : squadOf(g, u);
      if (!sq) { live.push(u); continue; }
      let a = by.get(sq); if (!a) by.set(sq, (a = [])); a.push(u);
    }
    for (const [sq, us] of by) {
      const all = liveMembers(g, sq).filter((m) => m.inVehicle === null);
      if (all.every((m) => us.includes(m))) whole.push(sq);
      else for (const u of us) { u.detached = true; u.task = false; u.speedCap = Infinity; u.squadHalt = false; live.push(u); }
    }
  } else {
    for (const u of sel) { if (!u.vehicle && u.squad) { u.detached = true; u.task = TASK_ORDERS.has(o.kind); u.speedCap = Infinity; u.squadHalt = false; } live.push(u); }
  }
  if (whole.length) squadOrders(g, whole, o, opts, (u, oo, q) => give(g, u, oo, q));
  if (!live.length) return;
  if (o.kind === "move" || o.kind === "attackMove" || o.kind === "retreat" || o.kind === "patrol") {
    const slots = formationSlots(g, live, o.x!, o.y!, (opts.formation as Formation) || "spread");
    live.forEach((u, k) => {
      const [sx, sy] = slots[k];
      const oo: Order = { ...o, x: sx, y: sy };
      if (o.kind === "patrol") { oo.ax = u.x; oo.ay = u.y; oo.bx = sx; oo.by = sy; oo.leg = 1; }
      give(g, u, oo, opts.queue);
    });
    return;
  }
  for (const u of live) give(g, u, { ...o }, opts.queue);
}

function give(g: Game, u: Unit, o: Order, queue?: boolean) {
  if (queue && u.order.kind !== "idle" && u.order.kind !== "hold") { u.queue.push(o); return; }
  u.queue = [];
  start(g, u, o);
}
function start(g: Game, u: Unit, o: Order) {
  u.order = o;
  u.path = null; u.pathGoal = null; u.stuckT = 0;
  if (o.kind !== "attack") u.focus = null;
  if (o.kind === "attack") u.focus = o.target ?? null;
  if (o.kind === "defend") u.defendAt = o.x !== undefined ? [o.x, o.y!] : [u.x, u.y];
  if (o.kind === "hold" || o.kind === "idle" || o.kind === "defend") { g.paths.cancel(u); return; }
  const dest = destOf(g, u, o);
  if (dest) goTo(g, u, dest[0], dest[1]);
}
function destOf(g: Game, u: Unit, o: Order): [number, number] | null {
  if (o.x !== undefined && o.y !== undefined && (o.kind === "move" || o.kind === "attackMove" || o.kind === "retreat" || o.kind === "patrol" || o.kind === "build")) return [o.x, o.y];
  const t = g.get(o.target);
  if (t) return [t.x, t.y];
  return null;
}
function goTo(g: Game, u: Unit, x: number, y: number) {
  u.pathGoal = [x, y];
  g.paths.request(u, x, y);
}

/** formation slots around a target, facing the direction of travel */
export function formationSlots(g: Game, units: Unit[], x: number, y: number, f: Formation): [number, number][] {
  const n = units.length;
  if (n === 1) return [[x, y]];
  let cx = 0, cy = 0;
  for (const u of units) { cx += u.x; cy += u.y; }
  cx /= n; cy /= n;
  const a = Math.atan2(y - cy, x - cx), fx = Math.cos(a), fy = Math.sin(a), rx = fy, ry = -fx;
  const sp = units.some((u) => u.vehicle) ? 7 : f === "spread" ? 3.4 : 2.4;
  const out: [number, number][] = [];
  // vehicles first, infantry around them
  const order = units.map((u, k) => k).sort((p, q) => Number(units[q].vehicle) - Number(units[p].vehicle));
  const res: [number, number][] = new Array(n);
  for (let k = 0; k < n; k++) {
    let side = 0, back = 0;
    if (f === "line") { side = (k - (n - 1) / 2) * sp; }
    else if (f === "column") { back = k * sp; side = (k % 2 ? 0.6 : -0.6); }
    else if (f === "wedge") { const row = Math.ceil(k / 2); side = (k === 0 ? 0 : (k % 2 ? 1 : -1) * row * sp * 0.8); back = row * sp * 0.8; }
    else { const cols = Math.ceil(Math.sqrt(n)); side = ((k % cols) - (cols - 1) / 2) * sp; back = Math.floor(k / cols) * sp; }
    let px = x + rx * side - fx * back, py = y + ry * side - fy * back;
    const p = g.bf.freeNear(px, py, 6, false);
    if (p) { px = p[0]; py = p[1]; } else { px = x; py = y; }
    out.push([px, py]);
  }
  order.forEach((ui, k) => { res[ui] = out[k]; });
  return res;
}

export function updateUnits(g: Game, dt: number) {
  g.targeted.clear();
  for (const u of g.units) if (u.alive && u.target != null) g.targeted.set(u.target, (g.targeted.get(u.target) || 0) + 1);
  for (const u of g.units) {
    if (!u.alive) continue;
    if (u.inVehicle !== null) {
      const v = g.get(u.inVehicle);
      if (!v || v.dead) { u.inVehicle = null; continue; }
      u.x = v.x; u.y = v.y; u.z = v.z;
      continue;
    }
    updateUnit(g, u, dt);
  }
}

function canFireWhileMoving(u: Unit) { return !u.wid || !["sniper", "rocket", "lmg"].includes(u.wid) || u.vehicle; }

function updateUnit(g: Game, u: Unit, dt: number) {
  u.suppression = Math.max(0, u.suppression - dt * 0.22);
  u.cool = Math.max(-1, u.cool - dt); u.hitT = Math.max(0, u.hitT - dt); u.flashT = Math.max(0, u.flashT - dt);
  if (u.burn > 0) { u.burn -= dt; g.damage(u, 8 * dt, null, "fire"); if (!u.alive) return; }
  // a soldier pulled out for a job (crate, build, wreck) rejoins his squad when it is done
  if (u.detached && u.task && u.order.kind === "idle" && !u.vehicle) {
    const sq = squadOf(g, u);
    if (sq) { u.detached = false; u.task = false; u.order = { kind: "formation" }; sq.dirty = true; }
  }
  // reload (also a tactical reload in a lull, so magazines are full when the next wave comes)
  if (u.reloadT > 0) {
    u.reloadT -= dt;
    if (u.reloadT <= 0 && u.weapon) { const take = Math.min(u.weapon.mag - u.mag, u.reserve); u.mag += take; u.reserve -= take; }
  } else if (u.weapon && u.mag <= 0 && u.reserve > 0) {
    u.reloadT = u.weapon.reload * (u.vehicle ? 1 : 1 - u.rank * 0.05);
    g.onSound("reload", u.x, u.y, 0.5);
  } else if (u.weapon && !u.vehicle && u.target === null && u.mag < u.weapon.mag * 0.4 && u.reserve > 0 && u.weapon.mag > 1) {
    u.reloadT = u.weapon.reload * (1 - u.rank * 0.05);
  } else if (u.weapon && u.mag <= 0 && u.reserve <= 0 && Math.floor(g.time / 15) !== Math.floor((g.time - dt) / 15)) {
    g.radio(`${u.name}: out of ammo! Request an ammunition drop.`, "warn");
  }
  const o = u.order;
  // ---- orders that resolve on arrival
  if (o.kind === "follow") {
    const t = g.get(o.target);
    if (!t || t.dead) { u.order = { kind: "idle" }; }
    else if (dist(u.x, u.y, t.x, t.y) > 6 && (!u.path || !u.pathGoal || dist(u.pathGoal[0], u.pathGoal[1], t.x, t.y) > 4) && !u.pathPending) goTo(g, u, t.x, t.y);
    else if (dist(u.x, u.y, t.x, t.y) < 3.5) u.path = null;
  }
  if (o.kind === "attack") {
    const t = g.get(o.target);
    if (!t || t.dead) { nextOrder(g, u); }
    else {
      const inRange = u.weapon && dist(u.x, u.y, t.x, t.y) < u.weapon.range * 0.95 && u.losOk && u.target === t.id;
      if (inRange) { u.path = null; }
      else if (!u.pathPending && (!u.path || !u.pathGoal || dist(u.pathGoal[0], u.pathGoal[1], t.x, t.y) > 5)) goTo(g, u, t.x, t.y);
    }
  }
  if (o.kind === "interact" || o.kind === "board" || o.kind === "clear") interact(g, u, dt);
  if (o.kind === "build") build(g, u, dt);
  if (o.kind === "defend" && u.defendAt && !u.target && dist(u.x, u.y, u.defendAt[0], u.defendAt[1]) > 6 && !u.path && !u.pathPending) goTo(g, u, u.defendAt[0], u.defendAt[1]);
  // ---- targeting
  u.scanT -= dt;
  if (u.scanT <= 0) { u.scanT = 0.28 + Math.random() * 0.08; acquire(g, u); }
  const tgt = g.get(u.target);
  const hasAmmo = !!u.weapon && (u.mag > 0 || u.reserve > 0);
  const engaging = !!tgt && !tgt.dead && u.losOk && o.kind !== "retreat" && hasAmmo;
  // ---- movement
  // on an attack order, keep pushing to the target and shoot on the move; only the target itself or a close threat stops the unit
  const close = engaging && dist(u.x, u.y, tgt.x, tgt.y) < 8;
  const stopToFire = (engaging && (o.kind === "attackMove" || o.kind === "patrol" || !canFireWhileMoving(u) || (o.kind === "attack" && (tgt.id === u.focus || close)))) || u.squadHalt;
  let moved = false;
  if (o.kind === "formation") moved = formationMove(g, u, dt, engaging);
  else if (u.path && !stopToFire && o.kind !== "hold") moved = followPath(g, u, dt, o.kind === "retreat" ? 1.15 : 1);
  else u.speedNow = 0;
  if (!u.path && !u.pathPending && (o.kind === "move" || o.kind === "attackMove" || o.kind === "retreat")) nextOrder(g, u);
  if (!u.path && !u.pathPending && o.kind === "patrol") {
    o.leg = 1 - (o.leg || 0);
    const [px, py] = o.leg ? [o.bx!, o.by!] : [o.ax!, o.ay!];
    goTo(g, u, px, py);
  }
  u.moving = moved;
  // ---- face and fire
  if (engaging) {
    const want = Math.atan2(tgt.y - u.y, tgt.x - u.x);
    if (!moved || u.vehicle) u.heading = turn(u.heading, want, dt * TURN);
    if (!moved || canFireWhileMoving(u)) fire(g, u, tgt, moved);
  } else if (!moved && o.kind === "formation" && !isNaN(u.slotFace)) u.heading = turn(u.heading, u.slotFace, dt * 3);
  // ---- roles
  if (u.def.heal) medic(g, u, dt);
  if (u.vehicle) vehicle(g, u, dt);
  separate(g, u);
}

function nextOrder(g: Game, u: Unit) {
  const n = u.queue.shift();
  if (n) start(g, u, n); else { u.order = { kind: "idle" }; u.path = null; }
}
const turn = (a: number, b: number, k: number) => { let d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return a + clamp(d, -k, k); };

function acquire(g: Game, u: Unit) {
  u.losOk = false;
  if (!u.weapon) { u.target = null; return; }
  const range = Math.min(u.weapon.range, u.vehicle ? u.weapon.range : Math.max(u.def.sight, 20));
  // in a halted formation each soldier covers his own arc (the way his slot faces)
  const sq = u.order.kind === "formation" ? squadOf(g, u) : null;
  const sector = sq && sq.halted && !isNaN(u.slotFace) ? u.slotFace : NaN;
  const eye = u.z + (u.vehicle ? 2.4 : 1.5);
  const ph = g.bf.phys;
  const visible = (t: any) => {
    const tz = t.z + (t instanceof Zombie ? (t.def.lowProfile ? 0.35 : 1.2 * t.def.size) : 1.0);
    return ph.los(u.x, u.y, eye, t.x, t.y, tz);
  };
  // focus fire / attack order target first
  const f = g.get(u.focus);
  if (f && !f.dead) {
    const d = dist(u.x, u.y, f.x, f.y);
    if (d <= u.weapon.range && visible(f)) { u.target = f.id; u.losOk = true; return; }
    // focus target out of sight: keep moving to it, but defend against anything that closes in
  }
  // keep the current target while it stays valid
  const cur = g.get(u.target);
  if (cur && !cur.dead && cur instanceof Zombie && dist(u.x, u.y, cur.x, cur.y) <= range && visible(cur)) { u.losOk = true; return; }
  const cand: [number, Zombie][] = [];
  const scan = f && !f.dead && u.order.kind === "attack" ? Math.min(range, 18) : range;
  g.zHash.query(u.x, u.y, scan, (z, d) => {
    if (z.dead) return;
    let sc = d - (z.state === "chase" || z.state === "attack" ? 6 : 0) - (z.def.boss ? 8 : 0);
    // spread fire: infected others are already shooting at count for less (not up close)
    const n = g.targeted.get(z.id) || 0;
    if (n && d > 6 && !z.def.boss) sc += n * (z.hp < 120 ? 6 : 3);
    if (!isNaN(sector) && d > 7 && Math.abs(angDiff(sector, Math.atan2(z.y - u.y, z.x - u.x))) > 1.4) sc += 14;
    cand.push([sc, z]);
  });
  cand.sort((a, b) => a[0] - b[0]);
  for (let k = 0; k < Math.min(5, cand.length); k++) {
    const z = cand[k][1];
    if (visible(z)) { u.target = z.id; u.losOk = true; z.awake = true; return; }
  }
  // nests when no infected are in sight
  for (const n of g.nests) {
    if (n.dead) continue;
    if (dist(u.x, u.y, n.x, n.y) < u.weapon.range && ph.los(u.x, u.y, eye, n.x, n.y, n.z + 1.0)) { u.target = n.id; u.losOk = true; return; }
  }
  u.target = null;
}

function followPath(g: Game, u: Unit, dt: number, mult: number, want?: number): boolean {
  const p = u.path!;
  if (u.pathIdx >= p.length) { u.path = null; return false; }
  let [wx, wy] = p[u.pathIdx];
  let d = dist(u.x, u.y, wx, wy);
  const last = u.pathIdx === p.length - 1;
  const arrive = last ? 0.45 : u.vehicle ? 3.5 : 1.3;
  if (d < arrive) {
    u.pathIdx++;
    if (u.pathIdx >= p.length) { u.path = null; return false; }
    [wx, wy] = p[u.pathIdx]; d = dist(u.x, u.y, wx, wy);
  }
  const sup = 1 - u.suppression * 0.35;
  const inside = !u.vehicle && g.bf.map.buildingAt(u.x, u.y);
  let sp = u.def.speed * mult * sup * (inside ? 0.7 : 1);
  if (u.vehicle) {
    const onRoad = g.bf.roads.near(u.x, u.y, 8, 1).length > 0;
    sp *= onRoad ? 1 : 0.55;
  }
  // slow when wounded or burning
  if (!u.vehicle && u.hp < u.maxHp * 0.3) sp *= 0.75;
  if (!u.vehicle) {
    sp = Math.min(sp, u.speedCap);           // a squad leader keeps the squad's pace
    if (want !== undefined) sp = Math.min(sp, want);
    const ph = g.pileH(u.x, u.y);
    if (ph > 0.15) sp *= Math.max(0.55, 1 - ph * 0.35); // clambering over bodies
    if (last && d < 1.2) sp *= Math.max(0.4, d / 1.2); // ease into the end point
  }
  const wantA = Math.atan2(wy - u.y, wx - u.x);
  if (u.vehicle) {
    u.heading = turn(u.heading, wantA, dt * 1.6);
    const off = Math.abs(Math.atan2(Math.sin(wantA - u.heading), Math.cos(wantA - u.heading)));
    sp *= off > 1.2 ? 0.15 : 1 - off * 0.5;
    u.speedNow = Math.min(sp, u.speedNow + dt * 3);
  } else { u.heading = turn(u.heading, wantA, dt * TURN); u.speedNow = u.speedNow < sp ? Math.min(sp, u.speedNow + dt * 5) : sp; }
  const step = Math.min(d, u.speedNow * dt);
  const dir = u.vehicle ? u.heading : wantA;
  // vehicles use a slimmer collision circle so they fit the streets the grid planner finds (0.5 m cells)
  const rr = u.vehicle ? 0.9 : 0.3;
  let [nx, ny] = g.bf.phys.move(u.x, u.y, Math.cos(dir) * step, Math.sin(dir) * step, rr, "human");
  if (step > 0.02 && dist(nx, ny, u.x, u.y) < step * 0.3) {
    // blocked by a corner: try sidestepping around it
    for (const da of [0.6, -0.6, 1.2, -1.2]) {
      const [sx, sy] = g.bf.phys.move(u.x, u.y, Math.cos(dir + da) * step, Math.sin(dir + da) * step, rr, "human");
      if (dist(sx, sy, u.x, u.y) > step * 0.5) { nx = sx; ny = sy; break; }
    }
  }
  u.x = nx; u.y = ny;
  if (!u.vehicle) openDoors(g, u.x, u.y, Math.cos(dir), Math.sin(dir));
  pushObstacles(g, u);
  u.z = g.bf.h(u.x, u.y) + (u.vehicle ? 0 : g.pileH(u.x, u.y));
  // stuck: local detour to a waypoint a few metres ahead, then skip, then nudge to a free cell, then re-plan
  u.stuckT += dt;
  if (u.stuckT > 1.2) {
    // progress is measured from an anchor that only moves once the unit has really advanced
    const moved = dist(u.x, u.y, u.lastX, u.lastY);
    u.stuckT = 0;
    // walking slowly on purpose (waiting for the squad, easing in) is not being stuck
    if (moved > Math.max(1.2, 0.5 * sp * Math.min(3, u.stuckN + 1)) || (!u.vehicle && sp < 1.3)) { u.lastX = u.x; u.lastY = u.y; u.stuckN = 0; }
    else if (u.vehicle && u.speedNow < 1) { /* still turning on the spot: not stuck yet */ }
    else {
      u.stuckN++;
      const ph = g.bf.phys;
      if (u.vehicle) {
        // back up and come at it from a different angle
        const [bx, by] = ph.move(u.x, u.y, -Math.cos(u.heading) * 2, -Math.sin(u.heading) * 2, 0.9, "human");
        u.x = bx; u.y = by; u.heading += (u.stuckN % 2 ? 0.7 : -0.7); u.speedNow = 0;
      }
      if (u.stuckN % 3 === 0) {
        // squeezed into a wall corner the grid doesn't see: step to the centre of a free cell on this side
        const q = g.bf.sameSide(u.x, u.y, 1.5);
        if (q) { const cx = (Math.floor(q[0] / 0.5) + 0.5) * 0.5, cy = (Math.floor(q[1] / 0.5) + 0.5) * 0.5; const m = ph.move(u.x, u.y, cx - u.x, cy - u.y, 0.25, "human"); u.x = m[0]; u.y = m[1]; }
      }
      let k = u.pathIdx;
      while (u.path && k < u.path.length - 1 && dist(u.x, u.y, u.path[k][0], u.path[k][1]) < 6) k++;
      const wp = u.path && u.path[Math.min(k, u.path.length - 1)];
      const from = g.bf.navOk(u.x, u.y) ? [u.x, u.y] : g.bf.sameSide(u.x, u.y);
      const det = wp && from && u.stuckN <= 4 ? ph.findPath(from[0], from[1], wp[0], wp[1], { margin: 16, maxCells: 240, maxExpand: 30000, who: "human" }) : null;
      if (det && det.length >= 2 && u.path) { u.path.splice(u.pathIdx, k - u.pathIdx, ...det.slice(1, -1)); }
      else if (u.stuckN <= 6 && u.path && u.pathIdx < u.path.length - 1) u.pathIdx++;
      else if (u.stuckN <= 7 && u.pathGoal && !u.pathPending) g.paths.request(u, u.pathGoal[0], u.pathGoal[1]);
      else {
        // last resort after ~12 s without progress: step out to the nearest open street cell and re-plan
        const q = g.bf.freeNear(u.x, u.y, 15, true);
        if (q) { u.x = q[0]; u.y = q[1]; u.z = g.bf.h(u.x, u.y); }
        u.stuckN = 0; u.lastX = u.x; u.lastY = u.y;
        if (u.pathGoal && !u.pathPending) g.paths.request(u, u.pathGoal[0], u.pathGoal[1]);
      }
    }
  }
  return step > 0.001;
}

/**
 * A squad member keeps to his formation slot: straight at it while the way is clear, along a planned
 * path when it is not. On the move he keeps pace with the leader and catches up when behind; once
 * the squad halts he eases into the slot and stands.
 */
function formationMove(g: Game, u: Unit, dt: number, engaging: boolean): boolean {
  const sq = squadOf(g, u);
  if (!sq || isNaN(u.slotX)) { u.speedNow = 0; return false; }
  const L = g.get(sq.acting) as Unit | null;
  const travelling = !sq.halted && !!L && L !== u;
  const tx = u.slotX, ty = u.slotY;
  const d = dist(u.x, u.y, tx, ty);
  const max = u.def.speed * (1 - u.suppression * 0.35) * (u.hp < u.maxHp * 0.3 ? 0.75 : 1) * (L && L.order.kind === "retreat" ? 1.15 : 1);
  if (!travelling && (d < 0.6 || sq.hold)) { u.path = null; u.speedNow = 0; return false; }
  // heavy weapons settle and fire once the squad has stopped and they are nearly in place
  if (!travelling && engaging && !canFireWhileMoving(u) && d < 3) { u.speedNow = 0; return false; }
  let want = travelling ? clamp(L!.speedNow + d * 1.2, 0, max * 1.25) : Math.min(max, 0.8 + d * 1.5);
  // the straight line to the slot is blocked: plan a path (rate limited)
  if (g.time - u.formClearT > 0.33) { u.formClearT = g.time; u.formClear = d < 0.8 || g.bf.phys.clearLine(u.x, u.y, tx, ty, "human", 0.25); }
  if (!u.formClear) {
    const stale = !u.pathGoal || dist(u.pathGoal[0], u.pathGoal[1], tx, ty) > 4;
    if (!u.pathPending && (!u.path || stale) && g.time - u.formT > 1.2) { u.formT = g.time; u.pathGoal = [tx, ty]; g.paths.request(u, tx, ty); }
    if (u.path) return followPath(g, u, dt, 1, Math.max(want, 1.6));
    u.speedNow = 0;
    return false;
  }
  u.path = null;
  const ph = g.pileH(u.x, u.y);
  if (ph > 0.15) want *= Math.max(0.55, 1 - ph * 0.35);
  u.speedNow += clamp(want - u.speedNow, -8 * dt, 5 * dt);   // natural acceleration and braking
  const step = Math.min(d, Math.max(0, u.speedNow) * dt);
  if (step < 1e-4) return false;
  const dir = Math.atan2(ty - u.y, tx - u.x);
  let [nx, ny] = g.bf.phys.move(u.x, u.y, Math.cos(dir) * step, Math.sin(dir) * step, 0.3, "human");
  if (dist(nx, ny, u.x, u.y) < step * 0.3) {
    for (const da of [0.6, -0.6, 1.2, -1.2]) {
      const [sx, sy] = g.bf.phys.move(u.x, u.y, Math.cos(dir + da) * step, Math.sin(dir + da) * step, 0.3, "human");
      if (dist(sx, sy, u.x, u.y) > step * 0.5) { nx = sx; ny = sy; break; }
    }
  }
  // turn to walk only when really going somewhere: no about-turns for small corrections
  if (d > 1.5 && !engaging) u.heading = turn(u.heading, dir, dt * TURN);
  u.x = nx; u.y = ny;
  u.z = g.bf.h(u.x, u.y) + g.pileH(u.x, u.y);
  openDoors(g, u.x, u.y, Math.cos(dir), Math.sin(dir));
  // no progress: plan a path instead
  u.formStuckT += dt;
  if (u.formStuckT > 1.5) {
    if (dist(u.x, u.y, u.formLastX, u.formLastY) < 0.4 && d > 1) { u.formClear = false; u.formClearT = g.time + 1.5; }
    u.formStuckT = 0; u.formLastX = u.x; u.formLastY = u.y;
  }
  return true;
}

function pushObstacles(g: Game, u: Unit) {
  for (const o of g.obstacles) {
    if (o.dead || !u.vehicle) continue; // infantry step around cars and over sandbags
    if (!o.blocksUnits && !o.blocksZombies) continue;
    if (Math.abs(o.x - u.x) > 8 || Math.abs(o.y - u.y) > 8) continue;
    const p = o.push(u.x, u.y, u.r);
    if (p && g.bf.phys.walkableAt(p[0], p[1], "human")) { u.x = p[0]; u.y = p[1]; }
  }
}

/** soldiers and survivors open closed doors they walk into */
export function openDoors(g: Game, x: number, y: number, fx: number, fy: number) {
  const ph = g.bf.phys;
  for (const s of ph.segsNear(x - 1, y - 1, x + 1, y + 1)) {
    if (s.kind !== 1 || ph.doorPassable(s.b)) continue;
    const mx = (s.ax + s.bx) / 2 + fx * 0.3, my = (s.ay + s.by) / 2 + fy * 0.3;
    if (dist(x, y, mx, my) < 1.3) { ph.setDoorOpen(s.b, true); g.onSound("bang", x, y, 0.15); }
  }
}

function separate(g: Game, u: Unit) {
  const r = u.r;
  g.uHash.query(u.x, u.y, r + 1.5, (o, d) => {
    if (o === u || d < 1e-4) return;
    const min = r + o.r;
    if (d >= min) return;
    const push = (min - d) * (u.vehicle && !o.vehicle ? 0.1 : 0.5);
    // collision-aware push: never shove a soldier through a wall
    const [nx, ny] = g.bf.phys.move(u.x, u.y, ((u.x - o.x) / d) * push, ((u.y - o.y) / d) * push, u.vehicle ? Math.min(1.3, u.r) : 0.3, "human");
    u.x = nx; u.y = ny;
  });
}

function medic(g: Game, u: Unit, dt: number) {
  u.healT -= dt;
  if (u.healT > 0) return;
  u.healT = 0.5;
  const h = u.def.heal!;
  if (u.medkits <= 0) return;
  let best: Unit | null = null, bf = 1;
  g.uHash.query(u.x, u.y, h.radius, (o) => { if (!o.vehicle && o.alive && o.hp < o.maxHp && o.hp / o.maxHp < bf) { bf = o.hp / o.maxHp; best = o; } });
  if (!best) return;
  const b = best as Unit;
  const amt = Math.min(h.rate * 0.5, b.maxHp - b.hp);
  b.hp += amt;
  u.medkits = Math.max(0, u.medkits - amt / 60);
  if (Math.random() < 0.15) g.effect("heal", b.x, b.y, b.z + 2, 0.6, 1);
}

function vehicle(g: Game, u: Unit, dt: number) {
  // crush infected on contact
  if (u.speedNow > 1.2 && u.def.crush) {
    g.zHash.query(u.x, u.y, u.r + 0.6, (z) => { if (!z.dead && z.type !== "abomination") g.damage(z, u.def.crush! * dt * (u.speedNow / 3), u.id, "crush"); });
  }
  // armored recovery vehicle repairs nearby vehicles
  if (u.def.repair) g.uHash.query(u.x, u.y, 10, (o) => { if (o.vehicle && o !== u && o.hp < o.maxHp) o.hp = Math.min(o.maxHp, o.hp + u.def.repair! * dt); });
  // transport truck carries ammunition for nearby infantry
  if (u.def.cargo) g.uHash.query(u.x, u.y, 8, (o) => { if (!o.vehicle && o.weapon && o.reserve < o.weapon.reserve) o.reserve = Math.min(o.weapon.reserve, o.reserve + o.weapon.mag * dt * 0.2); });
}

function interact(g: Game, u: Unit, dt: number) {
  const o = u.order, t = g.get(o.target);
  if (!t || t.dead) { nextOrder(g, u); return; }
  const reach = t instanceof Unit ? t.r + 2 : t instanceof Obstacle ? Math.max(t.w, t.d) / 2 + 1.5 : 2.2;
  const d = t instanceof Obstacle ? t.distTo(u.x, u.y) + Math.max(t.w, t.d) / 2 : dist(u.x, u.y, t.x, t.y);
  if (d > reach) { if (!u.path && !u.pathPending) goTo(g, u, t.x, t.y); return; }
  u.path = null;
  if (t instanceof Crate) { useCrate(g, u, t); nextOrder(g, u); return; }
  if (t instanceof Unit && t.vehicle && o.kind === "board") {
    const cap = t.def.capacity || 0;
    if (u.vehicle || t.passengers.length >= cap) { g.radio(`${t.name} is full.`, "warn"); nextOrder(g, u); return; }
    t.passengers.push(u.id); u.inVehicle = t.id; u.selected = false; u.order = { kind: "idle" };
    g.onSound("ui", u.x, u.y, 0.4);
    return;
  }
  if (t instanceof Civilian) { if (t.state === "hiding") { t.state = "following"; t.leader = u.id; } nextOrder(g, u); return; }
  if (t instanceof Obstacle && t.kind === "wreck") {
    if (u.type !== "engineer") { g.radio("Only combat engineers can clear wrecks.", "warn"); nextOrder(g, u); return; }
    u.clearT += dt;
    if (Math.random() < dt * 3) g.effect("spark", t.x + (Math.random() - 0.5) * 2, t.y + (Math.random() - 0.5) * 2, t.z + 1, 0.3, 1);
    if (u.clearT >= (u.def.build ? u.def.build.clear : 6)) { t.dead = true; u.clearT = 0; g.radio(`${u.name}: wreck cleared.`, "good"); g.onEvent("cleared", t); nextOrder(g, u); }
    return;
  }
  nextOrder(g, u);
}

export function useCrate(g: Game, u: Unit, c: Crate) {
  let used = false;
  const near: Unit[] = [];
  g.uHash.query(c.x, c.y, 9, (o) => { if (o.alive) near.push(o); });
  if (!near.includes(u)) near.push(u);
  for (const o of near) {
    if (c.ammo > 0 && o.weapon && o.reserve < o.weapon.reserve) { o.reserve = o.weapon.reserve; c.ammo -= o.vehicle ? 1 : 0.25; used = true; }
    if (c.medical > 0 && o.hp < o.maxHp) { o.hp = Math.min(o.maxHp, o.hp + (c.heal || 60)); c.medical -= 0.25; used = true; }
    if (c.medical > 0 && o.def.heal && o.medkits < o.def.heal.kits) { o.medkits = o.def.heal.kits; c.medical -= 0.5; used = true; }
  }
  if (c.deploy) { for (const [k, n] of Object.entries(c.deploy)) g.fob.inventory[k] = (g.fob.inventory[k] || 0) + n; g.radio("Defensive equipment collected: engineers can now build it (B).", "good"); c.deploy = null; used = true; }
  if (c.engineering) { g.fob.engineering += c.engineering; c.engineering = 0; used = true; g.radio("Engineering kit collected.", "good"); }
  if (used) g.onSound("ui", c.x, c.y, 0.5);
  if (c.ammo <= 0 && c.medical <= 0 && !c.deploy && !c.engineering) c.dead = true;
  return used;
}

function build(g: Game, u: Unit, dt: number) {
  const o = u.order;
  const d = dist(u.x, u.y, o.x!, o.y!);
  if (d > 4) { if (!u.path && !u.pathPending) goTo(g, u, o.x!, o.y!); return; }
  u.path = null;
  const def = STRUCTURES[o.item!];
  if (!def) { nextOrder(g, u); return; }
  let site = g.get(o.target) as Obstacle | null;
  if (!site) {
    if ((g.fob.inventory[o.item!] || 0) <= 0) { g.radio(`No ${def.name} left. Request a defensive kit.`, "warn"); nextOrder(g, u); return; }
    g.fob.inventory[o.item!]--;
    site = g.addObstacle(o.item!, o.x!, o.y!, o.rot || 0, 0.01);
    o.target = site.id;
  }
  const speed = (u.def.build ? u.def.build.speed : 0.5) / (def.build || 8);
  site.built = Math.min(1, site.built + speed * dt);
  if (Math.random() < dt * 4) g.effect("spark", site.x, site.y, site.z + 0.6, 0.25, 0.8);
  if (site.built >= 1) { g.radio(`${u.name}: ${def.name} ready.`, "good"); g.onEvent("built", site); nextOrder(g, u); }
}

export function unload(g: Game, v: Unit) {
  let k = 0;
  for (const pid of v.passengers) {
    const p = g.get(pid);
    if (!p) continue;
    const a = v.heading + Math.PI + (k++ - v.passengers.length / 2) * 0.5;
    const q = g.bf.freeNear(v.x + Math.cos(a) * (v.r + 1.5), v.y + Math.sin(a) * (v.r + 1.5), 8, false) || [v.x, v.y];
    p.inVehicle = null; p.x = q[0]; p.y = q[1]; p.z = g.bf.h(p.x, p.y); p.order = { kind: "idle" };
  }
  v.passengers = [];
}

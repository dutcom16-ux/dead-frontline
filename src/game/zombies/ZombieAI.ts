// Infected behaviour: sight and hearing, pursuit (direct steering near the target, shared Dijkstra
// flow fields around player squads further out), swarming separation, losing targets, following
// gunfire, attacking soldiers, civilians, vehicles, defences and doors; special infected abilities.
import type { Game } from "../Game";
import { Zombie, Unit, Civilian, Obstacle } from "../entities";
import { dist, clamp } from "../core";
import { maybeInfect } from "./Infection";

const WAKE = 240;
/** how high a corpse pile must reach (m) before the infected can climb over a defence */
const CLIMB: Record<string, number> = { sandbags: 0.85, barricade: 1.0, concrete_barrier: 0.9, mg_emplacement: 0.95, wreck: 1.3 };

interface Field { x: number; y: number; f: any; t: number }
export class FlowFields {
  g: Game; fields: Field[] = []; t = 0; slot = 0;
  constructor(g: Game) { this.g = g; }
  update(dt: number) {
    this.t -= dt;
    if (this.t > 0) return;
    this.t = 0.3;
    // cluster live soldiers; one field per cluster (up to 3), refreshed in turn
    const us = this.g.liveUnits();
    const clusters: { x: number; y: number; n: number; z: number }[] = [];
    for (const u of us) {
      let c = clusters.find((q) => dist(q.x, q.y, u.x, u.y) < 28);
      if (!c) clusters.push((c = { x: u.x, y: u.y, n: 0, z: 0 }));
      c.x = (c.x * c.n + u.x) / (c.n + 1); c.y = (c.y * c.n + u.y) / (c.n + 1); c.n++;
    }
    for (const c of clusters) this.g.zHash.query(c.x, c.y, 70, (z) => { if (z.state === "chase") c.z++; });
    clusters.sort((a, b) => b.z - a.z);
    const want = clusters.filter((c) => c.z > 0).slice(0, 3);
    this.fields = this.fields.filter((f) => want.some((c) => dist(c.x, c.y, f.x, f.y) < 30));
    for (const c of want) {
      const f = this.fields.find((q) => dist(c.x, c.y, q.x, q.y) < 30);
      if (!f) { this.fields.push({ x: c.x, y: c.y, f: this.g.bf.phys.flowField(c.x, c.y, 60, "zombie"), t: this.g.time }); return; }
      if (dist(c.x, c.y, f.x, f.y) > 5 || this.g.time - f.t > 1.5) { f.x = c.x; f.y = c.y; f.f = this.g.bf.phys.flowField(c.x, c.y, 60, "zombie"); f.t = this.g.time; return; }
    }
  }
  dir(x: number, y: number, tx: number, ty: number): [number, number] | null {
    for (const f of this.fields) {
      if (dist(f.x, f.y, tx, ty) > 26) continue;
      const d = this.g.bf.phys.flowDir(f.f, x, y);
      if (d) return [d[0], d[1]];
    }
    return null;
  }
}

export function updateZombies(g: Game, dt: number) {
  // hearing: gunfire, explosions, screams
  for (const n of g.noises) {
    g.zHash.query(n.x, n.y, n.r * 1.4, (z, d) => {
      if (z.dead || z.state === "chase" || z.state === "attack") return;
      if (d > n.r * z.def.hearing) return;
      z.awake = true; z.state = "investigate";
      z.goalX = n.x + (Math.random() - 0.5) * 14; z.goalY = n.y + (Math.random() - 0.5) * 14;
    });
  }
  const us = g.liveUnits();
  const tick1 = Math.floor(g.time) !== Math.floor(g.time - dt);
  for (const z of g.zombies) {
    if (z.dead) continue;
    if (tick1 && z.state !== "investigate" && z.state !== "chase") {
      let near = Infinity;
      for (const u of us) { const d = Math.abs(u.x - z.x) + Math.abs(u.y - z.y); if (d < near) near = d; }
      z.awake = near < WAKE * 1.3;
    }
    if (!z.awake) continue;
    updateZombie(g, z, dt);
  }
}

function findTarget(g: Game, z: Zombie): Unit | Civilian | null {
  const sight = z.def.sight * (g.difficulty === "high" ? 1.15 : g.difficulty === "low" ? 0.85 : 1);
  let best: any = null, bd = Infinity;
  const ph = g.bf.phys;
  const consider = (e: any, d: number) => {
    if (d >= bd) return;
    if (d > 4.5 && !ph.los(z.x, z.y, z.z + 1.5, e.x, e.y, e.z + (e.vehicle ? 1.5 : 1.2))) return;
    bd = d; best = e;
  };
  g.uHash.query(z.x, z.y, sight, (u, d) => consider(u, d));
  // survivors still barricaded in hiding are not noticed until soldiers bring them out
  g.cHash.query(z.x, z.y, sight * 0.8, (c, d) => { if (c.state !== "gone" && c.state !== "hiding") consider(c, d + 2); });
  return best;
}

function updateZombie(g: Game, z: Zombie, dt: number) {
  z.hitT = Math.max(0, z.hitT - dt);
  if (z.burnT > 0) { z.burnT -= dt; g.damage(z, z.burn * dt, null, "fire"); if (z.dead) return; }
  z.stagger = Math.max(0, z.stagger - dt);
  z.screamT -= dt; z.leapT -= dt; z.attackT -= dt;
  // ---- senses
  z.senseT -= dt;
  if (z.senseT <= 0) {
    z.senseT = 0.35 + Math.random() * 0.25;
    const t = findTarget(g, z);
    if (t) {
      if (z.state !== "chase" && z.state !== "attack") {
        if (z.def.scream && z.screamT <= 0) {
          z.screamT = z.def.scream.cooldown;
          g.noise(z.x, z.y, z.def.scream.radius);
          g.onSound("scream", z.x, z.y);
          g.radio("Screamer! Nearby infected are converging on its position.", "warn");
        } else if (Math.random() < 0.3) g.onSound("groan", z.x, z.y, 0.6);
      }
      if (z.state !== "attack") z.state = "chase";
      z.target = t.id; z.lastSeenX = t.x; z.lastSeenY = t.y; z.lastSeenT = g.time;
    } else if (z.state === "chase") {
      const cur = g.get(z.target);
      if (!cur || cur.dead || g.time - z.lastSeenT > 5) { z.state = "investigate"; z.goalX = z.lastSeenX; z.goalY = z.lastSeenY; z.target = null; }
    }
  }
  let sp = 0, dx = 0, dy = 0;
  if (z.state === "chase" || z.state === "attack") {
    const t = g.get(z.target);
    if (!t || t.dead || (t instanceof Civilian && t.state === "gone")) { z.state = "investigate"; z.goalX = z.lastSeenX; z.goalY = z.lastSeenY; return; }
    if (t instanceof Unit && t.inVehicle !== null) { z.target = t.inVehicle; return; }
    const d = dist(z.x, z.y, t.x, t.y), reach = z.r + (t.r || 0.3) + 0.55;
    if (d <= reach) {
      z.state = "attack";
      z.heading = Math.atan2(t.y - z.y, t.x - z.x);
      if (z.attackT <= 0) attack(g, z, t);
      return;
    }
    z.state = "chase";
    if (d < 5) { z.lastSeenX = t.x; z.lastSeenY = t.y; }
    sp = z.def.run;
    let dir: [number, number] | null = null;
    if (d > 7) dir = g.flow.dir(z.x, z.y, t.x, t.y);
    if (!dir) { dir = [(t.x - z.x) / d, (t.y - z.y) / d]; }
    [dx, dy] = dir;
    // mutant leap
    if (z.def.leap && z.leapT <= 0 && d < z.def.leap && d > 2.5) { z.leapT = 4; sp *= 3.2; g.onSound("growl", z.x, z.y, 0.7); }
    else if (z.def.leap && z.leapT > 3.6) sp *= 3.2;
  } else if (z.state === "investigate") {
    const d = dist(z.x, z.y, z.goalX, z.goalY);
    if (d < 2.5) { z.state = "wander"; z.homeX = z.x; z.homeY = z.y; z.wanderT = 3 + Math.random() * 6; return; }
    sp = (z.def.speed + z.def.run) * 0.5;
    dx = (z.goalX - z.x) / d; dy = (z.goalY - z.y) / d;
  } else {
    z.wanderT -= dt;
    if (z.wanderT <= 0) {
      z.wanderT = 4 + Math.random() * 8;
      if (z.state === "idle" || Math.random() < 0.4) { z.state = Math.random() < 0.5 ? "idle" : "wander"; }
      const a = Math.random() * Math.PI * 2, r = 4 + Math.random() * 14;
      z.goalX = z.homeX + Math.cos(a) * r; z.goalY = z.homeY + Math.sin(a) * r;
    }
    if (z.state === "idle") return;
    const d = dist(z.x, z.y, z.goalX, z.goalY);
    if (d < 1) return;
    sp = z.def.speed * 0.6;
    dx = (z.goalX - z.x) / d; dy = (z.goalY - z.y) / d;
  }
  if (z.stagger > 0) sp *= 0.35;
  // corpse piles: slow going on top of the bodies
  const ph = g.pileH(z.x, z.y);
  if (ph > 0.15 && z.type !== "abomination") sp *= Math.max(0.45, 1 - ph * 0.45);
  z.climbT = Math.max(0, z.climbT - dt);
  if (z.climbT > 0) sp *= 0.6;
  // barbed wire slows and cuts
  for (const o of g.obstacles) if (o.kind === "barbed_wire" && !o.dead && o.built >= 1 && Math.abs(o.x - z.x) < 4 && Math.abs(o.y - z.y) < 4 && o.distTo(z.x, z.y) < 0.4) { sp *= o.def!.slow || 0.3; g.damage(z, (o.def!.dps || 3) * dt, null, "melee"); o.hp -= dt * 2; }
  // separation: infected swarm around targets instead of stacking
  let sx = 0, sy = 0;
  g.zHash.query(z.x, z.y, 1.1, (o, d) => { if (o !== z && d > 1e-3) { const k = (1.1 - d) / d; sx += (z.x - o.x) * k; sy += (z.y - o.y) * k; } });
  dx += sx * 0.6; dy += sy * 0.6;
  const l = Math.hypot(dx, dy) || 1;
  dx /= l; dy /= l;
  z.heading = Math.atan2(dy, dx);
  const step = sp * dt;
  let [nx, ny] = g.bf.phys.move(z.x, z.y, dx * step, dy * step, Math.min(0.45, z.r), "zombie");
  // defences block the infected; they attack what stops them, or climb over it once the bodies are piled high enough
  let blocker: Obstacle | null = null, over = 0;
  for (const o of g.obstacles) {
    if (o.dead || !o.blocksZombies || o.built < 1) continue;
    if (Math.abs(o.x - nx) > 6 || Math.abs(o.y - ny) > 6) continue;
    const climb = CLIMB[o.kind];
    if (climb !== undefined && z.climbT > 0 && o.distTo(nx, ny) < z.r + 0.3) { over = Math.max(over, climb); continue; }
    const p = o.push(nx, ny, z.r);
    if (!p) continue;
    if (climb !== undefined && (z.state === "chase" || z.state === "investigate") && Math.max(ph, g.pileH(p[0], p[1])) >= climb && z.type !== "abomination" && z.type !== "brute") {
      // the pile reaches the top of the defence: over it goes
      z.climbT = 1.6; over = Math.max(over, climb);
      if (g.time - g.climbMsgT > 40) { g.climbMsgT = g.time; g.radio(`Infected are climbing the corpse pile over the ${o.def ? o.def.name.toLowerCase() : "barrier"}!`, "warn"); g.onEvent("climb", o); }
      continue;
    }
    nx = p[0]; ny = p[1]; if (o.kind !== "wreck") blocker = o;
  }
  z.x = nx; z.y = ny;
  z.z = g.bf.h(z.x, z.y) + Math.max(g.pileH(z.x, z.y), over);
  if (blocker && (z.state === "chase" || z.state === "investigate") && z.attackT <= 0) {
    z.attackT = z.def.attack[1];
    g.damage(blocker, z.def.attack[0] * (z.def.doorBreaker || 1), z.id, "melee");
    if (Math.random() < 0.3) g.onSound("bang", z.x, z.y, 0.5);
  }
  // stuck at a closed door while chasing: break it
  z.stuckT += dt;
  if (z.stuckT > 1) {
    const moved = dist(z.x, z.y, z.lastX, z.lastY);
    z.lastX = z.x; z.lastY = z.y; z.stuckT = 0;
    if (moved < 0.3 && sp > 0 && (z.state === "chase" || z.state === "investigate") && breakDoor(g, z)) { /* hammering a door */ }
    else if (moved < 0.2 && sp > 0 && z.state !== "chase") {
      // trapped indoors: head for the building's entrance, otherwise pick a new direction
      const b = g.bf.map.buildingAt(z.x, z.y);
      if (b && b.enter && b.ent) { const e = g.bf.map.entrancePoint(b, 1.5); z.goalX = e.x; z.goalY = e.y; z.state = "investigate"; }
      else { z.goalX = z.x + (Math.random() - 0.5) * 20; z.goalY = z.y + (Math.random() - 0.5) * 20; }
    }
  }
}

function attack(g: Game, z: Zombie, t: any) {
  z.attackT = z.def.attack[1] * (0.85 + Math.random() * 0.3);
  const dmg = z.def.attack[0] * (g.difficulty === "high" ? 1.25 : g.difficulty === "low" ? 0.75 : 1);
  g.onSound("bite", z.x, z.y, 0.6);
  if (z.def.slam) {
    g.effect("dust", z.x, z.y, z.z, 0.6, z.def.slam.radius);
    g.shake = Math.min(1, g.shake + 0.3);
    g.uHash.query(z.x, z.y, z.def.slam.radius, (u) => g.damage(u, dmg * 0.6, z.id, "melee"));
  }
  g.damage(t, dmg, z.id, "melee");
  if (t instanceof Unit && !t.vehicle) maybeInfect(g, t, z);
  if (!t.vehicle) g.effect("blood", t.x, t.y, t.z, 25, 0.5);
  if (t instanceof Unit && !t.vehicle && z.def.knockback) {
    const d = dist(z.x, z.y, t.x, t.y) || 1;
    const [nx, ny] = g.bf.phys.move(t.x, t.y, ((t.x - z.x) / d) * z.def.knockback, ((t.y - z.y) / d) * z.def.knockback, 0.3, "human");
    t.x = nx; t.y = ny;
  }
  if (t instanceof Unit) t.suppression = clamp(t.suppression + 0.12, 0, 1);
}

function breakDoor(g: Game, z: Zombie): boolean {
  const ph = g.bf.phys, map = g.bf.map;
  const [i, j] = map.chunkOf(z.x, z.y);
  for (const b of map.buildingsTouching(i, j)) {
    if (!b.enter || !b.ent || b.collapsed) continue;
    if (ph.doorPassable(b)) continue;
    const e = map.entrancePoint(b, 0.5);
    if (dist(e.x, e.y, z.x, z.y) > 2.6) continue;
    ph.damageDoor(b, z.def.attack[0] * (z.def.doorBreaker || 1) * 1.5);
    g.onSound("bang", z.x, z.y, 0.7);
    g.noise(z.x, z.y, 25);
    if (ph.doorState(b).broken) g.radio("Infected broke through a door.", "warn");
    return true;
  }
  return false;
}

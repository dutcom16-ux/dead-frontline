// Weapons, projectiles, explosions, fire, suppression and infected nests.
import type { Game } from "../Game";
import { Unit, Zombie, Nest, Obstacle } from "../entities";
import { dist, clamp } from "../core";
import { WEAPONS } from "../data";

export function fire(g: Game, u: Unit, t: any, moving: boolean) {
  const w = u.weapon;
  if (!w || u.cool > 0 || u.reloadT > 0 || u.mag <= 0) return;
  const d = dist(u.x, u.y, t.x, t.y);
  if (d > w.range) return;
  if (w.minRange && d < w.minRange) return;
  u.cool = w.interval * (1 + u.suppression * 0.35);
  u.mag--;
  g.stats.shots++;
  u.flashT = 0.06;
  u.shotN++;
  const muzzle = gunTip(u);
  g.noise(u.x, u.y, w.noise);
  g.onSound(w.sound, u.x, u.y);
  const tz = t.z + (t instanceof Zombie ? (t.def.lowProfile ? 0.35 : 1.15 * t.def.size) : 1.0);
  // accuracy: weapon base at half range, better close in, worse far out; moving, suppression, rank
  const rel = d / w.range;
  let p = w.accuracy * (rel < 0.5 ? 1 + (0.5 - rel) * 0.4 : 1 - (rel - 0.5) * 0.5);
  if (moving && !u.vehicle) p *= u.wid === "sniper" ? 0.3 : 0.75;
  p *= 1 - u.suppression * 0.45;
  p += u.rank * 0.03;
  if (t instanceof Zombie) { if (t.def.lowProfile) p *= 0.8; if (t.def.size > 1.3) p *= 1.15; if (t.state === "chase" && t.type === "runner") p *= 0.9; }
  if (t instanceof Nest) p = Math.max(p, 0.9);
  p = clamp(p, 0.05, 0.98);
  if (w.projectile) {
    const spread = (1 - p) * d * 0.25;
    g.projectiles.push({ x: muzzle[0], y: muzzle[1], z: muzzle[2], tx: t.x + (Math.random() - 0.5) * spread, ty: t.y + (Math.random() - 0.5) * spread, tz: t.z + 0.5,
      speed: w.projectile.speed, radius: w.projectile.radius, damage: w.damage, owner: u.id, kind: u.wid === "rocket" ? "rocket" : "shell", t: 0 });
    return;
  }
  if (u.wid === "flamer") {
    const a0 = Math.atan2(t.y - u.y, t.x - u.x), cone = ((w.cone || 20) * Math.PI) / 180;
    g.zHash.query(u.x, u.y, w.range, (z, dz) => {
      const a = Math.atan2(z.y - u.y, z.x - u.x);
      const da = Math.abs(Math.atan2(Math.sin(a - a0), Math.cos(a - a0)));
      if (da > cone) return;
      g.damage(z, w.damage, u.id, "fire");
      if (w.ignite) { z.burn = w.ignite.dps; z.burnT = w.ignite.time; }
    });
    g.effect("flame", (u.x + t.x) / 2, (u.y + t.y) / 2, u.z + 1, 0.15, d * 0.5, { rot: a0 });
    if (Math.random() < 0.25) g.fires.push({ x: t.x + (Math.random() - 0.5) * 2, y: t.y + (Math.random() - 0.5) * 2, r: 1.8, t: 4, dps: 10 });
    return;
  }
  const pellets = w.pellets || 1;
  let hitAny = false;
  for (let k = 0; k < pellets; k++) {
    let pk = p;
    if (pellets > 1) pk *= rel < 0.4 ? 0.95 : 0.65;
    const hit = Math.random() < pk;
    let ex = t.x, ey = t.y, ez = tz;
    if (hit) {
      hitAny = true;
      const crit = !(t instanceof Nest) && Math.random() < 0.08 + u.rank * 0.02 ? 1.8 : 1; // head shots
      g.damage(t, w.damage * crit * (pellets > 1 ? (rel < 0.4 ? 1 : 0.6) : 1), u.id, "bullet");
      if (t instanceof Zombie && w.suppress) t.stagger = Math.max(t.stagger, 0.3 * w.suppress);
      if (t instanceof Zombie) t.stagger = Math.max(t.stagger, 0.08);
      if (w.pierce) {
        // high-velocity rounds continue through to the next infected in line
        let left = w.pierce, lx = t.x, ly = t.y;
        const dx = (t.x - u.x) / d, dy = (t.y - u.y) / d;
        g.zHash.query(t.x + dx * 6, t.y + dy * 6, 6.5, (z) => {
          if (left <= 0 || z === t || z.dead) return;
          const along = (z.x - u.x) * dx + (z.y - u.y) * dy, off = Math.abs((z.x - u.x) * dy - (z.y - u.y) * dx);
          if (along > d && off < 0.8) { g.damage(z, w.damage * 0.6, u.id); left--; lx = z.x; ly = z.y; }
        });
        ex = lx; ey = ly;
      }
    } else {
      const off = 1 + d * 0.06;
      ex += (Math.random() - 0.5) * off * 2; ey += (Math.random() - 0.5) * off * 2; ez = t.z + Math.random() * 1.5;
    }
    if (k < 3) g.effect("tracer", muzzle[0], muzzle[1], muzzle[2], 0.07, 1, { x2: ex, y2: ey, z2: ez, owner: u.vehicle ? undefined : u.id });
  }
  if (hitAny && t instanceof Zombie && Math.random() < 0.5) g.effect("hit", t.x, t.y, tz, 0.18, 0.5);
}

export function gunTip(u: Unit): [number, number, number] {
  const c = Math.cos(u.heading), s = Math.sin(u.heading);
  if (u.vehicle) {
    const len = u.wid === "tank_gun" ? 6.4 : u.wid === "autocannon" ? 3.4 : 1.0;
    return [u.x + c * len, u.y + s * len, u.z + (u.type === "jeep" ? 2.3 : 2.6)];
  }
  return [u.x + c * 0.9, u.y + s * 0.9, u.z + 1.2];
}

export function updateCombat(g: Game, dt: number) {
  // projectiles (rockets, cannon shells, artillery)
  const ph = g.bf.phys;
  g.projectiles = g.projectiles.filter((p) => {
    p.t += dt;
    const dx = p.tx - p.x, dy = p.ty - p.y, dz = p.tz - p.z, L = Math.hypot(dx, dy, dz);
    const step = p.speed * dt;
    if (p.kind === "rocket" && Math.random() < 0.6) g.effect("smoke", p.x, p.y, p.z, 1.2, 0.35);
    if (L <= step) { g.explode(p.tx, p.ty, p.tz, p.radius, p.damage, p.owner); return false; }
    const nx = p.x + (dx / L) * step, ny = p.y + (dy / L) * step, nz = p.z + (dz / L) * step;
    // direct hit on an infected or a wall on the way
    let hit: any = null;
    g.zHash.query(nx, ny, 1.4, (z) => { if (!hit && Math.abs(z.z + 1 - nz) < 2) hit = z; });
    if (hit || (p.kind !== "artillery" && !ph.los(p.x, p.y, p.z, nx, ny, nz))) {
      g.explode(nx, ny, nz, p.radius, p.damage, p.owner);
      if (hit) g.damage(hit, p.damage * 0.5, p.owner, "blast");
      return false;
    }
    p.x = nx; p.y = ny; p.z = nz;
    return p.t < 12;
  });
  // fires on the ground
  g.fires = g.fires.filter((f) => {
    f.t -= dt;
    g.zHash.query(f.x, f.y, f.r, (z) => { g.damage(z, f.dps * dt, null, "fire"); if (z.burnT < 1) { z.burn = 12; z.burnT = 2; } });
    g.uHash.query(f.x, f.y, f.r * 0.7, (u) => { if (!u.vehicle) g.damage(u, f.dps * 0.4 * dt, null, "fire"); });
    if (Math.random() < dt * 6) g.effect("fire", f.x + (Math.random() - 0.5) * f.r, f.y + (Math.random() - 0.5) * f.r, g.bf.h(f.x, f.y), 0.6, 0.7 + Math.random() * 0.5);
    return f.t > 0;
  });
  // effects age
  for (const e of g.effects) e.t += dt;
  g.effects = g.effects.filter((e) => e.t < e.life);
  // infected nests spawn while soldiers are near
  for (const n of g.nests) {
    if (n.dead) continue;
    n.hitT = Math.max(0, n.hitT - dt);
    n.spawnT -= dt;
    if (n.spawnT > 0) continue;
    n.spawnT = (g.difficulty === "high" ? 9 : g.difficulty === "low" ? 18 : 13) / n.size;
    let near = false;
    g.uHash.query(n.x, n.y, 170, () => { near = true; });
    if (!near) continue;
    let local = 0;
    g.zHash.query(n.x, n.y, 45, () => { local++; });
    if (local >= n.cap * n.size) continue;
    const k = 2 + Math.floor(Math.random() * 3);
    const zs = g.spawnGroup(n.x, n.y, k, 4, n.zone, { walker: 60, runner: 25, crawler: 10, bloater: 5 });
    for (const z of zs) { z.awake = true; z.state = "investigate"; const u = g.uHash.nearest(n.x, n.y, 170); if (u) { z.goalX = u.x; z.goalY = u.y; } }
    g.onSound("groan", n.x, n.y, 0.8);
  }
  // defences: machine-gun emplacements engage on their own; watchtowers extend sight
  for (const o of g.obstacles) {
    if (o.dead || o.built < 1 || !o.def || !o.def.turret) continue;
    o.turretCool -= dt;
    if (o.turretCool > 0) continue;
    const w = WEAPONS[o.def.turret];
    let tgt: Zombie | null = null, bd = w.range;
    g.zHash.query(o.x, o.y, w.range, (z, d) => { if (!z.dead && d < bd && ph.los(o.x, o.y, o.z + 1.2, z.x, z.y, z.z + 1)) { bd = d; tgt = z; } });
    if (!tgt) { o.turretCool = 0.4; continue; }
    const t = tgt as Zombie;
    o.turretCool = w.interval;
    o.rot = Math.atan2(t.y - o.y, t.x - o.x) + Math.PI / 2;
    g.noise(o.x, o.y, w.noise);
    g.onSound(w.sound, o.x, o.y);
    if (Math.random() < w.accuracy) { g.damage(t, w.damage, null); t.stagger = Math.max(t.stagger, 0.2); }
    g.effect("tracer", o.x, o.y, o.z + 1.1, 0.07, 1, { x2: t.x, y2: t.y, z2: t.z + 1 });
  }
}

/** artillery / gun-run strike requested through logistics */
export function strike(g: Game, x: number, y: number, s: { radius: number; damage: number; shells: number; line?: boolean }, heading = 0) {
  for (let k = 0; k < s.shells; k++) {
    let tx: number, ty: number;
    if (s.line) { const o = (k / (s.shells - 1) - 0.5) * 50; tx = x + Math.cos(heading) * o + (Math.random() - 0.5) * 4; ty = y + Math.sin(heading) * o + (Math.random() - 0.5) * 4; }
    else { const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * s.radius * 1.4; tx = x + Math.cos(a) * r; ty = y + Math.sin(a) * r; }
    const tz = g.bf.h(tx, ty);
    g.projectiles.push({ x: tx + 30, y: ty - 30, z: tz + 160 + k * (s.line ? 4 : 30), tx, ty, tz, speed: s.line ? 120 : 180, radius: s.line ? 4 : s.radius * 0.55, damage: s.damage * (s.line ? 0.4 : 0.6), owner: 0, kind: "artillery", t: 0 });
  }
}
export { Obstacle };

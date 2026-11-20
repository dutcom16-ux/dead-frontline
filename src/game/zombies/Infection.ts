// Infection: a bite can infect a soldier. After an incubation time the soldier turns into an
// infected and goes straight for the nearest soldier, his own squad first. A soldier killed while
// infected rises a few seconds later. If the squad leader is infected, command passes to another
// soldier at once (units/Squads.ts).
import type { Game } from "../Game";
import { Unit, Zombie, Corpse } from "../entities";
import { dist } from "../core";

/** chance that one bite infects an unarmoured soldier (medium difficulty) */
export const BITE_INFECTION = 0.05;

export interface Riser { x: number; y: number; t: number; type: string; name: string; squad: number; corpse: Corpse | null }

export function maybeInfect(g: Game, u: Unit, z: Zombie) {
  if (u.vehicle || !u.alive || u.infectedAt >= 0) return;
  const k = g.difficulty === "low" ? 0.5 : g.difficulty === "high" ? 1.5 : 1;
  const p = (z.def.infect ?? BITE_INFECTION) * k * (1 - u.def.armor * 0.6);
  if (Math.random() < p) infect(g, u);
}
export function infect(g: Game, u: Unit, incubation?: number) {
  if (u.infectedAt >= 0 || !u.alive || u.vehicle) return;
  u.infectedAt = g.time;
  const k = g.difficulty === "high" ? 0.75 : 1;
  u.turnAt = g.time + (incubation ?? (22 + Math.random() * 14) * k);
  g.radio(`${u.name} has been bitten — infected. He will turn in about ${Math.round(u.turnAt - g.time)} s.`, "bad");
  g.onEvent("infected", u);
}

export function updateInfection(g: Game) {
  for (const u of g.units) if (u.alive && u.infectedAt >= 0 && g.time >= u.turnAt) turn(g, u);
  if (g.risers.length) {
    const due = g.risers.filter((r) => g.time >= r.t);
    if (due.length) {
      g.risers = g.risers.filter((r) => g.time < r.t);
      for (const r of due) {
        if (r.corpse) g.removeCorpse(r.corpse);
        const z = spawnTurned(g, r.x, r.y, r.type, r.squad);
        if (z) g.radio(`${r.name} has risen as one of them.`, "bad");
      }
    }
  }
}

function turn(g: Game, u: Unit) {
  let x = u.x, y = u.y;
  if (u.inVehicle !== null) {
    const v = g.get(u.inVehicle);
    if (v) { v.passengers = v.passengers.filter((id: number) => id !== u.id); x = v.x + Math.cos(v.heading + Math.PI) * (v.r + 1.5); y = v.y + Math.sin(v.heading + Math.PI) * (v.r + 1.5); }
    u.inVehicle = null;
  }
  u.hp = 0; u.dead = true; u.selected = false;
  g.stats.lost++; g.stats.turned++;
  g.radio(`${u.name} has turned! Put him down.`, "bad");
  const z = spawnTurned(g, x, y, u.type, u.squad);
  g.onEvent("turned", { unit: u, zombie: z });
}

/** a soldier risen as an infected: hostile at once, goes for his own squad first */
export function spawnTurned(g: Game, x: number, y: number, type: string, squad: number): Zombie | null {
  const z = g.addZombie("walker", x, y, "", true);
  if (!z) return null;
  z.soldier = type; z.formerSquad = squad;
  z.maxHp = z.hp = 150; z.awake = true;
  let best: Unit | null = null, bd = 45;
  for (const q of g.units) {
    if (!q.alive || q.inVehicle !== null) continue;
    const d = dist(x, y, q.x, q.y) - (q.squad === squad ? 6 : 0);
    if (d < bd) { bd = d; best = q; }
  }
  if (best) { z.state = "chase"; z.target = best.id; z.lastSeenX = best.x; z.lastSeenY = best.y; z.lastSeenT = g.time; }
  g.onSound("growl", x, y, 0.8);
  return z;
}

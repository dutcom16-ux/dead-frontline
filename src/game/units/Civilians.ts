// Survivors: hide until soldiers reach them, then follow the squad; once their area is secure a
// helicopter evacuates them. Military survivors join the player's force instead.
import type { Game } from "../Game";
import { Civilian, Transport } from "../entities";
import { dist } from "../core";
import { openDoors } from "./UnitAI";
import { reachableNear } from "../missions/op01";

export function updateCivilians(g: Game, dt: number) {
  for (const c of g.civs) {
    if (c.dead || c.state === "gone") continue;
    c.panicT = Math.max(0, c.panicT - dt);
    if (c.state === "hiding") {
      // survivors come out to soldiers who are close, or who they can see nearby
      let u = g.uHash.nearest(c.x, c.y, 8, (q) => !q.vehicle);
      if (!u) u = g.uHash.nearest(c.x, c.y, 25, (q) => !q.vehicle && g.bf.phys.los(q.x, q.y, q.z + 1.5, c.x, c.y, c.z + 1.4));
      if (u) {
        if (c.military) { joinForce(g, c); continue; }
        c.state = "following"; c.leader = u.id;
        g.radio(`${u.name}: survivors found${g.mission ? " — " + (g.mission.objective(c.objective)?.short || "") : ""}. They're with us.`, "good");
        g.onEvent("found", c);
      }
      continue;
    }
    if (c.state === "following") {
      let l = g.get(c.leader);
      if (!l || l.dead || l.inVehicle !== null) { l = g.uHash.nearest(c.x, c.y, 60, (q) => !q.vehicle); c.leader = l ? l.id : null; }
      if (l) walkTo(g, c, l.x, l.y, 3.2, dt, 3.4);
      continue;
    }
    if (c.state === "evac") {
      const h = g.transports.find((t) => t.id === c.leader);
      if (!h || h.done) { c.state = "following"; c.leader = null; continue; }
      if (h.t < h.arrive) continue; // wait for touchdown
      if (dist(c.x, c.y, h.tx, h.ty) < 3.5) { c.state = "gone"; g.stats.rescued++; g.onEvent("evacuated", c); continue; }
      walkTo(g, c, h.tx, h.ty, 0, dt, 3.6);
    }
  }
}

function walkTo(g: Game, c: Civilian, x: number, y: number, keep: number, dt: number, speed: number) {
  // leaving a building: go through its entrance
  const map = g.bf.map, here = map.buildingAt(c.x, c.y);
  if (here && here.enter && here.ent && map.buildingAt(x, y) !== here) {
    const ein = map.entrancePoint(here, -0.9), eout = map.entrancePoint(here, 1.6);
    if (dist(c.x, c.y, ein.x, ein.y) > 1.1 && !c.exiting) { x = ein.x; y = ein.y; keep = 0; }
    else { c.exiting = true; x = eout.x; y = eout.y; keep = 0; g.bf.phys.setDoorOpen(here, true); }
  } else c.exiting = false;
  const d = dist(c.x, c.y, x, y);
  if (d <= keep) return;
  const needPath = d > 10 || !g.bf.phys.clearLine(c.x, c.y, x, y, "plan", 0.2);
  if (needPath && !c.pathPending && (!c.path || c.pathIdx >= c.path.length || Math.random() < dt * 0.5)) g.paths.request(c, x, y);
  let tx = x, ty = y;
  if (needPath && c.path && c.pathIdx < c.path.length) {
    [tx, ty] = c.path[c.pathIdx];
    if (dist(c.x, c.y, tx, ty) < 1.2) c.pathIdx++;
  }
  const dd = dist(c.x, c.y, tx, ty) || 1;
  const step = Math.min(dd, speed * dt);
  c.heading = Math.atan2(ty - c.y, tx - c.x);
  const [nx, ny] = g.bf.phys.move(c.x, c.y, ((tx - c.x) / dd) * step, ((ty - c.y) / dd) * step, 0.3, "human");
  c.x = nx; c.y = ny; c.z = g.bf.h(c.x, c.y);
  openDoors(g, c.x, c.y, Math.cos(c.heading), Math.sin(c.heading));
  c.stuckT += dt;
  if (c.stuckT > 1.5) {
    if (dist(c.x, c.y, c.lastX, c.lastY) < 0.4) {
      c.stuckN = (c.stuckN || 0) + 1;
      if (c.stuckN > 6) { const q = g.bf.freeNear(c.x, c.y, 12, true); if (q) { c.x = q[0]; c.y = q[1]; } c.stuckN = 0; c.path = null; }
      else if (c.path && c.pathIdx < c.path.length) c.pathIdx++; else c.path = null;
    } else c.stuckN = 0;
    c.stuckT = 0; c.lastX = c.x; c.lastY = c.y;
  }
}

function joinForce(g: Game, c: Civilian) {
  c.state = "gone";
  const u = g.addUnit(c.military!, c.x, c.y);
  u.hp = u.maxHp * 0.6;
  if (u.weapon) { u.mag = Math.ceil(u.weapon.mag * 0.5); u.reserve = Math.ceil(u.weapon.reserve * 0.3); }
  g.radio(`${u.name} (3rd Engineer platoon) joins your task force.`, "good");
  g.onEvent("joined", u);
}

/** send a helicopter to evacuate the given civilians from near (x, y) */
export function callEvac(g: Game, x: number, y: number, civs: Civilian[]) {
  // land next to the survivors, on open ground connected to the street network
  let cx = 0, cy = 0;
  for (const c of civs) { cx += c.x; cy += c.y; }
  if (civs.length) { cx /= civs.length; cy /= civs.length; } else { cx = x; cy = y; }
  const p = reachableNear(g, [cx, cy]);
  const h: Transport = { id: g.newTransportId(), kind: "heli", x: p[0] + 220, y: p[1] + 160, z: 60, sx: p[0] + 220, sy: p[1] + 160, tx: p[0], ty: p[1], t: 0, arrive: 14, stay: 22, delivery: -1, heading: 0, done: false };
  g.transports.push(h);
  for (const c of civs) { c.state = "evac"; c.leader = h.id; }
  g.radio("Evac bird inbound for the survivors, ETA 15 seconds. Keep the LZ clear.", "radio");
  g.onSound("heli", p[0], p[1], 0.6);
  return h;
}

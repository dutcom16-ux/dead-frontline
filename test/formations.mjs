// Formation and squad tactics test (spec §19). Runs each scenario in the live game (headless
// Chromium, deterministic stepping), checks measurable conditions and saves screenshots.
//   node test/formations.mjs [dist] [outdir]
import fs from "node:fs"; import path from "node:path";
import { serve, loadPlaywright } from "./serve.mjs";
const { chromium } = loadPlaywright();
const DIR = path.resolve(process.argv[2] || "dist"), OUT = process.argv[3] || "/tmp/formations";
fs.mkdirSync(OUT, { recursive: true });
const PORT = +(process.env.PORT || 8781);
const srv = await serve(DIR, PORT);
const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.addInitScript(() => { let s = 777; Math.random = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; window.__reseed = (v) => { s = v >>> 0; }; });
await page.goto(`http://localhost:${PORT}/?manualtick`);
await page.waitForSelector("#menu:not([hidden])", { timeout: 90000 });
await page.click("#mNew"); await page.click('[data-diff="medium"]');
await page.click('[data-op="op01"]'); await page.click("#bDeploy");
await page.waitForFunction(() => window.__df && window.__df.session && window.__df.session.game, null, { timeout: 90000 });

// ---- helpers inside the page
await page.evaluate(() => {
  const A = window.__df, S = A.__squads, s = A.session;
  const T = (window.__T = {});
  T.g = () => s.game;
  T.tick = (sec, each) => { const G = s.game; G.paths.timeCapMs = Infinity; const n = Math.round(sec * 30); for (let k = 0; k < n; k++) { s.tick(1 / 30); if (each) each(k); } };
  T.events = [];
  const G0 = s.game, prev = G0.onEvent;
  G0.onEvent = (ev, d) => {
    T.events.push({ ev, t: G0.time, d: d && d.name ? d.name : d && d.squad ? d.squad.name : null });
    if (ev === "turned" && d && d.zombie) T.turnedEv = { z: d.zombie, target: d.zombie.target, state: d.zombie.state };
    prev(ev, d);
  };
  T.clear = () => {
    const G = s.game;
    for (const z of G.zombies) z.dead = true;
    for (const n of G.nests) n.spawnT = 1e9;   // no reinforcements for the infected during the tests
    G.corpses = []; G.piles.clear(); G.risers = []; G.effects = [];
    for (const o of G.obstacles) if (!o.fob) o.dead = true;
    G.compact();
  };
  T.LZ = () => { const m = s.game.mission; return m.lz; };
  T.setup = (types, formation, opts = {}) => {
    const G = s.game;
    T.clear();
    for (const u of G.units) { u.dead = true; u.hp = 0; }
    G.compact(); G.squads = [];
    const [x, y] = opts.at || T.LZ();
    const face = opts.face ?? 0;
    const us = types.map((t, i) => { const u = G.addUnit(t, x - Math.cos(face) * (i % 3) * 2 + Math.sin(face) * Math.floor(i / 3) * 2, y - Math.sin(face) * (i % 3) * 2); u.heading = face; u.rank = i === 0 ? 3 : 0; return u; });
    const q = S.createSquad(G, us, opts.name || "Alpha", formation);
    q.facing = q.want = face; q.dirty = true;
    T.tick(opts.settle ?? 8);
    T.events.length = 0;
    return q;
  };
  T.members = (q) => q.members.map((id) => s.game.get(id)).filter((u) => u && u.alive && u.inVehicle === null);
  T.minPair = (us) => { let m = 1e9; for (let i = 0; i < us.length; i++) for (let j = i + 1; j < us.length; j++) m = Math.min(m, Math.hypot(us[i].x - us[j].x, us[i].y - us[j].y)); return m; };
  T.slotErr = (us) => us.map((u) => Math.hypot(u.x - u.slotX, u.y - u.slotY));
  T.local = (q, u) => { const ox = q.halted ? q.cx : s.game.get(q.acting).x, oy = q.halted ? q.cy : s.game.get(q.acting).y, c = Math.cos(q.facing), sn = Math.sin(q.facing), dx = u.x - ox, dy = u.y - oy; return [dx * c + dy * sn, -dx * sn + dy * c]; };
  T.spawn = (n, x, y, r, type = "walker", chase = true) => {
    const G = s.game, out = [];
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2, z = G.addZombie(type, x + Math.cos(a) * r * Math.random(), y + Math.sin(a) * r * Math.random());
      if (!z) continue;
      z.awake = true;
      if (chase) { const t = G.units.find((u) => u.alive); if (t) { z.state = "chase"; z.target = t.id; z.lastSeenX = t.x; z.lastSeenY = t.y; z.lastSeenT = G.time; } }
      out.push(z);
    }
    return out;
  };
  T.look = (x, y, zoom = 26) => { s.cam.lookAt(x, y, zoom); s.cam.snap(); for (const u of s.game.units) u.selected = u.alive && !u.vehicle; };
  T.ff = (q, f) => S.setFormation(s.game, q, f);
});

const results = [];
const ONLY = process.env.ONLY ? process.env.ONLY.split(",") : null;
async function scenario(name, code, shot) {
  if (ONLY && !ONLY.includes(name.split(" ")[0])) return;
  const t0 = Date.now();
  let r;
  // every scenario starts from its own seed: the outcome does not depend on what the mission spawned
  // across the map before it (or on which scenarios ran first)
  let h = 777; for (const ch of name) h = (Math.imul(h, 31) + ch.charCodeAt(0)) >>> 0;
  await page.evaluate((v) => window.__reseed(v), h);
  try { r = await page.evaluate(code); } catch (e) { r = { pass: false, detail: "error: " + e.message }; }
  if (shot) { await page.waitForTimeout(1500); await page.screenshot({ path: path.join(OUT, shot) }); }
  results.push({ name, ...r, s: ((Date.now() - t0) / 1000).toFixed(0) });
  console.log(`${r.pass ? "PASS" : "FAIL"}  ${name} — ${r.detail}${shot ? `  [${shot}]` : ""}`);
}
const SQUAD = '["rifleman","rifleman","assault","machine_gunner","sniper","shotgunner","rocket","medic","engineer"]';

// 1 ------------------------------------------------------------------
await scenario("1 Line formation moves without overlapping", `(() => {
  const S = __df.__squads, G = __T.g(), q = __T.setup(${SQUAD}, "line", { face: 0.3 });
  const L = G.get(q.acting); const us = __T.members(q);
  __df.__issue(G, us, { kind: "move", x: L.x + Math.cos(0.3) * 55, y: L.y + Math.sin(0.3) * 55 }, {});
  let minD = 1e9, maxStep = 0; const prev = us.map((u) => [u.x, u.y]);
  __T.tick(26, (k) => { minD = Math.min(minD, __T.minPair(us)); us.forEach((u, i) => { maxStep = Math.max(maxStep, Math.hypot(u.x - prev[i][0], u.y - prev[i][1])); prev[i] = [u.x, u.y]; }); });
  const err = __T.slotErr(us), side = us.map((u) => __T.local(q, u)[1]).sort((a, b) => a - b);
  const gaps = side.slice(1).map((v, i) => v - side[i]);
  const pass = minD >= 0.55 && maxStep < 0.3 && Math.max(...err) < 1.2 && q.halted && Math.min(...gaps) > 2.0 && Math.max(...gaps) < 4.2;
  __T.look(q.cx, q.cy);
  return { pass, detail: "closest pair " + minD.toFixed(2) + " m, fastest step " + (maxStep * 30).toFixed(1) + " m/s, slot error max " + Math.max(...err).toFixed(2) + " m, line gaps " + Math.min(...gaps).toFixed(1) + "–" + Math.max(...gaps).toFixed(1) + " m" };
})()`, "1_line.png");

// 2 ------------------------------------------------------------------
await scenario("2 Line changes to column", `(() => {
  const G = __T.g(), q = G.squads[0], us = __T.members(q);
  __T.ff(q, "column");
  let minD = 1e9; __T.tick(14, () => { minD = Math.min(minD, __T.minPair(us)); });
  const loc = us.map((u) => __T.local(q, u)), err = __T.slotErr(us);
  const sideDev = Math.max(...loc.map((p) => Math.abs(p[1]))), depth = Math.max(...loc.map((p) => p[0])) - Math.min(...loc.map((p) => p[0]));
  const pass = q.formation === "column" && Math.max(...err) < 1.2 && sideDev < 1.3 && depth > (us.length - 1) * 2.6 * 0.85 && minD >= 0.55;
  __T.look(q.cx, q.cy);
  return { pass, detail: "file depth " + depth.toFixed(1) + " m, widest step aside " + sideDev.toFixed(2) + " m, slot error max " + Math.max(...err).toFixed(2) + " m, closest pair " + minD.toFixed(2) + " m" };
})()`, "2_column.png");

// 3 ------------------------------------------------------------------
await scenario("3 Squad changes direction and keeps its spacing (wedge, 90° turn)", `(() => {
  const S = __df.__squads, G = __T.g(), q = __T.setup(${SQUAD}, "wedge", { face: 0 });
  const us = __T.members(q), L = G.get(q.acting);
  __df.__issue(G, us, { kind: "move", x: L.x + 40, y: L.y }, {});
  __T.tick(10);
  __df.__issue(G, us, { kind: "move", x: L.x, y: L.y + 45 }, {});
  let minD = 1e9, maxTurn = 0, lastF = q.facing, lags = [], maxStep = 0; const prev = us.map((u) => [u.x, u.y]);
  __T.tick(20, (k) => { minD = Math.min(minD, __T.minPair(us)); const d = Math.abs(Math.atan2(Math.sin(q.facing - lastF), Math.cos(q.facing - lastF))); maxTurn = Math.max(maxTurn, d); lastF = q.facing; if (k > 120 && !q.halted) lags.push(q.lag); us.forEach((u, i) => { maxStep = Math.max(maxStep, Math.hypot(u.x - prev[i][0], u.y - prev[i][1])); prev[i] = [u.x, u.y]; }); });
  const meanLag = lags.length ? lags.reduce((a, b) => a + b, 0) / lags.length : 0;
  const pass = minD >= 0.55 && maxTurn <= 1.3 / 30 + 1e-3 && meanLag < 2.5 && maxStep < 0.3;
  __T.look(q.halted ? q.cx : L.x, q.halted ? q.cy : L.y);
  return { pass, detail: "formation turned at most " + (maxTurn * 30).toFixed(2) + " rad/s (smooth), mean slot lag after the turn " + meanLag.toFixed(2) + " m, closest pair " + minD.toFixed(2) + " m, fastest step " + (maxStep * 30).toFixed(1) + " m/s" };
})()`, "3_turn.png");

// 4 ------------------------------------------------------------------
await scenario("4 Soldiers reorganise when a member dies (line)", `(() => {
  const G = __T.g(), q = __T.setup(${SQUAD}, "line", { face: 0.3 });
  let us = __T.members(q);
  const victim = us.find((u) => u.id !== q.leader && u.type === "assault");
  const n0 = us.length;
  G.damage(victim, 9999, null, "blast");
  __T.tick(9);
  us = __T.members(q);
  const side = us.map((u) => __T.local(q, u)[1]).sort((a, b) => a - b), gaps = side.slice(1).map((v, i) => v - side[i]);
  const err = __T.slotErr(us);
  const slots = new Set([...q.slots.values()].map((sl) => sl.s.toFixed(1)));
  const pass = us.length === n0 - 1 && q.members.length === n0 - 1 && Math.max(...gaps) < 4.2 && Math.max(...err) < 1.2 && slots.size === n0 - 1;
  return { pass, detail: (n0 - 1) + " soldiers re-spaced: line gaps " + Math.min(...gaps).toFixed(1) + "–" + Math.max(...gaps).toFixed(1) + " m (no hole), slot error max " + Math.max(...err).toFixed(2) + " m" };
})()`);

// 5 ------------------------------------------------------------------
await scenario("5 Leader dies on the move and command transfers", `(() => {
  const G = __T.g(), q = __T.setup(${SQUAD}, "wedge", { face: 0.2 });
  const us = __T.members(q), L0 = G.get(q.leader), dest = [L0.x + 70, L0.y + 14];
  __df.__issue(G, us, { kind: "move", x: dest[0], y: dest[1] }, {});
  __T.tick(6);
  G.damage(L0, 9999, null, "blast");
  __T.tick(1);
  const L1 = G.get(q.leader), cmd = G.radioLog.some((m) => /takes command of Alpha/.test(m.text));
  const travelling = !q.halted && L1 && L1.order.kind === "move";
  __T.tick(25);
  const arrived = L1 && Math.hypot(L1.x - dest[0], L1.y - dest[1]) < 8;
  const pass = !!L1 && L1 !== L0 && L1.alive && cmd && travelling && arrived && Math.max(...__T.slotErr(__T.members(q))) < 1.5;
  return { pass, detail: (L1 ? L1.name : "nobody") + " took command (radio: " + cmd + "), squad kept moving: " + travelling + ", reached the objective: " + arrived };
})()`);

// 6 ------------------------------------------------------------------
await scenario("6 Soldiers fire while holding their formation positions (line)", `(() => {
  const G = __T.g(), q = __T.setup(${SQUAD}, "line", { face: 0 });
  const us = __T.members(q);
  const shots0 = G.stats.shots, k0 = G.stats.killed;
  __T.spawn(12, q.cx + 34, q.cy, 6);
  let maxDev = 0; const fired = new Set();
  __T.tick(25, (k) => { if (k > 30) for (const u of us) if (u.alive) maxDev = Math.max(maxDev, Math.hypot(u.x - u.slotX, u.y - u.slotY)); for (const u of us) if (u.alive && u.flashT > 0) fired.add(u.id); });
  const killed = G.stats.killed - k0, shots = G.stats.shots - shots0, firing = fired.size;
  const pass = killed >= 10 && shots >= 12 && maxDev < 2.0 && firing >= 6;
  __T.look(q.cx + 8, q.cy);
  return { pass, detail: shots + " bursts from " + firing + " of 9 soldiers, " + killed + "/12 infected killed, soldiers never more than " + maxDev.toFixed(2) + " m from their slots" };
})()`, "6_line_fire.png");

// 7 ------------------------------------------------------------------
await scenario("7 Circle defence against infected from every direction", `(() => {
  const G = __T.g(), q = __T.setup(${SQUAD}, "circle", { face: 0 });
  const us = __T.members(q);
  const zs = [];
  for (const a of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) zs.push(...__T.spawn(5, q.cx + Math.cos(a) * 30, q.cy + Math.sin(a) * 30, 4));
  const quadOf = (z) => (Math.round(Math.atan2(z.y - q.cy, z.x - q.cx) / (Math.PI / 2)) + 4) % 4;
  const killedQ = new Set(); let multi = 0, alive0 = us.length;
  __T.tick(28, (k) => {
    const tq = new Set(); for (const u of us) { const t = G.get(u.target); if (u.alive && t && !t.dead && u.losOk) tq.add(quadOf(t)); }
    if (tq.size >= 3) multi++;
    for (const z of zs) if (z.dead && !z._q) { z._q = 1; killedQ.add(quadOf(z)); }
  });
  const killed = zs.filter((z) => z.dead).length, outward = us.filter((u) => u.alive).every((u) => { const sl = q.slots.get(u.id); return !sl || sl.f * Math.cos(sl.face) + sl.s * Math.sin(sl.face) > 0 || Math.hypot(sl.f, sl.s) < 1.5; }); // centre slots (medic, engineer) excepted
  const pass = killedQ.size === 4 && multi > 15 && killed >= 16 && outward;
  __T.look(q.cx, q.cy);
  return { pass, detail: killed + "/20 killed, kills in " + killedQ.size + "/4 directions, soldiers engaging 3+ directions at once for " + (multi / 30).toFixed(1) + " s, all perimeter slots face outward: " + outward + ", soldiers alive " + us.filter((u) => u.alive).length + "/" + alive0 };
})()`, "7_circle.png");

// 7b ------------------------------------------------------------------
await scenario("7b Line turns to face infected coming from behind", `(() => {
  const G = __T.g(), q = __T.setup(${SQUAD}, "line", { face: 0 });
  __T.spawn(8, q.cx - 34, q.cy, 5);
  const f0 = q.facing; let t90 = -1; const fs = [];
  __T.tick(10, (k) => { fs.push(q.facing); if (t90 < 0 && Math.abs(Math.atan2(Math.sin(q.facing - f0), Math.cos(q.facing - f0))) > Math.PI / 2) t90 = k / 30; });
  const end = Math.abs(Math.atan2(Math.sin(q.facing - Math.PI), Math.cos(q.facing - Math.PI)));
  let maxStep = 0; for (let i = 1; i < fs.length; i++) maxStep = Math.max(maxStep, Math.abs(Math.atan2(Math.sin(fs[i] - fs[i - 1]), Math.cos(fs[i] - fs[i - 1]))));
  const pass = t90 > 0 && t90 < 4 && end < 0.5 && maxStep <= 1.3 / 30 + 1e-3;
  return { pass, detail: "line swung past 90° after " + t90.toFixed(1) + " s, ended " + (end * 57.3).toFixed(0) + "° off the threat, max swing " + (maxStep * 30).toFixed(2) + " rad/s" };
})()`);

// 8 ------------------------------------------------------------------
await scenario("8 Formation breaks when overwhelmed", `(() => {
  const G = __T.g(), q = __T.setup(["rifleman", "rifleman", "assault", "medic", "engineer"], "wedge", { face: 0 });
  __T.spawn(26, q.cx, q.cy, 5);
  let brokeAt = -1, fleeing = 0; const t0 = G.time;
  __T.tick(8, () => { if (brokeAt < 0 && q.broken > 0) { brokeAt = G.time - t0; fleeing = __T.members(q).filter((u) => u.order.kind === "move").length; } });
  const ev = __T.events.some((e) => e.ev === "broken"), msg = G.radioLog.some((m) => /formation is breaking/.test(m.text));
  __T.look(q.cx, q.cy, 22);
  return { pass: brokeAt > 0 && ev && msg && fleeing >= 3, detail: "formation broke after " + brokeAt.toFixed(1) + " s (radio: " + msg + "), " + fleeing + " soldiers falling back on their own" };
})()`, "8_broken.png");

// 9 ------------------------------------------------------------------
await scenario("9 Infected leader hands over command, turns and attacks his squad", `(() => {
  const S = __df.__squads, G = __T.g(), q = __T.setup(${SQUAD}, "wedge", { face: 0 });
  const L0 = G.get(q.leader);
  S.infect(G, L0, 4);
  __T.tick(0.2);
  const handed = q.leader !== L0.id && G.get(q.leader).alive;
  __T.tick(4.5);
  // the turned soldier as he rose (the squad usually shoots him within a second)
  const ev = window.__T.turnedEv, z = ev && ev.z;
  const tgt = ev && G.get(ev.target);
  const hostile = !!z && ev.state === "chase" && !!tgt && tgt.squad === q.id;
  window.__T.turned = z;
  return { pass: handed && !L0.alive && hostile, detail: "command passed to " + G.get(q.leader).name + " on infection: " + handed + "; " + L0.name + " turned: " + !L0.alive + "; the new infected goes for " + (tgt ? tgt.name + " of his old squad" : "nobody") + (z ? " [state " + z.state + ", hp " + Math.round(z.hp) + ", dead " + z.dead + ", target " + z.target + "]" : " [no zombie]") };
})()`);

// 10 -----------------------------------------------------------------
await scenario("10 Remaining soldiers reorganise and keep fighting", `(() => {
  const G = __T.g(), q = G.squads[0], z = window.__T.turned;
  __T.tick(12);
  const us = __T.members(q), err = __T.slotErr(us);
  const pass = !!z && z.dead && us.length === 8 && q.slots.size === 8 && Math.max(...err) < 1.5;
  __T.look(q.cx, q.cy, 20);
  return { pass, detail: "turned soldier put down: " + (!!z && z.dead) + "; " + us.length + " soldiers in " + q.slots.size + " slots, slot error max " + Math.max(...err).toFixed(2) + " m" };
})()`, "10_after_turn.png");

// 11 (spec §16) --------------------------------------------------------
await scenario("11 Corpses pile up in front of a sandbag line and the infected climb over", `(() => {
  // three riflemen against waves of 40: enough pressure for the infected to reach the wall
  const G = __T.g(), q = __T.setup(["rifleman", "rifleman", "rifleman"], "line", { face: 0 });
  G.addUnit("rifleman", q.cx - 120, q.cy);   // a spare soldier far away, so losing this squad does not end the mission
  // a sandbag wall 4 m in front of the line
  for (let k = -2; k <= 2; k++) G.addObstacle("sandbags", q.cx + 5, q.cy + k * 4, Math.PI / 2, 1);
  q.dirty = true; __T.tick(2);
  let maxPile = 0, climbs = 0, inside = 0;
  for (let wave = 0; wave < 6; wave++) {
    __T.spawn(40, q.cx + 10, q.cy, 4);
    __T.tick(12, () => { for (const z of G.zombies) { if (!z.dead && z.climbT > 1.55) { climbs++; maxPile = Math.max(maxPile, G.pileH(z.x, z.y)); } if (!z.dead && z.x < q.cx + 4.2 && Math.abs(z.y - q.cy) < 10) inside++; } });
  }
  const ev = __T.events.some((e) => e.ev === "climb");
  __T.look(q.cx + 4, q.cy, 18);
  return { pass: maxPile >= 0.85 && climbs > 0 && ev, detail: "pile under the climbers " + maxPile.toFixed(2) + " m against 0.9 m sandbags; climbing ticks: " + climbs + " (radio/event: " + ev + "), breached the line " + (inside > 0) + ", soldiers alive " + __T.members(q).length + "/3" };
})()`, "11_pile.png");

// 12 -----------------------------------------------------------------
await scenario("12 Defensive formation fills the defensive positions first", `(() => {
  const G = __T.g(), q = __T.setup(${SQUAD}, "wedge", { face: 0 });
  const [x, y] = [q.cx + 12, q.cy];
  const mg = G.addObstacle("mg_emplacement", x + 6, y, 0, 1), sb = G.addObstacle("sandbags", x, y + 6, 0, 1);
  __df.__issue(G, __T.members(q), { kind: "defend", x, y }, {});
  __T.tick(14);
  const us = __T.members(q);
  // the sandbag wall runs east-west 6 m north of the point: its defended side is the south face
  const atMg = us.some((u) => Math.hypot(u.x - mg.x, u.y - mg.y) < 1.2), behindSb = us.filter((u) => Math.abs(u.x - sb.x) < 2.2 && u.y < sb.y - 0.4 && u.y > sb.y - 2).length;
  const rs = us.map((u) => Math.hypot(u.x - x, u.y - y)), minPair = __T.minPair(us);
  const pass = q.formation === "defensive" && atMg && behindSb >= 1 && minPair > 1.6;
  __T.look(x, y, 20);
  return { pass, detail: "manning the MG: " + atMg + ", behind the sandbags: " + behindSb + ", soldiers spread " + Math.min(...rs).toFixed(1) + "–" + Math.max(...rs).toFixed(1) + " m from the point, closest pair " + minPair.toFixed(1) + " m" };
})()`, "12_defensive.png");

// 13 -----------------------------------------------------------------
await scenario("13 Player commands: leader, face, hold, regroup, new squad", `(() => {
  const S = __df.__squads, G = __T.g(), q = __T.setup(${SQUAD}, "line", { face: 0 });
  const us = __T.members(q);
  const pick = us.find((u) => u.type === "sniper");
  S.setLeader(G, pick);
  const led = q.leader === pick.id;
  S.faceTo(G, q, q.cx, q.cy + 30);
  __T.tick(3);
  const faced = Math.abs(Math.atan2(Math.sin(q.facing - Math.PI / 2), Math.cos(q.facing - Math.PI / 2))) < 0.1;
  // two soldiers sent off alone, then regrouped
  const two = us.filter((u) => u.type === "rifleman");
  __df.__issue(G, two, { kind: "move", x: q.cx - 25, y: q.cy - 10 }, {});
  __T.tick(8);
  const detached = two.every((u) => u.detached), away = two.every((u) => Math.hypot(u.x - q.cx, u.y - q.cy) > 15);
  S.regroup(G, q);
  __T.tick(12);
  const back = two.every((u) => !u.detached && Math.hypot(u.x - u.slotX, u.y - u.slotY) < 1.2);
  // hold: nobody moves
  __df.__issue(G, us, { kind: "hold" }, {});
  const p0 = us.map((u) => [u.x, u.y]); __T.tick(4);
  const held = us.every((u, i) => Math.hypot(u.x - p0[i][0], u.y - p0[i][1]) < 0.3);
  // split off a second squad and send both squads to different places
  const q2 = S.createSquad(G, us.slice(5), "Bravo", "column");
  __df.__issue(G, __T.members(q), { kind: "move", x: q.cx + 30, y: q.cy }, {});
  __df.__issue(G, __T.members(q2), { kind: "move", x: q.cx - 30, y: q.cy }, {});
  __T.tick(20);
  const two_sq = G.squads.length === 2 && q.halted && q2.halted && Math.hypot(q.cx - q2.cx, q.cy - q2.cy) > 40;
  const pass = led && faced && detached && away && back && held && two_sq;
  __T.look((q.cx + q2.cx) / 2, (q.cy + q2.cy) / 2, 34);
  return { pass, detail: "set leader " + led + ", face " + faced + ", soldiers detached on their own " + (detached && away) + ", regrouped " + back + ", hold " + held + ", two squads moved independently " + two_sq };
})()`, "13_two_squads.png");

// formation gallery --------------------------------------------------
for (const f of ["wedge", "line", "column", "box", "circle", "defensive"]) {
  await scenario("Gallery: " + f, `(() => {
    const G = __T.g(), q = __T.setup(${SQUAD}, "${f}", { face: 0.35, settle: 12 });
    const err = __T.slotErr(__T.members(q));
    __T.look(q.cx, q.cy, 10);
    for (const u of G.units) u.selected = false;
    const sp = __df.render.sprites, cam = __df.session.cam;
    const poses = __T.members(q).map((u) => sp.soldierPose(G, u, cam, __df.render.time, 60).anim);
    return { pass: Math.max(...err) < 1.2, detail: "all 9 soldiers within " + Math.max(...err).toFixed(2) + " m of their slots; facing " + q.facing.toFixed(2) + ", poses " + poses.join(" ") };
  })()`, `form_${f}.png`);
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} formation checks passed; page errors: ${errors.length}`);
if (errors.length) console.log(errors.slice(0, 5).join("\n"));
fs.writeFileSync(path.join(OUT, "results.json"), JSON.stringify({ results, errors }, null, 1));
await browser.close(); srv.close();
process.exit(failed.length || errors.length ? 1 : 0);

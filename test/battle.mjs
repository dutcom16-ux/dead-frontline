// Game-wide animation QA: a large mixed battle drawn through the real renderer (Sprites.draw on a
// canvas every step at 30 fps, the full 3D + overlay frame every half second), checking the
// animation of every figure on screen at once:
//   rapid commands    the squad gets a new move order every 0.4 s, then halts: views step one at a
//                     time, never flicker back, nobody is left walking on the spot after the halt
//   selection         units are selected and deselected while animating: selection rings follow
//   battle            20 soldiers, a jeep and a tank against 160 infected of every type from all
//                     sides: no missing frames, no flicker, no pose for the dead, every soldier and
//                     infected death plays once and stays
//   performance       sprite drawing time per frame and full frame time (software rendering)
//   node test/battle.mjs [dist]
import path from "node:path";
import { serve, loadPlaywright } from "./serve.mjs";
const { chromium } = loadPlaywright();
const DIR = path.resolve(process.argv[2] || "dist");
const PORT = +(process.env.PORT || 8787);
const srv = await serve(DIR, PORT);
const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.addInitScript(() => { let s = 2024; Math.random = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; });
await page.goto(`http://localhost:${PORT}/?manualtick`);
await page.waitForSelector("#menu:not([hidden])", { timeout: 90000 });
await page.click("#mNew"); await page.click('[data-diff="medium"]');
await page.click('[data-op="op01"]'); await page.click("#bDeploy");
await page.waitForFunction(() => window.__df && window.__df.session && window.__df.session.game && window.__df.render.sprites.mil, null, { timeout: 90000 });

const r = await page.evaluate(() => {
  const A = window.__df, s = A.session, g = s.game, sp = A.render.sprites, cam = s.cam, bf = g.bf;
  A.frame = () => {};
  g.paths.timeCapMs = Infinity;
  for (const z of g.zombies) z.dead = true;
  for (const n of g.nests) n.spawnT = 1e9;
  g.compact();
  const canvas = document.createElement("canvas"); canvas.width = 1280; canvas.height = 720;
  const ctx = canvas.getContext("2d");
  const ui = { hover: null, box: null, ghost: null, showPaths: false };
  const atlasOf = { soldierPose: sp.mil.atlas, zpose: sp.zombies.atlas, zpose8: sp.zs.atlas };
  const log = new Map();
  let missing = 0, deadPoses = 0;
  for (const name of Object.keys(atlasOf)) {
    const orig = sp[name].bind(sp);
    sp[name] = (...a) => {
      const p = orig(...a), e = a[1], now = a[3];
      const ids = atlasOf[name].anims[p.anim];
      if (!ids) missing++;
      if (e.dead || e.alive === false) deadPoses++;
      const st = sp.anim.get(e.id);
      if (!log.has(e.id)) log.set(e.id, { kind: name, seq: [] });
      const seq = log.get(e.id).seq;
      if (!seq.length || seq[seq.length - 1].t < now) seq.push({ t: now, view: st ? st.dir : -1, nv: st ? st.nv : 8, adeg: name === "soldierPose" && !isNaN(e.aimH) ? sp.compassDeg(a[2], e.aimH) : null, anim: p.anim, x: e.x, y: e.y, moving: e.moving });
      return p;
    };
  }
  let drawMs = 0, draws = 0, frameMs = 0, frames = 0, n = 0, maxDraw = 0;
  let focus = null;
  const step = (sec, each) => {
    for (let k = 0; k < Math.round(sec * 30); k++) {
      s.tick(1 / 30);
      if (each) each(k);
      if (focus) cam.lookAt(focus[0], focus[1]);
      cam.update(1 / 30, (x, y) => bf.h(x, y));
      if (n++ % 15 === 0) { const t = performance.now(); A.render.render(g, cam, g.time, ui); frameMs += performance.now() - t; frames++; }
      ctx.clearRect(0, 0, 1280, 720);
      const t0 = performance.now();
      sp.draw(ctx, g, bf, cam, 1280, 720, g.time);
      const dt = performance.now() - t0; drawMs += dt; draws++; maxDraw = Math.max(maxDraw, dt);
    }
  };
  const L = g.get(g.squads[0].acting);
  const C = bf.freeNear(L.x + 130, L.y + 10, 20, false) || [L.x + 130, L.y + 10];
  const squad = g.units.filter((u) => u.alive && !u.vehicle);
  for (const [k, u] of squad.entries()) { u.x = C[0] + (k % 3) * 2; u.y = C[1] + Math.floor(k / 3) * 2; }
  A.__issue(g, squad, { kind: "hold" }, {});
  focus = C; cam.zoom = 45;
  step(1);

  // ---- 1. rapid commands: a new move order every 0.4 s for 8 s, then halt
  const rapidFrom = g.time;
  for (let j = 0; j < 20; j++) {
    const a = j * 2.3, p = bf.freeNear(C[0] + Math.cos(a) * 12, C[1] + Math.sin(a) * 12, 8, false) || C;
    A.__issue(g, squad.filter((u) => u.alive), { kind: "move", x: p[0], y: p[1] }, {});
    step(0.4);
  }
  A.__issue(g, squad.filter((u) => u.alive), { kind: "hold" }, {});
  const haltAt = g.time;
  step(2.5);
  const rapidTo = g.time;

  // ---- 2. selection and deselection while animating
  let ringsOk = 0, ringChecks = 0;
  for (let j = 0; j < 6; j++) {
    for (const [k, u] of squad.entries()) u.selected = u.alive && (k + j) % 2 === 0;
    A.__issue(g, squad.filter((u) => u.selected), { kind: "move", x: C[0] + (j % 2 ? 6 : -6), y: C[1] }, {});
    step(0.5);
    A.render.render(g, cam, g.time, ui);
    const rings = (A.render.lists.get("m_ring") || []).length, sel = squad.filter((u) => u.selected && u.alive && u.inVehicle === null).length;
    ringChecks++; if (rings >= sel) ringsOk++;
  }
  for (const u of squad) u.selected = false;

  // ---- 3. battle: reinforcements, two vehicles, 160 infected of every type from all sides
  const extra = [];
  for (let k = 0; k < 11; k++) { const u = g.addUnit(["rifleman", "assault", "machine_gunner", "shotgunner", "medic"][k % 5], C[0] - 4 + (k % 4) * 2, C[1] + 6 + Math.floor(k / 4) * 2); extra.push(u); }
  // three unarmed, wounded soldiers out in front: soldiers will die in the fight
  for (const [k, u] of extra.slice(0, 3).entries()) { u.hp = 5; u.mag = 0; u.reserve = 0; u.x = C[0] + 14; u.y = C[1] - 4 + k * 4; }
  const veh = ["jeep", "tank"].map((t, k) => g.addUnit(t, C[0] + (k ? 8 : -8), C[1] - 6)).filter(Boolean);
  const army = [...squad, ...extra, ...veh].filter((u) => u && u.alive);
  A.__issue(g, army, { kind: "hold" }, {});
  const TYPES = ["walker", "walker", "runner", "crawler", "brute", "bloater", "screamer", "mutant"];
  const horde = [];
  for (let k = 0; k < 160; k++) {
    const a = (k / 160) * Math.PI * 2 * 3, rr = 35 + (k % 5) * 6;
    const z = g.addZombie(TYPES[k % TYPES.length], C[0] + Math.cos(a) * rr, C[1] + Math.sin(a) * rr); if (!z) continue;
    const t = k % 4 === 0 ? extra[(k / 4) % 3] : army[k % army.length];
    z.awake = true; z.state = "chase"; z.target = t.id; z.lastSeenX = t.x; z.lastSeenY = t.y; z.lastSeenT = g.time; horde.push(z);
  }
  // the squad advances through the fight half-way through (units attacking while others move)
  const battleFrom = g.time;
  step(20);
  A.__issue(g, squad.filter((u) => u.alive), { kind: "move", x: C[0] + 15, y: C[1] + 5 }, {});
  step(20);
  const battleTo = g.time;
  // follow the bodies for 3 more seconds
  const bodies = g.corpses.filter((c) => c.t >= battleFrom && c.uid !== undefined);
  const deathTrack = new Map();
  const oDying = sp.dyingPose.bind(sp);
  for (let j = 0; j < 90; j++) {
    step(1 / 30);
    for (const c of bodies) {
      if (!(c.kind === "soldier" || c.sprite)) continue;
      const p = oDying(g, c, cam);
      if (!deathTrack.has(c.id)) deathTrack.set(c.id, []);
      deathTrack.get(c.id).push({ age: g.time - c.t, i: p.i, anim: p.anim });
    }
  }
  const soldierDeaths = [...deathTrack.values()];
  const deathsOk = soldierDeaths.filter((tr) => tr.every((q, j) => j === 0 || (q.i >= tr[j - 1].i && q.anim === tr[0].anim)) && tr.filter((q) => q.age > 0.1 * sp.mil.atlas.anims[tr[0].anim].length + 0.05).every((q) => q.i === sp.mil.atlas.anims[tr[0].anim].length - 1)).length;   // the last frame from (frames / 10 fps) on
  const infectedBodies = bodies.filter((c) => !(c.kind === "soldier" || c.sprite)).length;

  // ---- metrics
  const sum = (from, to) => {
    const m = { figures: 0, frames: 0, jumps: 0, flicker: 0, walkInPlace: 0 };
    for (const { kind, seq } of log.values()) {
      const w = seq.filter((q) => q.t >= from && q.t <= to);
      if (w.length < 2) continue;
      m.figures++;
      let lastChange = null, stillT = 0;
      for (let k = 1; k < w.length; k++) {
        const a = w[k - 1], q = w[k]; m.frames++;
        if (q.view !== a.view) {
          const nv = q.nv || 8;
          if (Math.min((q.view - a.view + nv) % nv, (a.view - q.view + nv) % nv) > 1) m.jumps++;
          // flicker = the view going back while the rifle hardly moved (a soldier's rifle swinging back to
          // a new target is a real turn)
          const swung = q.adeg != null && lastChange && lastChange.adeg != null && Math.abs(((q.adeg - lastChange.adeg + 540) % 360) - 180) >= 180 / nv;
          if (lastChange && lastChange.from === q.view && q.t - lastChange.t < 0.25 && !swung) m.flicker++;
          lastChange = { from: a.view, t: q.t, adeg: q.adeg };
        }
        // a walk clip on a figure that has not moved for 0.3 s: walking on the spot (stuck state)
        const still = Math.hypot(q.x - a.x, q.y - a.y) < 1e-4;
        stillT = still ? stillT + (q.t - a.t) : 0;
        if (stillT > 0.3 && /^(walk|z_walk)_/.test(q.anim) && !(kind === "zpose8" && /_\w+$/.test(q.anim) && false)) m.walkInPlace++;
      }
    }
    return m;
  };
  const rapid = sum(rapidFrom, rapidTo), battle = sum(battleFrom, battleTo);
  // after the halt: everyone off the walk clip within 1.5 s (no state stuck on walking)
  let stuck = 0;
  for (const u of squad) { if (!u.alive) continue; const seq = log.get(u.id)?.seq || []; const after = seq.filter((q) => q.t > haltAt + 1.5 && q.t <= rapidTo); if (after.some((q) => /^walk_/.test(q.anim) && !q.moving)) stuck++; }
  return {
    rapid, battle, stuck, ringsOk, ringChecks, missing, deadPoses,
    soldierDeaths: soldierDeaths.length, deathsOk, infectedBodies,
    zombiesKilled: horde.filter((z) => z.dead).length, horde: horde.length, armyAlive: army.filter((u) => u.alive).length, army: army.length,
    drawMs: drawMs / draws, maxDraw, frameMs: frameMs / frames,
  };
});

const ok = (c) => (c ? "PASS" : "FAIL");
const checks = [
  [r.rapid.jumps === 0 && r.rapid.flicker === 0, `rapid commands (20 move orders in 8 s): ${r.rapid.figures} figures, ${r.rapid.jumps} skipped views, ${r.rapid.flicker} flickers`],
  [r.stuck === 0 && r.rapid.walkInPlace === 0, `after the halt nobody keeps walking: ${r.stuck} stuck, ${r.rapid.walkInPlace} frames walking on the spot`],
  [r.ringsOk === r.ringChecks, `selection rings follow selection and deselection while moving: ${r.ringsOk}/${r.ringChecks}`],
  [r.battle.jumps === 0 && r.battle.flicker === 0, `battle (${r.army} units incl. a jeep and a tank vs ${r.horde} infected): ${r.battle.figures} figures animated, ${r.battle.frames} figure-frames, ${r.battle.jumps} skipped views, ${r.battle.flicker} flickers`],
  [r.battle.walkInPlace === 0, `battle: no figure walking on the spot: ${r.battle.walkInPlace}`],
  [r.soldierDeaths > 0 && r.deathsOk === r.soldierDeaths, `soldier deaths in combat play once and hold: ${r.deathsOk}/${r.soldierDeaths} (and ${r.infectedBodies} infected bodies)`],
  [r.deadPoses === 0, `no walking/firing pose for the dead: ${r.deadPoses}`],
  [r.missing === 0, `every requested frame exists: ${r.missing} missing`],
  [r.drawMs < 25, `sprite drawing: ${r.drawMs.toFixed(1)} ms per frame on average, ${r.maxDraw.toFixed(1)} ms at most; CPU time to build a full 3D + overlay frame ${r.frameMs.toFixed(1)} ms`],
  [errors.length === 0, `page errors: ${errors.length} ${errors.slice(0, 2).join(" | ")}`],
];
for (const [c, t] of checks) console.log(`${ok(c)}  ${t}`);
console.log(`${checks.filter((c) => c[0]).length}/${checks.length} game-wide animation checks passed (${r.zombiesKilled}/${r.horde} infected killed, ${r.armyAlive}/${r.army} units alive)`);
await browser.close(); srv.close();
process.exit(checks.every((c) => c[0]) ? 0 : 1);

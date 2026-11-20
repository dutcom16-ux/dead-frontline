// Animation steadiness test for the infantry sprites (no jitter):
// a squad marches a square, turns about, then fights. On every simulation step each soldier's
// chosen clip, frame and facing are recorded (as the renderer would choose them at 30 fps), and:
//   * every direction change is to the next view (no snapping across), with no back-and-forth
//     flicker within 0.25 s,
//   * walking straight, the view does not change,
//   * the walk/run cycle advances by distance (frames per metre constant: no foot sliding),
//   * walk/run does not flip back and forth,
//   * a muzzle flash is only shown within 0.2 s of a shot,
//   * every clip/frame the renderer asks for exists in the atlas.
//   node test/anim.mjs [dist]
import path from "node:path";
import { serve, loadPlaywright } from "./serve.mjs";
const { chromium } = loadPlaywright();
const DIR = path.resolve(process.argv[2] || "dist");
const PORT = +(process.env.PORT || 8783);
const srv = await serve(DIR, PORT);
const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.addInitScript(() => { let s = 4242; Math.random = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; });
await page.goto(`http://localhost:${PORT}/?manualtick`);
await page.waitForSelector("#menu:not([hidden])", { timeout: 90000 });
await page.click("#mNew"); await page.click('[data-diff="medium"]');
await page.click('[data-op="op01"]'); await page.click("#bDeploy");
await page.waitForFunction(() => window.__df && window.__df.session && window.__df.session.game && window.__df.render.sprites.inf, null, { timeout: 90000 });

const r = await page.evaluate(() => {
  const A = window.__df, s = A.session, g = s.game, sp = A.render.sprites, cam = s.cam;
  g.paths.timeCapMs = Infinity;
  for (const z of g.zombies) z.dead = true;
  for (const n of g.nests) n.spawnT = 1e9;
  g.compact();
  const us = g.units.filter((u) => u.alive && !u.vehicle);
  const atlas = sp.inf.atlas;
  const log = new Map(us.map((u) => [u.id, []]));
  let missing = 0;
  const step = (sec) => {
    for (let k = 0; k < Math.round(sec * 30); k++) {
      s.tick(1 / 30);
      for (const u of us) {
        if (!u.alive) continue;
        const p = sp.poseInf(g, u, cam, g.time, 60);
        const ids = atlas.anims[p.anim];
        if (!ids || !ids.length || p.i < 0 || p.i >= ids.length) missing++;
        const st = sp.anim.get(u.id);
        log.get(u.id).push({ t: g.time, dir: st.dir, anim: p.anim, i: p.i, x: u.x, y: u.y, moving: u.moving, shot: g.time - st.shotT, run: st.run, cyc: /^(walk|run|firemove|movaim)_/.test(p.anim) });
      }
    }
  };
  step(3);
  const L = g.get(g.squads[0].acting);
  const [x0, y0] = [L.x, L.y];
  // a square: four legs with 90 degree turns, then straight back the other way (an about-turn)
  const legs = [[40, 0], [40, 40], [0, 40], [0, 0], [60, 0], [-10, 0]];
  for (const [dx, dy] of legs) {
    const p = g.bf.freeNear(x0 + dx, y0 + dy, 10, false) || [x0 + dx, y0 + dy];
    A.__issue(g, us.filter((u) => u.alive), { kind: "move", x: p[0], y: p[1] }, {});
    step(16);
  }
  // a fight: infected from two sides, the squad holds and shoots
  A.__issue(g, us.filter((u) => u.alive), { kind: "hold" }, {});
  for (const [dx, dy] of [[26, 6], [-24, -8]]) for (let k = 0; k < 6; k++) {
    const z = g.addZombie("walker", L.x + dx + k, L.y + dy); if (!z) continue;
    z.awake = true; z.state = "chase"; z.target = us[0].id; z.lastSeenX = us[0].x; z.lastSeenY = us[0].y; z.lastSeenT = g.time;
  }
  step(14);
  // ---- metrics
  const flickers = [];
  let expected = 0;
  let changes = 0, jumps = 0, flicker = 0, straightChanges = 0, straightTime = 0, runFlips = 0, flashOutside = 0, flashFrames = 0, metres = 0, frameSteps = 0;
  for (const [id, seq] of log) {
    let lastChange = null;
    let lastMode = null;
    for (let k = 1; k < seq.length; k++) {
      const a = seq[k - 1], b = seq[k];
      if (a.dir !== b.dir) {
        changes++;
        const dd = Math.min((a.dir - b.dir + 8) % 8, (b.dir - a.dir + 8) % 8);
        if (dd > 1) jumps++;
        if (lastChange && lastChange.from === b.dir && b.t - lastChange.t < 0.25) { flicker++; flickers.push({ id, t: +b.t.toFixed(2), dirs: [lastChange.from, a.dir, b.dir], anim: b.anim, moving: b.moving, dt: +(b.t - lastChange.t).toFixed(2) }); }
        lastChange = { from: a.dir, t: b.t };
      }
      const mode = b.cyc ? (b.run ? "run" : "walk") : null;
      if (mode && lastMode && mode !== lastMode) runFlips++;
      if (mode) lastMode = mode;
      if (/^(fire|firemove)_/.test(b.anim)) { flashFrames++; if (b.shot > 0.21) flashOutside++; }
      // stride: frames advanced per metre while walking (same clip)
      if (/^walk_/.test(b.anim) && !b.run && !a.run && a.anim === b.anim) {
        const d = Math.hypot(b.x - a.x, b.y - a.y);
        metres += d;
        const n = atlas.anims[b.anim].length;
        frameSteps += ((b.i - a.i + n) % n);
        expected += (d * n) / 1.6;
      }
    }
    // straight walking: windows of 2 s with the heading constant (from positions) and no order change
    for (let k = 60; k < seq.length; k += 30) {
      const w = seq.slice(k - 60, k);
      if (!w.every((q) => q.moving)) continue;
      const hx = w[59].x - w[0].x, hy = w[59].y - w[0].y;
      if (Math.hypot(hx, hy) < 3) continue;
      const h0 = Math.atan2(w[30].y - w[0].y, w[30].x - w[0].x), h1 = Math.atan2(w[59].y - w[30].y, w[59].x - w[30].x);
      if (Math.abs(Math.atan2(Math.sin(h1 - h0), Math.cos(h1 - h0))) > 0.12) continue;
      straightTime += 2;
      for (let j = 31; j < 60; j++) if (w[j].dir !== w[j - 1].dir) straightChanges++;
    }
  }
  const soldiers = log.size;
  return { soldiers, ticks: [...log.values()][0].length, changes, jumps, flicker, straightChanges, straightTime, runFlips, flashFrames, flashOutside, missing,
    framesPerMetre: metres > 0 ? frameSteps / metres : 0, expectedPerMetre: metres > 0 ? expected / metres : 0, kills: g.stats.killed, flickers };
});
const ok = (c) => (c ? "PASS" : "FAIL");
const checks = [
  [r.jumps === 0, `direction changes go to the next view: ${r.changes} changes, ${r.jumps} skipped a view`],
  [r.flicker === 0, `no back-and-forth flicker within 0.25 s: ${r.flicker}`],
  [r.straightChanges === 0 && r.straightTime > 20, `walking straight keeps one view: ${r.straightChanges} changes over ${r.straightTime} soldier-seconds`],
  [r.framesPerMetre > 0 && Math.abs(r.framesPerMetre - r.expectedPerMetre) < 0.15, `walk cycle tied to distance (no foot sliding): ${r.framesPerMetre.toFixed(2)} frames per metre, expected ${r.expectedPerMetre.toFixed(2)} (one cycle per 1.6 m)`],
  [r.runFlips <= r.soldiers * 14, `walk/run switches only with real changes of pace: ${r.runFlips} for ${r.soldiers} soldiers over 7 orders (≤ 14 each)`],
  [r.flashOutside === 0 && r.flashFrames > 0, `muzzle flash only right after a shot: ${r.flashFrames} flash frames, ${r.flashOutside} outside`],
  [r.missing === 0, `every requested clip/frame exists: ${r.missing} missing`],
  [errors.length === 0, `page errors: ${errors.length}`],
];
for (const [c, t] of checks) console.log(`${ok(c)}  ${t}`);
if (r.flickers.length) console.log("flicker:", JSON.stringify(r.flickers));
console.log(`${checks.filter((c) => c[0]).length}/${checks.length} animation checks passed (${r.soldiers} soldiers, ${r.ticks} steps, ${r.kills} infected killed)`);
await browser.close(); srv.close();
process.exit(checks.every((c) => c[0]) ? 0 : 1);

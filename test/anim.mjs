// Soldier animation test (military8 sheet): runs the real sprite drawing code (Sprites.draw on a
// canvas at 30 fps, game time) while the game plays deterministically, and checks:
//   atlas      every direction has walk (4), idle, fire (aim/shot/recoil, each with a barrel tip) and
//              dying (6) clips; the barrel tip lies on the rifle and points the way of the view
//              (dedicated N and S firing stances included)
//   march      a squad walks a square and turns about: views change one step at a time, no
//              flicker, one view while walking straight, walk cycle tied to distance (no sliding)
//   fight      while engaging (moving or not) never the walk clip; every shot starts the shot frame
//              with a flash; no flash without a shot; flashes last at most the shot frame
//   8 ways     one soldier fires at a target in each of the 8 screen directions (fire_<D>, flash
//              toward the target) and walks in each of the 8 directions (walk_<D>)
//   dying      soldiers killed in 8 different views: die_<D> from frame 0 to the last, once, and the
//              last frame stays; no walking or firing pose is ever computed for a dead soldier
//   node test/anim.mjs [dist]
import fs from "node:fs";
import path from "node:path";
import { serve, loadPlaywright } from "./serve.mjs";
const { chromium } = loadPlaywright();
const DIR = path.resolve(process.argv[2] || "dist");
const PORT = +(process.env.PORT || 8783);
const SHOTS = process.env.SHOTS || "";
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
await page.waitForFunction(() => window.__df && window.__df.session && window.__df.session.game && window.__df.render.sprites.mil, null, { timeout: 90000 });

const r = await page.evaluate(async () => {
  const A = window.__df, s = A.session, g = s.game, sp = A.render.sprites, cam = s.cam, bf = g.bf;
  A.frame = () => {};                    // the test draws the frames itself, on game time
  g.paths.timeCapMs = Infinity;
  for (const z of g.zombies) z.dead = true;
  for (const n of g.nests) n.spawnT = 1e9;
  g.compact();
  const atlas = sp.mil.atlas;
  const D8 = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  const out = { atlas: {}, march: {}, fight: {}, ways: { fire: {}, walk: {} }, dying: {} };

  // ---------------- atlas
  const cv = document.createElement("canvas"); cv.width = sp.mil.img.width; cv.height = sp.mil.img.height;
  const cx = cv.getContext("2d"); cx.drawImage(sp.mil.img, 0, 0);
  const px = cx.getImageData(0, 0, cv.width, cv.height).data;
  const alphaNear = (x, y) => { let m = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) m = Math.max(m, px[((y + dy) * cv.width + (x + dx)) * 4 + 3]); return m; };
  const clipBad = [], tipBad = [];
  for (const d of D8) {
    const want = { walk: 4, idle: 1, fire: 3, die: 6 };
    for (const k in want) {
      const ids = atlas.anims[k + "_" + d];
      if (!ids || ids.length !== want[k]) clipBad.push(k + "_" + d);
      else for (const i of ids) { const f = atlas.frames[i]; if (f.x < 0 || f.y < 0 || f.x + f.w > atlas.size[0] || f.y + f.h > atlas.size[1]) clipBad.push(k + "_" + d + " out of the atlas"); }
    }
    for (const i of atlas.anims["fire_" + d] || []) {
      const f = atlas.frames[i];
      if (f.mx === undefined) { tipBad.push(d + " no tip"); continue; }
      const ref = atlas.ref / (f.k || 1);
      const vx = (f.mx - f.ax) / ref, vy = (f.my - f.ay) / ref;          // from the feet, in figure heights (y down)
      const on = alphaNear(f.x + f.mx, f.y + f.my) > 100;
      const ok = { N: vy < -0.95 && Math.abs(vx) < 0.2, S: Math.abs(vx) < 0.15 && vy < -0.45 && vy > -0.8, E: vx > 0.25, W: vx < -0.25,
        NE: vx > 0.05 && vy < -0.95, NW: vx < -0.05 && vy < -0.95, SE: vx > 0.15 && vy > -0.8, SW: vx < -0.15 && vy > -0.8 }[d];
      if (!ok || !on) tipBad.push(`${d} tip (${vx.toFixed(2)}, ${vy.toFixed(2)}) on rifle ${on}`);
    }
  }
  // one standing height for every direction (the sheet draws some directions taller)
  const heights = D8.map((d) => {
    const f = atlas.frames[atlas.anims["idle_" + d][0]];
    let top = f.h;
    for (let y = 0; y < f.h && top === f.h; y++) for (let x = 0; x < f.w; x++) if (px[((f.y + y) * cv.width + f.x + x) * 4 + 3] > 128) { top = y; break; }
    return ((f.ay - top) * (f.k || 1)) / atlas.ref;
  });
  out.atlas = { clipBad, tipBad, heights };

  // ---------------- drawing harness: Sprites.draw on a canvas every step, game time
  const canvas = document.createElement("canvas"); canvas.width = 1280; canvas.height = 720;
  const ctx = canvas.getContext("2d");
  const W = 1280, H = 720;
  const log = new Map();
  let deadPoses = 0, missing = 0;
  const orig = sp.soldierPose.bind(sp);
  sp.soldierPose = (gg, u, c, now, human) => {
    const p = orig(gg, u, c, now, human);
    if (!u.alive) deadPoses++;
    const ids = atlas.anims[p.anim];
    if (!ids || p.i < 0 || p.i >= ids.length) missing++;
    if (!log.has(u.id)) log.set(u.id, []);
    const seq = log.get(u.id), st = sp.anim.get(u.id);
    const t = gg.get(u.target);
    const eng = !!t && !t.dead && u.losOk && (u.mag > 0 || u.reserve > 0);
    if (!seq.length || seq[seq.length - 1].t < now) seq.push({ t: now, dir: st.dir, state: p.state, anim: p.anim, i: p.i, flash: p.flash, x: u.x, y: u.y, moving: u.moving, spd: st.spd, shotN: u.shotN, eng, wid: u.wid });
    return p;
  };
  const ui = { hover: null, box: null, ghost: null, showPaths: false };
  let follow = null, n = 0;
  const step = (sec) => {
    for (let k = 0; k < Math.round(sec * 30); k++) {
      s.tick(1 / 30);
      if (follow) for (const [z, x, y] of follow.pins) { z.x = x; z.y = y; z.lastX = x; z.lastY = y; }
      if (follow && follow.u) cam.lookAt(follow.u.x, follow.u.y);
      cam.update(1 / 30, (x, y) => bf.h(x, y));
      if (n++ % 15 === 0) A.render.render(g, cam, g.time, ui);   // camera matrices for screen positions
      ctx.clearRect(0, 0, W, H);
      sp.draw(ctx, g, bf, cam, W, H, g.time);
    }
  };
  const us = g.units.filter((u) => u.alive && !u.vehicle);
  const L = g.get(g.squads[0].acting);
  follow = { u: L, pins: [] };
  step(3);

  // ---------------- march: a square, then an about-turn
  const [x0, y0] = [L.x, L.y];
  const marchFrom = g.time;
  for (const [dx, dy] of [[40, 0], [40, 40], [0, 40], [0, 0], [60, 0], [-10, 0]]) {
    const p = bf.freeNear(x0 + dx, y0 + dy, 10, false) || [x0 + dx, y0 + dy];
    A.__issue(g, us.filter((u) => u.alive), { kind: "move", x: p[0], y: p[1] }, {});
    step(16);
  }
  const marchTo = g.time;
  // ---------------- fight: infected from two sides; the squad holds and shoots, then advances firing
  A.__issue(g, us.filter((u) => u.alive), { kind: "hold" }, {});
  const spawnWave = (pairs, n) => { for (const [dx, dy] of pairs) for (let k = 0; k < n; k++) {
    const z = g.addZombie("walker", L.x + dx + k, L.y + dy); if (!z) continue;
    z.awake = true; z.state = "chase"; z.target = us[0].id; z.lastSeenX = us[0].x; z.lastSeenY = us[0].y; z.lastSeenT = g.time;
  } };
  spawnWave([[26, 6], [-24, -8]], 6);
  step(10);
  spawnWave([[30, 0]], 8);
  { const p = bf.freeNear(L.x + 20, L.y, 10, false) || [L.x + 20, L.y]; A.__issue(g, us.filter((u) => u.alive), { kind: "move", x: p[0], y: p[1] }, {}); }
  step(8);
  const fightTo = g.time;

  // ---------------- metrics over march + fight
  let changes = 0, jumps = 0, flicker = 0, wobble = 0, wobbleWalk = 0, straightChanges = 0, straightTime = 0, metres = 0, frameSteps = 0, expected = 0;
  let walkStarts = 0, walkStartsOnStep = 0;
  let shots = 0, shotsShown = 0, flashNoShot = 0, flashLong = 0, walkWhileEngaging = 0, engagedMovingFrames = 0, fireFrames = 0;
  const flickers = [], wwe = [], straightBad = [];
  for (const [id, seq0] of log) {
    const seq = seq0.filter((q) => q.t >= marchFrom && q.t <= fightTo);
    let lastChange = null, lastShotT = -9;
    for (let k = 1; k < seq.length; k++) {
      const a = seq[k - 1], b = seq[k];
      if (a.dir !== b.dir) {
        changes++;
        if (Math.min((a.dir - b.dir + 8) % 8, (b.dir - a.dir + 8) % 8) > 1) jumps++;
        if (lastChange && lastChange.from === b.dir && b.t - lastChange.t < 0.25) { flicker++; flickers.push({ id, t: +b.t.toFixed(2), anim: b.anim }); }
        if (lastChange && lastChange.from === b.dir && b.t - lastChange.t < 1) { wobble++; if (b.state === "walk") wobbleWalk++; }
        lastChange = { from: a.dir, t: b.t };
      }
      // firing: a new shot shows the shot frame and the flash at once; flashes only right after shots
      if (b.shotN !== a.shotN) { shots++; lastShotT = b.t; if (/^fire_/.test(b.anim) && b.i === 1 && (b.flash || b.wid === "flamer")) shotsShown++; }
      if (b.flash) { if (lastShotT < 0) flashNoShot++; else if (b.t - lastShotT > 0.061) flashLong++; }
      // (sniper rifles, rocket launchers and machine guns cannot fire on the move in this game: walking is right for them)
      if (b.eng && !["sniper", "rocket", "lmg"].includes(b.wid)) { if (/^walk_/.test(b.anim)) { walkWhileEngaging++; wwe.push({ id, t: +b.t.toFixed(2), wid: b.wid }); } if (b.moving) engagedMovingFrames++; }
      if (b.state === "fire") fireFrames++;
      // a walk starts with a step (the first stride frame), not mid-cycle
      if (/^walk_/.test(b.anim) && !/^walk_/.test(a.anim)) { walkStarts++; if (b.i === 0) walkStartsOnStep++; }
      // walk cycle advances with the distance covered
      if (/^walk_/.test(b.anim) && a.anim === b.anim) {
        const d = Math.hypot(b.x - a.x, b.y - a.y), nn = atlas.anims[b.anim].length;
        metres += d; frameSteps += (b.i - a.i + nn) % nn; expected += (d * nn) / (1.4 + 0.25 * Math.max(0, b.spd));
      }
    }
    for (let k = 60; k < seq.length; k += 30) {
      const w = seq.slice(k - 60, k);
      if (!w.every((q) => q.moving && q.state === "walk")) continue;
      if (Math.hypot(w[59].x - w[0].x, w[59].y - w[0].y) < 3) continue;
      const h0 = Math.atan2(w[30].y - w[0].y, w[30].x - w[0].x), h1 = Math.atan2(w[59].y - w[30].y, w[59].x - w[30].x);
      if (Math.abs(Math.atan2(Math.sin(h1 - h0), Math.cos(h1 - h0))) > 0.12) continue;
      straightTime += 2;
      for (let j = 31; j < 60; j++) if (w[j].dir !== w[j - 1].dir) { straightChanges++; straightBad.push({ id, t: +w[j].t.toFixed(2), from: w[j - 1].dir, to: w[j].dir, h: +(h1 * 57.3).toFixed(1) }); }
    }
  }
  const flashesDrawn = sp.flashes.filter((f) => f.t >= marchFrom && f.t <= fightTo).length;
  out.march = { walkStarts, walkStartsOnStep, changes, jumps, flicker, wobble, wobbleWalk, flickers: flickers.slice(0, 5), straightChanges, straightBad, straightTime, framesPerMetre: metres ? frameSteps / metres : 0, expectedPerMetre: metres ? expected / metres : 0, metresPerCycle: frameSteps ? metres / (frameSteps / 4) : 0 };
  out.fight = { wwe: wwe.slice(0, 6), shots, shotsShown, flashNoShot, flashLong, walkWhileEngaging, engagedMovingFrames, fireFrames, flashesDrawn, kills: g.stats.killed };

  // ---------------- one soldier, eight directions: firing, then walking
  for (const z of g.zombies) z.dead = true;
  g.compact();
  const S0 = us.find((u) => u.alive && u.type === "rifleman") || us.find((u) => u.alive);
  for (const u of us) if (u.alive && u !== S0) { u.x += 200; u.y += 200; A.__issue(g, [u], { kind: "hold" }, {}); }
  A.__issue(g, [S0], { kind: "hold" }, {});
  follow = { u: S0, pins: [] };
  step(1);
  const [rx, ry] = cam.right, [fx, fy] = cam.forward;
  const mapDir = (deg) => { const c = (deg * Math.PI) / 180; return [rx * Math.sin(c) + fx * Math.cos(c), ry * Math.sin(c) + fy * Math.cos(c)]; };
  const home = [S0.x, S0.y];
  for (let k = 0; k < 8; k++) {
    const [vx, vy] = mapDir(k * 45);
    S0.x = home[0]; S0.y = home[1];
    A.__issue(g, [S0], { kind: "hold" }, {});
    const z = g.addZombie("walker", S0.x + vx * 9, S0.y + vy * 9);
    if (!z) continue;
    z.hp = z.maxHp = 1e7; z.awake = true; z.state = "idle";
    follow.pins = [[z, z.x, z.y]];
    step(1.6);
    const t0 = g.time;
    step(2.4);
    const seq = (log.get(S0.id) || []).filter((q) => q.t > t0);
    const fl = sp.flashes.filter((f) => f.id === S0.id && f.t > t0);
    out.ways.fire[D8[k]] = {
      clips: [...new Set(seq.map((q) => q.anim))],
      shots: seq.length ? seq[seq.length - 1].shotN - seq[0].shotN : 0,
      flashes: fl.length, flashDirs: [...new Set(fl.map((f) => f.dir))],
      tip: fl.length ? [+(fl[0].x).toFixed(2), +(fl[0].y).toFixed(2)] : null,
    };
    z.dead = true; follow.pins = []; g.compact();
    step(0.6);
  }
  for (let k = 0; k < 8; k++) {
    const [vx, vy] = mapDir(k * 45);
    S0.x = home[0]; S0.y = home[1]; step(0.8);
    const p = [home[0] + vx * 30, home[1] + vy * 30];
    A.__issue(g, [S0], { kind: "move", x: p[0], y: p[1] }, {});
    step(1.2);
    const t0 = g.time;
    step(2.5);
    const seq = (log.get(S0.id) || []).filter((q) => q.t > t0 && q.state === "walk");
    const want = "walk_" + D8[k];
    out.ways.walk[D8[k]] = { frames: seq.length, share: seq.length ? seq.filter((q) => q.anim === want).length / seq.length : 0, clips: [...new Set(seq.map((q) => q.anim))] };
    A.__issue(g, [S0], { kind: "hold" }, {});
  }

  // ---------------- dying in eight views
  const extra = [];
  for (let k = 0; k < 8; k++) { const u = g.addUnit("rifleman", home[0] + (k % 4) * 3 - 4, home[1] + Math.floor(k / 4) * 3); A.__issue(g, [u], { kind: "hold" }, {}); extra.push(u); }
  S0.x = home[0] + 14; S0.y = home[1];
  step(0.5);
  const corpses = [];
  extra.forEach((u, k) => { const st = sp.anim.get(u.id); st.dir = k; st.prevDir = -1; st.dirT = g.time; });
  const dieFrom = g.time;
  for (const u of extra) { g.damage(u, 1e5, null, "bullet"); const c = g.corpses.find((c) => c.uid === u.id); if (c) corpses.push([u, c]); }
  const track = corpses.map(() => []);
  for (let j = 0; j < 90; j++) {
    step(1 / 30);
    corpses.forEach(([u, c], k) => { const p = sp.dyingPose(g, c, cam); track[k].push({ t: g.time - dieFrom, anim: p.anim, i: p.i }); });
  }
  out.dying = corpses.map(([u, c], k) => {
    const tr = track[k], want = "die_" + D8[k];
    const mono = tr.every((q, j) => j === 0 || q.i >= tr[j - 1].i);
    const lastAt = tr.find((q) => q.i === 5);
    return { want, anims: [...new Set(tr.map((q) => q.anim))], first: tr[0].i, mono, lastAt: lastAt ? +lastAt.t.toFixed(2) : null, held: tr.filter((q) => q.t > 0.8).every((q) => q.i === 5), stateKept: sp.anim.has(u.id) };
  });
  out.deadPoses = deadPoses; out.missing = missing;
  return out;
});

const ok = (c) => (c ? "PASS" : "FAIL");
const F = r.fight, M = r.march;
const fireWays = Object.entries(r.ways.fire), walkWays = Object.entries(r.ways.walk);
const checks = [
  [r.atlas.clipBad.length === 0, `every direction has walk 4 / idle 1 / fire 3 / dying 6 frames: ${r.atlas.clipBad.join(", ") || "all 8"}`],
  [r.atlas.tipBad.length === 0, `barrel tip on the rifle and pointing the view's way in all 24 firing frames (N and S stances included): ${r.atlas.tipBad.join("; ") || "ok"}`],
  [Math.max(...r.atlas.heights) - Math.min(...r.atlas.heights) < 0.03, `one standing height in every direction: ${r.atlas.heights.map((h) => h.toFixed(3)).join(" ")} figure heights`],
  [M.walkStarts > 10 && M.walkStartsOnStep === M.walkStarts, `walks start with a step: ${M.walkStartsOnStep}/${M.walkStarts}`],
  [M.jumps === 0, `march: view changes go to the next view: ${M.changes} changes, ${M.jumps} skipped (${M.wobble} turned back within 1 s, ${M.wobbleWalk} of them walking)`],
  [M.flicker === 0, `march: no back-and-forth flicker within 0.25 s: ${M.flicker}`],
  [M.straightChanges === 0 && M.straightTime > 20, `march: walking straight keeps one view: ${M.straightChanges} changes over ${M.straightTime} soldier-seconds`],
  [M.framesPerMetre > 0 && Math.abs(M.framesPerMetre - M.expectedPerMetre) < 0.05 && M.metresPerCycle > 1.4 && M.metresPerCycle < 2.7, `walk cycle tied to distance (no foot sliding): ${M.framesPerMetre.toFixed(3)} frames/m (expected ${M.expectedPerMetre.toFixed(3)}), ${M.metresPerCycle.toFixed(2)} m per cycle`],
  [F.shots > 20 && F.shotsShown === F.shots, `every shot starts the shot frame with its flash: ${F.shotsShown}/${F.shots}`],
  [F.flashNoShot === 0 && F.flashLong === 0 && F.flashesDrawn > 0, `no flash without a shot, none longer than the shot frame: ${F.flashNoShot} / ${F.flashLong} (${F.flashesDrawn} flashes drawn)`],
  [F.walkWhileEngaging === 0 && F.fireFrames > 0, `no walk clip while engaging a target: ${F.walkWhileEngaging} (${F.engagedMovingFrames} frames engaging on the move, firing stance)`],
  [fireWays.length === 8 && fireWays.every(([d, w]) => w.clips.length === 1 && w.clips[0] === "fire_" + d && w.shots > 0 && w.flashes > 0 && w.flashDirs.length === 1 && w.flashDirs[0] === d), `firing toward a target in all 8 directions: ${fireWays.map(([d, w]) => `${d}:${w.clips.join("/")}·${w.shots} shots·${w.flashes} flashes@${w.tip}`).join("  ")}`],
  [r.ways.fire.N && r.ways.fire.N.tip && r.ways.fire.N.tip[1] < -0.9 && r.ways.fire.S && r.ways.fire.S.tip && r.ways.fire.S.tip[1] > -0.8, `north firing stance flashes above the head, south stance at the chest: N ${r.ways.fire.N && r.ways.fire.N.tip}, S ${r.ways.fire.S && r.ways.fire.S.tip}`],
  [walkWays.length === 8 && walkWays.every(([d, w]) => w.frames > 30 && w.share >= 0.8), `walking in all 8 directions uses that direction's cycle: ${walkWays.map(([d, w]) => `${d}:${Math.round(w.share * 100)}%`).join(" ")}`],
  [r.dying.length === 8 && r.dying.every((q) => q.anims.length === 1 && q.anims[0] === q.want && q.first === 0 && q.mono && q.lastAt !== null && q.lastAt <= 0.7 && q.held), `dying in 8 views plays once and holds the last frame: ${r.dying.map((q) => `${q.anims[0]}@${q.lastAt}s`).join(" ")}`],
  [r.deadPoses === 0 && r.dying.every((q) => !q.stateKept), `no walking/firing pose for a dead soldier: ${r.deadPoses}`],
  [r.missing === 0, `every requested clip/frame exists: ${r.missing} missing`],
  [errors.length === 0, `page errors: ${errors.length} ${errors.slice(0, 2).join(" | ")}`],
];
for (const [c, t] of checks) console.log(`${ok(c)}  ${t}`);
console.log(`${checks.filter((c) => c[0]).length}/${checks.length} animation checks passed (${F.kills} infected killed)`);
if (SHOTS) fs.writeFileSync(SHOTS, JSON.stringify(r, null, 1));
await browser.close(); srv.close();
process.exit(checks.every((c) => c[0]) ? 0 : 1);

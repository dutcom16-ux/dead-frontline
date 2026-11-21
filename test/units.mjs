// Animation test for every unit type other than the soldiers (those are in test/anim.mjs): the
// infected of each type, soldiers who turned, survivors (sprite and 3D), and a large mixed crowd.
// Runs the real sprite drawing (Sprites.draw on a canvas at 30 fps, game time) while the game plays
// deterministically, and checks for each type:
//   views      the displayed view changes one step at a time, never flickers back within 0.25 s, and
//              while walking matches the real direction of travel (within one view)
//   clips      each view uses the clip drawn for it (S/SW three-quarter, SE mirrored, E/NE side,
//              W/NW mirrored, N from behind) and every frame exists
//   cycles     walk/run/crawl frames advance only with distance covered (none while standing still)
//   standing   one fixed frame (no flicking between the sheet's different faces), breathing only
//   attacks    every real hit shows the full-reach frame
//   death      the fall starts from the last pose, ends on a lying frame facing the same side, plays
//              once and the body stays; turned soldiers die in their last view
//   crowd      200 figures animating together: drawing time, no errors, animation state freed
//   node test/units.mjs [dist]
import path from "node:path";
import { serve, loadPlaywright } from "./serve.mjs";
const { chromium } = loadPlaywright();
const DIR = path.resolve(process.argv[2] || "dist");
const PORT = +(process.env.PORT || 8786);
const srv = await serve(DIR, PORT);
const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.addInitScript(() => { let s = 777; Math.random = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; });
await page.goto(`http://localhost:${PORT}/?manualtick`);
await page.waitForSelector("#menu:not([hidden])", { timeout: 90000 });
await page.click("#mNew"); await page.click('[data-diff="medium"]');
await page.click('[data-op="op01"]'); await page.click("#bDeploy");
await page.waitForFunction(() => window.__df && window.__df.session && window.__df.session.game && window.__df.render.sprites.zombies, null, { timeout: 90000 });

const r = await page.evaluate(() => {
  const A = window.__df, s = A.session, g = s.game, sp = A.render.sprites, cam = s.cam, bf = g.bf;
  A.frame = () => {};
  g.paths.timeCapMs = Infinity;
  for (const z of g.zombies) z.dead = true;
  for (const n of g.nests) n.spawnT = 1e9;
  g.compact();
  const ZA = sp.zombies.atlas, SA = sp.zs.atlas, MA = sp.mil.atlas;
  const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  const canvas = document.createElement("canvas"); canvas.width = 1280; canvas.height = 720;
  const ctx = canvas.getContext("2d");
  const ui = { hover: null, box: null, ghost: null, showPaths: false };
  // ---- pose logs through the real drawing code
  const log = new Map(), meta = new Map();
  let missing = 0;
  const wrap = (name, atlas, kind) => {
    const orig = sp[name].bind(sp);
    sp[name] = (...a) => {
      const p = orig(...a);
      const e = a[1], now = a[a.length - 1];
      const ids = atlas.anims[p.anim];
      if (!ids || Math.floor(p.i) < 0) missing++;
      const st = sp.anim.get(e.id);
      if (!log.has(e.id)) { log.set(e.id, []); meta.set(e.id, { kind, type: e.type || (e.military ? "military" : "civilian") }); }
      const seq = log.get(e.id);
      if (!seq.length || seq[seq.length - 1].t < now) seq.push({ t: now, anim: p.anim, i: ids ? ids[((Math.floor(p.i) % ids.length) + ids.length) % ids.length] : -1, flip: !!p.flip, view: st ? st.dir : -1, x: e.x, y: e.y, atk: e.attackT, sy: p.sy || 1, state: e.state });
      return p;
    };
  };
  wrap("zpose", ZA, "infected"); wrap("zpose8", SA, "turned");
  { const orig = sp.civPose.bind(sp); sp.civPose = (c, cm, now) => { const p = orig(c, cm, now); const ids = MA.anims[p.anim]; if (!ids) missing++;
    if (!log.has(c.id)) { log.set(c.id, []); meta.set(c.id, { kind: "survivor", type: "military" }); }
    const seq = log.get(c.id), st = sp.anim.get(c.id); if (!seq.length || seq[seq.length - 1].t < now) seq.push({ t: now, anim: p.anim, i: ids ? ids[p.i % ids.length] : -1, flip: false, view: st.dir, x: c.x, y: c.y }); return p; }; }
  let n = 0, focus = null, drawMs = 0, draws = 0;
  const pins = [];
  const step = (sec, after) => {
    for (let k = 0; k < Math.round(sec * 30); k++) {
      s.tick(1 / 30);
      for (const [e, x, y] of pins) { e.x = x; e.y = y; }
      if (after) after();
      if (focus) cam.lookAt(focus[0], focus[1]);
      cam.update(1 / 30, (x, y) => bf.h(x, y));
      if (n++ % 15 === 0) A.render.render(g, cam, g.time, ui);
      ctx.clearRect(0, 0, 1280, 720);
      const t0 = performance.now();
      sp.draw(ctx, g, bf, cam, 1280, 720, g.time);
      drawMs += performance.now() - t0; draws++;
    }
  };
  const L = g.get(g.squads[0].acting);
  const C = bf.freeNear(L.x + 130, L.y + 10, 20, false) || [L.x + 130, L.y + 10];
  for (const u of g.units) if (u.alive) { u.x = L.x - 60 + (u.id % 5); u.y = L.y + (u.id % 7); A.__issue(g, [u], { kind: "hold" }, {}); }
  focus = C; cam.zoom = 40;
  const [rx, ry] = cam.right, [fx, fy] = cam.forward;
  const mapDir = (deg) => { const c = (deg * Math.PI) / 180; return [rx * Math.sin(c) + fx * Math.cos(c), ry * Math.sin(c) + fy * Math.cos(c)]; };
  const compassOf = (vx, vy) => { const sx = vx * rx + vy * ry, sy = vx * fx + vy * fy; return ((90 - (Math.atan2(sy, sx) * 180) / Math.PI) % 360 + 360) % 360; };

  // ---- 1. each infected type walks out in 8 directions, then stands
  const TYPES = ["walker", "runner", "crawler", "brute", "bloater", "screamer", "mutant"];
  const walkers = [];
  for (const type of TYPES) {
    for (let k = 0; k < 8; k++) {
      const [vx, vy] = mapDir(k * 45);
      const z = g.addZombie(type, C[0] + vx * 3, C[1] + vy * 3); if (!z) continue;
      z.awake = true; z.state = "investigate"; z.goalX = C[0] + vx * 30; z.goalY = C[1] + vy * 30;
      walkers.push({ z, k });
    }
    step(9);
    for (const { z } of walkers) { z.state = "idle"; z.goalX = z.x; z.goalY = z.y; z.path = null; }   // then they stand
    step(2.5, () => { for (const { z } of walkers) if (z.state !== "idle") z.state = "idle"; });
    for (const { z } of walkers) if (!z.dead) z.dead = true;
    g.compact(); walkers.length = 0; step(0.5);
  }
  // ---- 2. infected attacking a soldier who cannot shoot back (and is not infected by the bites)
  const T0 = g.units.find((u) => u.alive && !u.vehicle);
  T0.x = C[0]; T0.y = C[1]; T0.hp = T0.maxHp = 1e9; T0.mag = 0; T0.reserve = 0; T0.infectedAt = 0; T0.turnAt = 1e12;
  A.__issue(g, [T0], { kind: "hold" }, {});
  pins.push([T0, C[0], C[1]]);
  const attackers = [];
  for (const [k, type] of [...TYPES.entries(), ...TYPES.entries()]) {
    // half start close, half sprint in from 30 m (full chase speed: 4.6 m/s for runners)
    const far = attackers.length >= TYPES.length, [vx, vy] = mapDir(k * 51 + (far ? 25 : 0));
    const z = g.addZombie(type, C[0] + vx * (far ? 30 : 4), C[1] + vy * (far ? 30 : 4)); if (!z) continue;
    z.awake = true; z.state = "chase"; z.target = T0.id; z.lastSeenX = C[0]; z.lastSeenY = C[1]; z.lastSeenT = g.time; attackers.push(z);
  }
  const atkFrom = g.time;
  step(12, () => { for (const z of attackers) { z.target = T0.id; if (z.state !== "attack") z.state = "chase"; } });
  const atkTo = g.time;
  // ---- 3. turned soldiers: walk out in 8 directions, then attack
  for (const z of attackers) z.dead = true; g.compact();
  const turned = [];
  for (let k = 0; k < 8; k++) {
    const [vx, vy] = mapDir(k * 45);
    const z = g.addZombie("walker", C[0] + vx * 6, C[1] + vy * 6); if (!z) continue;
    z.soldier = "rifleman"; z.hp = z.maxHp = 1e6; z.awake = true; z.state = "investigate"; z.goalX = C[0] + vx * 30; z.goalY = C[1] + vy * 30; turned.push(z);
  }
  step(9);
  for (const z of turned) { z.state = "chase"; z.target = T0.id; z.lastSeenX = C[0]; z.lastSeenY = C[1]; z.lastSeenT = g.time; }
  const tAtkFrom = g.time;
  step(10, () => { for (const z of turned) { z.target = T0.id; if (z.state !== "attack") z.state = "chase"; } });
  const tAtkTo = g.time;
  // ---- 4. deaths: infected of each type and turned soldiers, followed for 3 s
  const dying = [];
  const doomed = [];
  for (const [k, type] of TYPES.entries()) {
    const [vx, vy] = mapDir(k * 51 + 20);
    const z = g.addZombie(type, C[0] + vx * 10, C[1] + vy * 10); if (!z) continue;
    z.awake = true; z.state = "investigate"; z.goalX = C[0] + vx * 30; z.goalY = C[1] + vy * 30; doomed.push(z);
  }
  step(2);
  for (const z of turned) { const lp = sp.lastPose.get(z.id); g.damage(z, 1e9, null, "bullet"); dying.push({ id: z.id, kind: "turned", lp: lp && { ...lp } }); }
  for (const z of doomed) { const lp = sp.lastPose.get(z.id); g.damage(z, 1e9, null, "bullet"); dying.push({ id: z.id, kind: z.type, lp: lp && { ...lp } }); }
  const dieFrom = g.time;
  const deathLog = new Map();
  // record what the corpse draws: wrap blit/blitFall during corpse drawing
  const oBlit = sp.blit.bind(sp), oFall = sp.blitFall.bind(sp);
  let cur = null;
  sp.blit = (c, src, sh, f, ...rest) => { if (cur) cur.push({ f: sh.atlas.frames.indexOf(f), sheet: sh === sp.zs ? "ZS" : sh === sp.zombies ? "Z" : "M", flip: rest[3], fall: false }); return oBlit(c, src, sh, f, ...rest); };
  sp.blitFall = (c, src, sh, f, ...rest) => { if (cur) cur.push({ f: sh.atlas.frames.indexOf(f), sheet: "Z", flip: rest[3], fall: true, ang: rest[5] }); return oFall(c, src, sh, f, ...rest); };
  for (let j = 0; j < 90; j++) {
    step(1 / 30);
    for (const d of dying) {
      const c = g.corpses.find((q) => q.uid === d.id); if (!c) continue;
      // draw this corpse alone to see exactly what is drawn for it
      const keep = g.corpses; g.corpses = [c]; const zs = g.zombies, us = g.units, cs = g.civs, ef = g.effects;
      g.zombies = []; g.units = []; g.civs = []; g.effects = [];
      cur = []; sp.draw(ctx, g, bf, cam, 1280, 720, g.time);
      g.corpses = keep; g.zombies = zs; g.units = us; g.civs = cs; g.effects = ef;
      if (!deathLog.has(d.id)) deathLog.set(d.id, []);
      deathLog.get(d.id).push({ t: g.time - c.t, items: cur }); cur = null;
    }
  }
  sp.blit = oBlit; sp.blitFall = oFall;
  // ---- 5. survivors walking and standing (a military one drawn as a soldier, a civilian in 3D)
  // (hiding survivors are left alone by their AI; the test walks them by hand, far from any soldier)
  const civs = [], C2 = bf.freeNear(C[0] + 60, C[1], 20, false) || [C[0] + 60, C[1]];
  for (const mil of ["rifleman", null]) {
    for (let k = 0; k < 4; k++) { const c = g.addCivilian(C2[0] + k * 4, C2[1] + (mil ? 5 : -5), "test", mil); c.state = "hiding"; civs.push(c); }
  }
  focus = C2;
  const civStart = g.time;
  const models = new Map();
  for (let j = 0; j < 150; j++) {
    const moving = j < 105;
    step(1 / 30, () => { for (const [k, c] of civs.entries()) { const [vx, vy] = mapDir(k * 90); if (moving) { c.x += vx * 1.6 / 30; c.y += vy * 1.6 / 30; c.heading = Math.atan2(vy, vx); } } });
    A.render.render(g, cam, g.time, ui);
    for (const c of civs) if (!c.military) {
      for (const [m, l] of A.render.lists) for (const it of l) if (Math.abs(it.x - c.x) < 1e-6 && Math.abs(it.y - c.y) < 1e-6 && /^m_civilian/.test(m)) {
        if (!models.has(c.id)) models.set(c.id, []); models.get(c.id).push({ t: g.time, m, moving });
      }
    }
  }
  // ---- 5b. the abomination (3D): steps while walking, feet on the ground, feet together when it stops
  const ab = g.addZombie("abomination", C2[0], C2[1] + 14) || g.addZombie("abomination", C[0], C[1] - 20);
  const abLog = [], abInfo = { made: !!ab };
  if (ab) {
    // walked by hand at its chase pace (the boss's own AI waits for its trigger)
    ab.state = "idle"; ab.awake = false;
    const [vx, vy] = mapDir(80), x0 = ab.x, y0 = ab.y;
    focus = [ab.x, ab.y];
    for (let j = 0; j < 240; j++) {
      const k = Math.min(j, 180);
      step(1 / 30, () => { ab.x = x0 + vx * 1.9 * k / 30; ab.y = y0 + vy * 1.9 * k / 30; ab.state = "idle"; });
      A.render.render(g, cam, g.time, ui);
      for (const [m, l] of A.render.lists) for (const it of l) if (/^m_abomination/.test(m) && Math.abs(it.x - ab.x) < 1e-6 && Math.abs(it.y - ab.y) < 1e-6) abLog.push({ j, m, x: ab.x, y: ab.y, dz: it.z - ab.z });
      if (j === 5) abInfo.keys = [...A.render.lists.keys()].filter((k) => A.render.lists.get(k).length).join(","), abInfo.pos = [ab.x, ab.y, ab.dead, g.zombies.includes(ab)];
    }
    ab.dead = true; g.compact();
  }
  // ---- 6. crowd: 200 infected and the squad, moving and fighting
  for (const c of civs) c.state = "gone";
  pins.length = 0; T0.x = L.x - 60; T0.y = L.y; focus = C;
  const crowd = [];
  for (let k = 0; k < 200; k++) {
    const type = TYPES[k % TYPES.length], a = (k * 2.39996) % (Math.PI * 2), rr = 8 + (k % 20);
    const z = g.addZombie(type, C[0] + Math.cos(a) * rr, C[1] + Math.sin(a) * rr); if (!z) continue;
    z.awake = true; z.state = "investigate"; z.goalX = C[0] - Math.cos(a) * rr; z.goalY = C[1] - Math.sin(a) * rr; crowd.push(z);
  }
  drawMs = 0; draws = 0;
  step(6);
  const crowdMs = drawMs / draws, crowdN = g.zombies.filter((z) => !z.dead).length;
  for (const z of crowd) if (!z.dead && Math.random() < 0.7) g.damage(z, 1e9, null, "bullet");
  step(7);   // state is freed on the first sweep (every 3 s) after a body is 3 s old
  const animSize = sp.anim.size, alive = g.zombies.filter((z) => !z.dead).length + g.units.filter((u) => u.alive).length + g.civs.filter((c) => !c.dead).length;

  // ---------------- metrics
  const per = {};
  const bucket = (id) => { const m = meta.get(id); const key = m.kind === "infected" ? m.type : m.kind === "turned" ? "turned" : m.type === "military" ? "survivor (soldier sprite)" : "survivor"; return (per[key] ||= { n: 0, frames: 0, jumps: 0, flicker: 0, walkFrames: 0, offView: 0, wrongClip: 0, framesStill: 0, frameChangesStill: 0, idleFaces: 0, metres: 0, cycleSteps: 0, hits: 0, hitsShown: 0, missed: [], walkT: 0, standSide: 0, standSideWide: 0 }); };
  const viewClip = (anim, flip, v) => {
    const d = COMPASS[v];
    if (/^(attack|lunge|claw|crawl_attack)_E$/.test(anim)) return true;                       // attack: side view toward the victim
    if (/^crawl_E$/.test(anim) || anim === "dead") return true;
    if (/^back_N$/.test(anim)) return d === "N" || d === "NE" || d === "NW";
    if (/^walk_SW2?$/.test(anim)) return (d === "S" || d === "SW") ? !flip : d === "SE" ? flip : false;
    if (/^idle_S2?$/.test(anim)) return d === "S" || d === "SW" || d === "SE";
    if (/_E\d?$/.test(anim)) return (d === "E" || d === "NE") ? !flip : (d === "W" || d === "NW") ? flip : false;
    if (/^z_(walk|attack)_/.test(anim)) return anim.endsWith("_" + d);
    if (/^(walk|idle)_/.test(anim)) return anim.endsWith("_" + d);
    return false;
  };
  for (const [id, seq] of log) {
    const b = bucket(id); b.n++;
    // fastest cadence over any second of continuous movement (sprints included)
    for (let k = 30; k < seq.length; k += 5) {
      const w = seq.slice(k - 30, k);
      if (!w.every((q, j) => j === 0 || Math.hypot(q.x - w[j - 1].x, q.y - w[j - 1].y) / Math.max(1e-6, q.t - w[j - 1].t) > 0.6)) continue;
      let ch = 0; for (let j = 1; j < w.length; j++) if (w[j].view === w[j - 1].view && (w[j].i !== w[j - 1].i || w[j].flip !== w[j - 1].flip)) ch++;   // (turning changes the view: not cadence)
      const sp = Math.hypot(w[29].x - w[0].x, w[29].y - w[0].y) / (w[29].t - w[0].t);
      if (ch / (w[29].t - w[0].t) > (b.peak || 0)) { b.peak = ch / (w[29].t - w[0].t); b.peakSpd = sp; b.peakInfo = w.map((q) => `${q.anim.replace(/_/g, '')}${q.i}${q.flip ? 'f' : ''}v${q.view}`).join(' '); }
    }
    let lastChange = null, still = 0;
    for (let k = 1; k < seq.length; k++) {
      const a = seq[k - 1], q = seq[k]; b.frames++;
      if (q.view !== a.view) {
        if (Math.min((q.view - a.view + 8) % 8, (a.view - q.view + 8) % 8) > 1) b.jumps++;
        if (lastChange && lastChange.from === q.view && q.t - lastChange.t < 0.25) b.flicker++;
        lastChange = { from: a.view, t: q.t };
      }
      if (!viewClip(q.anim, q.flip, q.view)) b.wrongClip++;
      const d = Math.hypot(q.x - a.x, q.y - a.y), dt = q.t - a.t;
      const walking = /^(walk|run|hunch|charge|crawl|z_walk)/.test(q.anim) && d / dt > 0.6;
      if (walking && k > 20) {
        b.walkFrames++;
        // the view follows the real direction (smoothed over the last 0.5 s, allowing the settle delay)
        const p = seq[Math.max(0, k - 15)];
        const dd = Math.hypot(q.x - p.x, q.y - p.y);
        if (dd > 0.6) { const c = compassOf(q.x - p.x, q.y - p.y); const off = Math.abs(((c - q.view * 45 + 540) % 360) - 180); if (off > 67.5) b.offView++; }
        b.metres += d; b.walkT += dt; if (q.i !== a.i) b.cycleSteps++;
      }
      // standing still (not attacking): the frame must not change (no walking on the spot, no face swaps)
      if (d < 1e-4 && a.anim === q.anim && !/attack|lunge|claw/.test(q.anim) && q.t - (seq[k - 2]?.t ?? 0) > 0) {
        still++;
        // (after the 0.5 s it takes to come to a stop; turning on the spot changes the view: allowed)
        // standing side-on: the narrowest-stance frame (feet together), not a mid-stride one
        if (still > 15 && meta.get(id).kind === "infected" && /^(walk_E|hunch_E|stand_E2?)$/.test(q.anim)) { b.standSide++; if (!/^stand_E/.test(q.anim)) b.standSideWide++; }
        if (still > 15 && q.view === a.view) { b.framesStill++; if (q.i !== a.i || q.flip !== a.flip) { b.frameChangesStill++; if (b.missed.length < 6) b.missed.push(`still ${a.anim}:${a.i}${a.flip ? 'f' : ''}>${q.anim}:${q.i}${q.flip ? 'f' : ''} ${q.state}`); } }
      } else still = 0;
      if (/^idle_S/.test(q.anim) && /^idle_S/.test(a.anim) && q.i !== a.i && d < 1e-4) b.idleFaces++;
      // hits: the attack timer restarts on a hit; that frame shows the full reach
      if (q.atk !== undefined && q.atk > a.atk + 0.05 && q.t >= Math.min(atkFrom, tAtkFrom)) {
        b.hits++;
        const atlas = meta.get(id).kind === "turned" ? SA : ZA, ids = atlas.anims[q.anim] || [];
        if (/attack|lunge|claw/.test(q.anim) && q.i === ids[ids.length - 1]) b.hitsShown++;
        else if (b.missed.length < 4) b.missed.push(`${q.anim}:${ids.indexOf(q.i)}`);
      }
    }
  }
  // deaths
  const deaths = dying.map((d) => {
    const tr = deathLog.get(d.id) || [];
    const first = tr[0], last = tr[tr.length - 1];
    const fallFrames = tr.filter((q) => q.items.some((it) => it.fall)).length;
    const endItems = last ? last.items.filter((it) => !it.fall) : [];
    const ends = new Set(tr.filter((q) => q.t > 1).map((q) => JSON.stringify(q.items)));
    let ok = !!first && ends.size === 1;
    let info = "";
    if (d.kind === "turned") {
      const dieIds = d.lp ? SA.anims["z_die_" + d.lp.view] : [];
      const frames = tr.map((q) => q.items[0] && q.items[0].f);
      const mono = frames.every((f, j) => j === 0 || dieIds.indexOf(f) >= dieIds.indexOf(frames[j - 1]));
      ok = ok && !!d.lp && frames.every((f) => dieIds.includes(f)) && frames[0] === dieIds[0] && frames[frames.length - 1] === dieIds[dieIds.length - 1] && mono;
      info = `z_die_${d.lp && d.lp.view}`;
    } else {
      const deadIds = ZA.anims.dead;
      ok = ok && !!d.lp && fallFrames >= 8 && fallFrames <= 15 && endItems.length === 1 && deadIds.includes(endItems[0].f) && endItems[0].flip === d.lp.flip
        && tr.filter((q) => q.items.some((it) => it.fall)).every((q) => q.t < 0.5);
      info = `fall ${fallFrames} frames, lying ${endItems[0] && endItems[0].flip === d.lp?.flip ? "same side" : "other side"}`;
    }
    if (!ok && d.kind === "turned") info += " " + JSON.stringify(tr.filter((q, j) => j < 3 || j > tr.length - 2).map((q) => [+q.t.toFixed(2), q.items.map((it) => it.f)]));
    return { kind: d.kind, ok, info };
  });
  // 3D survivors: steps alternate while walking, feet together when standing
  const civ3d = [...models.values()].map((ms) => {
    const mv = ms.filter((q) => q.moving), st = ms.filter((q) => !q.moving && q.t > civStart + 3.8);
    let changes = 0; for (let j = 1; j < mv.length; j++) if (mv[j].m !== mv[j - 1].m) changes++;
    return { left: mv.some((q) => q.m === "m_civilian_l"), right: mv.some((q) => q.m === "m_civilian_r"), changes, still: st.every((q) => q.m === "m_civilian") && st.length > 10 };
  });
  let abDist = 0, abSteps = 0;
  for (let j = 1; j < abLog.length; j++) { if (abLog[j].j < 180) abDist += Math.hypot(abLog[j].x - abLog[j - 1].x, abLog[j].y - abLog[j - 1].y); if (abLog[j].m !== abLog[j - 1].m && abLog[j].m !== "m_abomination") abSteps++; }
  const abo = { info: abInfo, frames: abLog.length, left: abLog.some((q) => q.m === "m_abomination_l"), right: abLog.some((q) => q.m === "m_abomination_r"), dist: abDist, steps: abSteps,
    ground: abLog.every((q) => Math.abs(q.dz) < 1e-6), still: abLog.filter((q) => q.j > 195).every((q) => q.m === "m_abomination") };
  return { per, deaths, civ3d, abo, missing, crowdMs, crowdN, animSize, alive };
});

const ok = (c) => (c ? "PASS" : "FAIL");
const checks = [];
for (const [type, b] of Object.entries(r.per)) {
  const cyc = b.metres > 0 ? b.cycleSteps / b.metres : 0;
  checks.push([b.jumps === 0 && b.flicker === 0, `${type}: views step one at a time, no flicker (${b.n} figures, ${b.frames} frames; ${b.jumps} skips, ${b.flicker} flickers)`]);
  checks.push([b.wrongClip === 0, `${type}: every view uses its own drawn clip: ${b.wrongClip} wrong`]);
  if (b.walkFrames > 30) checks.push([b.offView <= b.walkFrames * 0.03, `${type}: walking faces the way it goes: ${b.offView}/${b.walkFrames} frames more than a view off`]);
  if (b.walkFrames > 30) checks.push([cyc > 0.5 && cyc < 12, `${type}: cycle follows distance: ${cyc.toFixed(2)} frame changes per metre`]);
  if (b.walkFrames > 30) checks.push([b.cycleSteps / b.walkT <= 14 && (b.peak || 0) <= 15, `${type}: cycle speed suits the pace: ${(b.cycleSteps / b.walkT).toFixed(1)} frame changes per second on average, at most ${(b.peak || 0).toFixed(1)} (at ${(b.peakSpd || 0).toFixed(1)} m/s)${(b.peak || 0) > 15 ? ' ' + b.peakInfo : ''}`]);
  if (b.standSide > 0) checks.push([b.standSideWide === 0, `${type}: standing side-on with feet together: ${b.standSideWide}/${b.standSide} frames mid-stride`]);
  if (b.framesStill > 10) checks.push([b.frameChangesStill === 0 && b.idleFaces === 0, `${type}: standing still keeps one frame (no stepping on the spot, no face swaps): ${b.frameChangesStill} changes in ${b.framesStill} frames ${b.frameChangesStill ? b.missed.join(' ') : ''}`]);
  if (b.hits > 0) checks.push([b.hitsShown === b.hits, `${type}: every hit shows the full reach: ${b.hitsShown}/${b.hits} ${b.missed.join(" ")}`]);
}
const byKind = {};
for (const d of r.deaths) (byKind[d.kind] ||= []).push(d);
for (const [k, ds] of Object.entries(byKind)) checks.push([ds.every((d) => d.ok), `${k}: death plays once and the body stays (${ds.length}): ${[...new Set(ds.map((d) => d.info))].join("; ")}`]);
checks.push([r.civ3d.length > 0 && r.civ3d.every((c) => c.left && c.right && c.changes >= 6 && c.still), `3D survivors alternate their steps while walking and stand with feet together: ${r.civ3d.map((c) => c.changes).join(",")} step changes`]);
{ const a = r.abo; const per = a.steps ? a.dist / a.steps : 0;
  checks.push([a.frames > 200 && a.left && a.right && per > 1.0 && per < 2.0 && a.ground && a.still, `abomination (3D) steps left and right while walking (${a.steps} steps over ${a.dist.toFixed(1)} m: ${per.toFixed(2)} m a step), feet on the ground ${a.ground}, feet together when it stops ${a.still}${a.frames ? '' : ' ' + JSON.stringify(a.info)}`]); }
checks.push([r.missing === 0, `every requested clip/frame exists: ${r.missing} missing`]);
checks.push([r.crowdMs < 40, `crowd of ${r.crowdN} infected plus the squad: ${r.crowdMs.toFixed(1)} ms per drawn frame (software rendering)`]);
checks.push([r.animSize <= r.alive + 60, `animation state is freed for the dead: ${r.animSize} entries for ${r.alive} living figures`]);
checks.push([errors.length === 0, `page errors: ${errors.length} ${errors.slice(0, 2).join(" | ")}`]);
for (const [c, t] of checks) console.log(`${ok(c)}  ${t}`);
console.log(`${checks.filter((c) => c[0]).length}/${checks.length} unit animation checks passed`);
await browser.close(); srv.close();
process.exit(checks.every((c) => c[0]) ? 0 : 1);

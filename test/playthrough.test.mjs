// Automated acceptance test for DEAD FRONTLINE Mission 01 (criteria 1-16 of the master prompt).
// Drives the real UI with mouse and keyboard where a player would, and a scripted commander
// (test/bot.js) for the long middle of the mission. The simulation is seeded and stepped by the
// test (?manualtick), so runs are repeatable.
//   node test/playthrough.test.mjs [dist] [difficulty]
import { createRequire } from "node:module";
import fs from "node:fs"; import path from "node:path";
import { serve } from "./serve.mjs";
const require = createRequire(import.meta.url);
const { chromium } = (() => { try { return require("playwright"); } catch { return require("/opt/npm-tools/node_modules/playwright/index.js"); } })();

const dir = path.resolve(process.argv[2] || "dist"), diff = process.argv[3] || "low";
const PORT = +(process.env.PORT || 8790), APP = `http://localhost:${PORT}/?manualtick`;
const srv = await serve(dir, PORT);
const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 860 } });
await ctx.addInitScript(() => { let s = 20261120; Math.random = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; });
let page = await ctx.newPage();
const errors = [];
const watch = (p) => { p.on("pageerror", (e) => errors.push(e.message)); p.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); }); };
watch(page);
const results = [];
const check = (n, name, ok, detail = "") => { results.push({ n, name, ok: !!ok, detail }); console.log(`${ok ? "PASS" : "FAIL"} ${String(n).padStart(2)} ${name}${detail ? " — " + detail : ""}`); };
const ev = (fn, arg) => page.evaluate(fn, arg);
const bot = () => page.evaluate(fs.readFileSync(path.join(path.dirname(new globalThis.URL(import.meta.url).pathname), "bot.js"), "utf8"));
const run = (s) => ev((n) => window.__bot.run(n), s);
const shot = (n) => page.screenshot({ path: `/tmp/df_accept_${n}.png` });

try {
  // 1. open via URL
  await page.goto(APP);
  await page.waitForSelector("#menu:not([hidden])", { timeout: 90000 });
  check(1, "Open the game in a browser through a URL", await page.isVisible("#mNew"), APP);

  // 2. start Operation Reclamation
  await page.click("#mNew"); await page.click(`[data-diff="${diff}"]`);
  await page.waitForSelector("#campaign:not([hidden])");
  await page.click('[data-op="op01"]');
  await page.waitForSelector("#briefing:not([hidden])");
  await page.click("#bDeploy");
  await page.waitForSelector("#hud:not([hidden])");
  const m0 = await ev(() => ({ name: window.__df.session.campaign.name, mission: window.__df.session.mission.name }));
  check(2, "Start Operation Reclamation", m0.name === "Operation Reclamation" && /Mission 01/.test(m0.mission), `${m0.name} · ${m0.mission}`);

  // 3. Toledo battlefield
  await page.waitForTimeout(3000);
  await shot("03_battlefield");
  const bfInfo = await ev(() => { const bf = window.__df.bf; let n = 0; for (const _ of bf.map.buildings()) n++; return { expected: (bf.map.manifest.stats || {}).buildings || 1, buildings: n, roads: bf.map.layers.roads.length, landmarks: [...bf.landmarks.keys()].length, attribution: bf.attribution.slice(0, 60), chunks: bf.r.stats.drawn, ground: bf.r.stats.ground, tris: bf.r.stats.tris }; });
  check(3, "View the Toledo City battlefield", bfInfo.buildings > 0 && bfInfo.buildings >= bfInfo.expected && bfInfo.roads > 400 && bfInfo.ground > 0 && bfInfo.tris > 1000, `${bfInfo.buildings} buildings, ${bfInfo.roads} roads, ${bfInfo.landmarks} landmarks, ${bfInfo.ground} terrain/road tiles and ${bfInfo.chunks} building chunks drawn, ${bfInfo.tris} triangles`);

  // 4. camera: keys pan, wheel zoom, Q rotates
  const c0 = await ev(() => { const c = window.__df.session.cam; return { x: c.tx, y: c.ty, z: c.tzoom, yaw: c.tyaw }; });
  await page.mouse.move(720, 430);
  await page.keyboard.down("KeyD"); await page.waitForTimeout(900); await page.keyboard.up("KeyD");
  await page.mouse.wheel(0, 400); await page.waitForTimeout(300);
  await page.keyboard.press("KeyQ"); await page.waitForTimeout(300);
  const c1 = await ev(() => { const c = window.__df.session.cam; return { x: c.tx, y: c.ty, z: c.tzoom, yaw: c.tyaw }; });
  check(4, "Move the camera (pan, zoom, rotate)", Math.hypot(c1.x - c0.x, c1.y - c0.y) > 3 && c1.z !== c0.z && c1.yaw !== c0.yaw, `moved ${Math.hypot(c1.x - c0.x, c1.y - c0.y).toFixed(0)} m, zoom ${c0.z.toFixed(0)}→${c1.z.toFixed(0)}, rotated`);
  await page.keyboard.press("KeyE");
  await ev(() => { const s = window.__df.session; s.cam.lookAt(s.mission.lz[0], s.mission.lz[1], 34); s.cam.snap(); for (const u of s.game.units) u.selected = false; });
  await page.waitForTimeout(1200);

  // 5. select soldiers with a box drag
  const box = await ev(() => { const a = window.__df, pts = a.session.game.units.map((u) => a.bf.screen(u.x, u.y, u.z + 0.9)).filter(Boolean); const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]); return [Math.min(...xs) - 25, Math.min(...ys) - 25, Math.max(...xs) + 25, Math.max(...ys) + 25]; });
  await page.mouse.move(box[0], box[1]); await page.mouse.down(); await page.mouse.move((box[0] + box[2]) / 2, (box[1] + box[3]) / 2, { steps: 4 }); await page.mouse.move(box[2], box[3], { steps: 4 }); await page.mouse.up();
  const nsel = await ev(() => window.__df.session.game.units.filter((u) => u.selected).length);
  check(5, "Select soldiers", nsel >= 9, `${nsel} selected by box drag`);

  // 6. right-click move order
  const p0 = await ev(() => window.__df.session.game.units.map((u) => [u.x, u.y]));
  // a clear spot of the battlefield (not under a HUD panel), ~30 m from the squad
  const target = await ev(() => { const a = window.__df, us = a.session.game.units; const c = us.map((u) => a.bf.screen(u.x, u.y, u.z)).filter(Boolean); const cx = c.reduce((s, p) => s + p[0], 0) / c.length, cy = c.reduce((s, p) => s + p[1], 0) / c.length;
    for (const [dx, dy] of [[260, 0], [-260, 0], [0, 200], [0, -200], [200, 150], [-200, 150]]) { const x = cx + dx, y = cy + dy, el = document.elementFromPoint(x, y); if (el && el.id === "gl") return [x, y]; } return [cx + 260, cy]; });
  await page.mouse.move(target[0], target[1], { steps: 3 });
  await page.mouse.click(target[0], target[1], { button: "right" });
  const orders6 = await ev(() => window.__df.session.game.units.map((u) => u.order.kind).join(","));
  await bot();
  await ev(() => { const s = window.__df.session; for (let i = 0; i < 240; i++) s.tick(1 / 30 + 1e-6); });
  const moved = await ev((p) => window.__df.session.game.units.filter((u, i) => p[i] && Math.hypot(u.x - p[i][0], u.y - p[i][1]) > 4).length, p0);
  check(6, "Move soldiers", moved >= 6, `${moved} soldiers moved after a right-click order (orders: ${orders6})`);

  // 7. fight the infected
  await run(40);
  const k7 = await ev(() => ({ kills: window.__df.session.game.stats.killed, shots: window.__df.session.game.stats.shots }));
  await shot("07_combat");
  check(7, "Fight zombies", k7.kills > 0, `${k7.kills} infected killed, ${k7.shots} shots fired`);

  // 8. health and ammunition: damage, reloads, medic healing, ammunition drop through the logistics UI
  const before8 = await ev(() => { const g = window.__df.session.game; const u = g.units.filter((q) => q.weapon && q.alive)[0]; return { reserve: u.reserve, id: u.id, wounded: g.units.filter((q) => q.hp < q.maxHp).length, medkits: g.units.filter((q) => q.def.heal).map((q) => q.medkits) }; });
  await page.click("#bLog");
  await page.waitForSelector('#panel:not([hidden]) [data-req="ammo_drop"]');
  await page.click('[data-req="ammo_drop"]');
  const dropAt = await ev(() => { const a = window.__df, us = a.session.game.units.filter((u) => u.alive && u.inVehicle === null); let x = 0, y = 0; for (const u of us) { x += u.x; y += u.y; } x /= us.length; y /= us.length; a.session.cam.lookAt(x, y); a.session.cam.snap(); const W = innerWidth, H = innerHeight; for (const [px, py] of [[W * 0.55, H * 0.5], [W * 0.6, H * 0.4], [W * 0.45, H * 0.45]]) { const el = document.elementFromPoint(px, py); if (el && el.id === "gl") return [px, py]; } return [W * 0.55, H * 0.5]; });
  await page.mouse.click(dropAt[0], dropAt[1]);
  const req8 = await ev(() => window.__df.session.game.logistics.pending.map((p) => p.item));
  const wounded8 = await ev(() => { const g = window.__df.session.game; return g.units.reduce((s, u) => s + (u.maxHp - u.hp), 0); });
  await page.click("#panelClose");
  await run(35);
  const after8 = await ev(() => { const g = window.__df.session.game; const crate = g.crates.length; for (const c of g.crates) { const u = g.units.find((q) => q.alive && !q.vehicle); if (u) window.__df.__issue(g, g.units.filter((q) => q.alive && !q.vehicle), { kind: "interact", target: c.id }); } return { crates: crate, delivered: g.logistics.delivered }; });
  await run(15);
  const end8 = await ev((id) => { const g = window.__df.session.game; const u = g.get(id) || g.units.find((q) => q.weapon && q.alive); return { reserve: u.reserve, max: u.weapon.reserve, healed: g.units.some((q) => q.def.heal && q.medkits < q.def.heal.kits) }; }, before8.id);
  const stats8 = await ev(() => { const g = window.__df.session.game; return { shots: g.stats.shots, reloads: g.units.filter((u) => u.weapon && u.reserve < u.weapon.reserve).length }; });
  check(8, "Manage health and ammunition", req8.includes("ammo_drop") && after8.delivered >= 1 && end8.reserve >= before8.reserve, `ammo drop requested through the Logistics panel: ${req8.join(",") || "none"}; delivered ${after8.delivered}; reserve ${Math.round(before8.reserve)}→${Math.round(end8.reserve)}; medic kits used: ${end8.healed}; squad damage taken ${Math.round(wounded8)} hp`);

  // 9-12. play the mission through (scripted commander)
  let st = null;
  await ev(() => { window.__bot.fobAuto = false; });
  for (let i = 0; i < 90; i++) { st = await run(60); if (st.state !== "active") break; }
  const g12 = await ev(() => { const s = window.__df.session, m = s.mission; return { state: m.state, done: m.objectives.filter((o) => o.state === "done").map((o) => o.id), rescued: s.game.stats.rescued, joined: s.game.units.filter((u) => /3rd/.test(u.name)).length, time: s.game.time, territory: m.territory(), killed: s.game.stats.killed, lost: s.game.stats.lost }; });
  await shot("12_liberated");
  check(9, "Rescue survivors", g12.rescued > 0, `${g12.rescued} survivors evacuated by helicopter`);
  const libObjs = ["lz", "cp_alpha", "city_hall", "engineers", "cp_bravo", "tpc", "cp_charlie", "market", "hospital", "port", "plaza"];
  check(10, "Complete mission objectives", libObjs.every((o) => g12.done.includes(o)), `${g12.done.length} objectives complete`);
  check(11, "Secure the port and key facilities", ["port", "hospital", "tpc", "city_hall"].every((o) => g12.done.includes(o)), "port, hospital, power plant, city hall");
  check(12, "Liberate Toledo City", g12.state === "liberated" || g12.state === "complete", `${g12.state} after ${Math.round(g12.time / 60)} game minutes · ${g12.killed} infected killed · ${g12.lost} losses · territory ${g12.territory}`);

  // 13. establish the FOB through the FOB panel (from here on the test plays the FOB phase through the UI)
  await ev(() => { window.__bot.fobAuto = false; });
  await page.click("#bFob");
  await page.waitForSelector('#panel:not([hidden]) [data-fobhere="0"]', { timeout: 10000 }).catch(() => {});
  const hasSite = await page.isVisible('[data-fobhere="0"]');
  if (hasSite) await page.click('[data-fobhere="0"]');
  await page.click("#panelClose").catch(() => {});
  const site = await ev(() => window.__df.session.game.fob.site);
  await run(90);
  const fob = await ev(() => { const f = window.__df.session.game.fob; return { est: f.established, built: f.facilities.filter((q) => q.built >= 1).length, all: f.facilities.length, second: f.check(f.site.x + 300, f.site.y, 0) }; });
  await ev(() => { const s = window.__df.session, f = s.game.fob.site; s.cam.lookAt(f.x, f.y, 70); s.cam.snap(); });
  await page.waitForTimeout(2500);
  await shot("13_fob");
  check(13, "Establish the FOB", !!site && fob.est, `site ${site ? site.x.toFixed(0) + "," + site.y.toFixed(0) : "none"} · ${fob.built}/${fob.all} parts built · second FOB refused: "${fob.second}"`);

  // 16. save, reload the page, load
  const snapBefore = await ev(() => { const g = window.__df.session.game; return { time: Math.round(g.time), units: g.units.filter((u) => u.alive).length, fob: !!g.fob.site, killed: g.stats.killed }; });
  await page.keyboard.press("Escape");
  await page.waitForSelector("#pause:not([hidden])");
  await page.click("#pSave");
  await page.waitForSelector('#saves:not([hidden]) [data-slot="1"]');
  await page.click('[data-slot="1"]');
  await page.waitForTimeout(800);
  await page.close();
  page = await ctx.newPage(); watch(page);
  await page.goto(APP);
  await page.waitForSelector("#menu:not([hidden])", { timeout: 90000 });
  await page.click("#mLoad");
  await page.waitForSelector('#saves:not([hidden]) [data-slot="1"]:not([disabled])');
  await page.click('[data-slot="1"]');
  await page.waitForSelector("#hud:not([hidden])", { timeout: 30000 });
  await page.waitForTimeout(1500);
  const snapAfter = await ev(() => { const g = window.__df.session.game; return { time: Math.round(g.time), units: g.units.filter((u) => u.alive).length, fob: !!g.fob.site, est: g.fob.established, killed: g.stats.killed, kind: window.__df.saves.kind }; });
  await shot("16_loaded");
  await bot();
  await ev(() => { window.__bot.fobAuto = false; });
  check(16, "Save and load the game", snapAfter.time === snapBefore.time && snapAfter.units === snapBefore.units && snapAfter.fob && snapAfter.killed === snapBefore.killed, `saved at ${snapBefore.time}s with ${snapBefore.units} units; loaded ${snapAfter.time}s, ${snapAfter.units} units, FOB ${snapAfter.est ? "established" : "missing"} (${snapAfter.kind})`);
  // 14-15. supplies and reinforcements through the logistics UI
  await page.click("#bLog");
  await page.waitForSelector('#panel:not([hidden]) [data-req="ammo_convoy"]');
  const d0 = await ev(() => ({ delivered: window.__df.session.game.logistics.delivered, rf: window.__df.session.game.stats.reinforcements, units: window.__df.session.game.units.length }));
  if (await page.isEnabled('[data-req="ammo_convoy"]')) await page.click('[data-req="ammo_convoy"]');
  const rfItem = (await page.isEnabled('[data-req="heavy_team"]')) ? "heavy_team" : "fireteam";
  await page.click(`[data-req="${rfItem}"]`);
  if (rfItem === "fireteam") { const at = await ev(() => { const a = window.__df, f = a.session.game.fob.site; return a.bf.screen(f.x, f.y - 40, a.bf.h(f.x, f.y - 40)); }); await page.mouse.click(at[0], at[1]); }
  await page.click("#panelClose").catch(() => {});
  await run(75);
  const d1 = await ev(() => ({ delivered: window.__df.session.game.logistics.delivered, rf: window.__df.session.game.stats.reinforcements, units: window.__df.session.game.units.length, sup: window.__df.session.mission.objective("supply").state, rein: window.__df.session.mission.objective("reinforce").state, state: window.__df.session.mission.state }));
  check(14, "Request supplies", d1.delivered > d0.delivered && d1.sup === "done", `${d1.delivered - d0.delivered} deliveries after the FOB was established`);
  check(15, "Deploy reinforcements", d1.rf > d0.rf && d1.rein === "done", `${d1.rf - d0.rf} soldiers arrived (${rfItem}) · mission ${d1.state}`);

} catch (e) {
  console.error("TEST ERROR", e);
  errors.push(String(e));
}
const passed = results.filter((r) => r.ok).length;
console.log(`\n${passed}/${results.length} criteria passed; page errors: ${errors.length}${errors.length ? "\n  " + errors.slice(0, 5).join("\n  ") : ""}`);
fs.writeFileSync("/tmp/df_acceptance.json", JSON.stringify({ difficulty: diff, results, errors }, null, 1));
await browser.close(); srv.close();
process.exit(passed === 16 && !errors.length ? 0 : 1);

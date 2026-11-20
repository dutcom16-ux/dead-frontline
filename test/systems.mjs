import { createRequire } from "node:module";
import fs from "node:fs"; import path from "node:path";
import { serve, loadPlaywright } from "./serve.mjs";
const require = createRequire(import.meta.url);
const { chromium } = loadPlaywright();
const srv = await serve(path.resolve("dist"), 8773);
const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 860 } });
const errs = []; page.on("pageerror", (e) => errs.push(e.message + " " + e.stack));
await page.addInitScript(() => { let s = 99; Math.random = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; });
await page.goto("http://localhost:8773/?manualtick");
await page.waitForSelector("#menu:not([hidden])", { timeout: 90000 });
await page.click("#mNew"); await page.click('[data-diff="low"]'); await page.click('[data-op="op01"]'); await page.click("#bDeploy");
await page.evaluate(fs.readFileSync("test/bot.js", "utf8"));
const r = await page.evaluate(() => {
  const A = window.__df, s = A.session, g = s.game, issue = A.__issue, out = {};
  const lz = s.mission.lz;
  const step = (sec) => { for (let i = 0; i < sec * 30; i++) s.tick(1 / 30 + 1e-6); };
  // vehicles
  const types = ["jeep", "apc", "ifv", "tank", "truck", "arv"];
  const vs = types.map((t, i) => g.addUnit(t, lz[0] + 12 + i * 8, lz[1] - 10));
  const inf = g.units.filter((u) => !u.vehicle).slice(0, 4);
  issue(g, inf, { kind: "board", target: vs[1].id });
  step(12);
  out.boarded = vs[1].passengers.length;
  const ahead = A.bf.roads.nearestOn(lz[0], lz[1] + 120, "Naga-Toledo Road");
  const v0 = vs.map((v) => [v.x, v.y]);
  issue(g, vs, { kind: "attackMove", x: ahead[0], y: ahead[1] });
  step(25);
  out.vehiclesMoved = vs.filter((v, i) => v.alive && Math.hypot(v.x - v0[i][0], v.y - v0[i][1]) > 10).length;
  out.passengersFollow = inf.filter((u) => u.inVehicle === vs[1].id && Math.hypot(u.x - vs[1].x, u.y - vs[1].y) < 1).length;
  window.__df.__unload = true;
  const UnitAI = null;
  A.controls.command && (vs[1].selected = true);
  for (const u of g.units) u.selected = u === vs[1];
  A.controls.command("unload");
  out.unloaded = inf.filter((u) => u.inVehicle === null).length;
  // engineer builds sandbags + barbed wire + MG emplacement from a defence kit
  const eng = g.units.find((u) => u.type === "engineer");
  g.fob.inventory.mg_emplacement = 1;
  issue(g, [eng], { kind: "build", x: eng.x + 4, y: eng.y + 3, item: "sandbags", rot: 0 });
  step(15);
  issue(g, [eng], { kind: "build", x: eng.x + 6, y: eng.y - 3, item: "mg_emplacement", rot: 0 });
  step(25);
  out.built = g.obstacles.filter((o) => o.kind !== "wreck" && o.built >= 1).map((o) => o.kind);
  // a horde walks into the defences
  const zs = g.spawnGroup(eng.x + 40, eng.y + 30, 12, 6, "test", { walker: 1 });
  for (const z of zs) { z.awake = true; z.state = "investigate"; z.goalX = eng.x; z.goalY = eng.y; }
  const k0 = g.stats.killed;
  step(30);
  out.hordeKilled = g.stats.killed - k0;
  // artillery strike (direct call: needs the FOB comms center in normal play)
  const before = g.stats.killed;
  const zz = g.spawnGroup(ahead[0] + 60, ahead[1] + 60, 10, 5, "test2", { walker: 1 });
  window.__strikeTarget = [ahead[0] + 60, ahead[1] + 60];
  return out;
});
console.log(JSON.stringify(r));
const r2 = await page.evaluate(() => {
  const A = window.__df, s = A.session, g = s.game; const step = (sec) => { for (let i = 0; i < sec * 30; i++) s.tick(1 / 30 + 1e-6); };
  g.logistics.campaignFlags.add("x");
  const [x, y] = window.__strikeTarget;
  const k0 = g.stats.killed;
  const L = g.logistics; L.ready.artillery = 0;
  // bypass the comms requirement for this test only
  const def = L.def("artillery"); const req = def.requires; def.requires = undefined;
  const why = L.request("artillery", x, y);
  def.requires = req;
  step(25);
  return { why, strikeKills: g.stats.killed - k0, projectilesLeft: g.projectiles.length };
});
console.log(JSON.stringify(r2));
await page.evaluate(() => { const s = window.__df.session; const u = s.game.units.find((q) => q.vehicle && q.alive); s.cam.lookAt(u.x, u.y, 40); s.cam.snap(); for (const q of s.game.units) q.selected = q.vehicle; });
await page.waitForTimeout(2500);
await page.screenshot({ path: "/tmp/sys_vehicles.png" });
// force the end of the mission to check debrief -> strategic map
await page.evaluate(() => { const m = window.__df.session.mission; for (const o of m.objectives) if (!o.optional && o.state !== "done") { o.state = "active"; m.complete(o); } });
await page.waitForSelector("#debrief:not([hidden])", { timeout: 20000 });
await page.screenshot({ path: "/tmp/sys_debrief.png" });
await page.click("#dContinue");
await page.waitForSelector("#campaign:not([hidden])");
await page.screenshot({ path: "/tmp/sys_campaign.png" });
const camp = await page.evaluate(() => { const c = window.__df.session.campaign; return { op01: c.ops.op01, op02: c.ops.op02, terr: c.territory.op01, fob: c.fob }; });
console.log(JSON.stringify(camp), "errors:", errs.length, errs.slice(0, 3).join("\n"));
await browser.close(); srv.close();

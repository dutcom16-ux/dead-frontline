// dev helper: screenshots of the pre-rendered town in game (node test/townshots.mjs [outdir])
import fs from "node:fs"; import path from "node:path";
import { serve, loadPlaywright } from "./serve.mjs";
const out = process.argv[2] || "/tmp/townshots";
fs.mkdirSync(out, { recursive: true });
const { chromium } = loadPlaywright();
const srv = await serve(path.resolve("dist"), 8768);
const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errs = [];
page.on("pageerror", (e) => errs.push(e.message));
page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") errs.push(m.text()); });
await page.goto("http://localhost:8768/?manualtick");
await page.waitForSelector("#menu:not([hidden])", { timeout: 90000 });
await page.screenshot({ path: out + "/menu.png" });
await page.click("#mNew"); await page.click('[data-diff="medium"]');
await page.click('[data-op="op01"]'); await page.click("#bDeploy");
await page.waitForFunction(() => window.__df && window.__df.session && window.__df.session.game, null, { timeout: 60000 });
const info = await page.evaluate(() => {
  const A = window.__df, bf = A.bf, t = bf.town;
  return { placed: t.placed.length, types: t.placed.map((q) => q.type + "@" + q.x.toFixed(0) + "," + q.y.toFixed(0)), yaw: A.session.cam.yaw * 180 / Math.PI, trees: bf.world.trees.length, gpu: bf.r.gpuBytes };
});
console.log(JSON.stringify(info).slice(0, 1500));
const shots = JSON.parse(process.env.SHOTS || "[]");
const defaults = [["church", -215, -215, 30], ["hospital", 161.7, -449, 32], ["school", null, null, 30], ["townhouse", null, null, 18], ["midrise", null, null, 22]];
for (const [name, x0, y0, zoom] of shots.length ? shots : defaults) {
  for (const dmg of [0, 2, 3]) {
    const r = await page.evaluate(([name, x0, y0, zoom, dmg]) => {
      const A = window.__df, bf = A.bf, s = A.session, g = s.game;
      let q = bf.town.placed.find((p) => p.type === name && (x0 === null || Math.hypot(p.x - x0, p.y - y0) < 40));
      const x = q ? q.x : x0, y = q ? q.y : y0;
      if (q) bf.world.setState(q.b, { dmg });
      // a few soldiers and infected beside it for scale
      const us = g.units.filter((u) => u.alive && !u.vehicle).slice(0, 4);
      us.forEach((u, i) => { u.x = x + 3 * i - 4; u.y = y - 26; u.z = bf.h(u.x, u.y); u.path = null; });
      const zs = g.zombies.filter((z) => !z.dead).slice(0, 4);
      zs.forEach((z, i) => { z.x = x + 3 * i - 4; z.y = y - 31; z.z = bf.h(z.x, z.y); });
      s.cam.lookAt(x, y - 8, zoom); s.cam.snap();
      return q ? q.type + " s=" + q.s + " front=" + q.front : "none";
    }, [name, x0, y0, zoom, dmg]);
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${out}/${name}_${dmg}.png` });
    console.log(name, dmg, r);
  }
}
// turn the camera a quarter
await page.evaluate(() => { const s = window.__df.session; s.cam.rotate(1); s.cam.lookAt(-215, -223, 30); s.cam.snap(); });
await page.waitForTimeout(700);
await page.screenshot({ path: out + "/church_turned.png" });
console.log("errors:", errs.slice(0, 10));
await browser.close(); srv.close();

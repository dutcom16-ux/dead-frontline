import { createRequire } from "node:module";
import path from "node:path";
import { serve, loadPlaywright } from "./serve.mjs";
const require = createRequire(import.meta.url);
const { chromium } = loadPlaywright();
const srv = await serve(path.resolve("dist"), 8772);
const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
for (const [w, h, name] of [[915, 412, "land"], [412, 860, "port"]]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36" });
  const page = await ctx.newPage();
  const errs = []; page.on("pageerror", (e) => errs.push(e.message));
  await page.goto("http://localhost:8772/");
  await page.waitForSelector("#menu:not([hidden])", { timeout: 90000 });
  await page.screenshot({ path: `/tmp/m_${name}_menu.png` });
  await page.tap("#mNew"); await page.tap('[data-diff="low"]'); await page.tap('[data-op="op01"]'); await page.tap("#bDeploy");
  await page.waitForTimeout(3000);
  // tap a unit, then tap ground to move
  const u = await page.evaluate(() => { const a = window.__df; for (const q of a.session.game.units) q.selected = false; const q = a.session.game.units[0]; return a.bf.screen(q.x, q.y, q.z + 0.9); });
  await page.touchscreen.tap(u[0], u[1]);
  const sel = await page.evaluate(() => window.__df.session.game.units.filter((q) => q.selected).length);
  await page.screenshot({ path: `/tmp/m_${name}_game.png` });
  console.log(name, "selected by tap:", sel, "errors:", errs.length, errs[0] || "");
  await ctx.close();
}
await browser.close(); srv.close();

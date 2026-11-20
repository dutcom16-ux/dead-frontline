import { createRequire } from "node:module";
import fs from "node:fs"; import path from "node:path";
import { serve, loadPlaywright } from "./serve.mjs";
const require = createRequire(import.meta.url);
const { chromium } = loadPlaywright();
const diff = process.argv[2] || "medium", total = +(process.argv[3] || 1200);
const srv = await serve(path.resolve("dist"), 8766);
const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errs = [];
page.on("pageerror", (e) => errs.push("pageerror: " + e.message + "\n" + e.stack));
page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
await page.addInitScript(() => { let s = 20261120; Math.random = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; });
await page.goto("http://localhost:8766/?manualtick");
await page.waitForSelector("#menu:not([hidden])", { timeout: 60000 });
await page.click("#mNew"); await page.click(`[data-diff="${diff}"]`);
await page.click('[data-op="op01"]'); await page.click("#bDeploy");
await page.evaluate(fs.readFileSync("test/bot.js", "utf8"));
let prev = "", stuck = 0;
for (let t = 0; t < total; t += 60) {
  const r = await page.evaluate((n) => window.__bot.run(n), +(process.env.CHUNK || 60));
  console.log(JSON.stringify(r).slice(0, 400));
  if (r.state === "complete" || r.state === "failed") break;
  if (r.status === prev) { stuck++; if (stuck === 3) fs.writeFileSync("/tmp/df_stuck.json", JSON.stringify(await page.evaluate(() => window.__bot.dump()))); console.log("STUCK dumped"); } else stuck = 0;
  prev = r.status;
}
await page.screenshot({ path: "/tmp/df_bot.png" });
console.log(errs.slice(0, 10).join("\n"));
await browser.close(); srv.close();

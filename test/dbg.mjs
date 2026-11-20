// dev helper: node test/dbg.mjs <difficulty> '<js expression evaluated in the page after deploy>'
import fs from "node:fs"; import path from "node:path";
import { serve, loadPlaywright } from "./serve.mjs";
const { chromium } = loadPlaywright();
const srv = await serve(path.resolve("dist"), 8767);
const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on("pageerror", (e) => console.log("pageerror: " + e.message));
await page.addInitScript(() => { let s = 20261120; Math.random = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; });
await page.goto("http://localhost:8767/?manualtick");
await page.waitForSelector("#menu:not([hidden])", { timeout: 60000 });
await page.click("#mNew"); await page.click(`[data-diff="${process.argv[2]}"]`);
await page.click('[data-op="op01"]'); await page.click("#bDeploy");
await page.evaluate(fs.readFileSync("test/bot.js", "utf8"));
console.log(await page.evaluate(process.argv[3]));
if (process.argv[4]) await page.screenshot({ path: process.argv[4] });
await browser.close(); srv.close();

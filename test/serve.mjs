import { createRequire } from "node:module";
// tiny static server for tests: node test/serve.mjs dist 8765
import http from "node:http"; import fs from "node:fs"; import path from "node:path";
const dir = path.resolve(process.argv[2] || "dist"), port = +(process.argv[3] || 8765);
const T = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".webmanifest": "application/manifest+json", ".mapz": "application/octet-stream", ".map": "application/json" };
export function serve(d = dir, p = port) {
  const s = http.createServer((req, res) => {
    let f = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (f.endsWith("/")) f += "index.html";
    const fp = path.join(d, f);
    if (!fp.startsWith(d) || !fs.existsSync(fp)) { res.writeHead(404); res.end("nf"); return; }
    res.writeHead(200, { "Content-Type": T[path.extname(fp)] || "application/octet-stream", "Cache-Control": "no-cache" });
    fs.createReadStream(fp).pipe(res);
  });
  return new Promise((r) => s.listen(p, () => r(s)));
}
if (process.argv[1] && process.argv[1].endsWith("serve.mjs")) serve().then(() => console.log("serving", dir, port));
/** Playwright from the project (npm i -D playwright) or a machine-wide install */
export function loadPlaywright() {
  const require = createRequire(import.meta.url);
  try { return require("playwright"); } catch { return require("/opt/npm-tools/node_modules/playwright/index.js"); }
}

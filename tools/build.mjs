// Production build: bundle TypeScript with esbuild, copy public/, write the offline service worker.
//   npm run build            -> dist/  (upload to any static HTTPS host)
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const esbuild = (() => { try { return require("esbuild"); } catch { return require("/opt/npm-tools/node_modules/esbuild"); } })();

const root = path.dirname(path.dirname(new URL(import.meta.url).pathname));
const out = path.join(root, process.argv[2] || "dist");
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
await esbuild.build({
  entryPoints: [path.join(root, "src/main.ts")], bundle: true, format: "iife", target: ["es2020"], minify: true,
  sourcemap: true, outfile: path.join(out, "app.js"), loader: { ".json": "json" }, legalComments: "none", logLevel: "warning",
});
const copy = (from, to) => {
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    const a = path.join(from, e.name), b = path.join(to, e.name);
    if (e.isDirectory()) { fs.mkdirSync(b, { recursive: true }); copy(a, b); } else fs.copyFileSync(a, b);
  }
};
copy(path.join(root, "public"), out);
fs.copyFileSync(path.join(root, "styles/main.css"), path.join(out, "main.css"));
let html = fs.readFileSync(path.join(root, "index.html"), "utf8")
  .replace('<script type="module" src="/src/main.ts"></script>', '<script src="app.js"></script>')
  .replace('<link rel="stylesheet" href="/styles/main.css">', '<link rel="stylesheet" href="main.css">');
fs.writeFileSync(path.join(out, "index.html"), html);
// precache list + service worker (offline play after the first visit)
const list = [];
const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else list.push(path.relative(out, p).split(path.sep).join("/")); } };
walk(out);
const assets = list.filter((f) => !f.endsWith(".map") && f !== "sw.js").sort();
const h = crypto.createHash("sha256");
for (const f of assets) h.update(fs.readFileSync(path.join(out, f)));
const version = h.digest("hex").slice(0, 12), cache = "deadfrontline-" + version;
fs.writeFileSync(path.join(out, "asset-list.json"), JSON.stringify({ version, cache, assets: ["./", ...assets, "asset-list.json"] }, null, 1));
const sw = fs.readFileSync(path.join(root, "tools/sw.template.js"), "utf8").replace("__CACHE__", JSON.stringify(cache)).replace("__ASSETS__", JSON.stringify(["./", ...assets, "asset-list.json"]));
fs.writeFileSync(path.join(out, "sw.js"), sw);
fs.writeFileSync(path.join(out, "_headers"), "/sw.js\n  Cache-Control: no-cache\n/asset-list.json\n  Cache-Control: no-cache\n/*.mapz\n  Content-Type: application/octet-stream\n");
fs.writeFileSync(path.join(out, "vercel.json"), JSON.stringify({ headers: [{ source: "/sw.js", headers: [{ key: "Cache-Control", value: "no-cache" }] }, { source: "/asset-list.json", headers: [{ key: "Cache-Control", value: "no-cache" }] }] }, null, 1));
const size = assets.reduce((s, f) => s + fs.statSync(path.join(out, f)).size, 0);
console.log(`built ${path.relative(root, out)}/: ${assets.length} files, ${(size / 1e6).toFixed(2)} MB, version ${version}`);

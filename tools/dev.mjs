// Development server: rebuilds on every change and serves http://localhost:5173
import { createRequire } from "node:module";
import path from "node:path";
import fs from "node:fs";
const require = createRequire(import.meta.url);
const esbuild = (() => { try { return require("esbuild"); } catch { return require("/opt/npm-tools/node_modules/esbuild"); } })();
const root = path.dirname(path.dirname(new URL(import.meta.url).pathname));
const out = path.join(root, ".dev");
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
fs.cpSync(path.join(root, "public"), out, { recursive: true });
fs.copyFileSync(path.join(root, "styles/main.css"), path.join(out, "main.css"));
fs.writeFileSync(path.join(out, "index.html"), fs.readFileSync(path.join(root, "index.html"), "utf8")
  .replace('<script type="module" src="/src/main.ts"></script>', '<script src="app.js"></script>')
  .replace('<link rel="stylesheet" href="/styles/main.css">', '<link rel="stylesheet" href="main.css">'));
const ctx = await esbuild.context({ entryPoints: [path.join(root, "src/main.ts")], bundle: true, format: "iife", sourcemap: true,
  outfile: path.join(out, "app.js"), loader: { ".json": "json" }, define: { "DEV": "true" } });
await ctx.watch();
const { host, port } = await ctx.serve({ servedir: out, port: 5173 });
console.log(`DEAD FRONTLINE dev server: http://localhost:${port}  (rebuilds on save; service worker disabled in dev)`);

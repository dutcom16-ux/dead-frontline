// Map package access: manifest, global layers, lazily parsed building chunks,
// and the manual-corrections overlay (kept separate from source data).
import { LocalFrame } from "./proj.js";
import { ringBBox, pointInPoly, footprintHash } from "./geom.js";

// Source of chunk JSON: inline strings (offline single-file build) or files next to the page.
export class PackageSource {
  constructor(inline, baseUrl) {
    this.inline = inline; // {"manifest.json": string, ...} or null
    this.base = baseUrl || "map/";
  }
  async text(name) {
    if (this.inline) {
      const v = this.inline[name];
      if (v === undefined) throw new Error("missing in package: " + name);
      return v;
    }
    const r = await fetch(this.base + name);
    if (!r.ok) throw new Error(name + ": HTTP " + r.status);
    return r.text();
  }
  textSync(name) {
    return this.inline ? this.inline[name] : null;
  }
}

// packed map file of the installable build: gzip(JSON {file: content}) fetched once, cached by the SW
export async function loadPackedPackage(url, onProgress) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(url + ": HTTP " + r.status);
  const total = +r.headers.get("Content-Length") || 0;
  let got = 0;
  const counted = r.body.pipeThrough(new TransformStream({ transform(chunk, ctl) { got += chunk.length; if (onProgress) onProgress(got, total); ctl.enqueue(chunk); } }));
  const txt = await new Response(counted.pipeThrough(new DecompressionStream("gzip"))).text();
  return JSON.parse(txt);
}

export async function decodeInlinePackage(b64gz) {
  // base64(gzip(JSON {file: content})) -> object. Uses DecompressionStream (no network).
  const bin = atob(b64gz);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const ds = new DecompressionStream("gzip");
  const stream = new Blob([bytes]).stream().pipeThrough(ds);
  const txt = await new Response(stream).text();
  return JSON.parse(txt);
}

export class MapData {
  static async load(source) {
    const m = new MapData();
    m.src = source;
    m.manifest = JSON.parse(await source.text("manifest.json"));
    m.layers = JSON.parse(await source.text("layers.json"));
    try {
      m.corrections = JSON.parse(await source.text("corrections.json"));
    } catch (e) {
      m.corrections = { format: 1, buildings: {} };
    }
    if (m.manifest.terrain && m.manifest.terrain.file) {
      m.terrain = JSON.parse(await source.text(m.manifest.terrain.file));
      const bin = atob(m.terrain.data_b64);
      const dv = new DataView(new ArrayBuffer(bin.length));
      for (let i = 0; i < bin.length; i++) dv.setUint8(i, bin.charCodeAt(i));
      m.terrainZ = new Float32Array(m.terrain.nx * m.terrain.ny);
      for (let i = 0; i < m.terrainZ.length; i++) m.terrainZ[i] = dv.getInt16(i * 2, true) / 10;
    }
    m.frame = new LocalFrame(m.manifest.crs);
    m.cs = m.manifest.chunk_size;
    m.chunkMeta = new Map();
    for (const c of m.manifest.chunks) m.chunkMeta.set(c.i + "," + c.j, c);
    m.chunks = new Map(); // key -> parsed chunk
    m.byId = new Map(); // building id -> building (parsed chunks only)
    m.homeOf = new Map(); // id -> chunk key (from xref + parsed)
    m.listeners = [];
    m.localDraft = null;
    try {
      const d = localStorage.getItem("toledo-map-corrections-draft:" + m.manifest.name);
      if (d) m.localDraft = JSON.parse(d);
    } catch (e) { /* storage may be unavailable */ }
    if (m.localDraft && m.localDraft.buildings) {
      for (const [k, v] of Object.entries(m.localDraft.buildings)) m.corrections.buildings[k] = v;
    }
    await m.preloadAll();
    return m;
  }

  // All chunk JSON is small enough to parse up front for a city district; render
  // meshes, collision and nav tiles are still built per chunk on demand.
  async preloadAll() {
    for (const c of this.manifest.chunks) await this.loadChunk(c.i, c.j);
  }

  key(i, j) { return i + "," + j; }
  chunkOf(x, y) { return [Math.floor(x / this.cs), Math.floor(y / this.cs)]; }

  async loadChunk(i, j) {
    const k = this.key(i, j);
    if (this.chunks.has(k)) return this.chunks.get(k);
    const meta = this.chunkMeta.get(k);
    if (!meta) return null;
    const c = JSON.parse(await this.src.text(meta.file));
    this.ingest(k, c);
    return c;
  }
  getChunk(i, j) { return this.chunks.get(this.key(i, j)) || null; }

  ingest(k, c) {
    c.key = k;
    c.meta = this.chunkMeta.get(k);
    c.buildings.forEach((b, idx) => {
      b.chunk = k;
      b.idx = idx;
      b.src = { fp: b.fp, h: b.h, lv: b.lv, a: b.a, c: b.c, rf: b.rf, rh: b.rh, enter: b.enter };
      b.srcHash = footprintHash(b.fp);
      this.applyCorrection(b);
      this.byId.set(b.id, b);
    });
    this.chunks.set(k, c);
  }

  // ------------------------------------------------------------ corrections overlay
  applyCorrection(b) {
    const s = b.src;
    // reset to source
    b.fp = s.fp; b.h = s.h; b.lv = s.lv; b.a = s.a; b.c = s.c; b.rf = s.rf; b.rh = s.rh; b.enter = s.enter; b.hidden = false;
    b.bb = ringBBox(b.fp);
    b.corr = null;
    const c = this.corrections.buildings[b.id];
    if (!c) return;
    b.corr = c;
    const tag = "manual:" + (c.source || "no source given");
    if (c.footprint_wgs84) {
      const f = [];
      for (const [lat, lon] of c.footprint_wgs84) f.push(...this.frame.toLocal(lat, lon));
      b.fp = f;
      b.bb = ringBBox(f);
    }
    if (c.height != null) { b.h = c.height; b.hsM = tag; }
    if (c.levels != null) { b.lv = c.levels; b.lvsM = tag; }
    if (c.archetype) { b.a = c.archetype; b.asM = tag; }
    if (c.category) { b.c = c.category; b.csM = tag; }
    if (c.roof) { b.rf = c.roof; b.rfsM = tag; }
    if (c.roof_height != null) b.rh = c.roof_height;
    if (c.enter != null) b.enter = c.enter ? 1 : 0;
    if (c.hidden) { b.hidden = true; b.enter = 0; }
    b.corrStale = !!(c.base_hash && c.base_hash !== b.srcHash);
  }
  setCorrection(id, patch) {
    const b = this.byId.get(id);
    if (!b) return;
    const cur = this.corrections.buildings[id] || {};
    const next = { ...cur, ...patch, base_hash: b.srcHash, date: new Date().toISOString().slice(0, 10) };
    for (const k of Object.keys(next)) if (next[k] === null || next[k] === "") delete next[k];
    const meaningful = Object.keys(next).some((k) => !["base_hash", "date", "source", "license", "author", "note", "verified"].includes(k)) || next.note || next.verified;
    if (meaningful) this.corrections.buildings[id] = next;
    else delete this.corrections.buildings[id];
    this.applyCorrection(b);
    this.saveDraft();
    this.emit({ type: "building", id, chunk: b.chunk });
  }
  clearCorrection(id) {
    delete this.corrections.buildings[id];
    const b = this.byId.get(id);
    if (b) this.applyCorrection(b);
    this.saveDraft();
    if (b) this.emit({ type: "building", id, chunk: b.chunk });
  }
  saveDraft() {
    try {
      localStorage.setItem("toledo-map-corrections-draft:" + this.manifest.name, JSON.stringify({ buildings: this.corrections.buildings }));
    } catch (e) { /* ignore */ }
  }
  exportCorrections() {
    return JSON.stringify({
      format: 1,
      note: "Manual corrections overlay for " + this.manifest.name + ". Source OSM data is never modified; " +
        "save this file as data/corrections/buildings.json and rebuild the map package.",
      exported_at: new Date().toISOString(),
      buildings: this.corrections.buildings,
    }, null, 1);
  }
  importCorrections(obj) {
    this.corrections.buildings = { ...(obj.buildings || {}) };
    for (const b of this.byId.values()) this.applyCorrection(b);
    this.saveDraft();
    this.emit({ type: "all" });
  }
  on(fn) { this.listeners.push(fn); }
  emit(ev) { for (const f of this.listeners) f(ev); }

  // ------------------------------------------------------------ run-time structures
  // b: a building record in chunk format (id, fp, c, a, h, lv, rf, rh, wc, rc, ent, obb, ip, area, brg, z...)
  addBuilding(b) {
    const [i, j] = this.chunkOf(b.ip[0], b.ip[1]);
    const k = this.key(i, j);
    let c = this.chunks.get(k);
    if (!c) {
      c = { i, j, bounds: [i * this.cs, j * this.cs, (i + 1) * this.cs, (j + 1) * this.cs], buildings: [], xref: [], key: k, meta: null };
      this.chunks.set(k, c);
    }
    b.chunk = k; b.idx = c.buildings.length; b.dynamic = true;
    b.src = { fp: b.fp, h: b.h, lv: b.lv, a: b.a, c: b.c, rf: b.rf, rh: b.rh, enter: b.enter };
    b.srcHash = footprintHash(b.fp);
    this.applyCorrection(b);
    c.buildings.push(b);
    this.byId.set(b.id, b);
    const bb = ringBBox(b.fp);
    for (let a = Math.floor(bb[0] / this.cs); a <= Math.floor(bb[2] / this.cs); a++)
      for (let e = Math.floor(bb[1] / this.cs); e <= Math.floor(bb[3] / this.cs); e++) {
        if (a === i && e === j) continue;
        const kk = this.key(a, e);
        let n = this.chunks.get(kk);
        if (!n) { n = { i: a, j: e, bounds: [a * this.cs, e * this.cs, (a + 1) * this.cs, (e + 1) * this.cs], buildings: [], xref: [], key: kk, meta: null }; this.chunks.set(kk, n); }
        n.xref.push([b.id, i, j]);
      }
    this.emit({ type: "building", id: b.id, chunk: k });
    return b;
  }
  removeBuilding(id) {
    const b = this.byId.get(id);
    if (!b) return;
    const c = this.chunks.get(b.chunk);
    c.buildings.splice(b.idx, 1);
    c.buildings.forEach((x, n) => { x.idx = n; });
    for (const n of this.chunks.values()) n.xref = n.xref.filter((x) => x[0] !== id);
    this.byId.delete(id);
    b.removed = true;
    this.emit({ type: "building", id, chunk: b.chunk, removed: b });
  }

  // ------------------------------------------------------------ queries
  *buildings() {
    for (const c of this.chunks.values()) yield* c.buildings;
  }
  getBuilding(id) { return this.byId.get(id) || null; }
  findBuildings(pred) {
    const out = [];
    for (const b of this.buildings()) if (pred(b)) out.push(b);
    return out;
  }
  // buildings whose footprint may touch chunk (i,j): own + xref
  buildingsTouching(i, j) {
    const c = this.getChunk(i, j);
    const out = c ? c.buildings.slice() : [];
    const raw = c ? c.xref : (this.xrefOnly(i, j) || []);
    for (const [id] of raw) {
      const b = this.byId.get(id);
      if (b) out.push(b);
    }
    return out;
  }
  xrefOnly() { return null; }
  buildingAt(x, y) {
    const [i, j] = this.chunkOf(x, y);
    for (const b of this.buildingsTouching(i, j)) {
      if (x < b.bb[0] || x > b.bb[2] || y < b.bb[1] || y > b.bb[3]) continue;
      if (b.part_of || b.hidden) continue;
      if (pointInPoly(x, y, b.fp, b.holes)) return b;
    }
    return null;
  }
  nearestBuilding(x, y, pred, maxD = 500) {
    let best = null, bd = maxD;
    for (const b of this.buildings()) {
      if (pred && !pred(b)) continue;
      const d = Math.hypot(b.ip[0] - x, b.ip[1] - y);
      if (d < bd) { bd = d; best = b; }
    }
    return best;
  }
  // door position (just outside the wall) and the outward normal
  entrancePoint(b, out = 0.8) {
    const [ei, t] = b.ent;
    const f = b.fp, n = f.length / 2;
    const i = ei % n, j = (i + 1) % n;
    const ax = f[2 * i], ay = f[2 * i + 1], bx = f[2 * j], by = f[2 * j + 1];
    const L = Math.hypot(bx - ax, by - ay) || 1;
    const nx = (by - ay) / L, ny = -(bx - ax) / L;
    const px = ax + (bx - ax) * t, py = ay + (by - ay) * t;
    return { x: px + nx * out, y: py + ny * out, nx, ny, wx: px, wy: py };
  }
  groundZ(x, y) {
    const g = this.terrain;
    if (!g) return 0;
    const fx = (x - g.x0) / g.res, fy = (y - g.y0) / g.res;
    const i = Math.min(Math.max(Math.floor(fx), 0), g.nx - 2), j = Math.min(Math.max(Math.floor(fy), 0), g.ny - 2);
    const tx = Math.min(Math.max(fx - i, 0), 1), ty = Math.min(Math.max(fy - j, 0), 1);
    const Z = this.terrainZ, nx = g.nx;
    return (Z[j * nx + i] * (1 - tx) + Z[j * nx + i + 1] * tx) * (1 - ty) + (Z[(j + 1) * nx + i] * (1 - tx) + Z[(j + 1) * nx + i + 1] * tx) * ty;
  }
  latlon(x, y) { return this.frame.toWGS84(x, y); }
  bounds() { return this.manifest.bounds_local; }
  center() {
    const b = this.bounds();
    return [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];
  }
}

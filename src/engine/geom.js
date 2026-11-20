// 2D geometry: flat coordinate arrays [x0,y0,x1,y1,...], x = east, y = north.

export function ringArea(f) {
  let s = 0;
  const n = f.length;
  for (let i = 0; i < n; i += 2) {
    const j = (i + 2) % n;
    s += f[i] * f[j + 1] - f[j] * f[i + 1];
  }
  return s / 2;
}

export function pointInRing(x, y, f) {
  let inside = false;
  const n = f.length;
  for (let i = 0, j = n - 2; i < n; j = i, i += 2) {
    const xi = f[i], yi = f[i + 1], xj = f[j], yj = f[j + 1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function pointInPoly(x, y, outer, holes) {
  if (!pointInRing(x, y, outer)) return false;
  if (holes) for (const h of holes) if (pointInRing(x, y, h)) return false;
  return true;
}

export function ringBBox(f) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < f.length; i += 2) {
    const x = f[i], y = f[i + 1];
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x > x1) x1 = x;
    if (y > y1) y1 = y;
  }
  return [x0, y0, x1, y1];
}

export function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const L2 = dx * dx + dy * dy;
  let t = L2 ? ((px - ax) * dx + (py - ay) * dy) / L2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const qx = ax + t * dx - px, qy = ay + t * dy - py;
  return Math.sqrt(qx * qx + qy * qy);
}

// segment-segment intersection parameter along (a->b), or -1
export function segHit(ax, ay, bx, by, cx, cy, dx, dy) {
  const rx = bx - ax, ry = by - ay, sx = dx - cx, sy = dy - cy;
  const den = rx * sy - ry * sx;
  if (Math.abs(den) < 1e-12) return -1;
  const qx = cx - ax, qy = cy - ay;
  const t = (qx * sy - qy * sx) / den;
  const u = (qx * ry - qy * rx) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? t : -1;
}

// ---------------------------------------------------------------- ear clipping
// Polygon with holes -> triangle index list over the concatenated vertex list.
// Holes are bridged into the outer ring (Eberly). Returns {verts:[x,y,...], tris:[...]}
export function triangulate(outer, holes) {
  let ring = toPts(outer);
  if (ringAreaPts(ring) < 0) ring.reverse();
  if (holes && holes.length) {
    const hs = holes.map((h) => {
      const p = toPts(h);
      if (ringAreaPts(p) > 0) p.reverse();
      return p;
    });
    hs.sort((a, b) => maxX(b) - maxX(a));
    for (const h of hs) ring = bridgeHole(ring, h);
  }
  const verts = [];
  for (const p of ring) verts.push(p[0], p[1]);
  return { verts, tris: earcut(ring) };
}

function toPts(f) {
  const out = [];
  for (let i = 0; i < f.length; i += 2) out.push([f[i], f[i + 1]]);
  return out;
}
function ringAreaPts(r) {
  let s = 0;
  for (let i = 0; i < r.length; i++) {
    const a = r[i], b = r[(i + 1) % r.length];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s / 2;
}
function maxX(r) {
  let m = -Infinity;
  for (const p of r) m = Math.max(m, p[0]);
  return m;
}
function bridgeHole(ring, hole) {
  let hi = 0;
  for (let i = 1; i < hole.length; i++) if (hole[i][0] > hole[hi][0]) hi = i;
  const M = hole[hi];
  // nearest outer vertex visible to the right of M (approximation: closest vertex with x >= M.x
  // whose connecting segment crosses no edge)
  let best = -1, bestD = Infinity;
  for (let i = 0; i < ring.length; i++) {
    const P = ring[i];
    if (P[0] < M[0] - 1e-9) continue;
    const d = (P[0] - M[0]) ** 2 + (P[1] - M[1]) ** 2;
    if (d >= bestD) continue;
    if (!crossesAny(M, P, ring, i) && !crossesAny(M, P, hole, -1, hi)) {
      best = i;
      bestD = d;
    }
  }
  if (best < 0) {
    for (let i = 0; i < ring.length; i++) {
      const d = (ring[i][0] - M[0]) ** 2 + (ring[i][1] - M[1]) ** 2;
      if (d < bestD) { best = i; bestD = d; }
    }
  }
  const out = ring.slice(0, best + 1);
  for (let k = 0; k <= hole.length; k++) out.push(hole[(hi + k) % hole.length]);
  out.push(ring[best]);
  for (let i = best + 1; i < ring.length; i++) out.push(ring[i]);
  return out;
}
function crossesAny(A, B, ring, skipVertex, skipVertex2 = -1) {
  for (let i = 0; i < ring.length; i++) {
    const j = (i + 1) % ring.length;
    if (i === skipVertex || j === skipVertex || i === skipVertex2 || j === skipVertex2) continue;
    const C = ring[i], D = ring[j];
    const t = segHit(A[0], A[1], B[0], B[1], C[0], C[1], D[0], D[1]);
    if (t > 1e-9 && t < 1 - 1e-9) return true;
  }
  return false;
}
function earcut(pts) {
  const n = pts.length;
  const tris = [];
  if (n < 3) return tris;
  const prev = new Int32Array(n), next = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    prev[i] = (i + n - 1) % n;
    next[i] = (i + 1) % n;
  }
  let remaining = n, cur = 0, guard = 0;
  const cross = (a, b, c) => (pts[b][0] - pts[a][0]) * (pts[c][1] - pts[a][1]) - (pts[b][1] - pts[a][1]) * (pts[c][0] - pts[a][0]);
  const inTri = (a, b, c, p) => {
    const P = pts[p];
    if ((P[0] === pts[a][0] && P[1] === pts[a][1]) || (P[0] === pts[b][0] && P[1] === pts[b][1]) || (P[0] === pts[c][0] && P[1] === pts[c][1])) return false;
    const c1 = cross(a, b, p), c2 = cross(b, c, p), c3 = cross(c, a, p);
    return c1 >= 0 && c2 >= 0 && c3 >= 0;
  };
  while (remaining > 3 && guard < n * n + 10) {
    guard++;
    const a = prev[cur], b = cur, c = next[cur];
    let ear = cross(a, b, c) > 1e-12;
    if (ear) {
      for (let p = next[c]; p !== a; p = next[p]) {
        if (inTri(a, b, c, p)) { ear = false; break; }
      }
    }
    if (ear) {
      tris.push(a, b, c);
      next[a] = c;
      prev[c] = a;
      remaining--;
      cur = c;
      guard = 0;
    } else {
      cur = next[cur];
      if (guard > remaining * 2 + 2) {
        // degenerate / self-touching input: clip the least bad vertex to make progress
        tris.push(prev[cur], cur, next[cur]);
        next[prev[cur]] = next[cur];
        prev[next[cur]] = prev[cur];
        remaining--;
        cur = next[cur];
        guard = 0;
      }
    }
  }
  if (remaining === 3) tris.push(prev[cur], cur, next[cur]);
  return tris;
}

// ---------------------------------------------------------------- ribbons
// Offset a polyline to both sides (mitred, limited). Returns {L:[x,y..], R:[x,y..], s:[dist..]}
export function ribbon(f, halfW, wl = null, wr = null) {
  const n = f.length / 2;
  const L = new Float32Array(n * 2), R = new Float32Array(n * 2), S = new Float32Array(n);
  let acc = 0;
  for (let i = 0; i < n; i++) {
    const x = f[2 * i], y = f[2 * i + 1];
    let nx = 0, ny = 0;
    const segN = (k) => {
      const dx = f[2 * k + 2] - f[2 * k], dy = f[2 * k + 3] - f[2 * k + 1];
      const l = Math.hypot(dx, dy) || 1;
      return [-dy / l, dx / l];
    };
    if (i === 0) [nx, ny] = segN(0);
    else if (i === n - 1) [nx, ny] = segN(n - 2);
    else {
      const a = segN(i - 1), b = segN(i);
      nx = a[0] + b[0];
      ny = a[1] + b[1];
      const l = Math.hypot(nx, ny);
      if (l < 1e-6) { nx = b[0]; ny = b[1]; }
      else {
        nx /= l; ny /= l;
        const cos = nx * b[0] + ny * b[1];
        const m = 1 / Math.max(cos, 0.5); // miter limit 2
        nx *= m; ny *= m;
      }
    }
    if (i > 0) acc += Math.hypot(x - f[2 * i - 2], y - f[2 * i - 1]);
    S[i] = acc;
    const hl = wl ? wl[i] : halfW, hr = wr ? wr[i] : halfW;
    L[2 * i] = x + nx * hl; L[2 * i + 1] = y + ny * hl;
    R[2 * i] = x - nx * hr; R[2 * i + 1] = y - ny * hr;
  }
  return { L, R, S };
}

// FNV-1a hash of numbers/strings -> uint32 (stable ids for corrections and estimates)
export function fnv(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}
export function hash01(key, salt) {
  return fnv(key + "|" + salt) / 4294967296;
}
export function footprintHash(fp) {
  return fnv(Array.from(fp, (v) => v.toFixed(2)).join(",")).toString(16);
}

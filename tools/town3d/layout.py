"""Town layout: where the sprite buildings stand on the Toledo map (the map itself has no buildings).

    from layout import town_layout; placements = town_layout(BUILDINGS, grid_deg)

1. Landmarks first: the church at the San Juan de Sahagun shrine, the hospital at the General
   Hospital, school blocks at Consolatrix College and UV Toledo, the supermarket by the public
   market, the power plant at the Toledo Power Company, a five-storey block at the city hall.
2. Then street frontage: along every street (residential and up, service lanes last) lots are set
   back from the kerb on both sides, front to the road, in the land use found behind them:
   commercial areas get shop-houses (townhouse), five-storey shops and a few bungalows; residential
   areas bungalows and townhouses; elsewhere bungalows and townhouses spaced out along the road.
   A second row of houses goes behind the first in residential areas.
3. Every lot (with its yard, forecourt or car park) must lie on land, off the water and every road,
   clear of other lots, on ground no steeper than 3 m across, outside the landing zone and the
   plazas, pitches, parks, sites and cemeteries (left open for fighting and the FOB).

The sprites exist in 8 views, so a building's front must point along the street grid (grid_deg + a
multiple of 45 deg; wide buildings, whose long side is the front, a multiple of 90 deg so they show
three-quarter views); a lot is only used where the street turns that way within 14 deg.
"""
import gzip
import json
import math
import os

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
MAP = os.path.join(os.path.dirname(os.path.dirname(HERE)), "public/maps/toledo_poblacion.mapz")
DIAG = {"school", "hospital", "supermarket", "powerplant"}
STREETS = ["trunk", "trunk_link", "primary", "secondary", "secondary_link", "tertiary", "unclassified", "residential", "living_street"]
NOGO_AREAS = {"pitch", "grass", "site", "paved", "cemetery", "bridge"}
LZ = (2321.0, -190.0)
OPEN = [(2378.0, 205.0, 30.0),            # checkpoint Alpha, Naga-Toledo Road
        (1431.5, 1212.1, 30.0),           # checkpoint Bravo, Naga-Toledo Road / Antonio Y. de Pio Highway
        (-192.6, 6.1, 35.0),              # checkpoint Charlie, Diosdado Macapagal Highway / Rafols Street
        (-117.3, 133.3, 20.0)]            # the market's nest
# every building is drawn larger than its model: taller storeys and doors, so that the soldiers and
# infected (drawn 1.45 m tall, a touch over life size for the 50 deg camera) stand in proportion to
# them: a figure reaches four-fifths of a door and three-fifths of a storey
SIZE = {"townhouse": 1.3, "bungalow": 1.3, "midrise": 1.3, "school": 1.25, "supermarket": 1.25, "powerplant": 1.25,
        "hospital": 1.3, "church": 1.5}
ARCH = {"townhouse": ("concrete_house_2f", "residential"), "bungalow": ("concrete_house_1f", "residential"),
        "midrise": ("shop_commercial", "commercial"), "supermarket": ("shop_commercial", "commercial"),
        "school": ("school_block", "school"), "hospital": ("hospital_block", "hospital"), "church": ("church", "church"),
        "powerplant": ("industrial_plant", "industrial")}


def u(c):
    r = math.radians(c)
    return np.array([math.sin(r), math.cos(r)])


def pip(pts, poly):
    """points (n, 2) in polygon (flat list) -> bool array"""
    x, y = pts[:, 0], pts[:, 1]
    xs, ys = np.asarray(poly[0::2]), np.asarray(poly[1::2])
    inside = np.zeros(len(pts), bool)
    j = len(xs) - 1
    for i in range(len(xs)):
        c = ((ys[i] > y) != (ys[j] > y)) & (x < (xs[j] - xs[i]) * (y - ys[i]) / (ys[j] - ys[i] + 1e-12) + xs[i])
        inside ^= c
        j = i
    return inside


class Ground:
    def __init__(self):
        d = json.loads(gzip.open(MAP).read())
        self.man = json.loads(d["manifest.json"])
        self.L = json.loads(d["layers.json"])
        t = json.loads(d["terrain.json"])
        import base64
        raw = base64.b64decode(t["data_b64"])
        self.Z = np.frombuffer(raw, "<i2").astype(np.float64).reshape(t["ny"], t["nx"]) / 10
        self.t = t
        b = self.man["bounds_local"]
        self.bounds = (b[0] + 45, b[1] + 45, b[2] - 45, b[3] - 45)
        self.land = self.L["land"][0]["outer"]
        self.water = [w["outer"] for w in self.L["water"]]
        self.areas = [(a["surface"], a["outer"], np.array([min(a["outer"][0::2]), min(a["outer"][1::2]), max(a["outer"][0::2]), max(a["outer"][1::2])]))
                      for a in self.L["areas"]]
        # road samples every metre: x, y, half width, rank (0 = path ... 3 = street)
        pts = []
        for r in self.L["roads"]:
            if r.get("tunnel") or r["class"] == "steps":
                continue
            p = r["pts"]
            hw = r.get("w", 4.0) / 2
            for k in range(0, len(p) - 2, 2):
                a, b2 = np.array(p[k:k + 2]), np.array(p[k + 2:k + 4])
                n = max(1, int(np.linalg.norm(b2 - a)))
                for tt in np.linspace(0, 1, n + 1):
                    q = a + (b2 - a) * tt
                    pts.append((q[0], q[1], hw))
        for pr in self.L["piers"]:
            p = pr.get("pts") or pr.get("outer") or []
            for k in range(0, len(p) - 2, 2):
                a, b2 = np.array(p[k:k + 2]), np.array(p[k + 2:k + 4])
                for tt in np.linspace(0, 1, max(1, int(np.linalg.norm(b2 - a))) + 1):
                    q = a + (b2 - a) * tt
                    pts.append((q[0], q[1], pr.get("w", 4) / 2))
        self.road = np.array(pts)
        self.cell = 25.0
        self.rgrid = {}
        for i, (x, y, _) in enumerate(self.road):
            self.rgrid.setdefault((int(x // self.cell), int(y // self.cell)), []).append(i)
        self.rgrid = {k: np.array(v) for k, v in self.rgrid.items()}

    def height(self, pts):
        t = self.t
        fx = np.clip((pts[:, 0] - t["x0"]) / t["res"], 0, t["nx"] - 1.001)
        fy = np.clip((pts[:, 1] - t["y0"]) / t["res"], 0, t["ny"] - 1.001)
        i, j = fx.astype(int), fy.astype(int)
        ax, ay = fx - i, fy - j
        Z = self.Z
        return (Z[j, i] * (1 - ax) + Z[j, i + 1] * ax) * (1 - ay) + (Z[j + 1, i] * (1 - ax) + Z[j + 1, i + 1] * ax) * ay

    def roads_near(self, x0, y0, x1, y1):
        out = []
        for i in range(int(x0 // self.cell) - 1, int(x1 // self.cell) + 2):
            for j in range(int(y0 // self.cell) - 1, int(y1 // self.cell) + 2):
                v = self.rgrid.get((i, j))
                if v is not None:
                    out.append(v)
        return self.road[np.concatenate(out)] if out else np.zeros((0, 3))

    def area_at(self, x, y):
        for (s, poly, bb) in self.areas:
            if bb[0] <= x <= bb[2] and bb[1] <= y <= bb[3] and pip(np.array([[x, y]]), poly)[0]:
                return s
        return None


class Lots:
    """placed lots as oriented rectangles, with a coarse grid for neighbour checks"""
    def __init__(self):
        self.items, self.grid = [], {}

    def corners(self, piv, front, s, r):
        X, Z = u(front - 90), u(front)
        return [piv + s * (x * X + z * Z) for (x, z) in ((r[0], r[2]), (r[1], r[2]), (r[1], r[3]), (r[0], r[3]))]

    def overlaps(self, cs, gap=0.7):
        lo, hi = np.min(cs, 0) - gap, np.max(cs, 0) + gap
        for k in self.near(lo, hi):
            if sat(cs, self.items[k], gap):
                return True
        return False

    def near(self, lo, hi):
        seen = set()
        for i in range(int(lo[0] // 40) - 1, int(hi[0] // 40) + 2):
            for j in range(int(lo[1] // 40) - 1, int(hi[1] // 40) + 2):
                for k in self.grid.get((i, j), ()):
                    if k not in seen:
                        seen.add(k)
                        yield k

    def add(self, cs):
        k = len(self.items)
        self.items.append(cs)
        lo, hi = np.min(cs, 0), np.max(cs, 0)
        for i in range(int(lo[0] // 40), int(hi[0] // 40) + 1):
            for j in range(int(lo[1] // 40), int(hi[1] // 40) + 1):
                self.grid.setdefault((i, j), []).append(k)


def sat(a, b, gap):
    """separating-axis test for two convex quads (lists of 4 points), grown by gap"""
    for poly in (a, b):
        for i in range(4):
            e = poly[(i + 1) % 4] - poly[i]
            n = np.array([-e[1], e[0]]) / (np.linalg.norm(e) + 1e-9)
            pa = [p @ n for p in a]
            pb = [p @ n for p in b]
            if max(pa) + gap < min(pb) or max(pb) + gap < min(pa):
                return False
    return True


def town_layout(B, grid_deg, seed=2026):
    G = Ground()
    rng = np.random.default_rng(seed)
    lots = Lots()
    out = []
    marks = {l["id"]: l["center"] for l in G.man["landmarks"] if l.get("center")}
    # open ground: the landing zone, the port apron, and the city plaza with the streets round it
    # (the final fight: the nest and the Abomination are on the plaza)
    reserved = [(LZ[0], LZ[1], 75.0)] + [(c[0], c[1], {"city_plaza": 45.0, "toledo_port": 22.0}[k]) for k, c in marks.items()
                                          if k in ("city_plaza", "toledo_port")]

    def allowed(t):
        per = 90 if t in DIAG else 45
        return per

    def snap(t, phi):
        per = allowed(t)
        rel = (phi - grid_deg) % per
        err = rel if rel <= per / 2 else rel - per
        return (phi - err) % 360, err

    def try_lot(t, piv, front, s=1.0, nogo=NOGO_AREAS):
        D = B[t]
        lot = D["lot"]
        cs = lots.corners(piv, front, s, lot)
        bmin, bmax = np.min(cs, 0), np.max(cs, 0)
        bx = G.bounds
        if bmin[0] < bx[0] or bmin[1] < bx[1] or bmax[0] > bx[2] or bmax[1] > bx[3]:
            return None
        for (rx, ry, rr) in reserved:
            if math.hypot(piv[0] - rx, piv[1] - ry) < rr + math.hypot(*(bmax - bmin)) / 2:
                return None
        if lots.overlaps(cs):
            return None
        X, Z = u(front - 90), u(front)
        xs = np.arange(lot[0], lot[1] + 1e-6, 1.6 / s)
        zs = np.arange(lot[2], lot[3] + 1e-6, 1.6 / s)
        g = np.array([(x, z) for x in xs for z in zs])
        P = piv + s * (g[:, :1] * X + g[:, 1:] * Z)
        if not pip(P, G.land).all():
            return None
        for w in G.water:
            if pip(P, w).any():
                return None
        h = G.height(P)
        if h.max() - h.min() > 3.0 or h.min() < 0.3:
            return None
        rd = G.roads_near(bmin[0] - 8, bmin[1] - 8, bmax[0] + 8, bmax[1] + 8)
        if len(rd):
            loc = rd[:, :2] - piv
            lx, lz = (loc @ X) / s, (loc @ Z) / s
            m = (rd[:, 2] + 0.6) / s
            if np.any((lx > lot[0] - m) & (lx < lot[1] + m) & (lz > lot[2] - m) & (lz < lot[3] + m)):
                return None
        if nogo:
            for (sfc, poly, bb) in G.areas:
                if sfc in nogo and not (bmax[0] < bb[0] or bmin[0] > bb[2] or bmax[1] < bb[1] or bmin[1] > bb[3]):
                    if pip(P, poly).any():
                        return None
        return cs

    def place(t, piv, front, s=1.0, extra=None, nogo=NOGO_AREAS):
        cs = try_lot(t, piv, front, s, nogo)
        if cs is None:
            return False
        lots.add(cs)
        e = {"type": t, "x": round(float(piv[0]), 2), "y": round(float(piv[1]), 2), "front": round(float(front) % 360, 2), "s": s}
        if extra:
            e.update(extra)
        out.append(e)
        return True

    # ---------------------------------------------------------------- 1. landmarks
    def nearest_road(x, y):
        rd = G.roads_near(x - 60, y - 60, x + 60, y + 60)
        if not len(rd):
            return None
        d = np.hypot(rd[:, 0] - x, rd[:, 1] - y)
        return rd[np.argmin(d)]

    def landmark(t, key, n=1, radius=70, s=None):
        s = s or SIZE[t]
        c = marks[key]
        placed = 0
        r0 = nearest_road(*c)
        face = math.degrees(math.atan2(r0[0] - c[0], r0[1] - c[1])) if r0 is not None else grid_deg
        fronts = sorted({snap(t, face + k * allowed(t))[0] for k in range(int(360 / allowed(t)))},
                        key=lambda f: abs(((f - face) + 180) % 360 - 180))
        for sc in (s, s * 0.93, s * 0.87):                    # a little smaller where the full size does not fit
            for rad in np.arange(0, radius, 3.0):
                for a in (np.linspace(0, 360, max(1, int(rad / 3) * 2 + 1), endpoint=False) if rad else [0]):
                    p = np.array(c) + rad * u(a)
                    for f in fronts[:2]:
                        if place(t, p, f, round(sc, 3), {"lm": key} if placed == 0 else None, NOGO_AREAS - {"site", "paved"}):
                            placed += 1
                            if placed >= n:
                                return placed
                            break
            if placed:
                return placed
        return placed

    for (t, key, kw) in (("church", "sahagun_church", dict()), ("hospital", "general_hospital", dict()),
                         ("school", "consolatrix", dict(n=2)), ("school", "uv_toledo", dict(n=2)),
                         ("supermarket", "public_market", dict(radius=120)), ("powerplant", "tpc", dict(radius=150)),
                         ("midrise", "city_hall", dict(n=2, s=1.4))):
        if key in marks:
            landmark(t, key, **kw)
    # school blocks on every school and campus site; a supermarket on every large commercial area
    def centroid(poly):
        P = np.array(poly).reshape(-1, 2)
        return P.mean(0)
    taken = [np.array([e["x"], e["y"]]) for e in out]
    for a in G.L["areas"]:
        nm, area = (a.get("name") or ""), a.get("area") or 0
        c = centroid(a["outer"])
        if any(np.linalg.norm(c - t) < 60 for t in taken):
            continue
        if a["surface"] == "site" and any(k in nm for k in ("School", "College", "University", "Campus")):
            marks["_" + a["id"]] = c.tolist()
            landmark("school", "_" + a["id"], n=2 if area > 9000 else 1, radius=max(20, math.sqrt(area) / 2))
        elif a["surface"] in ("commercial", "paved") and (area > 6000 or "Mall" in nm):
            marks["_" + a["id"]] = c.tolist()
            landmark("supermarket", "_" + a["id"], radius=max(25, math.sqrt(area) / 2))
    for e in out:
        if str(e.get("lm", "")).startswith("_"):
            del e["lm"]
    print(f"  landmarks and sites: {len(out)} buildings")
    # room to fight at the mission's checkpoints (op01: road junctions) and round the market's nest:
    # no houses within these circles (the landmarks above stand already)
    for (x, y, r) in OPEN:
        reserved.append((x, y, r))

    # ---------------------------------------------------------------- 2. street frontage
    core = np.array(marks.get("city_plaza", (0, 0)))
    roads = [r for r in G.L["roads"] if r["class"] in STREETS] + [r for r in G.L["roads"] if r["class"] == "service"]
    second_row = []
    supermarkets = sum(1 for e in out if e["type"] == "supermarket")
    for r in roads:
        p = np.array(r["pts"]).reshape(-1, 2)
        if len(p) < 2:
            continue
        hw = r.get("w", 4.0) / 2
        seg = np.linalg.norm(np.diff(p, axis=0), axis=1)
        L = seg.sum()
        if L < 12:
            continue
        cum = np.concatenate([[0], np.cumsum(seg)])
        main = r["class"] in ("trunk", "primary", "secondary", "tertiary")
        free = {1: 6.0, -1: 6.0}
        s_ = 6.0
        while s_ < L - 6:
            k = min(np.searchsorted(cum, s_) - 1, len(seg) - 1)
            k = max(k, 0)
            tt = (s_ - cum[k]) / max(seg[k], 1e-6)
            P = p[k] + (p[k + 1] - p[k]) * tt
            dvec = (p[k + 1] - p[k]) / max(seg[k], 1e-6)
            moved = False
            for side in (1, -1):
                if s_ < free[side]:
                    continue
                n = np.array([dvec[1], -dvec[0]]) * side                     # toward the lot
                q = P + n * (hw + 10)
                zone = G.area_at(*q)
                if zone in NOGO_AREAS or zone == "industrial":
                    free[side] = s_ + 6
                    continue
                dc = np.linalg.norm(P - core)
                if zone == "commercial" or (main and dc < 700):
                    pick = rng.choice(["townhouse", "midrise", "bungalow", "townhouse"], p=[0.45, 0.25 if main else 0.08, 0.2, 0.1 if main else 0.27])
                    gap = rng.uniform(0.6, 2.2)
                elif zone == "residential" or dc < 1100:
                    pick = rng.choice(["bungalow", "townhouse"], p=[0.6, 0.4])
                    gap = rng.uniform(1.0, 4.0)
                else:
                    pick = rng.choice(["bungalow", "townhouse"], p=[0.75, 0.25])
                    gap = rng.uniform(8.0, 30.0) if r["class"] != "residential" else rng.uniform(3.0, 10.0)
                if zone == "commercial" and supermarkets < 3 and main and rng.uniform() < 0.04:
                    pick = "supermarket"
                face = math.degrees(math.atan2(-n[0], -n[1]))
                done = False
                busy = zone == "commercial" or (main and dc < 700)
                for t in ([pick] + [x for x in ("townhouse", "bungalow") if x != pick and busy]):
                    front, err = snap(t, face)
                    if abs(err) > 14:
                        continue
                    lot = [v * SIZE[t] for v in B[t]["lot"]]                  # the lot as drawn (scaled)
                    half = (lot[1] - lot[0]) / 2
                    setback = rng.uniform(0.8, 2.2) + half * abs(math.sin(math.radians(err)))
                    # the pivot sits behind the lot's front edge, facing the street
                    piv = P + n * (hw + setback + lot[3]) - u(front - 90) * ((lot[0] + lot[1]) / 2)
                    if place(t, piv, front, SIZE[t]):
                        free[side] = s_ + (lot[1] - lot[0]) + gap
                        if t == "supermarket":
                            supermarkets += 1
                        if (zone in ("residential", "commercial") or dc < 1300) and t in ("bungalow", "townhouse", "midrise"):
                            second_row.append((t, piv, front, lot))
                        done = moved = True
                        break
                if not done:
                    free[side] = s_ + 2.0
            s_ += 2.0
    print(f"  frontage: {len(out)} buildings")
    # ---------------------------------------------------------------- 3. infill behind the street front
    # (lots reached by alleys, as in the town's dense blocks): up to two more rows, facing the same way
    row = second_row
    for depth in (1, 2):
        nxt = []
        for (t, piv, front, lot) in row:
            if rng.uniform() < (0.2 if depth == 1 else 0.45):
                continue
            t2 = "bungalow" if rng.uniform() < 0.55 else "townhouse"
            lot2 = [v * SIZE[t2] for v in B[t2]["lot"]]
            for jit in (0.0, rng.uniform(-3, 3)):
                back = piv - u(front) * (rng.uniform(1.2, 3.5) - lot[2] + lot2[3]) \
                    + u(front - 90) * ((lot[0] + lot[1]) / 2 - (lot2[0] + lot2[1]) / 2 + jit)
                if place(t2, back, front, SIZE[t2]):
                    nxt.append((t2, back, front, lot2))
                    break
        print(f"  infill row {depth}: {len(nxt)} buildings")
        row = nxt
    counts = {}
    for e in out:
        counts[e["type"]] = counts.get(e["type"], 0) + 1
    print(f"  total: {len(out)} buildings", counts)
    return out

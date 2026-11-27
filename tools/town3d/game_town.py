"""Town sprites for the game: public/sprites/town/*.png + town.json

    cd tools/town3d && python3 game_town.py        (frames from render_sheet.py / build_trees.py)

1. Packs the pre-rendered buildings (townhouse, mid-rise, church, school, hospital: 3 states x 8
   views) and trees (coconut palm, mango, banana: 2 views x 4 sway frames) at half resolution,
   trimmed, into one 256-colour atlas page per kind; and the fire and smoke loops (fx.py) with
   every building's fire points (burn.py) for its damaged and destroyed states.
2. Picks the map buildings that become sprite buildings: the landmark church and hospital, and
   school blocks, two-storey houses and shop buildings whose size and orientation fit a sprite.
   The sprites are drawn for 8 fixed views, so the camera is turned to the town's street grid
   (camera_yaw_deg) and a building is only used where it lines up with the grid within 12 deg.
   Each chosen building takes the sprite's footprint, height and entrance (collision, navigation,
   line of sight and the minimap all follow), scaled to fit the lot.

Building space (all sprites): x = width, y = up, z = depth, +z = the front; the pivot (map anchor)
is the building's origin. A point (x, z) goes to the map at pivot + s * (x * u(front - 90) + z * u(front))
with u(c) = (sin c, cos c) for a compass bearing c (x east, y north).
"""
import gzip
import json
import math
import os
import sys

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
OUT = os.path.join(ROOT, "public/sprites/town")
MAP = os.path.join(ROOT, "public/maps/toledo_poblacion.mapz")
SRC_PPM = 320 / 18.5          # px per metre of the renders
SCALE = 0.5                   # atlas resolution relative to the renders
PPM = SRC_PPM * SCALE

# fp: footprint polygon (x, z pairs), ent: [edge index, t] (the door), box: x0, x1, z0, z1, top (depth
# proxy), lot: x0, x1, z0, z1 (everything the sprite paints on the ground), long: the long axis
BUILDINGS = {
    "townhouse": dict(src="out", F=320, pivot=(0.47, 0.60),
                      fp=[3.5, 4.5, -3.5, 4.5, -3.5, -4.5, 3.5, -4.5], ent=[0, 0.5],
                      box=[-4.6, 3.6, -6.6, 5.4, 7.6], lot=[-4.8, 3.8, -6.8, 5.6], lv=2, h=5.9, rh=1.6, long="z"),
    "midrise": dict(src="out_midrise", F=480, pivot=(0.425, 0.6775),
                    fp=[5.0, 6.0, -5.0, 6.0, -5.0, -6.0, 5.0, -6.0], ent=[0, 0.5],
                    box=[-5.2, 5.2, -6.2, 7.7, 19.6], lot=[-5.3, 6.7, -6.3, 8.7], lv=5, h=17.6, rh=0.0, long="z"),
    "church": dict(src="out_church", F=704, pivot=(0.457, 0.607),
                   fp=None, ent=[0, 0.4],
                   box=[-10.5, 6.5, -17.1, 11.2, 20.6], lot=[-10.8, 7.2, -17.7, 14.9], lv=1, h=8.5, rh=3.2, long="z"),
    "school": dict(src="out_school", F=808, pivot=(0.458, 0.537),
                   fp=[19.0, 4.7, -19.0, 4.7, -19.0, -4.7, 19.0, -4.7], ent=[0, 0.5],
                   box=[-19.8, 19.8, -5.5, 5.5, 12.6], lot=[-20.0, 20.0, -5.7, 11.0], lv=3, h=10.2, rh=2.4, long="x"),
    "hospital": dict(src="out_hospital", F=784, pivot=(0.4845, 0.583),
                     fp=[14.0, 7.0, -14.0, 7.0, -14.0, 2.6, -16.2, 2.6, -16.2, -2.6, -14.0, -2.6, -14.0, -7.0, 14.0, -7.0],
                     ent=[0, 0.73], box=[-16.3, 14.1, -7.0, 7.0, 18.2], lot=[-16.5, 15.5, -8.0, 15.5], lv=4, h=15.0, rh=0.0, long="x"),
}
# church outline: facade and bell tower in front, the nave with its buttresses, the round apse behind
BUILDINGS["church"]["fp"] = [7.0, 11.2, -10.5, 11.2, -10.5, 6.2, -5.6, 6.2, -5.6, -12.0] + \
    [v for k in range(7) for v in (-5.1 * math.cos(math.pi * k / 6), -12.0 - 5.1 * math.sin(math.pi * k / 6))] + \
    [5.6, -12.0, 5.6, 10.0, 7.0, 10.0]

TREES = {   # kind: map tree kinds, height, depth box half size, the two views used
    "palm": dict(src="coconut_palm", F=320, pivot=(0.40, 0.66), h=11.5, r=2.6, views=[1, 5]),
    "mango": dict(src="mango_tree", F=320, pivot=(0.36, 0.62), h=9.0, r=3.4, views=[1, 5]),
    "banana": dict(src="banana_plant", F=192, pivot=(0.42, 0.62), h=4.3, r=1.6, views=[1, 5]),
}

# which map archetypes may take which sprite (and how many at most)
RULES = [
    ("church", ("landmark_church",), 1, (0.8, 1.3)),
    ("hospital", ("landmark_hospital",), 1, (0.8, 1.25)),
    ("school", ("school_block", "college_block"), 14, (0.8, 1.2)),
    ("midrise", ("shop_commercial", "government_hall"), 6, (0.85, 1.25)),
    ("townhouse", ("concrete_house_2f", "shop_commercial"), 40, (0.85, 1.3)),
]
MAX_ERR = 12.0
DIAG = {"school", "hospital"}
DEBUG = set(os.environ.get("TOWN_DEBUG", "").split(","))


# ------------------------------------------------------------------ atlas packing
def premul_resize(im, k):
    a = np.asarray(im.convert("RGBA")).astype(np.float32) / 255
    a[..., :3] *= a[..., 3:4]
    w, h = max(1, round(im.width * k)), max(1, round(im.height * k))
    ch = [Image.fromarray(a[..., i]).resize((w, h), Image.LANCZOS) for i in range(4)]
    b = np.clip(np.stack([np.asarray(c) for c in ch], -1), 0, 1)
    al = b[..., 3:4]
    b[..., :3] = np.where(al > 1e-4, b[..., :3] / np.maximum(al, 1e-4), 0)
    b[..., 3] = np.where(al[..., 0] < 2 / 255, 0, al[..., 0])
    return Image.fromarray((np.clip(b, 0, 1) * 255 + 0.5).astype(np.uint8), "RGBA")


def bbox(im, thr=3):
    a = np.asarray(im)[..., 3] > thr
    ys, xs = np.nonzero(a)
    return xs.min(), ys.min(), xs.max() + 1, ys.max() + 1


def shelf_pack(sizes, width, pad=3):
    x = y = row = 0
    out = [None] * len(sizes)
    for i in sorted(range(len(sizes)), key=lambda i: -sizes[i][1]):
        w, h = sizes[i]
        if x + w + pad > width:
            x, y, row = 0, y + row + pad, 0
        out[i] = (x + pad, y + pad)
        x += w + pad
        row = max(row, h)
    return out, y + row + 2 * pad


def save_page(items, name):
    """items: [(image, ...)] -> places them on one page, returns [(x, y)]"""
    sizes = [(im.width, im.height) for im in items]
    area = sum(w * h for w, h in sizes)
    width = min(4096, max(256, int(math.sqrt(area) * 1.15 / 4 + 1) * 4))
    while True:
        pos, height = shelf_pack(sizes, width)
        if height <= 4096:
            break
        width += 256
    page = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    for im, (x, y) in zip(items, pos):
        page.paste(im, (x, y))
    # 256 colours keep the download small; alpha is kept as is
    q = page.quantize(colors=256, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.FLOYDSTEINBERG)
    q.save(os.path.join(OUT, name + ".png"), optimize=True)
    return pos, (width, height)


def pack_buildings():
    meta = {}
    for name, B in BUILDINGS.items():
        ims, info = [], []
        for st in range(3):
            for v in range(8):
                im = premul_resize(Image.open(os.path.join(HERE, B["src"], "frames", f"{st}_{v}.png")), SCALE)
                x0, y0, x1, y1 = bbox(im)
                ims.append(im.crop((x0, y0, x1, y1)))
                ax, ay = B["pivot"][0] * B["F"] * SCALE - x0, B["pivot"][1] * B["F"] * SCALE - y0
                info.append([round(ax, 2), round(ay, 2)])
        pos, size = save_page(ims, name)
        frames = [[[*pos[st * 8 + v], ims[st * 8 + v].width, ims[st * 8 + v].height, *info[st * 8 + v]] for v in range(8)] for st in range(3)]
        meta[name] = {"page": name + ".png", "size": size, "frames": frames, "fp": [round(v, 2) for v in B["fp"]], "ent": B["ent"],
                      "box": B["box"], "lot": B["lot"], "lv": B["lv"], "h": B["h"], "rh": B["rh"]}
        print(f"  {name}: page {size[0]}x{size[1]}, {os.path.getsize(os.path.join(OUT, name + '.png')) // 1024} KB")
    return meta


def pack_trees():
    ims, keys = [], []
    for kind, T in TREES.items():
        for v in T["views"]:
            fr = [premul_resize(Image.open(os.path.join(HERE, "out_trees", "frames", f"{T['src']}_{v}_{f}.png")), SCALE) for f in range(4)]
            bb = np.array([bbox(im) for im in fr])
            x0, y0, x1, y1 = bb[:, 0].min(), bb[:, 1].min(), bb[:, 2].max(), bb[:, 3].max()
            w, h = x1 - x0, y1 - y0
            strip = Image.new("RGBA", (4 * (w + 3), h), (0, 0, 0, 0))
            for f, im in enumerate(fr):
                strip.paste(im.crop((x0, y0, x1, y1)), (f * (w + 3), 0))
            ims.append(strip)
            keys.append((kind, v, w, h, T["pivot"][0] * T["F"] * SCALE - x0, T["pivot"][1] * T["F"] * SCALE - y0))
    pos, size = save_page(ims, "trees")
    kinds = {}
    for (kind, v, w, h, ax, ay), (x, y) in zip(keys, pos):
        T = TREES[kind]
        k = kinds.setdefault(kind, {"views": [], "h": T["h"], "r": T["r"]})
        k["views"].append([x, y, int(w), int(h), int(w) + 3, round(ax, 2), round(ay, 2)])
    print(f"  trees: page {size[0]}x{size[1]}, {os.path.getsize(os.path.join(OUT, 'trees.png')) // 1024} KB")
    return {"page": "trees.png", "size": size, "kinds": kinds, "fps": 4}


def pack_fx():
    """fire (full resolution) and smoke (half) loops as one strip each, and the fire points of
    every building's damaged and destroyed states (from burn.py)"""
    out = {}
    for kind, k, fps in (("fire", 1.0, 12), ("smoke", SCALE, 12)):
        fr = np.load(os.path.join(HERE, "out_fx", kind + ".npy"))               # premultiplied frames
        anchor = (24.0, 74.0) if kind == "fire" else (39.2, 214.0)
        ims = []
        for f in fr:
            a = f[..., 3:4]
            rgb = np.where(a > 1e-4, f[..., :3] / np.maximum(a, 1e-4), 0)
            im = Image.fromarray((np.clip(np.concatenate([rgb, a], -1), 0, 1) * 255 + 0.5).astype(np.uint8), "RGBA")
            ims.append(premul_resize(im, k) if k != 1.0 else im)
        w, h = ims[0].size
        page = Image.new("RGBA", (len(ims) * (w + 3), h), (0, 0, 0, 0))
        for i, im in enumerate(ims):
            page.paste(im, (i * (w + 3), 0))
        page.save(os.path.join(OUT, kind + ".png"), optimize=True)
        out[kind] = {"page": kind + ".png", "ppm": round(SRC_PPM * k, 4), "frame": [0, 0, w, h, w + 3, round(anchor[0] * k, 2), round(anchor[1] * k, 2)],
                     "frames": len(ims), "fps": fps, "box": [1.0, 4.5] if kind == "fire" else [2.0, 14.0]}
        print(f"  {kind}: {len(ims)} frames {w}x{h}, {os.path.getsize(os.path.join(OUT, kind + '.png')) // 1024} KB")
    burn = json.load(open(os.path.join(HERE, "out_fx", "burning.json")))
    # then: in which of the 8 views the building does not hide the fire (bit v = view v), and for a
    # fire on a wall the yaw of the wall's outward normal (else null)
    out["emitters"] = {name: {st: [[e["kind"], *e["pos"], e["scale"], e["phase"],
                                    sum(1 << v for v in range(8) if d["states"][st]["views"][v][i]["layer"] == "front"), e.get("wall")]
                                   for i, e in enumerate(d["states"][st]["emitters"])]
                              for st in ("damaged", "destroyed")} for name, d in burn.items()}
    return out


# ------------------------------------------------------------------ placement on the map
def u(c):
    r = math.radians(c)
    return np.array([math.sin(r), math.cos(r)])


def to_world(px, py, front, s, lx, lz):
    return np.array([px, py]) + s * (lx * u(front - 90) + lz * u(front))


def pip(x, y, f):
    n, inside, j = len(f) // 2, False, len(f) // 2 - 1
    for i in range(n):
        xi, yi, xj, yj = f[2 * i], f[2 * i + 1], f[2 * j], f[2 * j + 1]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi + 1e-12) + xi:
            inside = not inside
        j = i
    return inside


def signed_area(f):
    n = len(f) // 2
    return 0.5 * sum(f[2 * i] * f[2 * ((i + 1) % n) + 1] - f[2 * ((i + 1) % n)] * f[2 * i + 1] for i in range(n))


def load_map():
    d = json.loads(gzip.open(MAP).read())
    blds = []
    for k, v in d.items():
        if k.startswith("chunks/"):
            blds += json.loads(v)["buildings"]
    layers = json.loads(d["layers.json"])
    return blds, layers


def placements():
    blds, layers = load_map()
    wind = np.sign(np.median([signed_area(b["fp"]) for b in blds]))
    road_pts = []
    for r in layers["roads"]:
        if r.get("tunnel"):
            continue
        p = r["pts"]
        main = r["class"] not in ("footway", "path", "steps", "track", "service", "pedestrian", "cycleway")
        for k in range(0, len(p) - 2, 2):
            a, b = np.array(p[k:k + 2]), np.array(p[k + 2:k + 4])
            n = max(1, int(np.linalg.norm(b - a)))
            for t in np.linspace(0, 1, n + 1):
                q = a + (b - a) * t
                road_pts.append((q[0], q[1], r.get("w", 4) / 2, main))
    road_pts = np.array(road_pts)

    def entrance_dir(b):
        f, (ei, t) = b["fp"], b.get("ent", [0, 0.5])
        n = len(f) // 2
        i, j = ei % n, (ei + 1) % n
        ax, ay, bx, by = f[2 * i], f[2 * i + 1], f[2 * j], f[2 * j + 1]
        mx, my = ax + (bx - ax) * t, ay + (by - ay) * t
        L = math.hypot(bx - ax, by - ay) or 1
        nx, ny = (by - ay) / L, -(bx - ax) / L
        if pip(mx + nx * 0.4, my + ny * 0.4, f):
            nx, ny = -nx, -ny
        return math.degrees(math.atan2(nx, ny)) % 360

    def candidates(theta0):
        out = []
        for name, arch, _, (smin, smax) in RULES:
            B = BUILDINGS[name]
            bx0, bx1, bz0, bz1, _top = B["box"]
            mw, ml = bx1 - bx0, bz1 - bz0                     # mass width (x) and length (z)
            for b in blds:
                if b.get("a") not in arch or b.get("part_of") or b.get("hidden"):
                    continue
                if name == "townhouse" and b.get("lv", 1) < 2:
                    continue
                if name == "midrise" and (b.get("lv", 1) < 2 or b.get("area", 0) < 120):
                    continue
                cx, cy, L, W, brg = b["obb"]
                ent = entrance_dir(b)
                opts = []
                for front in (brg, brg + 90, brg + 180, brg + 270):
                    along = (front - brg) % 180 < 1        # the front axis runs along the map's long side
                    lz, lx = (L, W) if along else (W, L)   # lot length along the front axis, and across
                    sf = min(lx / mw, lz / ml) * 1.06
                    # wide buildings (front on the long side) need the diagonal views, the camera being
                    # at theta0 + 45 deg: their fronts follow the grid; others may also sit at 45 deg to it
                    per = 90 if name in DIAG else 45
                    rel = (front - theta0) % per
                    err = rel if rel <= per / 2 else rel - per
                    dfront = abs((front - ent + 180) % 360 - 180)
                    opts.append((dfront > 100, abs(err) > MAX_ERR, -min(sf, smax), dfront, front - err, sf, err))
                opts.sort()
                for o in opts[:2]:
                    _, bad, _, dfront, snapped, sf, err = o
                    if bad or sf < smin or dfront > 100:
                        continue
                    out.append(dict(b=b, type=name, front=snapped % 360, s=min(sf, smax), err=err))
                    break
        return out

    def weight(c):
        return {"church": 20, "hospital": 20, "school": 3, "midrise": 2, "townhouse": 1}[c["type"]] * (1 - abs(c["err"]) / 30)

    best = max(np.arange(0, 45, 0.5), key=lambda t: sum(weight(c) for c in candidates(t)))
    cands = candidates(best)
    print(f"  camera grid angle {best} deg: {len(cands)} buildings fit before the lot checks")

    others = [b for b in blds if not b.get("part_of") and not b.get("hidden")]
    placed, lots, counts, hidden = [], [], {}, set()
    order = sorted(cands, key=lambda c: (-weight(c), abs(c["err"])))
    def try_place(c, off):
        b, name, B = c["b"], c["type"], BUILDINGS[c["type"]]
        s, front = c["s"], c["front"]
        bx0, bx1, bz0, bz1, _ = B["box"]
        mc = np.array([(bx0 + bx1) / 2, (bz0 + bz1) / 2])
        piv = np.array(b["obb"][:2]) + off * u(b["obb"][4]) - s * (mc[0] * u(front - 90) + mc[1] * u(front))
        X, Z = u(front - 90), u(front)
        lot = B["lot"]
        xs = np.arange(lot[0], lot[1] + 1e-6, 1.0 / s)
        zs = np.arange(lot[2], lot[3] + 1e-6, 1.0 / s)
        g = np.array([(x, z) for x in xs for z in zs])
        pts = piv + s * (g[:, :1] * X + g[:, 1:] * Z)
        hide = []
        for o in others:                                   # no other building under the new lot
            if o is b or o["id"] in hidden:
                continue
            bb = o.get("bb") or [min(o["fp"][0::2]), min(o["fp"][1::2]), max(o["fp"][0::2]), max(o["fp"][1::2])]
            m = (pts[:, 0] > bb[0]) & (pts[:, 0] < bb[2]) & (pts[:, 1] > bb[1]) & (pts[:, 1] < bb[3])
            if m.any() and any(pip(x, y, o["fp"]) for x, y in pts[m]):
                if o.get("a") == "canopy" and name in ("hospital", "school", "church"):
                    hide.append(o["id"])                   # a covered walkway under the forecourt goes
                    continue
                return "lot clashes with " + o["id"] + " " + str(o.get("a"))
        # roads: not through the building, main roads not across the yard
        loc = road_pts[:, :2] - piv
        lx, lz = (loc @ X) / s, (loc @ Z) / s
        hw = road_pts[:, 2] / s
        inmass = (lx > bx0 - hw) & (lx < bx1 + hw) & (lz > bz0 - hw) & (lz < bz1 + hw)
        inlot = (lx > lot[0]) & (lx < lot[1]) & (lz > lot[2]) & (lz < lot[3]) & (road_pts[:, 3] > 0)
        if inmass.any() or inlot.any():
            return "road through the " + ("building" if inmass.any() else "lot")
        for q in lots:                                     # not on top of another new lot
            loc2 = pts - q["piv"]
            a2, b2 = (loc2 @ q["X"]) / q["s"], (loc2 @ q["Z"]) / q["s"]
            L2 = q["lot"]
            if np.any((a2 > L2[0]) & (a2 < L2[1]) & (b2 > L2[2]) & (b2 < L2[3])):
                return "overlaps another new lot"
        return dict(piv=piv, X=X, Z=Z, s=s, lot=lot, hide=hide)

    for c in order:
        b, name, B = c["b"], c["type"], BUILDINGS[c["type"]]
        cap = next(r[2] for r in RULES if r[0] == name)
        if counts.get(name, 0) >= cap:
            continue
        bx0, bx1, bz0, bz1, _ = B["box"]
        along = (c["front"] - b["obb"][4]) % 180 < 13 or (c["front"] - b["obb"][4]) % 180 > 167
        span = (bz1 - bz0 if along else bx1 - bx0) * c["s"]
        room = max(0.0, (b["obb"][2] - span) / 2)
        offs = sorted(np.arange(-room, room + 1e-6, 2.0) if room > 1 else [0.0], key=abs)
        res = None
        for off in offs:
            res = try_place(c, off)
            if isinstance(res, dict):
                break
        if not isinstance(res, dict):
            if DEBUG and name in DEBUG:
                print("    ", name, b["id"], res)
            continue
        lots.append(res)
        hidden.update(res["hide"])
        counts[name] = counts.get(name, 0) + 1
        piv = res["piv"]
        placed.append({"id": b["id"], "type": name, "x": round(float(piv[0]), 2), "y": round(float(piv[1]), 2),
                       "front": round(float(c["front"]), 2), "s": round(float(c["s"]), 3), "was": b.get("a"),
                       "err": round(float(c["err"]), 1), **({"hide": res["hide"]} if res["hide"] else {})})
    print("  placed:", counts)
    for p in placed:
        if p["type"] in ("church", "hospital", "midrise"):
            print("   ", p)
    return best, placed, int(wind)


def main():
    os.makedirs(OUT, exist_ok=True)
    print("packing")
    town = {"format": 1, "ppm": round(PPM, 4), "buildings": pack_buildings(), "trees": pack_trees(), "fx": pack_fx()}
    print("placing")
    theta0, placed, wind = placements()
    town["camera_yaw_deg"] = round((theta0 + 45) % 360, 2)
    town["grid_deg"] = theta0
    town["winding"] = wind
    town["placements"] = placed
    json.dump(town, open(os.path.join(OUT, "town.json"), "w"), separators=(",", ":"))
    print("  -> public/sprites/town/town.json", os.path.getsize(os.path.join(OUT, "town.json")) // 1024, "KB")


if __name__ == "__main__":
    sys.exit(main())

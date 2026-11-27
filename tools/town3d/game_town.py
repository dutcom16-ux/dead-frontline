"""Town sprites for the game: public/sprites/town/*.png + town.json

    cd tools/town3d && python3 game_town.py        (frames from render_sheet.py / build_trees.py)

1. Packs the pre-rendered buildings (townhouse, bungalow, mid-rise, church, school, hospital,
   supermarket, power plant: 3 states x 8 views) and trees (coconut palm, mango, banana: 2 views x 4 sway frames) at half resolution (houses and shop blocks at 3/4: they are seen most),
   trimmed, into one 256-colour atlas page per kind; and the fire and smoke loops (fx.py) with
   every building's fire points (burn.py) for its damaged and destroyed states.
2. Lays out the town (layout.py): the map package has no buildings, so every building is a sprite
   building placed here — the landmarks (church, hospital, schools, supermarket, power plant,
   city hall block) and houses and shops along the streets. The sprites are drawn for 8 fixed
   views, so the camera is turned to the street grid (camera_yaw_deg) and every building faces
   along it. The game makes a map building from each placement (footprint, height, entrance;
   collision, navigation, line of sight and the minimap all follow).

Building space (all sprites): x = width, y = up, z = depth, +z = the front; the pivot (map anchor)
is the building's origin. A point (x, z) goes to the map at pivot + s * (x * u(front - 90) + z * u(front))
with u(c) = (sin c, cos c) for a compass bearing c (x east, y north).
"""
import json
import math
import os
import sys

import numpy as np
from PIL import Image

from layout import town_layout

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
OUT = os.path.join(ROOT, "public/sprites/town")
SRC_PPM = 320 / 18.5          # px per metre of the renders
SCALE = 0.5                   # atlas resolution relative to the renders
PPM = SRC_PPM * SCALE
# the houses and shops are seen most and drawn 1.3x (layout.SIZE): their pages are sharper
RES = {"townhouse": 0.75, "bungalow": 0.75, "midrise": 0.7}

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
    "bungalow": dict(src="out_bungalow", F=448, pivot=(0.492, 0.515),
                     fp=[5.5, 2.5, -5.5, 2.5, -5.5, -4.0, 5.5, -4.0], ent=[0, 0.61],
                     box=[-6.0, 9.1, -4.6, 4.7, 5.2], lot=[-6.7, 9.5, -5.7, 6.4], lv=1, h=3.4, rh=1.75, long="x"),
    "supermarket": dict(src="out_supermarket", F=720, pivot=(0.495, 0.529),
                        fp=[12.0, 2.7, -12.0, 2.7, -12.0, -12.3, 12.0, -12.3], ent=[0, 0.29],
                        box=[-12.6, 12.6, -12.4, 7.5, 9.3], lot=[-13.7, 13.7, -14.9, 15.1], lv=1, h=7.0, rh=0.0, long="x"),
    "powerplant": dict(src="out_powerplant", F=880, pivot=(0.493, 0.641),
                       fp=[5.0, 6.0, -15.0, 6.0, -15.0, -4.0, 5.0, -4.0, 5.0, -8.0, 13.0, -8.0, 13.0, 4.0, 5.0, 4.0], ent=[1, 0.5],
                       box=[-15.3, 15.8, -8.3, 6.1, 21.6], lot=[-17.3, 16.3, -14.9, 13.9], lv=3, h=13.0, rh=0.0, long="x",
                       # solid yard structures besides the halls: x0, x1, z0, z1, height
                       parts=[[-16.4, -8.0, 7.4, 12.6, 6.0], [-17.0, -2.5, -14.5, -6.3, 9.0], [6.2, 15.6, 5.8, 13.4, 2.2],
                              [-3.0, 0.0, 11.0, 13.4, 2.8], [7.6, 10.4, -12.4, -9.6, 30.0], [13.0, 15.7, 0.3, 3.9, 22.0]]),
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
        ims, info, k = [], [], RES.get(name, SCALE)
        for st in range(3):
            for v in range(8):
                im = premul_resize(Image.open(os.path.join(HERE, B["src"], "frames", f"{st}_{v}.png")), k)
                x0, y0, x1, y1 = bbox(im)
                ims.append(im.crop((x0, y0, x1, y1)))
                ax, ay = B["pivot"][0] * B["F"] * k - x0, B["pivot"][1] * B["F"] * k - y0
                info.append([round(ax, 2), round(ay, 2)])
        pos, size = save_page(ims, name)
        frames = [[[*pos[st * 8 + v], ims[st * 8 + v].width, ims[st * 8 + v].height, *info[st * 8 + v]] for v in range(8)] for st in range(3)]
        meta[name] = {"page": name + ".png", "size": size, "ppm": round(SRC_PPM * k, 4), "frames": frames, "fp": [round(v, 2) for v in B["fp"]], "ent": B["ent"],
                      "box": B["box"], "lot": B["lot"], "lv": B["lv"], "h": B["h"], "rh": B["rh"], **({"parts": B["parts"]} if "parts" in B else {})}
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
GRID_DEG = 19.0                 # the street grid of the Poblacion (compass bearing of the main streets)
ENTER = {"church": 1.0, "hospital": 1.0, "school": 1.0, "supermarket": 1.0, "midrise": 0.6, "townhouse": 0.25, "bungalow": 0.2}


def placements():
    """the town's buildings: every one a new map building (id t<n>) made from its sprite"""
    rng = np.random.default_rng(77)
    placed = []
    for n, p in enumerate(town_layout(BUILDINGS, GRID_DEG)):
        e = {"id": f"t{n}", **p}
        if rng.uniform() < ENTER.get(p["type"], 0):
            e["enter"] = 1
        placed.append(e)
    return placed


def main():
    os.makedirs(OUT, exist_ok=True)
    print("packing")
    town = {"format": 1, "ppm": round(PPM, 4), "buildings": pack_buildings(), "trees": pack_trees(), "fx": pack_fx()}
    print("placing")
    placed = placements()
    town["camera_yaw_deg"] = round((GRID_DEG + 45) % 360, 2)
    town["grid_deg"] = GRID_DEG
    town["winding"] = 1           # footprints counter-clockwise (x east, y north), as the map's
    town["placements"] = placed
    json.dump(town, open(os.path.join(OUT, "town.json"), "w"), separators=(",", ":"))
    print("  -> public/sprites/town/town.json", os.path.getsize(os.path.join(OUT, "town.json")) // 1024, "KB")


if __name__ == "__main__":
    sys.exit(main())

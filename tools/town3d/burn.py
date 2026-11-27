"""Fires and smoke on the damaged and destroyed buildings: out_fx/burning.json + preview GIFs.

    python3 burn.py [names...]

For every building and its damaged and destroyed states, fire points are taken from the model:
the burnt-out windows and shell holes (the soot plumes on the walls) when damaged, the largest
rubble heaps and burnt floors when destroyed. Each point is projected into all 8 views with the
sprites' camera, and tested against the model: a point the building hides from the camera goes
on the "back" layer (draw its fire and smoke before the building, which then covers their lower
part), the others on the "front" layer (after the building).

burning.json, per building and state:
  emitters  [{kind: "fire" | "smoke", pos: [x, y, z] building metres, scale, phase,
             wall: the outward normal's yaw (deg, building space) for fires on a wall, else null}]
  views     8 lists of [{kind, x, y (px in the frame), scale, layer, phase}], N, NE, ... NW
"""
import importlib
import json
import math
import sys

import numpy as np
from PIL import Image

from bsdf import CAM_F, CAM_R, CAM_U, Ry

PPM = 320 / 18.5
NAMES = ["townhouse", "midrise", "church", "school", "hospital", "bungalow", "supermarket", "powerplant"]
SHEETS = {"townhouse": "out/townhouse_sheet.json", "midrise": "out_midrise/midrise_sheet.json"}
FRAMES = {"townhouse": "out/frames", "midrise": "out_midrise/frames"}
FIRE = np.load("out_fx/fire.npy")
SMOKE = np.load("out_fx/smoke.npy")
FIRE_A, SMOKE_A = (24.0, 74.0), (39.2, 214.0)
# fires placed by hand where the model records none: through roof holes, in gutted halls, cars
EXTRA = {
    ("townhouse", 1): [((-1.0, 3.6, 5.5), 1.2), ((1.2, 6.0, -1.0), 1.1)],
    ("church", 1): [((2.75, 9.9, -6.0), 1.4), ((-2.44, 10.0, 2.0), 1.3), ((4.27, 9.1, 6.0), 1.2)],
    ("school", 1): [((-11.15, 11.1, 3.2), 1.4), ((5.3, 11.0, -3.3), 1.3), ((11.3, 11.4, 2.2), 1.1)],
    ("bungalow", 1): [((-3.0, 4.3, 0.8), 1.1), ((2.7, 3.7, -3.5), 1.0)],
    ("supermarket", 1): [((-0.6, 6.4, -5.8), 1.6)],
    ("supermarket", 2): [((-6.0, 1.6, -7.0), 1.8), ((4.0, 1.5, -4.0), 1.7), ((7.5, 1.2, -9.5), 1.5), ((-5.5, 1.0, 3.9), 1.0)],
}


def sheet_meta(name):
    d = json.load(open(SHEETS.get(name, f"out_{name}/{name}_sheet.json")))
    f = d["frames"][f"{name}_intact_N"]
    return f["frame"]["w"], (f["pivot"]["x"], f["pivot"]["y"])


def emitters(mod, scene, state, rng):
    out = []
    fires = sorted(getattr(scene, "fires", []) or [], key=lambda f: -f[2])[:7]
    for (f0, fn, fw) in fires:
        f0, fn = np.asarray(f0, float), np.asarray(fn, float)
        horizontal = abs(fn[1]) < 0.5
        p = f0 + fn * 0.3 - (np.array([0, 0.7, 0]) if horizontal else 0)
        n = round(math.degrees(math.atan2(fn[0], fn[2])), 1) if horizontal else None    # the wall's outward normal (yaw)
        out.append({"kind": "fire", "pos": p, "scale": float(np.clip(fw / 0.8, 0.7, 1.9)), "n": n})
    for (p, sc_) in EXTRA.get((mod.__name__, state), []):
        out.append({"kind": "fire", "pos": np.array(p, float), "scale": sc_, "n": None})
    if state == 2 or len(out) < 2:
        # the largest rubble heaps and burnt floors: fires at their tops
        cands = []
        for pr in scene.prims:
            if pr.sub or pr.mat not in ("rubble", "burnt") or pr.kind not in ("ell", "box"):
                continue
            if pr.kind == "ell":
                hx, hy, hz = pr.h
                top = np.asarray(pr.c, float) + np.array([0, hy + 0.05, 0])
            else:
                if pr.h[1] > 0.3 or np.any(np.abs(pr.R - np.eye(3)) > 1e-6):
                    continue
                hx, hy, hz = pr.h
                top = np.asarray(pr.c, float) + np.array([0, hy + 0.05, 0])
            area = hx * hz
            if area < 2.0:
                continue
            cands.append((area, top, min(hx, hz)))
        cands.sort(key=lambda c: -c[0])
        picked = []
        for area, top, r in cands:
            if all(np.linalg.norm((top - q)[[0, 2]]) > 4.5 for q in picked):
                picked.append(top)
                for k in range(1 if r < 2.5 else 2):                     # big heaps burn in two places
                    off = np.array([rng.uniform(-0.4, 0.4) * r, 0, rng.uniform(-0.4, 0.4) * r]) if k else np.zeros(3)
                    out.append({"kind": "fire", "pos": top + off, "scale": float(np.clip(1.0 + 0.15 * math.sqrt(area), 1.1, 2.1)), "n": None})
            if len(picked) >= 5:
                break
    # smoke from the bigger fires (and a few more on large buildings)
    fires = [e for e in out if e["kind"] == "fire"]
    fires.sort(key=lambda e: -e["scale"])
    n = 1 if len(fires) <= 2 else 2 if len(fires) <= 4 else 3
    for e in fires[:n]:
        out.append({"kind": "smoke", "pos": e["pos"] + np.array([0, 0.4, 0]), "scale": float(np.clip(0.8 + 0.3 * e["scale"], 0.9, 1.5)), "n": e["n"]})
    for e in out:
        e["phase"] = round(float(rng.uniform(0, 24)), 2)
    return out


def project(scene, P, view, F, anchor, lift=1.0):
    """pixel position of building point P in view `view`, and whether the building hides the
    flame's middle (lift metres above P) from the camera"""
    Rw = Ry(math.radians(180 - view * 45))
    c = P @ Rw.T
    sx, sy = c @ CAM_R, -(c @ CAM_U)
    x, y = sx * PPM + F * anchor[0], sy * PPM + F * anchor[1]
    to_cam = -(CAM_F @ Rw)
    t, hidden = 0.3, False
    M = P + np.array([0, lift, 0])
    for _ in range(160):
        q = M + to_cam * t
        d = float(scene.sdf(q[None])[0])
        if d < 0.01:
            hidden = True
            break
        t += max(d, 0.02)
        if t > 90:
            break
    return x, y, hidden


def paste(canvas, img, anchor, x, y, scale):
    """composite a premultiplied effect frame onto the canvas (premultiplied) at (x, y) = its anchor"""
    h, w = img.shape[:2]
    if abs(scale - 1) > 1e-3:
        im = Image.fromarray((np.clip(img, 0, 1) * 255).astype(np.uint8), "RGBA").resize((max(1, round(w * scale)), max(1, round(h * scale))), Image.LANCZOS)
        img = np.asarray(im).astype(np.float64) / 255
        h, w = img.shape[:2]
    x0, y0 = int(round(x - anchor[0] * scale)), int(round(y - anchor[1] * scale))
    H, W = canvas.shape[:2]
    ax0, ay0, ax1, ay1 = max(0, x0), max(0, y0), min(W, x0 + w), min(H, y0 + h)
    if ax1 <= ax0 or ay1 <= ay0:
        return
    src = img[ay0 - y0:ay1 - y0, ax0 - x0:ax1 - x0]
    dst = canvas[ay0:ay1, ax0:ax1]
    dst[:] = src + dst * (1 - src[..., 3:4])


def frame_for(kind, k, phase):
    if kind == "fire":
        return FIRE[int(k + phase) % len(FIRE)], FIRE_A
    return SMOKE[int(k + phase) % len(SMOKE)], SMOKE_A


def premul(path):
    a = np.asarray(Image.open(path).convert("RGBA")).astype(np.float64) / 255
    a[..., :3] *= a[..., 3:4]
    return a


def compose(name, F, view_list, state, view, k, base=None):
    bld = premul(f"{FRAMES.get(name, f'out_{name}/frames')}/{state}_{view}.png")
    pad = int(F * 0.45)                                  # room above the frame for the smoke
    bld = np.concatenate([np.zeros((pad, bld.shape[1], 4)), bld], 0)
    canvas = np.zeros_like(bld)
    view_list = [dict(e, y=e["y"] + pad) for e in view_list]
    for e in view_list:                                  # behind the building: smoke first, then fire
        if e["layer"] == "back":
            img, anc = frame_for(e["kind"], k, e["phase"])
            paste(canvas, img, anc, e["x"], e["y"], e["scale"])
    canvas = bld + canvas * (1 - bld[..., 3:4])
    for kind in ("fire", "smoke"):                       # in front: fires, then the smoke over them
        for e in view_list:
            if e["layer"] == "front" and e["kind"] == kind:
                img, anc = frame_for(kind, k, e["phase"])
                paste(canvas, img, anc, e["x"], e["y"], e["scale"])
    return canvas


def main(names):
    rng = np.random.default_rng(77)
    try:
        out = json.load(open("out_fx/burning.json"))
    except Exception:
        out = {}
    for name in names:
        mod = importlib.import_module(name)
        F, anchor = sheet_meta(name)
        res = {"frame_size": F, "anchor": anchor, "states": {}}
        for st, label in ((1, "damaged"), (2, "destroyed")):
            sc = mod.build(st)
            em = emitters(mod, sc, st, rng)
            views = []
            for v in range(8):
                vl = []
                for e in em:
                    x, y, hidden = project(sc, e["pos"], v, F, anchor, lift=0.9 * e["scale"] if e["kind"] == "fire" else 2.0)
                    vl.append({"kind": e["kind"], "x": round(x, 1), "y": round(y, 1), "scale": round(e["scale"], 2),
                               "layer": "back" if hidden else "front", "phase": e["phase"]})
                views.append(vl)
            res["states"][label] = {"emitters": [{"kind": e["kind"], "pos": [round(float(c), 2) for c in e["pos"]], "scale": round(e["scale"], 2), "phase": e["phase"], "wall": e["n"]} for e in em],
                                    "views": views}
            print(f"  {name} {label}: {sum(e['kind'] == 'fire' for e in em)} fires, {sum(e['kind'] == 'smoke' for e in em)} smoke columns")
        out[name] = res
        # preview: damaged and destroyed side by side, view SW, 24 frames at 12 fps (2 s)
        view = 5
        gif = []
        half = F > 400
        for k in range(24):
            row = [compose(name, F, res["states"][lab]["views"][view], st, view, k) for st, lab in ((1, "damaged"), (2, "destroyed"))]
            canvas = np.concatenate(row, 1)
            bg = np.ones_like(canvas[..., :3]) * np.array([0.5, 0.52, 0.47])
            rgb = canvas[..., :3] + bg * (1 - canvas[..., 3:4])
            im = Image.fromarray((np.clip(rgb, 0, 1) * 255).astype(np.uint8))
            if half:
                im = im.resize((im.width // 2, im.height // 2), Image.LANCZOS)
            gif.append(im)
        pal = gif[0].quantize(colors=255, method=Image.Quantize.MEDIANCUT)
        q = [g.quantize(palette=pal, dither=Image.Dither.NONE) for g in gif]
        q[0].save(f"out_fx/{name}_burning.gif", save_all=True, append_images=q[1:], duration=83, loop=0, optimize=True)
    json.dump(out, open("out_fx/burning.json", "w"), separators=(",", ":"))


if __name__ == "__main__":
    main(sys.argv[1:] or NAMES)

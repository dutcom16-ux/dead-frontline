"""Fire and smoke loops for the burning buildings: out_fx/fire_sheet.png, smoke_sheet.png (+ .json)

    python3 fx.py

Both loops are seamless and drawn at the buildings' scale (17.3 px/m) with the same light (from the
screen's top-left). Frames are premultiplied RGBA; the fire's alpha is kept below its brightness so
it glows over what lies behind (drawn normally it looks like flame, with additive blending it glows).

  fire   12 frames, 48 x 80 px (2.8 x 4.6 m), anchor at the base of the flame, 12 fps (1 s loop)
  smoke  24 frames, 112 x 224 px (6.5 x 13 m), anchor at the source, 12 fps (2 s loop); dark smoke rising
         and leaning with the wind toward the screen's right
"""
import json
import math
import os

import numpy as np
from PIL import Image

OUT = "out_fx"
PPM = 320 / 18.5


def lattice(ix, iy, seed):
    ix, iy = np.asarray(ix, np.int64), np.asarray(iy, np.int64)
    h = (ix * 374761393 + iy * 668265263 + seed * 2147483647) & 0xFFFFFFFF
    h = ((h ^ (h >> 13)) * 1274126177) & 0xFFFFFFFF
    return (h & 0xFFFF) / 65535.0


def vnoise(x, y, seed, py=None):
    """value noise, periodic in y with period py (lattice units) if given"""
    x0, y0 = np.floor(x).astype(np.int64), np.floor(y).astype(np.int64)
    fx, fy = x - x0, y - y0
    sx, sy = fx * fx * (3 - 2 * fx), fy * fy * (3 - 2 * fy)
    def L(ix, iy):
        if py:
            iy = np.mod(iy, int(round(py)))
        return lattice(ix, iy, seed)
    a, b = L(x0, y0), L(x0 + 1, y0)
    c, d = L(x0, y0 + 1), L(x0 + 1, y0 + 1)
    return (a * (1 - sx) + b * sx) * (1 - sy) + (c * (1 - sx) + d * sx) * sy


def fbm(x, y, seed, py=None, oct=4):
    s, a, f, tot = 0.0, 1.0, 1.0, 0.0
    for o in range(oct):
        s = s + a * vnoise(x * f, y * f, seed + o * 17, py * f if py else None)
        tot += a
        a *= 0.5
        f *= 2
    return s / tot


def fire_frames(n=12, W=48, H=80, ss=3):
    """flame tongues: turbulent noise scrolling up through a teardrop envelope (periodic in time)"""
    w, h = W * ss, H * ss
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float64)
    u = (xx + 0.5) / w * 2 - 1                         # -1..1 across
    v = 1 - (yy + 0.5) / h                             # 0 at the bottom, 1 at the top
    base = 6 / H
    vv = np.clip((v - base) / (1 - base), 0, 1)
    below = v < base
    frames = []
    P = 4                                              # noise period in y (lattice units) = scroll per loop
    for k in range(n):
        t = k / n
        sy = vv * 3.0 - t * P                          # scrolls up by exactly one period per loop
        warp = (fbm(u * 2.2, sy, 3, py=P) - 0.5) * 0.55 * (0.3 + vv)
        uu = u + warp
        width = 0.86 * (1 - vv) ** 0.5 * (0.7 + 0.3 * np.clip(vv * 6, 0, 1))
        core = np.clip(1 - np.abs(uu) / np.maximum(width, 1e-3), 0, 1)
        tong = fbm(u * 3.0 + 7, (vv * 3.0 * 1.0 - t * P), 11, py=P, oct=3)
        I = core ** 0.7 * np.clip(1.2 - vv ** 0.85 - 0.9 * (tong - 0.5) * vv * 2, 0, 1)
        I *= np.clip(vv * 14 + 0.2, 0, 1) * (~below)
        I = np.clip(I * 1.35, 0, 1)
        # colour ramp: deep red -> orange -> yellow -> near white
        r = np.clip(0.55 + 1.6 * I, 0, 1)
        g = np.clip(-0.10 + 1.25 * I ** 1.2, 0, 1)
        b = np.clip(-0.35 + 1.0 * I ** 2.2, 0, 1)
        a = np.clip((I - 0.06) / 0.35, 0, 1) * 0.85
        img = np.stack([r * a, g * a, b * a, a * 0.8], -1)       # premultiplied; alpha a bit lower: glow
        img = img.reshape(H, ss, W, ss, 4).mean((1, 3))
        frames.append(img)
    return frames, (W / 2, H - 6)


def smoke_frames(n=24, W=112, H=224, ss=2, puffs=14, seed=5):
    """dark smoke: soft puffs born at the source at even intervals, rising, growing and drifting right"""
    rng = np.random.default_rng(seed)
    w, h = W * ss, H * ss
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float64) / ss
    bx, by = W * 0.35, H - 10
    prop = [dict(wob=rng.uniform(-1, 1), r0=rng.uniform(6, 10), shade=rng.uniform(0.85, 1.1),
                 rot=rng.uniform(0, 6.28), dx=rng.uniform(0.8, 1.2)) for _ in range(puffs)]
    L = np.array([-0.55, -0.65, 0.52])
    L /= np.linalg.norm(L)
    frames = []
    for k in range(n):
        acc = np.zeros((h, w, 4))
        order = sorted(range(puffs), key=lambda i: -(((k / n) - i / puffs) % 1.0))   # oldest (highest) first
        for i in order:
            p = prop[i]
            age = ((k / n) - i / puffs) % 1.0
            rise = age ** 0.85 * (H - 50)
            cx = bx + p["dx"] * (24 * age ** 1.6) + p["wob"] * 5 * math.sin(age * 5 + p["rot"])
            cy = by - rise
            r = p["r0"] + 38 * age ** 0.85
            dx, dy = (xx - cx) / r, (yy - cy) / r
            d2 = dx * dx + dy * dy
            m = d2 < 1.0
            if not m.any():
                continue
            nz = np.sqrt(np.clip(1 - d2, 0, 1))
            lit = np.clip(dx * L[0] + dy * L[1] + nz * L[2], 0, 1)
            tex = fbm((dx * math.cos(p["rot"]) - dy * math.sin(p["rot"])) * 2.5 + i * 3.1,
                      (dx * math.sin(p["rot"]) + dy * math.cos(p["rot"])) * 2.5, 21 + i, oct=3)
            dens = np.clip(1 - d2, 0, 1) ** 0.9 * (0.6 + 0.9 * tex)
            fade = min(1.0, age / 0.06) * (1 - age) ** 1.2
            al = np.clip(dens * fade * 1.15, 0, 0.95)
            g = (0.07 + 0.27 * lit) * p["shade"] + 0.06 * age
            col = np.stack([g * 1.02, g, g * 0.97], -1)
            # source glow: the youngest puffs are lit from below by the fire
            if age < 0.15:
                glow = (0.15 - age) / 0.15 * np.clip(dy, 0, 1)
                col = col + np.stack([0.55 * glow, 0.22 * glow, 0.04 * glow], -1)
            acc[..., :3] = col * al[..., None] + acc[..., :3] * (1 - al[..., None])
            acc[..., 3] = al + acc[..., 3] * (1 - al)
        img = acc.reshape(H, ss, W, ss, 4).mean((1, 3))
        frames.append(img)
    return frames, (bx, by)


def sheet(frames, name, anchor, fps):
    H, W = frames[0].shape[:2]
    n = len(frames)
    cols = 8
    rows = math.ceil(n / cols)
    page = np.zeros((rows * H, cols * W, 4))
    fr = {}
    for k, f in enumerate(frames):
        r, c = divmod(k, cols)
        page[r * H:(r + 1) * H, c * W:(c + 1) * W] = f
        fr[f"{name}_{k}"] = {"frame": {"x": c * W, "y": r * H, "w": W, "h": H}, "rotated": False, "trimmed": False,
                            "spriteSourceSize": {"x": 0, "y": 0, "w": W, "h": H}, "sourceSize": {"w": W, "h": H},
                            "pivot": {"x": round(anchor[0] / W, 4), "y": round(anchor[1] / H, 4)}, "duration": round(1000 / fps)}
    # store straight alpha in the PNG (premultiplied colour divided back)
    a = page[..., 3:4]
    rgb = np.where(a > 1e-4, page[..., :3] / np.maximum(a, 1e-4), 0)
    out = np.concatenate([np.clip(rgb, 0, 1), np.clip(a, 0, 1)], -1)
    Image.fromarray((out * 255 + 0.5).astype(np.uint8), "RGBA").save(f"{OUT}/{name}_sheet.png", optimize=True)
    meta = {"image": f"{name}_sheet.png", "size": {"w": cols * W, "h": rows * H}, "frame_size": {"w": W, "h": H},
            "frames_count": n, "fps": fps, "loop": True, "anchor_px": [round(anchor[0], 2), round(anchor[1], 2)],
            "pixels_per_metre": round(PPM, 3)}
    json.dump({"frames": fr, "meta": meta}, open(f"{OUT}/{name}_sheet.json", "w"), indent=1)
    return meta


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    ff, fa = fire_frames()
    sf, sa = smoke_frames()
    np.save(f"{OUT}/fire.npy", np.stack(ff))
    np.save(f"{OUT}/smoke.npy", np.stack(sf))
    print(sheet(ff, "fire", fa, 12))
    print(sheet(sf, "smoke", sa, 12))

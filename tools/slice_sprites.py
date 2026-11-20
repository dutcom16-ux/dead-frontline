# usage: python3 tools/slice_sprites.py assets/source/troops_sheet.png public/sprites/troops.png public/sprites/troops.json
#        (then trim "smoke" to its first 5 frames: the last two are a split artefact)
# Slice the troop sprite sheet into a clean, transparent atlas + JSON for the game.
# Rows are picked by what the drawings actually show (front-facing or right-facing),
# not by the sheet's direction labels, which do not match the art.
import json, sys
import numpy as np
from PIL import Image
from scipy import ndimage

SRC, OUT_PNG, OUT_JSON = sys.argv[1], sys.argv[2], sys.argv[3]
im = Image.open(SRC).convert("RGB")
A = np.asarray(im).astype(np.int32)
LUM = A.max(axis=2)

# (name, kind, x0, x1, y_center, max frames, drop_last)
TROOPS = [
    ("idle_front",   "troop", 50, 365, 60, 7, False),
    ("walk_front",   "troop", 790, 1165, 60, 8, False),
    ("walk_side",    "troop", 1185, 1530, 255, 8, False),
    ("run_front",    "troop", 45, 370, 355, 7, False),
    ("run_side",     "troop", 40, 370, 478, 7, False),
    ("shoot_side",   "troop", 800, 1175, 478, 8, True),
    ("reload_front", "troop", 40, 150, 628, 3, False),
    ("reload_front2","troop", 180, 300, 628, 3, False),
    ("hurt_front",   "troop", 355, 545, 628, 5, False),
    ("die_front",    "troop", 630, 912, 628, 7, False),
    ("crouch_front", "troop", 968, 1205, 722, 6, False),
]
FX = [
    ("muzzle",    "fx", 8, 425, 852, 7),
    ("explosion", "fx", 8, 598, 958, 7),
    ("smoke",     "fx", 600, 1115, 958, 7),
    ("blood",     "fx", 1118, 1515, 955, 6),
    ("sparks",    "fx", 915, 1112, 855, 4),
    ("bloodhit",  "fx", 1118, 1240, 855, 2),
]

def components(x0, x1, yc, half, thr, dil):
    y0, y1 = max(0, yc - half), min(A.shape[0], yc + half)
    sub = LUM[y0:y1, x0:x1] > thr
    sub = ndimage.binary_dilation(sub, iterations=dil)
    lab, n = ndimage.label(sub)
    boxes = []
    for sl in ndimage.find_objects(lab):
        if sl is None: continue
        ys, xs = sl
        h, w = ys.stop - ys.start, xs.stop - xs.start
        boxes.append((xs.start + x0, ys.start + y0, xs.stop + x0, ys.stop + y0, w, h))
    return boxes

def troop_frame(b):
    x0, y0, x1, y1 = b[0] - 2, b[1] - 2, b[2] + 2, b[3] + 2
    rgb = A[y0:y1, x0:x1]
    lum = rgb.max(axis=2)
    # background = near-black pixels connected to the crop border
    dark = lum < 26
    lab, n = ndimage.label(dark)
    border = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
    bg = np.isin(lab, list(border))
    alpha = np.where(bg, 0, 255).astype(np.uint8)
    # soften the silhouette edge a little
    soft = ndimage.binary_erosion(alpha > 0, iterations=1)
    alpha = np.where((alpha > 0) & ~soft, 200, alpha).astype(np.uint8)
    rgba = np.dstack([rgb.astype(np.uint8), alpha])
    ys, xs = np.nonzero(alpha)
    # feet anchor: centre of the lowest 15% of opaque pixels
    cut = ys.max() - max(2, int((ys.max() - ys.min()) * 0.15))
    fx = float(xs[ys >= cut].mean()) if (ys >= cut).any() else float(xs.mean())
    flash = int(((rgb[..., 0] > 200) & (rgb[..., 1] > 140) & (rgb[..., 2] < 140)).sum())
    return Image.fromarray(rgba, "RGBA"), (fx, float(ys.max() + 1)), flash

def fx_frame(b):
    x0, y0, x1, y1 = b[0] - 3, b[1] - 3, b[2] + 3, b[3] + 3
    rgb = A[y0:y1, x0:x1].astype(np.float32)
    m = rgb.max(axis=2)
    a = np.clip((m - 8) / 200.0, 0, 1)
    col = np.where(a[..., None] > 0.02, np.clip(rgb / np.maximum(a[..., None], 0.02), 0, 255), 0)
    rgba = np.dstack([col, a * 255]).astype(np.uint8)
    h, w = m.shape
    return Image.fromarray(rgba, "RGBA"), (w / 2, h / 2), 0

frames, anims = [], {}
for name, kind, x0, x1, yc, nmax, drop_last in TROOPS:
    minh = 12 if name == "die_front" else 30
    bs = [b for b in components(x0, x1, yc, 40, 34, 2) if b[4] >= 14 and (b[5] >= 30 or (name == "die_front" and b[4] >= 30 and b[5] >= 10))]
    bs.sort(key=lambda b: b[0])
    if drop_last and len(bs) > 1: bs = bs[:-1]
    bs = bs[:nmax]
    ids = []
    for b in bs:
        img, anchor, flash = troop_frame(b)
        frames.append({"img": img, "anchor": anchor, "flash": flash}); ids.append(len(frames) - 1)
    anims[name] = ids
    print(f"{name:14s} {len(ids)} frames  sizes {[ (b[4], b[5]) for b in bs]}")
for name, kind, x0, x1, yc, nmax in FX:
    half = 60 if name in ("explosion", "smoke") else 36
    bs = [b for b in components(x0, x1, yc, half, 40, 1) if b[5] >= 16 and b[4] >= 14]
    bs.sort(key=lambda b: b[0])
    # frames that touch each other: split the widest boxes evenly until the count is right
    while len(bs) < nmax and bs:
        wi = max(range(len(bs)), key=lambda i: bs[i][4])
        b = bs[wi]; n = max(2, round(b[4] / (sorted(q[4] for q in bs)[len(bs) // 2] or b[4])))
        if b[4] < 1.6 * min(q[4] for q in bs) and len(bs) > 1: break
        step = b[4] / n
        parts = [(int(b[0] + k * step), b[1], int(b[0] + (k + 1) * step), b[3], int(step), b[5]) for k in range(n)]
        bs = bs[:wi] + parts + bs[wi + 1:]
    bs = bs[:nmax]
    ids = []
    for b in bs:
        img, anchor, _ = fx_frame(b)
        frames.append({"img": img, "anchor": anchor, "flash": 0}); ids.append(len(frames) - 1)
    anims[name] = ids
    print(f"{name:14s} {len(ids)} frames  sizes {[ (b[4], b[5]) for b in bs]}")

# reload: both short rows play as one 6-frame clip
anims["reload_front"] = anims["reload_front"] + anims.pop("reload_front2")
# shoot: split into aim (no flash) and fire (flash) frames
sh = anims["shoot_side"]
order = sorted(sh, key=lambda i: frames[i]["flash"])
anims["aim_side"] = sorted(order[:3])          # least muzzle flash
anims["fire_side"] = sorted(order[-2:])        # brightest muzzle flash

# pack into rows (simple shelf packer), 1 px gutter
W = 1024
x = y = rowh = 0
rects = []
for f in frames:
    w, h = f["img"].size
    if x + w + 2 > W: x, y, rowh = 0, y + rowh + 2, 0
    rects.append((x + 1, y + 1, w, h)); x += w + 2; rowh = max(rowh, h)
H = y + rowh + 2
atlas = Image.new("RGBA", (W, H), (0, 0, 0, 0))
for f, (rx, ry, w, h) in zip(frames, rects):
    atlas.paste(f["img"], (rx, ry))
atlas.save(OUT_PNG, optimize=True)
meta = {
    "source": "user-supplied troop sprite sheet (8085.png), sliced by tools/slice_sprites.py",
    "size": [W, H],
    "frames": [{"x": r[0], "y": r[1], "w": r[2], "h": r[3], "ax": round(f["anchor"][0], 1), "ay": round(f["anchor"][1], 1)} for f, r in zip(frames, rects)],
    "anims": anims,
    "facing": "front clips face the viewer; side clips face screen-right (mirror for left)",
}
json.dump(meta, open(OUT_JSON, "w"), separators=(",", ":"))
print("atlas", W, "x", H, "frames", len(frames))

# usage: python3 tools/slice_sprites.py
# Cuts the two supplied sprite sheets into transparent atlases + JSON for the game:
#   assets/source/squad_zombie_sheet.png (8086.png) -> soldier movement/aim/die frames + all infected frames
#   assets/source/troops_sheet.png       (8085.png) -> reload and crouch frames (recoloured to match) + effects
# Outputs public/sprites/troops.png/.json and public/sprites/zombies.png/.json.
#
# The sheets' direction labels do not match the drawings, so clips are picked by what the art shows.
# Directions in clip names are screen directions: S = facing the viewer, E = facing screen-right,
# SE = three-quarter front-right, N = back to the viewer. There is no three-quarter back view.
# Left-facing views are the right-facing ones mirrored at draw time.
import json, os
import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC_B = os.path.join(ROOT, "assets/source/squad_zombie_sheet.png")
SRC_A = os.path.join(ROOT, "assets/source/troops_sheet.png")
OUT = os.path.join(ROOT, "public/sprites")

B = np.asarray(Image.open(SRC_B).convert("RGB")).astype(np.int32)
A = np.asarray(Image.open(SRC_A).convert("RGB")).astype(np.int32)

# ---------------------------------------------------------------- sheet B: a 10 x 22 grid
ROWS = [57, 156, 254, 355, 462, 561, 648, 739, 832, 943]   # row centres: 0-4 infected, 5-9 soldiers
BLOCKS = {"L": (0, 440), "M": (440, 1040), "R": (1040, 1536)}
lum = B.max(axis=2)
lab, n = ndimage.label(ndimage.binary_dilation(lum > 28, iterations=2))
GRID = {}
for sl in ndimage.find_objects(lab):
    ys, xs = sl
    w, h = xs.stop - xs.start, ys.stop - ys.start
    if w * h < 200: continue
    yc = (ys.start + ys.stop) / 2
    r = min(range(len(ROWS)), key=lambda i: abs(ROWS[i] - yc))
    blk = next(k for k, (x0, x1) in BLOCKS.items() if x0 <= (xs.start + xs.stop) / 2 < x1)
    GRID.setdefault((r, blk), []).append((xs.start, ys.start, xs.stop, ys.stop))
for k in GRID: GRID[k].sort()

def cut(img, box, recolor=False):
    """crop a sprite, make the black background transparent (flood fill from the crop border)"""
    x0, y0, x1, y1 = box[0] - 2, box[1] - 2, box[2] + 2, box[3] + 2
    rgb = img[max(0, y0):y1, max(0, x0):x1].astype(np.float32)
    l = rgb.max(axis=2)
    # background = dark pixels connected to the crop border. Thin dark seams inside the figure
    # (black camo, trouser folds) must not count: break 1-px channels first, then fill holes.
    dark = l < 24
    lb, _ = ndimage.label(ndimage.binary_erosion(dark, iterations=1, border_value=1))
    border = set(np.unique(np.concatenate([lb[0], lb[-1], lb[:, 0], lb[:, -1]]))) - {0}
    bg = ndimage.binary_dilation(np.isin(lb, list(border)), iterations=1) & dark
    bg[0, :] = bg[-1, :] = bg[:, 0] = bg[:, -1] = True
    fg = ndimage.binary_fill_holes(~bg)
    alpha = np.where(fg, 255, 0).astype(np.uint8)
    soft = ndimage.binary_erosion(alpha > 0, iterations=1)
    alpha = np.where((alpha > 0) & ~soft, 200, alpha).astype(np.uint8)
    if recolor:
        # sheet A's soldiers are lighter: match sheet B's palette (mean/contrast transfer)
        mA, sA, mB, sB = np.array([92.0, 86.0, 80.0]), 44.0, np.array([75.0, 71.0, 65.0]), 35.0
        rgb = np.clip((rgb - mA) * (sB / sA) + mB, 0, 255)
    rgba = np.dstack([rgb.astype(np.uint8), alpha])
    ys, xs = np.nonzero(alpha)
    cutoff = ys.max() - max(2, int((ys.max() - ys.min()) * 0.15))
    ax = float(xs[ys >= cutoff].mean()) if (ys >= cutoff).any() else float(xs.mean())
    # rifle muzzle: right-most opaque pixel in the upper half (used for muzzle flashes on aim frames)
    top, bot = ys.min(), ys.min() + int((ys.max() - ys.min()) * 0.5)
    band = (ys >= top + 4) & (ys <= bot)
    mx = int(xs[band].max()) if band.any() else int(xs.max())
    my = int(ys[band][xs[band] == mx].mean()) if band.any() else int(ys.min())
    return Image.fromarray(rgba, "RGBA"), (ax, float(ys.max() + 1)), (mx, my)

def fx_cut(box):
    x0, y0, x1, y1 = box[0] - 3, box[1] - 3, box[2] + 3, box[3] + 3
    rgb = A[y0:y1, x0:x1].astype(np.float32)
    m = rgb.max(axis=2)
    a = np.clip((m - 8) / 200.0, 0, 1)
    col = np.where(a[..., None] > 0.02, np.clip(rgb / np.maximum(a[..., None], 0.02), 0, 255), 0)
    h, w = m.shape
    return Image.fromarray(np.dstack([col, a * 255]).astype(np.uint8), "RGBA"), (w / 2, h / 2), (0, 0)

class Atlas:
    def __init__(self): self.frames, self.anims = [], {}
    def add(self, name, items):
        ids = []
        for img, anchor, muzzle, k in items:
            self.frames.append({"img": img, "anchor": anchor, "muzzle": muzzle, "k": k}); ids.append(len(self.frames) - 1)
        self.anims[name] = ids
        print(f"  {name:12s} {len(ids)}")
    def save(self, png, js, source, ref, W=1024):
        x = y = rowh = 0; rects = []
        for f in self.frames:
            w, h = f["img"].size
            if x + w + 2 > W: x, y, rowh = 0, y + rowh + 2, 0
            rects.append((x + 1, y + 1, w, h)); x += w + 2; rowh = max(rowh, h)
        H = y + rowh + 2
        atlas = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        for f, (rx, ry, w, h) in zip(self.frames, rects): atlas.paste(f["img"], (rx, ry))
        # 256-colour palette with alpha: about 5x smaller, no visible difference at game scale
        atlas.quantize(colors=256, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.NONE).save(png, optimize=True)
        out = []
        for f, r in zip(self.frames, rects):
            e = {"x": r[0], "y": r[1], "w": r[2], "h": r[3], "ax": round(f["anchor"][0], 1), "ay": round(f["anchor"][1], 1)}
            if f["k"] != 1: e["k"] = round(f["k"], 3)
            if f["muzzle"] != (0, 0): e["mx"], e["my"] = f["muzzle"]
            out.append(e)
        json.dump({"source": source, "size": [W, H], "ref": ref, "frames": out, "anims": self.anims}, open(js, "w"), separators=(",", ":"))
        print(f"  -> {os.path.relpath(png, ROOT)} {W}x{H}, {len(self.frames)} frames")

def grid(r, blk, cols=None):
    bs = GRID[(r, blk)]
    return [bs[c] for c in (cols if cols is not None else range(len(bs)))]
def B_(r, blk, cols=None): return [(*cut(B, b), 1.0) for b in grid(r, blk, cols)]

# ---------------------------------------------------------------- sheet A components (rows by y centre)
lumA = A.max(axis=2)
def comps_A(x0, x1, yc, half, thr, dil):
    sub = ndimage.binary_dilation(lumA[yc - half:yc + half, x0:x1] > thr, iterations=dil)
    lb, _ = ndimage.label(sub)
    out = []
    for sl in ndimage.find_objects(lb):
        ys, xs = sl
        out.append((xs.start + x0, ys.start + yc - half, xs.stop + x0, ys.stop + yc - half))
    return sorted(out)
def A_(x0, x1, yc, nmax, height):
    """sheet A frames, recoloured and scaled so the clip's median figure height = `height` (sheet B pixels)"""
    bs = [b for b in comps_A(x0, x1, yc, 40, 34, 2) if b[2] - b[0] >= 14 and b[3] - b[1] >= 30][:nmax]
    k = height / float(np.median([b[3] - b[1] for b in bs]))
    return [(*cut(A, b, recolor=True), k) for b in bs]

print("troops")
T = Atlas()
T.add("idle_S", B_(6, "L"));            T.add("idle_S2", B_(7, "L"))
T.add("ready_S", B_(8, "L", [0, 1, 2])); T.add("aim_SE", B_(8, "L", [3, 4, 5]))
T.add("back_N", B_(9, "L", [3, 4]))     # col 5 of this row faces the viewer, so it is not used as a back view
T.add("walk_S", B_(5, "M"));            T.add("walk_SE", B_(6, "M")); T.add("walk_SE2", B_(7, "M"))
T.add("walk_E", B_(8, "M"));            T.add("kneel_E", B_(9, "M", [8]))
T.add("run_SE", B_(5, "R"));            T.add("run_SE2", B_(6, "R")); T.add("run_E", B_(7, "R"))
T.add("advance_E", B_(8, "R"));         T.add("die_E", B_(9, "R"))
T.add("reload_S", A_(40, 150, 628, 3, 82) + A_(180, 300, 628, 3, 82))   # standing
T.add("crouch_S", A_(968, 1205, 722, 6, 62))   # kneeling: about 3/4 of standing height
FX = [("muzzle", 8, 425, 852, 7, 36), ("explosion", 8, 598, 958, 7, 60), ("smoke", 600, 1115, 958, 5, 60),
      ("blood", 1118, 1515, 955, 6, 36), ("sparks", 915, 1112, 855, 4, 36), ("bloodhit", 1118, 1240, 855, 2, 36)]
for name, x0, x1, yc, nmax, half in FX:
    bs = [b for b in comps_A(x0, x1, yc, half, 40, 1) if b[3] - b[1] >= 16 and b[2] - b[0] >= 14]
    while len(bs) < nmax and bs:   # touching frames: split the widest box evenly
        wi = max(range(len(bs)), key=lambda i: bs[i][2] - bs[i][0]); b = bs[wi]; bw = b[2] - b[0]
        med = sorted(q[2] - q[0] for q in bs)[len(bs) // 2] or bw
        nn = max(2, round(bw / med))
        if bw < 1.6 * min(q[2] - q[0] for q in bs) and len(bs) > 1: break
        st = bw / nn
        bs = bs[:wi] + [(int(b[0] + k * st), b[1], int(b[0] + (k + 1) * st), b[3]) for k in range(nn)] + bs[wi + 1:]
    T.add(name, [(*fx_cut(b), 1.0) for b in bs[:nmax]])
T.save(os.path.join(OUT, "troops.png"), os.path.join(OUT, "troops.json"),
       "user-supplied sprite sheets 8086.png (soldiers) and 8085.png (reload, crouch, effects); tools/slice_sprites.py", 84)

print("zombies")
Z = Atlas()
Z.add("idle_S", B_(0, "L"));  Z.add("idle_S2", B_(4, "L"))
Z.add("back_N", B_(1, "L", [4]) + B_(2, "L", [4]))
Z.add("attack_E", B_(3, "L"))
Z.add("walk_S", B_(0, "M")); Z.add("walk_S2", B_(1, "M")); Z.add("walk_S3", B_(2, "M"))
Z.add("walk_E", B_(3, "M", [0, 1, 2, 3, 4])); Z.add("hunch_E", B_(4, "M", [0, 1, 2, 3, 4, 5, 6]))
Z.add("lunge_E", B_(3, "M", [5, 6, 7, 8]))
Z.add("run_E", B_(0, "R")); Z.add("run_E2", B_(1, "R")); Z.add("run_E3", B_(2, "R")); Z.add("charge_E", B_(3, "R"))
Z.add("crawl_E", B_(4, "R")); Z.add("dead", B_(4, "M", [7]) + B_(4, "R", [3, 5]))
Z.save(os.path.join(OUT, "zombies.png"), os.path.join(OUT, "zombies.json"),
       "user-supplied sprite sheet 8086.png (infected rows); tools/slice_sprites.py", 92)

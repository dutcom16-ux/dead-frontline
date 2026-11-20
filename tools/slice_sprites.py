# usage: python3 tools/slice_sprites.py
# Cuts the supplied sprite sheets into transparent atlases + JSON for the game:
#   assets/source/squad_zombie_sheet.png  (8086.png) -> soldier movement/aim/die frames + all infected frames
#   assets/source/troops_sheet.png        (8085.png) -> reload and crouch frames (recoloured to match) + effects
#   assets/source/rifleman_8dir.png       (8088.png) -> riflemen: walk, aim, fire, die in 8 directions
#   assets/source/zombie_soldier_8dir.png (8089.png) -> turned soldiers: walk, attack, die in 8 directions
# Outputs public/sprites/troops.*, zombies.* and soldier8.* (png + json).
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


# ---------------------------------------------------------------- 8-direction sheets (8088, 8089)
# 8 rows x 10 columns on a transparent background. Rows, clockwise from facing away from the viewer:
# N, NE, E, SE, S, SW, W, NW. Columns: 0-4 walk cycle, 5-6 aim + fire (rifleman) or reach + grab
# (infected soldier), 7-9 falling and lying dead. The rows are not drawn at one size, so each row is
# scaled to the same standing height.
DIRS8 = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"]
COLS8 = [88, 236, 383, 528, 673, 803, 940, 1053, 1182, 1320]   # column centres (both sheets)
STAND8 = 100   # standing figure height in the atlas (px)

def sheet8(path, rows_y):
    img = np.asarray(Image.open(path).convert("RGBA"))
    bounds = [0] + [(rows_y[i] + rows_y[i + 1]) // 2 for i in range(len(rows_y) - 1)] + [img.shape[0]]
    out = {}
    for r in range(8):
        y0, y1 = bounds[r], bounds[r + 1]
        band = img[y0:y1]
        lb, _ = ndimage.label(ndimage.binary_dilation(band[..., 3] > 40, iterations=3))
        cells = {}
        for k, sl in enumerate(ndimage.find_objects(lb)):
            ys, xs = sl
            area = int(((lb[sl] == k + 1) & (band[sl][..., 3] > 40)).sum())
            if area < 60: continue
            c = min(range(10), key=lambda i: abs(COLS8[i] - (xs.start + xs.stop) / 2))
            b = cells.get(c)
            cells[c] = (min(b[0], xs.start), min(b[1], ys.start), max(b[2], xs.stop), max(b[3], ys.stop)) if b else (xs.start, ys.start, xs.stop, ys.stop)
        frames = []
        for c in range(10):
            x0, ya, x1, yb = cells[c]
            crop = band[ya:yb, x0:x1].copy()
            # keep only this cell's figure (drop stray bits of neighbouring frames)
            lb2, n2 = ndimage.label(ndimage.binary_dilation(crop[..., 3] > 40, iterations=4))
            if n2 > 1:
                sizes = ndimage.sum(crop[..., 3] > 40, lb2, range(1, n2 + 1))
                keep = np.isin(lb2, [i + 1 for i, v in enumerate(sizes) if v >= max(sizes) * 0.08])
                crop[..., 3] = np.where(keep, crop[..., 3], 0)
            frames.append(crop)
        # one scale per row: median standing height of the walk/aim frames -> STAND8
        hs = []
        for f in frames[:7]:
            ys = np.nonzero(f[..., 3] > 40)[0]
            hs.append(ys.max() - ys.min() + 1)
        k = STAND8 / float(np.median(hs))
        items = []
        for f in frames:
            im = Image.fromarray(f, "RGBA")
            im = im.resize((max(1, round(im.width * k)), max(1, round(im.height * k))), Image.LANCZOS)
            a = np.asarray(im)[..., 3]
            ys, xs = np.nonzero(a > 40)
            im = im.crop((max(0, xs.min() - 1), max(0, ys.min() - 1), min(im.width, xs.max() + 2), min(im.height, ys.max() + 2)))
            a = np.asarray(im)[..., 3]
            ys, xs = np.nonzero(a > 40)
            cut = ys.max() - max(2, int((ys.max() - ys.min()) * 0.12))
            ax = float(xs[ys >= cut].mean())
            items.append((im, (ax, float(ys.max() + 1)), (0, 0), 1.0))
        out[DIRS8[r]] = items
    return out

print("soldier8")
R = sheet8(os.path.join(ROOT, "assets/source/rifleman_8dir.png"), [76, 228, 374, 521, 661, 795, 922, 1050])
ZS = sheet8(os.path.join(ROOT, "assets/source/zombie_soldier_8dir.png"), [78, 233, 380, 526, 668, 802, 930, 1056])
S8 = Atlas()
for d in DIRS8:
    S8.add("r_walk_" + d, R[d][0:5]); S8.add("r_aim_" + d, R[d][5:6]); S8.add("r_fire_" + d, R[d][6:7]); S8.add("r_die_" + d, R[d][7:10])
for d in DIRS8:
    S8.add("z_walk_" + d, ZS[d][0:5]); S8.add("z_attack_" + d, ZS[d][5:7]); S8.add("z_die_" + d, ZS[d][7:10])
S8.save(os.path.join(OUT, "soldier8.png"), os.path.join(OUT, "soldier8.json"),
        "user-supplied 8-direction sheets 8088.png (rifleman) and 8089.png (infected soldier); tools/slice_sprites.py", STAND8)

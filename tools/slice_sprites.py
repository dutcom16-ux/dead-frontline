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


# ---------------------------------------------------------------- infantry collection sheet
# assets/source/infantry_8dir_collection.png ("Military_Soldier_Sprite_Sheet_Collection_1.png") has five
# labelled panels (walk, run, fire standing, fire moving, idle) on a dark textured background. Its
# direction labels do not match the drawings: run and firing frames nearly all face right, and some
# walk columns change from facing the camera to facing away half way down. So frames are assigned by
# the direction they really face (table below), left-facing views are mirrors, and the clips get:
#   * background removal (flood fill from the cell border; the near-black rifle is kept in the upper
#     body, the foot shadow is dropped),
#   * one height per clip (the sheet's bottom rows are drawn ~8 % taller, its idle figures ~14 % smaller),
#   * a stable anchor between head and hips (so a step does not shift the whole figure),
#   * muzzle-flash-free copies of the firing frames, for aiming between shots.
COL_SRC = os.path.join(ROOT, "assets/source/infantry_8dir_collection.png")
CA = np.asarray(Image.open(COL_SRC).convert("RGB")).astype(int)
C_LB = [12, 108, 200, 289, 380, 474, 570, 664, 758]
C_RB = [780, 872, 963, 1054, 1150, 1243, 1333, 1426, 1525]
C_ROWS = {"walk": [(88, 162), (162, 236), (236, 310), (310, 390)], "run": [(88, 162), (162, 236), (236, 310), (310, 390)],
          "fstand": [(484, 557), (557, 630), (630, 704), (704, 781)], "fmove": [(478, 558), (558, 630), (630, 703), (703, 779)],
          "idle": [(866, 940), (942, 1006)]}
C_SIDE = {"walk": C_LB, "run": C_RB, "fstand": C_LB, "fmove": C_RB, "idle": C_LB}

def c_panel_bg(sec):
    xb = C_SIDE[sec]; y0 = C_ROWS[sec][0][0]; y1 = C_ROWS[sec][-1][1]
    sub = CA[y0:y1, xb[0]:xb[-1]].reshape(-1, 3); l = sub.max(axis=1)
    return np.median(sub[(l > 18) & (l < 45)], axis=0)
C_BG = {s: c_panel_bg(s) for s in C_ROWS}

def c_cut(sec, r, c):
    xb = C_SIDE[sec]; (y0, y1) = C_ROWS[sec][r]; x0, x1 = xb[c] + 3, xb[c + 1] - 3
    rgb = CA[y0:y1, x0:x1].astype(float)
    lum = rgb.max(axis=2); sat = rgb.max(axis=2) - rgb.min(axis=2)
    bg = C_BG[sec]; bgl = bg.max(); d = np.abs(rgb - bg).max(axis=2)
    lighter = (lum > bgl + 10) | (sat > 24)
    lb, n = ndimage.label(ndimage.binary_dilation(lighter, iterations=2))
    sizes = ndimage.sum(lighter, lb, range(1, n + 1)); main = np.argmax(sizes) + 1
    ys, xs = np.nonzero(lb == main); top, bot = ys.min(), ys.max()
    rows = np.arange(rgb.shape[0])[:, None]
    # dark pixels (rifle, straps) count only in the upper body; lower down, darker than the background is the foot shadow
    fg0 = lighter | ((rows < top + 0.6 * (bot - top)) & (lum < bgl - 7))
    fg = ndimage.binary_closing(fg0, structure=np.ones((3, 3)), iterations=3)
    fg = ndimage.binary_fill_holes(fg)
    fg = fg & ~((rows > top + 0.82 * (bot - top)) & (lum < bgl + 3) & ~fg0)
    gap = fg & ~fg0 & (rows > top + 0.45 * (bot - top)) & (d < 11)     # background sealed in between the legs
    gl, gn = ndimage.label(gap)
    if gn:
        gs = ndimage.sum(gap, gl, range(1, gn + 1)); fg = fg & ~np.isin(gl, [i + 1 for i, v in enumerate(gs) if v >= 10])
    bl, _ = ndimage.label(~fg); edge = set(np.unique(np.concatenate([bl[0], bl[-1], bl[:, 0], bl[:, -1]]))) - {0}
    fg = ~np.isin(bl, list(edge))
    fg = ndimage.binary_opening(fg, iterations=1)
    lb2, n2 = ndimage.label(ndimage.binary_dilation(fg, iterations=3))
    if n2 > 1:
        s2 = ndimage.sum(fg, lb2, range(1, n2 + 1)); fg = fg & np.isin(lb2, [i + 1 for i, v in enumerate(s2) if v >= max(s2) * 0.06])
    alpha = (fg * 255).astype(np.uint8); alpha[fg & ~ndimage.binary_erosion(fg)] = 170
    return np.dstack([rgb.astype(np.uint8), alpha])

def c_strip_flash(a):
    """the same frame without its muzzle flash (bright/warm pixels round the flash out at the rifle's end)"""
    rgb = a[..., :3].astype(int); R, G, B = rgb[..., 0], rgb[..., 1], rgb[..., 2]; lum = rgb.max(axis=2)
    ys, xs = np.nonzero(a[..., 3] > 0); cx = np.median(xs); w = xs.max() - xs.min()
    core = (((R > 200) & (G > 120) & (R - B > 60)) | ((R > 235) & (G > 220))) & (np.arange(a.shape[1])[None, :] > cx + 0.15 * w)
    lb, n = ndimage.label(core)
    if not n: return a
    sizes = ndimage.sum(core, lb, range(1, n + 1))
    zone = ndimage.binary_dilation(np.isin(lb, [i + 1 for i, v in enumerate(sizes) if v >= 4]), iterations=5)
    out = a.copy(); out[..., 3] = np.where(zone & ((lum > 70) | (R - B > 22)), 0, a[..., 3])
    m = out[..., 3] > 0; l2, n2 = ndimage.label(m)
    if n2 > 1:
        s2 = ndimage.sum(m, l2, range(1, n2 + 1)); out[..., 3] = np.where(np.isin(l2, [i + 1 for i, v in enumerate(s2) if v >= max(s2) * 0.03]), out[..., 3], 0)
    return out

STAND_C = 67   # standing figure height in this sheet (walk frames), px
# clip -> (panel, [(row, col)...]) by the direction the frames really face (see the note above)
C_CLIPS = {
    "walk_S": ("walk", [(r, 0) for r in range(4)]), "walk_SE": ("walk", [(r, 2) for r in range(4)]),
    "walk_NE": ("walk", [(r, 5) for r in (1, 2, 3)]), "walk_N": ("walk", [(r, 4) for r in range(4)]),
    "run_SE": ("run", [(r, 1) for r in range(4)]), "run_NE": ("run", [(r, 5) for r in range(4)]), "run_N": ("run", [(r, 4) for r in range(4)]),
    "fire_SE": ("fstand", [(r, 0) for r in range(4)]), "fire_NE": ("fstand", [(r, 7) for r in range(4)]),
    "firemove_SE": ("fmove", [(r, 0) for r in range(4)]), "firemove_NE": ("fmove", [(r, 7) for r in range(4)]),
    "idle_S": ("idle", [(r, 0) for r in range(2)]), "idle_SE": ("idle", [(r, 2) for r in range(2)]),
    "idle_NE": ("idle", [(r, 5) for r in range(2)]), "idle_N": ("idle", [(r, 4) for r in range(2)]),
}

def c_frame(a, k):
    im = Image.fromarray(a, "RGBA")
    im = im.resize((max(1, round(im.width * k)), max(1, round(im.height * k))), Image.LANCZOS)
    al = np.asarray(im)[..., 3]; ys, xs = np.nonzero(al > 40)
    im = im.crop((max(0, xs.min() - 1), max(0, ys.min() - 1), min(im.width, xs.max() + 2), min(im.height, ys.max() + 2)))
    al = np.asarray(im)[..., 3]; ys, xs = np.nonzero(al > 40)
    top, bot = ys.min(), ys.max(); h = bot - top
    head = xs[ys <= top + 0.12 * h].mean(); hip = xs[(ys >= top + 0.5 * h) & (ys <= top + 0.62 * h)].mean()
    return im, ((head + hip) / 2, float(bot + 1))

def c_clip(name):
    sec, cells = C_CLIPS[name]
    raw = [c_cut(sec, r, c) for r, c in cells]
    hs = []
    for a in raw:
        ys = np.nonzero(a[..., 3] > 0)[0]; hs.append(ys.max() - ys.min() + 1)
    target = STAND_C if sec == "idle" else float(np.median(hs))
    out = []
    for a, h in zip(raw, hs):
        k = float(np.clip(target / h, 0.85, 1.2))
        out.append((a, k))
    return out

def mirror_item(item):
    im, (ax, ay), mz, k = item
    return (im.transpose(Image.FLIP_LEFT_RIGHT), (im.width - ax, ay), mz, k)

print("infantry8")
I8 = Atlas()
done = {}
for name in C_CLIPS:
    items = []
    for a, k in c_clip(name):
        im, anc = c_frame(a, k); items.append((im, anc, (0, 0), 1.0))
    done[name] = items
    if name.startswith("fire"):
        aim = []
        for a, k in c_clip(name):
            im, anc = c_frame(c_strip_flash(a), k); aim.append((im, anc, (0, 0), 1.0))
        done[name.replace("firemove", "movaim").replace("fire", "aim")] = aim
for name, items in list(done.items()):
    I8.add(name, items)
    d = name.split("_")[1]
    if d in ("SE", "NE"):
        I8.add(name.replace("_" + d, "_" + ("SW" if d == "SE" else "NW")), [mirror_item(it) for it in items])
I8.save(os.path.join(OUT, "infantry8.png"), os.path.join(OUT, "infantry8.json"),
        "user-supplied Military_Soldier_Sprite_Sheet_Collection_1.png, frames re-assigned by their real facing; tools/slice_sprites.py", STAND_C)

# usage: python3 tools/slice_sprites.py
# Cuts the supplied sprite sheets into transparent atlases + JSON for the game (public/sprites/):
#   assets/source/military_soldier_sheet.png (Military_Soldier_Sprite_Sheet.png) -> military8.*:
#       every infantry soldier: walk, idle, fire, die in 8 directions (see the section at the end)
#   assets/source/zombie_soldier_8dir.png (8089.png) -> infected_soldier8.*: soldiers who turned
#   assets/source/squad_zombie_sheet.png  (8086.png) -> zombies.*: the infected
#   assets/source/troops_sheet.png        (8085.png) -> effects.*: explosion, smoke, blood, sparks
# Each atlas is a 256-colour PNG with alpha; the JSON lists frames (x, y, w, h, anchor ax/ay, scale k,
# muzzle mx/my for firing frames) and clips.
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

# ---------------------------------------------------------------- sheet B (8086): a 10 x 22 grid; rows 0-4 are the infected
ROWS = [57, 156, 254, 355, 462, 561, 648, 739, 832, 943]   # row centres
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
        # 256-colour palette with alpha: about 5x smaller, no visible difference at game scale. The
        # quantizer can merge empty pixels with faint ones, which leaves a pale box around each figure:
        # if it does, empty pixels get a palette entry of their own that is fully transparent.
        q = atlas.quantize(colors=256, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.NONE)
        empty = np.asarray(atlas)[..., 3] == 0
        if np.asarray(q.convert("RGBA"))[..., 3][empty].max(initial=0) > 0:
            q = atlas.quantize(colors=255, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.NONE)
            pal = q.getpalette(rawmode="RGBA")
            idx = np.array(q)
            idx[empty] = len(pal) // 4
            q = Image.fromarray(idx.astype(np.uint8), "P")
            q.putpalette(pal + [0, 0, 0, 0], rawmode="RGBA")
        q.save(png, optimize=True)
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
print("effects")
T = Atlas()
FX = [("explosion", 8, 598, 958, 7, 60), ("smoke", 600, 1115, 958, 5, 60),
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
T.save(os.path.join(OUT, "effects.png"), os.path.join(OUT, "effects.json"),
       "user-supplied sprite sheet 8085.png (effects); tools/slice_sprites.py", 84)

print("zombies")
# Sheet B's infected frames are a loose collection: the rows mix different people and facings and
# are not drawn in leg order. Each clip below takes frames of one person and one facing (checked
# frame by frame; see docs/ASSETS.md) and puts them in the order that changes the silhouette least
# from frame to frame, so the loop runs smoothly. Standing figures are anchored at the hips (the
# root of the movement: spread feet and reaching arms don't shift the body); lying ones at their middle.
def zcut(blk, r, c, anchor="hip"):
    img, (ax, ay), _ = cut(B, GRID[(r, blk)][c])
    a = np.asarray(img); m = a[..., 3] > 100
    ys, xs = np.nonzero(m); top, bot = ys.min(), ys.max(); h = bot - top
    if anchor == "hip":
        band = (ys >= top + 0.45 * h) & (ys <= top + 0.58 * h)
        ax = float(np.median(xs[band]))
    else:
        ax = float((xs.min() + xs.max()) / 2)
    return (img, (ax, ay), (0, 0), 1.0)

def zframes(spec, anchor="hip"):
    return [zcut(blk, r, c, anchor) for blk, r, cs in spec for c in cs]

def placed(items):
    """alpha masks of the frames on one canvas, anchors aligned"""
    L = max(it[1][0] for it in items); R = max(it[0].width - it[1][0] for it in items)
    T = max(it[1][1] for it in items); D = max(it[0].height - it[1][1] for it in items)
    W, H = int(L + R) + 2, int(T + D) + 2
    out = []
    for img, (ax, ay), _, _ in items:
        c = np.zeros((H, W), np.float32); a = np.asarray(img)[..., 3] / 255.0
        x0, y0 = int(round(L - ax)), int(round(T - ay))
        c[y0:y0 + a.shape[0], x0:x0 + a.shape[1]] = a
        out.append(c)
    return out

def smooth_loop(items):
    """reorder frames into the loop with the least total silhouette change (first frame kept first)"""
    from itertools import permutations
    n = len(items)
    if n <= 2: return items
    m = placed(items)
    D = [[float(np.abs(m[i] - m[j]).mean()) for j in range(n)] for i in range(n)]
    best, order = 1e9, list(range(n))
    for p in permutations(range(1, n)):
        if p[0] > p[-1]: continue                       # a loop and its reverse are the same
        q = (0,) + p
        cost = sum(D[q[i]][q[(i + 1) % n]] for i in range(n))
        if cost < best: best, order = cost, list(q)
    return [items[i] for i in order]

def by_reach(items):
    """attack frames from the least to the most extended arm (facing screen-right): ready ... strike"""
    def reach(it):
        a = np.asarray(it[0])[..., 3] > 100; ys, xs = np.nonzero(a)
        up = ys < ys.min() + 0.6 * (ys.max() - ys.min())
        return xs[up].max() - it[1][0]
    return sorted(items, key=reach)

Z = Atlas()
Z.add("idle_S", zframes([("L", 0, range(6))]))                 # facing the viewer; six different faces
Z.add("idle_S2", zframes([("L", 4, range(6))]))
Z.add("back_N", zframes([("L", 1, [4]), ("L", 2, [4])]))       # back to the viewer (two people)
Z.add("walk_SW", smooth_loop(zframes([("M", 0, range(9))])))   # three-quarter front, facing left
Z.add("walk_SW2", smooth_loop(zframes([("M", 1, [3, 5, 6, 8]), ("M", 2, [3, 6, 7])])))
Z.add("walk_E", smooth_loop(zframes([("M", 3, range(5))])))    # side on, facing right
Z.add("hunch_E", smooth_loop(zframes([("M", 4, range(5))])))
Z.add("lunge_E", by_reach(zframes([("M", 3, [5, 6, 7, 8])])))  # walk_E's man attacking
Z.add("claw_E", by_reach(zframes([("M", 4, [2, 5, 6])])))      # hunch_E's man attacking
Z.add("attack_E", by_reach(zframes([("L", 3, range(6))])))
Z.add("run_E", smooth_loop(zframes([("R", 1, range(7))])))
Z.add("run_E2", smooth_loop(zframes([("R", 0, range(5))])))
Z.add("run_E3", smooth_loop(zframes([("R", 2, [3, 4, 5, 6])])))
Z.add("charge_E", smooth_loop(zframes([("R", 3, range(7))])))
Z.add("crawl_E", smooth_loop(zframes([("R", 4, [0, 1, 2, 4])], "centre")))
Z.add("crawl_attack_E", by_reach(zframes([("R", 4, [0, 1, 2, 4])], "centre")))   # the crawl frames by reach: the grab
Z.add("dead", zframes([("R", 4, [3, 5])], "centre"))
Z.save(os.path.join(OUT, "zombies.png"), os.path.join(OUT, "zombies.json"),
       "user-supplied sprite sheet 8086.png (infected rows); tools/slice_sprites.py", 92)

# ---------------------------------------------------------------- 8-direction infected soldier sheet (8089)
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
            # (always, even with one part: the sheet's empty background has faint alpha that would show
            # as a pale box around the figure)
            lb2, n2 = ndimage.label(ndimage.binary_dilation(crop[..., 3] > 40, iterations=4))
            if n2:
                sizes = ndimage.sum(crop[..., 3] > 40, lb2, range(1, n2 + 1))
                keep = np.isin(lb2, [i + 1 for i, v in enumerate(sizes) if v >= max(sizes) * 0.08])
                crop[..., 3] = np.where(keep & (crop[..., 3] > 12), crop[..., 3], 0)
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
            top, bot = ys.min(), ys.max(); h = bot - top
            if len(items) < 8:      # standing (walk, attack, first falling frame): the hips, the root of the movement
                band = (ys >= top + 0.45 * h) & (ys <= top + 0.58 * h)
                ax = float(np.median(xs[band]))
            else:                   # kneeling and lying: the middle of the body
                ax = float((xs.min() + xs.max()) / 2)
            items.append((im, (ax, float(ys.max() + 1)), (0, 0), 1.0))
        out[DIRS8[r]] = items
    return out

def olive(items):
    """re-dye the infected soldier's desert camouflage to the olive uniform of the military sheet
    (only the tan cloth: skin, blood and dark gear are left alone)"""
    out = []
    for im, anc, mz, k in items:
        a = np.asarray(im).astype(np.float32)
        R, G, B = a[..., 0], a[..., 1], a[..., 2]
        sat = np.clip((R - B - 30) / 40.0, 0, 1) * ((R >= G - 4) & (G >= B)).astype(np.float32)
        tgt = np.dstack([R * 0.55, G * 0.66, B * 0.45])
        a[..., :3] = a[..., :3] * (1 - sat[..., None]) + tgt * sat[..., None]
        out.append((Image.fromarray(np.clip(a, 0, 255).astype(np.uint8), "RGBA"), anc, mz, k))
    return out

print("infected_soldier8")
ZS = sheet8(os.path.join(ROOT, "assets/source/zombie_soldier_8dir.png"), [78, 233, 380, 526, 668, 802, 930, 1056])
S8 = Atlas()
VEC8 = {"N": (0, -1), "NE": (0.7, -0.7), "E": (1, 0), "SE": (0.9, 0.45), "S": (0, 1), "SW": (-0.9, 0.45), "W": (-1, 0), "NW": (-0.7, -0.7)}
def reach8(items, d):
    """reach + grab frames from the less to the more extended arm (along the view's direction)"""
    vx, vy = VEC8[d]
    def r(it):
        a = np.asarray(it[0])[..., 3] > 100; ys, xs = np.nonzero(a)
        up = ys < ys.min() + 0.7 * (ys.max() - ys.min())
        return float(((xs[up] - it[1][0]) * vx + (ys[up] - it[1][1]) * vy).max())
    return sorted(items, key=r)
for d in DIRS8:
    S8.add("z_walk_" + d, olive(ZS[d][0:5])); S8.add("z_attack_" + d, olive(reach8(ZS[d][5:7], d))); S8.add("z_die_" + d, olive(ZS[d][7:10]))
S8.save(os.path.join(OUT, "infected_soldier8.png"), os.path.join(OUT, "infected_soldier8.json"),
        "user-supplied 8-direction sheet 8089.png (infected soldier), re-dyed olive; tools/slice_sprites.py", STAND8)


# ---------------------------------------------------------------- military personnel sheet
# assets/source/military_soldier_sheet.png ("Military_Soldier_Sprite_Sheet.png", 1536x1024, transparent).
# Three labelled sections, each with eight direction groups left to right: N, NE, E, SE, S, SW, W, NW.
#   WALKING: 3 frames per direction (two strides and a passing step).
#   FIRING:  3 frames per direction (aim and recoil).
#   DYING:   6 frames per direction: 3 staggering frames, then a 4th below them and two lying frames.
# Checks made on the drawings:
#   * N, NE, E, S, SW, W and NW are drawn as labelled.
#   * The SE groups are drawn facing east (backpack to the viewer, rifle level to the right), so a
#     soldier heading south-east would look as if walking away and his rifle would be 45 degrees off.
#     SE is therefore the SW group mirrored (front three-quarter, rifle down-right). The sheet's SE
#     frames are cut and reported but not used.
#   * Some firing frames touch their neighbours (rifles): they are split at the narrowest gap between
#     the figures, not at guessed coordinates.
#   * The dying section is drawn 11-20 % smaller than walking: each direction's dying frames are scaled
#     so the standing ones match that direction's walking height.
SRC_MIL = os.path.join(ROOT, "assets/source/military_soldier_sheet.png")
MIL = np.asarray(Image.open(SRC_MIL).convert("RGBA"))
MDIRS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"]
MGROUPS = [0, 214, 411, 597, 780, 965, 1147, 1330, 1536]   # x ranges of the eight direction groups
# rifle directions as drawn, in screen space (x right, y down); S points at the viewer
AIM = {"N": (0, -1), "NE": (0.6, -0.8), "E": (1, 0), "SE": (0.94, 0.34), "S": (0, 1), "SW": (-0.94, 0.34), "W": (-1, 0), "NW": (-0.6, -0.8)}

def m_boxes(y0, y1, thr, dil):
    """figure boxes per direction group in a band of the sheet"""
    sub = MIL[y0:y1, :, 3] > thr
    if dil: sub = ndimage.binary_dilation(sub, iterations=dil)
    lb, _ = ndimage.label(sub)
    out = {g: [] for g in range(8)}
    for sl in ndimage.find_objects(lb):
        ys, xs = sl
        if int((MIL[y0:y1][sl][..., 3] > thr).sum()) < 150: continue
        cx = (xs.start + xs.stop) / 2
        g = max(i for i in range(8) if MGROUPS[i] <= cx)
        out[g].append([xs.start, ys.start + y0, xs.stop, ys.stop + y0])
    for g in out: out[g].sort()
    return out

def m_split(box, n):
    """split a box holding n touching figures at the n-1 narrowest columns between them"""
    x0, y0, x1, y1 = box
    col = (MIL[y0:y1, x0:x1, 3] > 128).sum(axis=0).astype(float)
    w = x1 - x0; cuts = [x0]
    for k in range(1, n):
        c = k * w / n; lo, hi = int(c - w / (3 * n)), int(c + w / (3 * n))
        cuts.append(x0 + lo + int(np.argmin(col[lo:hi])))
    cuts.append(x1)
    return [[cuts[i], y0, cuts[i + 1], y1] for i in range(n)]

def m_crop(box):
    """the figure in a box: its own pixels only (inside its box, its largest connected part, so no
    stray bits of a neighbour's rifle and no faint background), soft edge kept, ground shadow dropped"""
    x0, y0, x1, y1 = box
    a = MIL[max(0, y0 - 1):y1 + 1, max(0, x0):x1].copy()
    lb, n = ndimage.label(ndimage.binary_dilation(a[..., 3] > 60, iterations=1))
    if n:      # always: the background's faint alpha would show as a pale box
        sz = ndimage.sum(a[..., 3] > 60, lb, range(1, n + 1))
        a[..., 3] = np.where((lb == int(np.argmax(sz)) + 1) & (a[..., 3] > 12), a[..., 3], 0)
    # faint grey ground shadow under the boots: low alpha at foot level
    ys = np.nonzero(a[..., 3] > 128)[0]
    if len(ys):
        bot = ys.max(); a[bot + 1:, :, 3] = 0
    return a

def body(a):
    """(top of helmet, feet) rows and head/hip x: the rifle (a thin barrel) is not counted as height"""
    m = a[..., 3] > 128
    widths = m.sum(axis=1); ys = np.nonzero(widths)[0]
    top = next(y for y in ys if widths[y] >= 12)
    bot = ys.max()
    h = bot - top
    head = np.nonzero(m[top:top + max(2, int(0.1 * h))].any(axis=0))[0].mean()
    hipband = m[top + int(0.5 * h): top + int(0.62 * h) + 1]
    hip = np.nonzero(hipband.any(axis=0))[0].mean() if hipband.any() else head
    return top, bot, head, hip

def m_scale(a, k):
    im = Image.fromarray(a, "RGBA")
    if abs(k - 1) > 1e-3: im = im.resize((max(1, round(im.width * k)), max(1, round(im.height * k))), Image.LANCZOS)
    al = np.asarray(im)[..., 3]; ys, xs = np.nonzero(al > 20)
    return im.crop((max(0, xs.min() - 1), max(0, ys.min() - 1), min(im.width, xs.max() + 2), min(im.height, ys.max() + 2)))

def muzzle(im, d):
    """barrel tip of a firing frame: the dark rifle pixel furthest along the aim direction"""
    a = np.asarray(im); m = a[..., 3] > 128
    top, bot, head, hip = body(a); h = bot - top
    dark = m & (a[..., :3].max(axis=2) < 52)
    ys, xs = np.nonzero(dark)
    keep = ys < top + 0.5 * h                       # the rifle is held at chest height (knee pads and boots are black too)
    ys, xs = ys[keep], xs[keep]
    if d == "S":
        # rifle pointing at the viewer, held at the middle of the chest: the muzzle is the lower end of
        # the black rifle shape in a narrow central column (pouches at the hips are dark too)
        c = (np.abs(xs - head) < 0.12 * a.shape[1]) & (ys > top + 0.2 * h) & (ys < top + 0.45 * h)
        ys, xs = ys[c], xs[c]
        i = int(np.argmax(ys))
        return int(xs[i]), int(ys[i])
    vx, vy = AIM[d]; cx, cy = head, top + 0.35 * h
    i = int(np.argmax((xs - cx) * vx + (ys - cy) * vy))
    return int(xs[i]), int(ys[i])

def anchor_stand(im):
    a = np.asarray(im); top, bot, head, hip = body(a)
    return ((head + hip) / 2, float(bot + 1))
def anchor_lying(im):
    a = np.asarray(im); ys, xs = np.nonzero(a[..., 3] > 128)
    return (float((xs.min() + xs.max()) / 2), float(ys.max() + 1 - 0.45 * (ys.max() - ys.min())))

def mirror(item):
    im, (ax, ay), mz, k = item
    return (im.transpose(Image.FLIP_LEFT_RIGHT), (im.width - ax, ay), (im.width - 1 - mz[0], mz[1]) if mz != (0, 0) else mz, k)

print("military8")
walkB = m_boxes(115, 262, 60, 1)
fireB = m_boxes(412, 582, 128, 0)
topB = m_boxes(748, 866, 60, 1)
botB = m_boxes(860, 1000, 60, 1)
for g in range(8):
    # touching firing frames: split by the narrowest gap
    while len(fireB[g]) < 3:
        wi = max(range(len(fireB[g])), key=lambda i: fireB[g][i][2] - fireB[g][i][0]); b = fireB[g][wi]
        n = 3 - len(fireB[g]) + 1
        fireB[g] = sorted(fireB[g][:wi] + m_split(b, n) + fireB[g][wi + 1:])
    assert len(walkB[g]) == 3 and len(fireB[g]) == 3 and len(topB[g]) == 3 and len(botB[g]) == 3, (g, len(walkB[g]), len(fireB[g]), len(topB[g]), len(botB[g]))

H0 = float(np.median([(lambda t: t[1] - t[0])(body(m_crop(b))) for g in range(8) for b in walkB[g]]))
M8 = Atlas(); report = []
clips = {}
for g, d in enumerate(MDIRS):
    walk = [m_crop(b) for b in walkB[g]]; fire = [m_crop(b) for b in fireB[g]]
    # dying: three staggering frames, the standing one below them, then the two lying ones (upper, lower)
    bot = sorted(botB[g], key=lambda b: (b[3] - b[1]), reverse=True)
    stand4 = bot[0]; lying = sorted(bot[1:], key=lambda b: b[1])
    die = [m_crop(b) for b in topB[g]] + [m_crop(stand4)] + [m_crop(b) for b in lying]
    hw = [body(a)[1] - body(a)[0] for a in walk]; hf = [body(a)[1] - body(a)[0] for a in fire]
    hd = [body(a)[1] - body(a)[0] for a in die[:4]]
    mw, mf = float(np.median(hw)), float(np.median(hf))
    kdie = float(np.median(hw)) / float(np.median(hd))
    # per-frame size noise is pulled to the clip's own median (at most +-6 %)
    W = [m_scale(a, float(np.clip(mw / h, 0.94, 1.06))) for a, h in zip(walk, hw)]
    F = [m_scale(a, float(np.clip(mf / h, 0.94, 1.06))) for a, h in zip(fire, hf)]
    D = [m_scale(a, kdie * float(np.clip(np.median(hd) / h, 0.94, 1.06))) for a, h in zip(die[:4], hd)] + [m_scale(a, kdie) for a in die[4:]]
    # walk cycle: the frame with the narrowest stance is the passing step -> stride, pass, stride, pass
    spread = []
    for im in W:
        a = np.asarray(im)[..., 3] > 128; ys = np.nonzero(a.any(axis=1))[0]; foot = a[ys.max() - max(3, (ys.max() - ys.min()) // 7):]
        xs = np.nonzero(foot.any(axis=0))[0]; spread.append(xs.max() - xs.min())
    p = int(np.argmin(spread)); s1, s2 = [i for i in range(3) if i != p]
    cycle = [s1, p, s2, p]
    # firing: aim = the middle barrel position, shot = barrel furthest out, recoil = furthest back
    fitems = [(im, anchor_stand(im), muzzle(im, d), 1.0) for im in F]
    proj = [((mz[0] - an[0]) * AIM[d][0] + (mz[1] - an[1]) * AIM[d][1]) if d != "S" else mz[1] for im, an, mz, k in fitems]
    order = sorted(range(3), key=lambda i: proj[i])          # back ... out
    aim, shot, recoil = order[1], order[2], order[0]
    # one size for every direction: the sheet draws some directions up to ~5 % taller than others, so
    # each direction is scaled (at draw time, field k) to the common standing height
    kd = H0 / mw
    fitems = [(im, an, mz, kd) for im, an, mz, _ in fitems]
    witems = [(im, anchor_stand(im), (0, 0), kd) for im in W]
    ditems = [(im, anchor_stand(im), (0, 0), kd) for im in D[:4]] + [(im, anchor_lying(im), (0, 0), kd) for im in D[4:]]
    clips[d] = {"walk": [witems[i] for i in cycle], "idle": [witems[p]], "fire": [fitems[aim], fitems[shot], fitems[recoil]], "die": ditems}
    report.append(f"  {d:2s}: walk {[round(h) for h in hw]} px (x{kd:.3f}), cycle {cycle}; fire order aim/shot/recoil {aim}/{shot}/{recoil}; dying x{kdie:.2f}")
# SE: the sheet's SE groups face east; use SW mirrored (see note above)
clips["SE_sheet"] = clips["SE"]
clips["SE"] = {k: [mirror(it) for it in v] for k, v in clips["SW"].items()}
for d in MDIRS:
    for k in ("walk", "idle", "fire", "die"):
        M8.add(f"{k}_{d}", clips[d][k])
M8.save(os.path.join(OUT, "military8.png"), os.path.join(OUT, "military8.json"),
        "user-supplied Military_Soldier_Sprite_Sheet.png; SE = SW mirrored (the sheet's SE is drawn facing east); tools/slice_sprites.py", round(H0))
print("\n".join(report)); print(f"  standing height {H0:.0f} px; sheet SE frames not used: {len(clips['SE_sheet']['walk']) - 1 + 3 + 6} (drawn facing east)")

"""Game atlas for the infantry soldier: public/sprites/soldier16.png + .json

    cd tools/soldier3d && python3 game_atlas.py      (about 5 minutes on 2 cores)

Renders the soldier rig in 16 screen views without the ground shadow and without a baked muzzle
flash (the game draws its own flash, on real shots only), trims each frame to the figure, packs the
frames into a 256-colour atlas and writes the frame list in the format the other atlases use
(tools/slice_sprites.py):

  frames  x, y, w, h   place in the atlas
          ax, ay       the feet (the same ground point in every frame, standing or lying)
          mx, my       firing frames: the rifle's muzzle, projected from the 3D rig (exact)
          md           firing frames: [dx, dy, len] the barrel's direction on screen (y down) and how
                       much of it is visible (1 = side on, 0 = pointing straight at or away from you)
  anims   walk_<V> 12, idle_<V> 8, fire_<V> 3 (aim, shot, recoil), die_<V> 12
  views   the 16 view names, clockwise from facing away from the viewer (N)
  ref     standing height in atlas pixels
"""
import json
import math
import os
import sys
from multiprocessing import Pool

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import anims as A          # noqa: E402
import soldier3d as S      # noqa: E402

S.SHADOW_A = 0.0
ROOT = os.path.dirname(os.path.dirname(HERE))
OUT = os.path.join(ROOT, "public/sprites")
CACHE = os.path.join(HERE, "out/game_frames")
VIEWS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"]
# clip -> (animation, frame indices used); fire: aim, shot, recoil
CLIPS = [("walk", "walk", list(range(12))), ("idle", "idle", list(range(8))),
         ("fire", "fire", [0, 1, 2]), ("die", "death", list(range(12)))]


def yaw_of(view_i):
    """compass view (0 = N, away from the viewer, clockwise) -> rig yaw. The renderer's screen angle is
    0 = facing right, clockwise; N is screen angle 270."""
    screen = (view_i * 22.5 - 90.0) % 360.0
    return 90.0 - screen


def job(args):
    anim, vi, fi = args
    path = os.path.join(CACHE, f"{anim}_{vi:02d}_{fi:02d}")
    if os.path.exists(path + ".png") and os.path.exists(path + ".json"):
        return path
    fn = {n: f for n, f, *_ in A.ANIMS}[anim]
    P, fx = fn()[fi]
    fx = dict(fx)
    fx.pop("flash", None)                      # the game draws the flash itself
    if anim == "fire" and fi != 2:
        fx.pop("casing", None)                 # the casing is out on the recoil frame only
    yaw = yaw_of(vi)
    J = S.resolve(P)
    rgba, _ = S.render(J, yaw, fx)
    img = S.downsample(rgba)
    Image.fromarray((np.clip(img, 0, 1) * 255 + 0.5).astype(np.uint8), "RGBA").save(path + ".png")
    meta = {}
    if anim == "fire":
        Ryaw = S.Ry(math.radians(yaw))
        mx, my, _ = S.project(Ryaw @ J["muzzle"])
        dv = Ryaw @ J["muzzle_dir"]
        sdx, sdy = float(np.dot(dv, S.CAM_R)), float(-np.dot(dv, S.CAM_U))
        ln = math.hypot(sdx, sdy)
        meta = {"mx": mx / S.SS, "my": my / S.SS,
                "md": [sdx / ln if ln > 1e-6 else 0.0, sdy / ln if ln > 1e-6 else 1.0, ln]}
    with open(path + ".json", "w") as f:
        json.dump(meta, f)
    return path


def trim(im):
    a = np.asarray(im)[..., 3]
    ys, xs = np.nonzero(a > 3)
    x0, y0 = max(0, xs.min() - 1), max(0, ys.min() - 1)
    x1, y1 = min(im.width, xs.max() + 2), min(im.height, ys.max() + 2)
    return im.crop((x0, y0, x1, y1)), (x0, y0)


def main():
    os.makedirs(CACHE, exist_ok=True)
    jobs = [(anim, vi, fi) for _, anim, idx in CLIPS for vi in range(16) for fi in idx]
    with Pool(2) as pool:
        for k, _ in enumerate(pool.imap_unordered(job, jobs, chunksize=4)):
            if k % 80 == 0:
                print(f"  rendered {k}/{len(jobs)}", flush=True)
    feet = (S.FRAME / 2, S.FRAME * S.ANCHOR_Y)
    items, anims_ = [], {}
    for clip, anim, idx in CLIPS:
        for vi, v in enumerate(VIEWS):
            ids = []
            for fi in idx:
                p = os.path.join(CACHE, f"{anim}_{vi:02d}_{fi:02d}")
                im, (ox, oy) = trim(Image.open(p + ".png").convert("RGBA"))
                meta = json.load(open(p + ".json"))
                e = {"img": im, "ax": feet[0] - ox, "ay": feet[1] - oy}
                if meta:
                    e["mx"], e["my"] = meta["mx"] - ox, meta["my"] - oy
                    e["md"] = meta["md"]
                items.append(e)
                ids.append(len(items) - 1)
            anims_[f"{clip}_{v}"] = ids
    # standing height: feet to the top of the helmet, idle frame 0, median over the views
    hs = []
    for v in VIEWS:
        e = items[anims_["idle_" + v][0]]
        a = np.asarray(e["img"])[..., 3] > 128
        hs.append(e["ay"] - np.nonzero(a.any(axis=1))[0].min())
    ref = round(float(np.median(hs)))
    # shelf packing, tallest first
    W = 2048
    order = sorted(range(len(items)), key=lambda i: -items[i]["img"].height)
    x = y = rowh = 0
    rects = [None] * len(items)
    for i in order:
        w, h = items[i]["img"].size
        if x + w + 2 > W:
            x, y, rowh = 0, y + rowh + 2, 0
        rects[i] = (x + 1, y + 1, w, h)
        x += w + 2
        rowh = max(rowh, h)
    H = y + rowh + 2
    atlas = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    for e, (rx, ry, w, h) in zip(items, rects):
        atlas.paste(e["img"], (rx, ry))
    # 256 colours with alpha, with a fully transparent entry of its own for empty pixels
    q = atlas.quantize(colors=255, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.NONE)
    pal = q.getpalette(rawmode="RGBA")
    idx = np.array(q)
    idx[np.asarray(atlas)[..., 3] == 0] = len(pal) // 4
    q = Image.fromarray(idx.astype(np.uint8), "P")
    q.putpalette(pal + [0, 0, 0, 0], rawmode="RGBA")
    q.save(os.path.join(OUT, "soldier16.png"), optimize=True)
    frames = []
    for e, (rx, ry, w, h) in zip(items, rects):
        f = {"x": rx, "y": ry, "w": w, "h": h, "ax": round(e["ax"], 1), "ay": round(e["ay"], 1)}
        if "mx" in e:
            f["mx"], f["my"] = round(e["mx"], 1), round(e["my"], 1)
            f["md"] = [round(c, 3) for c in e["md"]]
        frames.append(f)
    js = {"source": "rendered from the soldier rig in tools/soldier3d (game_atlas.py)",
          "size": [W, H], "ref": ref, "views": VIEWS, "frames": frames, "anims": anims_}
    with open(os.path.join(OUT, "soldier16.json"), "w") as f:
        json.dump(js, f, separators=(",", ":"))
    print(f"  -> public/sprites/soldier16.png {W}x{H}, {len(frames)} frames, standing height {ref} px "
          f"(views {min(hs):.0f}-{max(hs):.0f})")


if __name__ == "__main__":
    main()

"""Pack rendered frames into sprite sheets + JSON atlases + GIF preview."""
import json
import os
import zipfile

from PIL import Image

import anims as A
import soldier3d as S

DIRS = 16
F = S.FRAME
SRC = "out/frames"
DST = "out/final"
COMPASS = ["E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW",
           "W", "WNW", "NW", "NNW", "N", "NNE", "NE", "ENE"]
INFO = [(n, len(fn()), fps, loop) for n, fn, fps, loop in A.ANIMS]


def frame(name, d, i):
    return Image.open(f"{SRC}/{name}/{d:02d}_{i:02d}.png").convert("RGBA")


def atlas_json(image_name, size, entries, tags, dirs):
    frames = {}
    for key, x, y, dur in entries:
        frames[key] = {
            "frame": {"x": x, "y": y, "w": F, "h": F},
            "rotated": False, "trimmed": False,
            "spriteSourceSize": {"x": 0, "y": 0, "w": F, "h": F},
            "sourceSize": {"w": F, "h": F},
            "pivot": {"x": 0.5, "y": S.ANCHOR_Y},
            "duration": dur,
        }
    return {
        "frames": frames,
        "meta": {
            "image": image_name, "format": "RGBA8888",
            "size": {"w": size[0], "h": size[1]}, "scale": "1",
            "frame_size": {"w": F, "h": F},
            "pivot_note": "feet are at x=50%%, y=%d%% of each frame" % round(S.ANCHOR_Y * 100),
            "directions": [{"row": r, "name": COMPASS[d], "angle_deg": d * 360 / DIRS}
                           for r, d in enumerate(dirs)],
            "angle_convention": "0 deg = facing right (east), increasing clockwise on screen "
                                "(y-down): E, ESE, SE ... S is facing the camera.",
            "animations": {n: {"frames": c, "fps": fps, "loop": loop} for n, c, fps, loop in INFO},
            "frameTags": tags,
        },
    }


def build_sheet(dirs, anim_names, image_name):
    info = [x for x in INFO if x[0] in anim_names]
    cols = sum(x[1] for x in info)
    sheet = Image.new("RGBA", (cols * F, len(dirs) * F), (0, 0, 0, 0))
    entries, tags = [], []
    c0 = 0
    for name, n, fps, loop in info:
        for r, d in enumerate(dirs):
            keys = []
            for i in range(n):
                x, y = (c0 + i) * F, r * F
                sheet.paste(frame(name, d, i), (x, y))
                key = f"{name}_{COMPASS[d]}_{i:02d}"
                entries.append((key, x, y, round(1000 / fps)))
                keys.append(key)
            tags.append({"name": f"{name}_{COMPASS[d]}", "row": r, "start_col": c0,
                         "frames": keys, "fps": fps, "loop": loop})
        c0 += n
    sheet.save(f"{DST}/{image_name}", optimize=True)
    js = atlas_json(image_name, sheet.size, entries, tags, dirs)
    with open(f"{DST}/{image_name[:-4]}.json", "w") as f:
        json.dump(js, f, indent=1)
    return sheet


def preview_gif():
    dirs = list(range(0, 16, 2))                 # 8 directions
    order = [4, 2, 0, 14, 6, 8, 10, 12]          # S SE E NE / SW W NW N
    seq = [("idle", 1, 110), ("walk", 2, 70), ("fire", 3, 60), ("death", 1, 85)]
    bg = (214, 200, 168, 255)
    cell = F
    W, H = 4 * cell, 2 * cell
    frames, durs = [], []
    lens = {n: c for n, c, *_ in INFO}
    for name, reps, dur in seq:
        for _ in range(reps):
            for i in range(lens[name]):
                im = Image.new("RGBA", (W, H), bg)
                for k, d in enumerate(order):
                    im.alpha_composite(frame(name, d, i), ((k % 4) * cell, (k // 4) * cell))
                frames.append(im.convert("RGB"))
                durs.append(dur)
    durs[-1] = 1400
    pal = frames[len(frames) // 2].quantize(colors=255, method=Image.Quantize.MEDIANCUT)
    q = [f.quantize(palette=pal, dither=Image.Dither.NONE) for f in frames]
    q[0].save(f"{DST}/soldier_preview.gif", save_all=True, append_images=q[1:],
              duration=durs, loop=0, optimize=True)


def main():
    os.makedirs(DST, exist_ok=True)
    names = [x[0] for x in INFO]
    build_sheet(list(range(DIRS)), names, "soldier_16dir_all.png")
    build_sheet(list(range(0, DIRS, 2)), names, "soldier_8dir_all.png")
    for n in names:
        build_sheet(list(range(DIRS)), [n], f"soldier_16dir_{n}.png")
    preview_gif()
    with open(f"{DST}/README.txt", "w") as f:
        f.write(README)
    zpath = f"{DST}/soldier_spritesheets.zip"
    with zipfile.ZipFile(zpath, "w", zipfile.ZIP_DEFLATED) as z:
        for fn in sorted(os.listdir(DST)):
            if fn.endswith((".png", ".json", ".txt")):
                z.write(f"{DST}/{fn}", fn)
    print("ok")


README = """Desert soldier sprite sheets
============================

Frames: 160 x 160 px, transparent background, soft ground shadow included.
Pivot / feet position: x = 50%, y = 73% of each frame (same in every frame).

Layout: one ROW per facing direction, animations side by side in COLUMNS.
  idle   8 frames   8 fps   loop
  walk  12 frames  14 fps   loop
  fire   6 frames  16 fps   loop (muzzle flash on frames 1-2, casing ejects)
  death 12 frames  12 fps   play once, hold last frame

Directions (16-dir sheets), row = angle / 22.5:
  0 E, 1 ESE, 2 SE, 3 SSE, 4 S (facing camera), 5 SSW, 6 SW, 7 WSW,
  8 W, 9 WNW, 10 NW, 11 NNW, 12 N (back to camera), 13 NNE, 14 NE, 15 ENE
  angle 0 = facing right, increasing clockwise on screen (Godot/Phaser convention).
  In code: row = round(angle_deg / 22.5) % 16.

Files
  soldier_16dir_all.png / .json   everything in one sheet (6080 x 2560)
  soldier_8dir_all.png  / .json   8 directions only (E, SE, S, SW, W, NW, N, NE)
  soldier_16dir_<anim>.png / .json  one sheet per animation (each under 4096 px,
                                    safer for mobile GPUs)
  JSON files use the TexturePacker "JSON Hash" format (Phaser, PixiJS, Cocos, etc.)
  with frame names like  walk_SE_03  plus "frameTags" listing each animation+direction.
"""

if __name__ == "__main__":
    main()

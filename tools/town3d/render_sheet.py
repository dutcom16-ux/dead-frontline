"""Render the townhouse in 8 views x 3 states and pack the sprite sheet, JSON and previews.

    python3 render_sheet.py        (about 10 minutes on 2 cores)
"""
import json
import os
from multiprocessing import Pool

import numpy as np
from PIL import Image

import importlib
import sys

import brender as BR

# python3 render_sheet.py [module] [frame] [anchor_x] [anchor_y]   (17.3 px per metre for every building)
NAME = sys.argv[1] if len(sys.argv) > 1 else "townhouse"
T = importlib.import_module(NAME)
FRAME = int(sys.argv[2]) if len(sys.argv) > 2 else 320
ANCHOR = (float(sys.argv[3]), float(sys.argv[4])) if len(sys.argv) > 4 else (0.47, 0.6)
PPM = 320 / 18.5
VIEW_W, SS = FRAME / PPM, 2
VIEWS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"]   # where the shop front faces on screen
STATES = ["intact", "damaged", "destroyed"]
OUT = "out" if NAME == "townhouse" else "out_" + NAME


def job(args):
    si, vi = args
    path = f"{OUT}/frames/{si}_{vi}.png"
    if os.path.exists(path):
        return path
    sc = T.build(si)
    img = BR.render(sc, T.shade, 180 - vi * 45, FRAME, VIEW_W, ANCHOR, ss=SS)
    Image.fromarray((np.clip(img, 0, 1) * 255 + 0.5).astype(np.uint8), "RGBA").save(path)
    return path


def main():
    os.makedirs(f"{OUT}/frames", exist_ok=True)
    jobs = [(si, vi) for si in range(3) for vi in range(8)]
    with Pool(2) as pool:
        for k, p in enumerate(pool.imap_unordered(job, jobs)):
            print(f"  {k + 1}/{len(jobs)} {p}", flush=True)
    sheet = Image.new("RGBA", (FRAME * 8, FRAME * 3), (0, 0, 0, 0))
    frames = {}
    clipped = []
    for si, st in enumerate(STATES):
        for vi, v in enumerate(VIEWS):
            im = Image.open(f"{OUT}/frames/{si}_{vi}.png")
            a = np.asarray(im)[..., 3]
            if max(a[0].max(), a[-1].max(), a[:, 0].max(), a[:, -1].max()) > 10:
                clipped.append(f"{st}_{v}")
            sheet.paste(im, (vi * FRAME, si * FRAME))
            frames[f"{NAME}_{st}_{v}"] = {
                "frame": {"x": vi * FRAME, "y": si * FRAME, "w": FRAME, "h": FRAME},
                "rotated": False, "trimmed": False,
                "spriteSourceSize": {"x": 0, "y": 0, "w": FRAME, "h": FRAME},
                "sourceSize": {"w": FRAME, "h": FRAME},
                "pivot": {"x": ANCHOR[0], "y": ANCHOR[1]},
                "view": v, "front_deg": vi * 45, "state": st,
            }
    sheet.save(f"{OUT}/{NAME}_sheet.png", optimize=True)
    meta = {
        "image": f"{NAME}_sheet.png", "size": {"w": sheet.width, "h": sheet.height},
        "frame_size": {"w": FRAME, "h": FRAME},
        "layout": "rows = states (intact, damaged, destroyed); columns = views N, NE, E, SE, S, SW, W, NW",
        "views": "the direction the building's front (%s) faces on screen, clockwise from N = facing away from the viewer "
                 "(S = front toward the viewer). view = round(front_compass_deg / 45) %% 8." % getattr(T, "FRONT", "shop front"),
        "pivot": getattr(T, "PIVOT", "the centre of the building's footprint on the ground") + "," + " at x %d%% / y %d%% of every frame" % (round(ANCHOR[0] * 100), round(ANCHOR[1] * 100)),
        "pixels_per_metre": round(FRAME / VIEW_W, 3),
        "footprint_m": getattr(T, "FOOTPRINT", None),
        "height_m": getattr(T, "HEIGHT", None),
        "camera": "orthographic, 0.87 rad (about 50 deg) down, the game's IsoCamera pitch; light from the screen's top-left",
        "states": STATES, "views_order": VIEWS,
    }
    with open(f"{OUT}/{NAME}_sheet.json", "w") as f:
        json.dump({"frames": frames, "meta": meta}, f, indent=1)
    # previews: the three states side by side, turning through the 8 views, on a street-grey ground
    gif = []
    for k in range(16):
        vi = (4 + k) % 8
        im = Image.new("RGBA", (FRAME * 3, FRAME), (128, 132, 120, 255))
        for si in range(3):
            im.alpha_composite(Image.open(f"{OUT}/frames/{si}_{vi}.png"), (si * FRAME, 0))
        if FRAME > 480:                                                                  # keep big previews light
            im = im.resize((im.width // 2, im.height // 2), Image.LANCZOS)
        gif.append(im.convert("RGB"))
    pal = gif[0].quantize(colors=255, method=Image.Quantize.MEDIANCUT)
    q = [g.quantize(palette=pal, dither=Image.Dither.NONE) for g in gif]
    q[0].save(f"{OUT}/{NAME}_preview.gif", save_all=True, append_images=q[1:], duration=450, loop=0, optimize=True)
    bg = Image.new("RGBA", sheet.size, (128, 132, 120, 255))
    bg.alpha_composite(sheet)
    bg.convert("RGB").save(f"{OUT}/{NAME}_contact.jpg", quality=88)
    print("clipped:", clipped or "none")


if __name__ == "__main__":
    main()

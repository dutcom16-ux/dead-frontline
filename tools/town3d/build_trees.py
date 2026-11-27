"""Tree sprite sheets: rows = 8 views, columns = 4 wind-sway frames (a seamless loop)."""
import json
import os
from multiprocessing import Pool

import numpy as np
from PIL import Image

import brender as BR
import trees as TR

OUT = "out_trees"
VIEWS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"]
PPM = 320 / 18.5
SPEC = {"coconut_palm": (320, (0.4, 0.66)), "mango_tree": (320, (0.36, 0.62)), "banana_plant": (192, (0.42, 0.62))}
NF, FPS = 4, 4


def job(args):
    kind, vi, fi = args
    p = f"{OUT}/frames/{kind}_{vi}_{fi}.png"
    if os.path.exists(p):
        return p
    F, anc = SPEC[kind]
    sc = TR.KINDS[kind](fi / NF)
    img = BR.render(sc, TR.shade, 180 - vi * 45, F, F / PPM, anc, ss=2)
    Image.fromarray((np.clip(img, 0, 1) * 255 + 0.5).astype(np.uint8), "RGBA").save(p)
    return p


def main():
    os.makedirs(f"{OUT}/frames", exist_ok=True)
    jobs = [(k, v, f) for k in SPEC for v in range(8) for f in range(NF)]
    with Pool(2) as pool:
        for i, p in enumerate(pool.imap_unordered(job, jobs)):
            if i % 8 == 0:
                print(i, "/", len(jobs), p, flush=True)
    clipped = []
    previews = {}
    for kind, (F, anc) in SPEC.items():
        sheet = Image.new("RGBA", (F * NF, F * 8), (0, 0, 0, 0))
        frames = {}
        for vi, v in enumerate(VIEWS):
            for fi in range(NF):
                im = Image.open(f"{OUT}/frames/{kind}_{vi}_{fi}.png")
                a = np.asarray(im)[..., 3]
                if max(a[0].max(), a[-1].max(), a[:, 0].max(), a[:, -1].max()) > 10:
                    clipped.append(f"{kind}_{v}_{fi}")
                sheet.paste(im, (fi * F, vi * F))
                frames[f"{kind}_{v}_{fi}"] = {
                    "frame": {"x": fi * F, "y": vi * F, "w": F, "h": F}, "rotated": False, "trimmed": False,
                    "spriteSourceSize": {"x": 0, "y": 0, "w": F, "h": F}, "sourceSize": {"w": F, "h": F},
                    "pivot": {"x": anc[0], "y": anc[1]}, "view": v, "frame_index": fi, "duration": round(1000 / FPS)}
        sheet.save(f"{OUT}/{kind}_sheet.png", optimize=True)
        meta = {"image": f"{kind}_sheet.png", "size": {"w": sheet.width, "h": sheet.height}, "frame_size": {"w": F, "h": F},
                "layout": "rows = views N, NE, E, SE, S, SW, W, NW; columns = 4 wind-sway frames (loop)",
                "fps": FPS, "loop": True, "pivot": f"the foot of the trunk at x {round(anc[0] * 100)}% / y {round(anc[1] * 100)}%",
                "pixels_per_metre": round(PPM, 3), **TR.INFO[kind],
                "camera": "orthographic, 0.87 rad (about 50 deg) down, the game's IsoCamera; light from the screen's top-left",
                "views": "trees look alike from every side; the 8 views keep the lighting and shadow right as the camera turns"}
        json.dump({"frames": frames, "meta": meta}, open(f"{OUT}/{kind}_sheet.json", "w"), indent=1)
    # preview: the three trees in the game's SE view, swaying, on grass
    frames = []
    for fi in list(range(NF)) * 3:
        im = Image.new("RGBA", (320 * 2 + 192, 320), (96, 120, 70, 255))
        im.alpha_composite(Image.open(f"{OUT}/frames/coconut_palm_3_{fi}.png"), (0, 0))
        im.alpha_composite(Image.open(f"{OUT}/frames/mango_tree_3_{fi}.png"), (320, 0))
        im.alpha_composite(Image.open(f"{OUT}/frames/banana_plant_3_{fi}.png"), (640, 90))
        frames.append(im.convert("RGB"))
    pal = frames[0].quantize(colors=255, method=Image.Quantize.MEDIANCUT)
    q = [f.quantize(palette=pal, dither=Image.Dither.NONE) for f in frames]
    q[0].save(f"{OUT}/trees_preview.gif", save_all=True, append_images=q[1:], duration=250, loop=0, optimize=True)
    print("clipped:", clipped or "none")


if __name__ == "__main__":
    main()

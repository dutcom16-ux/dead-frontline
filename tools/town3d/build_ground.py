"""Ground tiles and water: sprite sheets (8 views), animated water sheets, top-down textures."""
import json
import os
from multiprocessing import Pool

import numpy as np
from PIL import Image

import ground as G

OUT = "out_ground"
VIEWS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"]
TILES = ["road", "intersection", "walkway"]
WATER = {"sea": (24, 8), "shore": (24, 6)}           # frames per loop, fps
F = 256


def to_img(a):
    return Image.fromarray((np.clip(a, 0, 1) * 255 + 0.5).astype(np.uint8), "RGBA")


def tile_job(args):
    kind, vi = args
    p = f"{OUT}/frames/{kind}_{vi}.png"
    if not os.path.exists(p):
        to_img(G.render_tile(kind, vi * 45, F)).save(p)
    return p


def water_job(args):
    kind, vi, fi = args
    p = f"{OUT}/frames/{kind}_{vi}_{fi:02d}.png"
    if not os.path.exists(p):
        n = WATER[kind][0]
        to_img(G.render_tile(kind, vi * 45, F, t=fi / n)).save(p)
    return p


def frame_entry(x, y, extra):
    e = {"frame": {"x": x, "y": y, "w": F, "h": F}, "rotated": False, "trimmed": False,
         "spriteSourceSize": {"x": 0, "y": 0, "w": F, "h": F}, "sourceSize": {"w": F, "h": F},
         "pivot": {"x": 0.5, "y": 0.5}}
    e.update(extra)
    return e


COMMON = {
    "tile_m": 10, "pixels_per_metre": round(G.PPM, 3),
    "camera": "orthographic, 0.87 rad (about 50 deg) down, the game's IsoCamera; light from the screen's top-left",
    "views": "the direction of the tile's +z axis on screen, clockwise from N = away from the viewer. Your game camera "
             "(yaw 45 deg + 90 deg steps) uses the diagonal views NE, SE, SW, NW.",
    "pivot": "tile centre at the frame centre; tiles are drawn 6 cm larger on each side so neighbours overlap without gaps",
}


def main():
    os.makedirs(f"{OUT}/frames", exist_ok=True)
    os.makedirs(f"{OUT}/topdown", exist_ok=True)
    jobs_t = [(k, v) for k in TILES for v in range(8)]
    jobs_w = [(k, v, f) for k in WATER for v in range(8) for f in range(WATER[k][0])]
    with Pool(2) as pool:
        list(pool.imap_unordered(tile_job, jobs_t))
        for i, _ in enumerate(pool.imap_unordered(water_job, jobs_w, chunksize=8)):
            if i % 64 == 0:
                print("water", i, "/", len(jobs_w), flush=True)
    # static tiles: rows = road, intersection, walkway; columns = 8 views
    sheet = Image.new("RGBA", (F * 8, F * 3), (0, 0, 0, 0))
    frames = {}
    for r, k in enumerate(TILES):
        for vi, v in enumerate(VIEWS):
            sheet.paste(Image.open(f"{OUT}/frames/{k}_{vi}.png"), (vi * F, r * F))
            frames[f"{k}_{v}"] = frame_entry(vi * F, r * F, {"tile": k, "view": v})
    sheet.save(f"{OUT}/ground_tiles_sheet.png", optimize=True)
    meta = dict(COMMON, image="ground_tiles_sheet.png", size={"w": sheet.width, "h": sheet.height},
                layout="rows: road, intersection, walkway; columns: views N, NE, E, SE, S, SW, W, NW",
                road="along the tile's z axis: 7 m two-lane carriageway, curbs, 1.35 m paved sidewalks",
                intersection="4-way: both roads 7 m, crosswalks and stop lines, rounded corners with black-and-white curbs",
                walkway="along z: 3 m clay-paver walkway with a soldier-course border and concrete edging, through grass")
    json.dump({"frames": frames, "meta": meta}, open(f"{OUT}/ground_tiles_sheet.json", "w"), indent=1)
    # water: two sheets per kind (diagonal views, straight views), 12 columns, 2 rows per view
    for k, (n, fps) in WATER.items():
        for group, vis in (("diagonal", [1, 3, 5, 7]), ("straight", [0, 2, 4, 6])):
            sh = Image.new("RGBA", (F * 12, F * 2 * 4), (0, 0, 0, 0))
            fr = {}
            for gi, vi in enumerate(vis):
                for f in range(n):
                    x, y = (f % 12) * F, (gi * 2 + f // 12) * F
                    sh.paste(Image.open(f"{OUT}/frames/{k}_{vi}_{f:02d}.png"), (x, y))
                    fr[f"{k}_{VIEWS[vi]}_{f:02d}"] = frame_entry(x, y, {"view": VIEWS[vi], "frame_index": f, "duration": round(1000 / fps)})
            name = f"{k}_{group}_sheet"
            sh.save(f"{OUT}/{name}.png", optimize=True)
            m = dict(COMMON, image=f"{name}.png", size={"w": sh.width, "h": sh.height}, frames_per_loop=n, fps=fps, loop=True,
                     layout=f"views {', '.join(VIEWS[v] for v in vis)}; each view takes 2 rows of 12 frames ({n} frames, loops seamlessly)")
            if k == "shore":
                m["shore"] = "sea toward the tile's -z, beach toward +z; one swash (waves run up and draw back) per loop"
            json.dump({"frames": fr, "meta": m}, open(f"{OUT}/{name}.json", "w"), indent=1)
    # top-down textures for the 3D ground: albedo + height (tiles), lit animation strip (sea)
    for k in TILES:
        c, h = G.topdown(k, 512)
        Image.fromarray((np.clip(c, 0, 1) * 255).astype(np.uint8), "RGB").save(f"{OUT}/topdown/{k}_albedo.png")
        Image.fromarray((np.clip(h / 0.2, 0, 1) * 255).astype(np.uint8), "L").save(f"{OUT}/topdown/{k}_height.png")
    for k, (n, fps) in WATER.items():
        strip = Image.new("RGB", (256 * 6, 256 * 4))
        for f in range(n):
            v = (np.arange(256) + 0.5) / 256 * G.TILE - G.TILE / 2
            z, x = np.meshgrid(v, v, indexing="ij")
            view = np.array([0.0, 1.0, 0.0])
            c, _ = G.layout(k, x, -z, f / n, view, G.KEY)
            strip.paste(Image.fromarray((np.clip(c, 0, 1) * 255).astype(np.uint8), "RGB"), ((f % 6) * 256, (f // 6) * 256))
        strip.save(f"{OUT}/topdown/{k}_topdown_anim.png")
    # previews
    bg = Image.new("RGBA", sheet.size, (70, 72, 70, 255)); bg.alpha_composite(sheet)
    bg.convert("RGB").save(f"{OUT}/ground_tiles_contact.png")
    # a 3x3 tiled demo in the game's SE view: roads around an intersection, walkway, sea and shore
    demo_frames = []
    for f in range(24):
        im = Image.new("RGBA", (F * 3, F * 2), (60, 62, 60, 255))
        for col, k in enumerate(["sea", "shore"]):
            im.alpha_composite(Image.open(f"{OUT}/frames/{k}_3_{f:02d}.png"), (col * F + 128, 0))
        for col, k in enumerate(["road", "intersection", "walkway"]):
            im.alpha_composite(Image.open(f"{OUT}/frames/{k}_3.png"), (col * F, F))
        demo_frames.append(im.convert("RGB"))
    pal = demo_frames[0].quantize(colors=255, method=Image.Quantize.MEDIANCUT)
    q = [d.quantize(palette=pal, dither=Image.Dither.NONE) for d in demo_frames]
    q[0].save(f"{OUT}/ground_preview.gif", save_all=True, append_images=q[1:], duration=125, loop=0, optimize=True)
    print("done")


if __name__ == "__main__":
    main()

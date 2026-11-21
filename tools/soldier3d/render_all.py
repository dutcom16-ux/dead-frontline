import os, sys, math, time
from multiprocessing import Pool
import numpy as np
from PIL import Image
import soldier3d as S, anims as A

DIRS = 16
OUT = "out/frames"

def dir_yaw(d):
    return 90.0 - 360.0 * d / DIRS

def job(args):
    name, d, i = args
    path = f"{OUT}/{name}/{d:02d}_{i:02d}.png"
    if os.path.exists(path):
        return path
    fn = {n: f for n, f, *_ in A.ANIMS}[name]
    P, fx = fn()[i]
    J = S.resolve(P)
    rgba, depth = S.render(J, dir_yaw(d), fx)
    if fx.get("flash"):
        rgba = S.draw_flash(rgba, depth, J, dir_yaw(d), fx["flash"])
    out = S.downsample(rgba)
    Image.fromarray((np.clip(out, 0, 1) * 255 + 0.5).astype(np.uint8), "RGBA").save(path)
    return path

if __name__ == "__main__":
    jobs = []
    for name, fn, fps, loop in A.ANIMS:
        os.makedirs(f"{OUT}/{name}", exist_ok=True)
        n = len(fn())
        jobs += [(name, d, i) for d in range(DIRS) for i in range(n)]
    t0 = time.time()
    with Pool(2) as pool:
        for k, _ in enumerate(pool.imap_unordered(job, jobs, chunksize=4)):
            if k % 40 == 0:
                print(f"{k}/{len(jobs)} {time.time()-t0:.0f}s", flush=True)
    print("done", len(jobs), f"{time.time()-t0:.0f}s")

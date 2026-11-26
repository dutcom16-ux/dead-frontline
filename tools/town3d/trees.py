"""Trees for Toledo: coconut palm, mango tree, banana plant. build(kind, phase) gives the tree with
the wind at `phase` (0..1 over one loop): the palm's trunk bends and its fronds flutter, the mango's
canopy sways in clumps, the banana's big leaves flap."""
import math

import numpy as np

from bsdf import Prim, Scene, eul, nrm
from townhouse import MAT, Builder, shade   # noqa: F401  (shared materials and shading)

MAT.update({
    "trunk_palm": ((0.55, 0.50, 0.42), 0.04, "rings"),
    "frond":      ((0.36, 0.56, 0.20), 0.10, "frond"),
    "frond_dead": ((0.58, 0.45, 0.26), 0.04, "frond"),
    "coconut":    ((0.40, 0.48, 0.16), 0.20, "plain"),
    "bark":       ((0.36, 0.29, 0.23), 0.03, "bark"),
    "canopy":     ((0.19, 0.38, 0.14), 0.08, "foliage"),
    "canopy_lt":  ((0.30, 0.50, 0.17), 0.08, "foliage"),
    "banana_leaf": ((0.36, 0.57, 0.21), 0.12, "broadleaf"),
    "banana_stem": ((0.46, 0.56, 0.26), 0.06, "rings"),
    "dirt":       ((0.42, 0.34, 0.25), 0.02, "concrete"),
})


def sway(phase, k=0.0):
    return math.sin(2 * math.pi * phase + k)


def frond(B, g, base, az, elev, length, droop, width, mat, rng, flutter, segs=8, fold=24, paddle=False):
    """a feather frond: a rachis curving out and down, with a V-folded blade of leaflets"""
    d = np.array([math.cos(az) * math.cos(elev), math.sin(elev), math.sin(az) * math.cos(elev)])
    p = np.array(base, float)
    seg = length / segs
    side = nrm(np.cross(d, [0, 1.0, 0]))
    for s in range(segs):
        f = (s + 0.5) / segs
        # bend down by droop (rad per metre), more toward the tip; flutter rocks it up/down and sideways
        ang = droop * seg * (0.5 + 1.1 * f) - flutter * 0.03
        dn = np.array([0, -1.0, 0]) - d * (-d[1])
        if np.linalg.norm(dn) > 1e-6:
            d = nrm(d * math.cos(ang) + nrm(dn) * math.sin(ang))
        d = nrm(d + side * flutter * 0.03)
        q = p + d * seg
        B.rod(g, mat, p, q, 0.045 * (1 - 0.6 * f) + 0.012)
        if paddle:                                                                      # banana: broad, rounded tip
            w = width * min(1.0, 4 * f) * min(1.0, 2.6 * (1 - f) + 0.25)
        else:
            w = width * math.sin(math.pi * min(1.0, (f + 0.15) / 1.0)) * (1.0 if f > 0.08 else 0.3)
        if w > 0.05:
            mid = (p + q) / 2
            fwd = nrm(q - p)
            sd = nrm(np.cross(fwd, [0, 1.0, 0]))
            up = np.cross(sd, fwd)
            for sgn in (-1, 1):
                a = math.radians(fold + 14 * f) * sgn
                bdir = nrm(sd * math.cos(a) * sgn - up * math.sin(abs(a)) * 0.9)   # blades fold down in a V
                c = mid + bdir * (w / 2) * 1.0
                R = np.stack([fwd, nrm(np.cross(bdir, fwd)), bdir], axis=1)
                if np.linalg.det(R) < 0:
                    R[:, 1] *= -1
                B.rbox(g, mat, c, np.array([seg * 0.55, 0.012, w / 2]), R)
        p = q
    return p


def palm(phase):
    B = Builder(seed=41)
    rng = B.rng
    H = 10.0
    lean = np.array([1.1, 0, 0.35])
    bend = 0.35 * sway(phase)
    pts = []
    for k in range(10):
        f = k / 9
        off = lean * f ** 1.6 + np.array([bend, 0, bend * 0.3]) * f ** 2
        pts.append(np.array([0, H * f, 0]) + off)
    for k in range(9):
        r1 = 0.24 - 0.09 * k / 9 + (0.08 if k == 0 else 0)
        B.p.append(Prim("rcone", "trunk_palm", "trunk", a=pts[k], b=pts[k + 1], r1=r1, r2=0.24 - 0.09 * (k + 1) / 9))
    top = pts[-1]
    B.ell("crown", "frond_dead", top + np.array([0, 0.1, 0]), (0.32, 0.4, 0.32))
    for j in range(7):                                                                  # coconuts
        a = j / 7 * 2 * math.pi
        B.ell("crown", "coconut", top + np.array([math.cos(a) * 0.32, -0.2 - 0.12 * (j % 2), math.sin(a) * 0.32]), (0.15, 0.17, 0.15))
    n = 14
    for k in range(n):
        az = k / n * 2 * math.pi + 0.2 * math.sin(k * 2.3)
        elev = math.radians(25 + 30 * ((k * 7) % 3) / 2)
        fl = sway(phase, k * 1.7)
        frond(B, f"fr{k % 5}", top + np.array([0, 0.25, 0]), az + 0.04 * fl, elev, 4.3 + 0.4 * ((k * 3) % 4) / 3,
              0.30 + 0.06 * (k % 3), 0.85, "frond", rng, fl)
    for k, az in enumerate((0.8, 3.7)):                                                 # dead fronds hanging
        frond(B, "dead", top + np.array([0, -0.1, 0]), az, math.radians(-55), 2.8, 0.05, 0.5, "frond_dead", rng, 0.3 * sway(phase, k))
    return Scene(B.p)


def mango(phase):
    B = Builder(seed=43)
    rng = B.rng
    B.p.append(Prim("rcone", "bark", "trunk", a=(0, 0, 0), b=(0.1, 2.6, 0.05), r1=0.42, r2=0.3))
    limbs = []
    for k in range(4):
        a = k / 4 * 2 * math.pi + 0.4
        tip = np.array([math.cos(a) * 2.4, 5.4 + 0.5 * (k % 2), math.sin(a) * 2.4])
        B.p.append(Prim("rcone", "bark", "trunk", a=(0.1, 2.5, 0.05), b=tip, r1=0.26, r2=0.12))
        limbs.append(tip)
    # canopy: a dark core and many leaf clumps over a dome, swaying by height
    s = sway(phase)
    B.ell("core", "canopy", (0.28 * s * 0.4, 6.4, 0), (4.2, 2.3, 4.2))
    for k in range(95):
        u = rng.uniform(0, 2 * math.pi)
        v = rng.uniform(0.0, 1.0)
        r = 4.9 * math.sqrt(v)
        y = 6.0 + 2.5 * math.sqrt(max(0, 1 - (r / 5.3) ** 2)) + rng.uniform(-0.5, 0.5)
        if v > 0.75:
            y -= rng.uniform(0.3, 1.4)                                                 # the rim hangs lower
        c = np.array([math.cos(u) * r, y, math.sin(u) * r])
        dy = (y - 4.0) / 5.0
        c = c + np.array([0.28 * s * dy + 0.09 * sway(phase, k), 0.03 * sway(phase, k * 1.9), 0.1 * sway(phase, k * 0.7) * dy])
        rad = rng.uniform(0.75, 1.25)
        B.ell(f"cl{k % 8}", "canopy" if k % 3 else "canopy_lt", c, (rad, rad * 0.75, rad), R=eul(0, rng.uniform(0, 180), 0))
    return Scene(B.p)


def banana(phase):
    B = Builder(seed=47)
    rng = B.rng
    stems = [((0, 0, 0), 2.9), ((0.7, 0, 0.35), 2.2), ((-0.45, 0, 0.55), 1.6)]
    for si, (b, h) in enumerate(stems):
        b = np.array(b, float)
        top = b + np.array([0.05 * sway(phase, si), h, 0])
        B.p.append(Prim("rcone", "banana_stem", "stems", a=b, b=top, r1=0.16 * h / 2.9 + 0.04, r2=0.1 * h / 2.9 + 0.03))
        nl = 7 if si == 0 else 5
        for k in range(nl):
            az = k / nl * 2 * math.pi + si
            elev = math.radians(68 - 10 * (k % 3))
            fl = sway(phase, k * 1.3 + si)
            frond(B, f"lv{si}{k % 2}", top, az + 0.06 * fl, elev, 2.3 * h / 2.9 + 0.4, 0.5, 0.95, "banana_leaf", rng,
                  1.5 * fl, segs=6, fold=5, paddle=True)
        if si == 0:                                                                      # a dry leaf hanging down
            frond(B, "dead", top + np.array([0, -0.3, 0]), 2.5, math.radians(-60), 1.6, 0.04, 0.45, "frond_dead", rng, 0.4, segs=4, fold=6)
    return Scene(B.p)


KINDS = {"coconut_palm": palm, "mango_tree": mango, "banana_plant": banana}
INFO = {
    "coconut_palm": {"height_m": 11.5, "crown_m": 9.0},
    "mango_tree": {"height_m": 9.0, "crown_m": 10.5},
    "banana_plant": {"height_m": 4.3, "crown_m": 4.5},
}

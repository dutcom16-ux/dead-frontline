"""Toledo church: a Spanish-colonial Filipino stone church (generic, not a copy of a real one).

Building space: x = width, y = up, z = length, +z = the facade and plaza. Coral-stone masonry nave
(11 x 22 m) with buttresses and arched stained-glass windows under a clay-tile gable roof, a
half-domed apse at the back, a baroque facade (pilasters, cornices, arched wooden doors, niches with
statues, an oculus, a curved pediment with volutes and an iron cross) and a three-tier bell tower
with bells, pinnacles and a dome on the left of the facade. A cobbled plaza with steps in front.

States: 0 intact; 1 damaged (roof holed down to the rafters, windows broken, soot, the tower top
hit, the doors smashed in, a sandbag and barbed-wire barricade on the steps, debris);
2 destroyed (roof burnt away with fallen beams, walls broken down to jagged stonework, the facade
standing without its pediment, the tower fallen to its first tier with a bell in the rubble).
"""
import math

import numpy as np

from bsdf import Prim, Scene, eul
from townhouse import MAT, Builder, shade   # noqa: F401

MAT.update({
    "stone":      ((0.80, 0.74, 0.62), 0.03, "masonry"),
    "stone_dark": ((0.67, 0.61, 0.51), 0.03, "masonry"),
    "tisa":       ((0.66, 0.33, 0.22), 0.06, "tiles"),
    "churchdoor": ((0.36, 0.22, 0.12), 0.08, "door"),
    "stained":    ((0.50, 0.50, 0.50), 0.50, "stained"),
    "bronze":     ((0.56, 0.42, 0.22), 0.60, "metal"),
    "whitewash":  ((0.92, 0.91, 0.87), 0.04, "plaster"),
    "iron":       ((0.12, 0.12, 0.13), 0.40, "metal"),
    "cobble":     ((0.64, 0.62, 0.58), 0.02, "cobble"),
    "beam_burnt": ((0.13, 0.10, 0.08), 0.02, "wood"),
})

NX = 5.5                  # nave half width
NZ0, NZ1 = -12.0, 10.0    # nave back and front
WALL = 8.5
PITCH = math.radians(30)
RIDGE = WALL + NX * math.tan(PITCH)
FZ0, FZ1 = 10.0, 11.2     # facade
TX0, TX1, TZ0, TZ1 = -10.5, -5.5, 6.2, 11.2   # tower base


def arch(B, g, mat, axis, face, u, w, y0, spring, depth, out_sign, fill=None, inset=0.12):
    """an arched opening (sub) on a wall face, optionally filled (glass, door) a little inside.
    axis 'z': wall facing +-z (u along x); 'x': wall facing +-x (u along z)"""
    r = w / 2
    lo, hi = (face - depth, face + 0.3) if out_sign > 0 else (face - 0.3, face + depth)
    if axis == "z":
        B.box(g, mat, u - r, u + r, y0, spring, lo, hi, sub=True)
        B.cyl(g, mat, (u, spring, (lo + hi) / 2), r, (hi - lo) / 2, R=eul(90, 0, 0))
        B.p[-1].sub = True
    else:
        B.box(g, mat, lo, hi, y0, spring, u - r, u + r, sub=True)
        B.cyl(g, mat, ((lo + hi) / 2, spring, u), r, (hi - lo) / 2, R=eul(0, 0, 90))
        B.p[-1].sub = True
    if fill:
        f0 = face - out_sign * inset
        f1 = f0 - out_sign * 0.05
        a, b = min(f0, f1), max(f0, f1)
        if axis == "z":
            B.box(g, fill, u - r, u + r, y0, spring, a, b)
            B.cyl(g, fill, (u, spring, (a + b) / 2), r, (b - a) / 2, R=eul(90, 0, 0))
        else:
            B.box(g, fill, a, b, y0, spring, u - r, u + r)
            B.cyl(g, fill, ((a + b) / 2, spring, u), r, (b - a) / 2, R=eul(0, 0, 90))


def ruined(B, rng, g, mat, axis, face, u0, u1, t, lo, hi, inward):
    u = u0
    while u < u1 - 1e-6:
        w = min(u1 - u, rng.uniform(0.6, 1.6))
        top = rng.uniform(lo, hi)
        a, b = (face, face + t) if inward > 0 else (face - t, face)
        if axis == "z":
            B.box(g, mat, u, u + w, 0.1, top, a, b)
        else:
            B.box(g, mat, a, b, 0.1, top, u, u + w)
        u += w


def build(state=0):
    B = Builder(seed=61 + state)
    rng = B.rng
    fires = []
    ruin = state == 2
    # ------------------------------------------------------------ ground: plinth and plaza
    B.box("ground", "stone_dark", TX0 - 0.3, TX1, 0.0, 0.12, TZ0 - 0.3, FZ1)            # tower footing
    B.box("ground", "cobble", TX0 - 0.3, NX + 1.6, 0.0, 0.12, FZ1, 14.8)
    for k in range(3):                                                                   # steps to the doors
        B.box("ground", "stone", -3.4 + 0.25 * k, 3.4 - 0.25 * k, 0.12, 0.27 + 0.15 * k, FZ1, FZ1 + 1.2 - 0.38 * k)
    if not ruin:
        # -------------------------------------------------------- nave, buttresses, windows
        B.box("nave", "stone", -NX, NX, 0.1, WALL, NZ0, FZ0 + 0.2)
        B.box("nave", "stone_dark", -NX - 0.3, NX + 0.3, WALL - 0.3, WALL, NZ0 - 0.3, FZ0)
        for z in (-12.0, -7.0, -2.0, 3.0, 8.0):
            for s in (-1, 1):
                x0, x1 = sorted((s * NX, s * (NX + 1.0)))
                n = (s * math.sin(math.radians(35)), math.cos(math.radians(35)), 0)
                o = 6.4 * math.cos(math.radians(35)) + NX * math.sin(math.radians(35))
                B.box("butt", "stone_dark", x0, x1, 0.1, 6.8, z - 0.45, z + 0.45, cuts=[(n, o)])
        broken = {(-1, 1), (1, 2), (1, 0)} if state == 1 else set()
        for k, z in enumerate((-9.5, -4.5, 0.5, 5.5)):
            for s in (-1, 1):
                fill = "interior" if (s, k) in broken else "stained"
                arch(B, f"win{k}", "stone", "x", s * NX, z, 1.4, 3.4, 6.0, 0.6, s, fill=fill)
                if (s, k) in broken and s == 1:
                    fires.append((np.array([s * NX, 7.0, z]), np.array([s * 1.0, 0, 0]), 0.6))
        # -------------------------------------------------------- roof (clay tiles), back gable, apse
        ov, t = 0.6, 0.12
        half = (NX + ov) / math.cos(PITCH) / 2
        zs0, zs1 = NZ0 - 0.3, FZ0 + 0.1
        cutL = [((math.sin(PITCH), math.cos(PITCH), 0), RIDGE * math.cos(PITCH)),
                ((-math.sin(PITCH), math.cos(PITCH), 0), RIDGE * math.cos(PITCH))]
        B.box("roof", "stone", -NX, NX, WALL - 0.01, RIDGE, NZ0, NZ0 + 0.5, cuts=cutL)
        holes = [(1, 0.45, -6.0, 2.2), (-1, 0.6, 2.0, 1.8), (1, 0.7, 6.0, 1.4)] if state == 1 else []
        for s in (-1, 1):
            cx = s * (NX + ov) / 2
            cy = RIDGE - (NX + ov) / 2 * math.tan(PITCH) + t / 2 / math.cos(PITCH)
            R = eul(0, 0, -s * math.degrees(PITCH))
            B.rbox("roof", "tisa", np.array([cx, cy, (zs0 + zs1) / 2]), np.array([half, t / 2, (zs1 - zs0) / 2]), R, axis=2)
            for (hs, along, hz, hl) in holes:
                if hs == s:
                    c = np.array([cx, cy, 0]) + R @ np.array([(along - 0.5) * 2 * half, 0, 0])
                    c[2] = hz
                    B.rbox("roof", "tisa", c, np.array([1.1, 0.5, hl / 2]), R, sub=True)
        B.rod("roof", "stone_dark", (0, RIDGE + 0.08, zs0), (0, RIDGE + 0.08, zs1), 0.14)
        B.box("roof", "interior", -NX + 0.2, NX - 0.2, WALL - 0.05, WALL + 0.01, NZ0 + 0.2, FZ0 - 0.1)
        if state == 1:
            for s in (-1, 1):
                for z in np.arange(-11, 10, 1.4):
                    B.rod("rafters", "beam_burnt", (0, RIDGE - 0.15, z), (s * (NX - 0.1), WALL + 0.05, z), 0.07)
        B.cyl("apse", "stone", (0, (WALL - 0.6) / 2 + 0.1, NZ0), NX - 0.4, (WALL - 0.6) / 2, cuts=[((0, 0, 1.0), 0.0)])
        B.ell("apse", "tisa", (0, WALL - 0.6, NZ0), (NX + 0.1, 2.6, NX + 0.1), cuts=[((0, 0, 1.0), 0.0), ((0, -1.0, 0), 0.0)])
        B.p[-1].axis = 0
        # -------------------------------------------------------- facade
        B.box("facade", "stone", -7.0, 7.0, 0.1, 12.0, FZ0, FZ1)
        for (y0, y1) in ((4.6, 4.95), (11.7, 12.15)):
            B.box("facade", "stone_dark", -7.25, 7.25, y0, y1, FZ0, FZ1 + 0.3)
        for x in (-6.5, -2.4, 2.4, 6.5):
            B.box("facade", "stone_dark", x - 0.32, x + 0.32, 0.1, 11.7, FZ1 - 0.1, FZ1 + 0.22)
        ped = [((math.sin(math.radians(32)), math.cos(math.radians(32)), 0), 15.6 * math.cos(math.radians(32))),
               ((-math.sin(math.radians(32)), math.cos(math.radians(32)), 0), 15.6 * math.cos(math.radians(32)))]
        B.box("facade", "stone", -4.8, 4.8, 12.0, 15.6, FZ0 + 0.2, FZ1 - 0.1, cuts=ped)
        for s in (-1, 1):                                                                # volutes
            B.cyl("facade", "stone_dark", (s * 4.6, 12.65, FZ1 - 0.4), 0.6, 0.35, R=eul(90, 0, 0))
            B.p.append(Prim("rcone", "stone_dark", "facade", a=(s * 6.5, 12.15, FZ1 - 0.2), b=(s * 6.5, 13.1, FZ1 - 0.2), r1=0.28, r2=0.05))
        # doors
        if state == 0:
            arch(B, "doors", "stone", "z", FZ1, 0.0, 2.8, 0.27, 4.0, 0.9, 1, fill="churchdoor", inset=0.35)
        else:
            arch(B, "doors", "stone", "z", FZ1, 0.0, 2.8, 0.27, 4.0, 0.9, 1, fill="interior", inset=0.6)
            B.rbox("doors", "churchdoor", np.array([0.9, 1.9, FZ1 + 0.4]), np.array([0.7, 1.7, 0.06]), eul(0, 55, 0))
        for x in (-4.45, 4.45):
            arch(B, "doors", "stone", "z", FZ1, x, 1.2, 2.0, 3.6, 0.5, 1, fill="stained" if state == 0 else "interior")
            arch(B, "niche", "stone", "z", FZ1, x, 1.0, 6.0, 7.6, 0.45, 1)
            B.ell("niche", "whitewash", (x, 6.9, FZ1 - 0.25), (0.26, 0.75, 0.2))
            B.ell("niche", "whitewash", (x, 7.75, FZ1 - 0.25), (0.14, 0.15, 0.14))
        B.cyl("oculus", "stone", (0, 8.4, FZ1), 1.0, 0.4, R=eul(90, 0, 0))
        B.p[-1].sub = True
        B.cyl("oculus", "stained" if state == 0 else "interior", (0, 8.4, FZ1 - 0.3), 1.0, 0.04, R=eul(90, 0, 0))
        B.cyl("oculus", "stone_dark", (0, 8.4, FZ1 + 0.02), 1.15, 0.03, R=eul(90, 0, 0))
        B.p[-1].sub = False
        B.cyl("oculus", "stone", (0, 8.4, FZ1 + 0.05), 1.0, 0.1, R=eul(90, 0, 0))
        B.p[-1].sub = True
        tilt = (0, 0, 14) if state == 1 else (0, 0, 0)
        R = eul(*tilt)
        B.rbox("cross", "iron", np.array([0, 16.5, FZ1 - 0.5]), np.array([0.07, 0.9, 0.07]), R)
        B.rbox("cross", "iron", np.array([0, 16.85, FZ1 - 0.5]) + R @ np.array([0, 0, 0]), np.array([0.45, 0.07, 0.07]), R)
        # -------------------------------------------------------- bell tower
        B.box("tower1", "stone", TX0, TX1, 0.1, 9.0, TZ0, TZ1)
        B.box("tower1", "stone_dark", TX0 - 0.25, TX1 + 0.25, 8.7, 9.3, TZ0 - 0.25, TZ1 + 0.25)
        arch(B, "tower1", "stone", "z", TZ1, -8.0, 1.0, 5.2, 6.4, 0.4, 1, fill="stained" if state == 0 else "interior")
        B.box("tower2", "stone", TX0 + 0.3, TX1 - 0.3, 9.3, 13.6, TZ0 + 0.3, TZ1 - 0.3)
        B.box("tower2", "interior", TX0 + 0.75, TX1 - 0.75, 9.8, 12.9, TZ0 + 0.75, TZ1 - 0.75)
        cx, cz = (TX0 + TX1) / 2, (TZ0 + TZ1) / 2
        for (ax, face, u, s) in (("z", TZ1 - 0.3, cx, 1), ("z", TZ0 + 0.3, cx, -1), ("x", TX1 - 0.3, cz, 1), ("x", TX0 + 0.3, cz, -1)):
            arch(B, "tower2", "stone", ax, face, u, 1.7, 9.9, 11.9, 0.9, s)
        B.ell("tower2", "bronze", (cx, 11.4, cz), (0.62, 0.72, 0.62), cuts=[((0, -1.0, 0), 0.55)])
        B.box("tower2", "stone_dark", TX0 + 0.05, TX1 - 0.05, 13.5, 13.9, TZ0 + 0.05, TZ1 - 0.05)
        top_cut = [((0.7, 0.7, 0.0), 0.0)] if state == 1 else []
        B.box("tower3", "stone", TX0 + 0.7, TX1 - 0.7, 13.9, 16.6, TZ0 + 0.7, TZ1 - 0.7)
        B.box("tower3", "interior", TX0 + 1.0, TX1 - 1.0, 14.1, 16.3, TZ0 + 1.0, TZ1 - 1.0)
        for (ax, face, u, s) in (("z", TZ1 - 0.7, cx, 1), ("z", TZ0 + 0.7, cx, -1), ("x", TX1 - 0.7, cz, 1), ("x", TX0 + 0.7, cz, -1)):
            arch(B, "tower3", "stone", ax, face, u, 1.0, 14.3, 15.6, 0.5, s)
        B.box("tower3", "stone_dark", TX0 + 0.55, TX1 - 0.55, 16.5, 16.8, TZ0 + 0.55, TZ1 - 0.55)
        B.ell("tower3", "stone_dark", (cx, 16.8, cz), (1.75, 1.6, 1.75), cuts=[((0, -1.0, 0), 0.0)])
        B.cyl("tower3", "stone", (cx, 18.7, cz), 0.32, 0.4)
        B.box("tower3", "iron", cx - 0.06, cx + 0.06, 19.1, 20.6, cz - 0.06, cz + 0.06)
        B.box("tower3", "iron", cx - 0.38, cx + 0.38, 20.0, 20.12, cz - 0.06, cz + 0.06)
        for x in (TX0 + 0.45, TX1 - 0.45):                                               # pinnacles
            for z in (TZ0 + 0.45, TZ1 - 0.45):
                B.p.append(Prim("rcone", "stone_dark", "tower3", a=(x, 13.9, z), b=(x, 15.0, z), r1=0.22, r2=0.03))
        if state == 1:                                                                   # a shell took a corner off
            B.box("tower3", "stone", TX1 - 1.6, TX1 + 0.2, 15.2, 17.8, TZ1 - 1.8, TZ1 + 0.2, sub=True)
            B.box("tower2", "stone", TX0 - 0.2, TX0 + 1.0, 12.6, 13.95, TZ1 - 1.4, TZ1 + 0.2, sub=True)
        # -------------------------------------------------------- damaged: barricade, debris
        if state == 1:
            for k in range(11):                                                          # sandbag arc on the steps
                a = math.radians(-70 + k * 14)
                for r in range(2):
                    B.ell("barricade", "sandbag", (3.0 * math.sin(a), 0.42 + r * 0.27, FZ1 + 0.4 + 2.2 * math.cos(a)),
                          (0.3, 0.15, 0.22), R=eul(0, math.degrees(a) + 90, 0))
            for k in range(4):                                                           # barbed wire coil
                z = FZ1 + 3.2
                B.rod("barricade", "iron", (-3.4 + 1.7 * k, 0.5, z), (-1.7 + 1.7 * k, 0.5, z), 0.03)
                for j in range(5):
                    xx = -3.4 + 1.7 * k + j * 0.34
                    B.rod("barricade", "iron", (xx, 0.12, z - 0.25), (xx + 0.2, 0.75, z + 0.25), 0.012)
            for _ in range(40):
                x, z = rng.uniform(-10, 7), rng.uniform(-17, 14.5)
                if -NX - 0.2 < x < NX + 1.1 and NZ0 < z < FZ1:
                    continue
                s = rng.uniform(0.1, 0.35)
                B.rbox("debris", "stone" if rng.uniform() < 0.6 else "tisa", np.array([x, s * 0.5, z]), np.array([s, s * 0.5, s * 0.7]),
                       eul(rng.uniform(-30, 30), rng.uniform(0, 180), rng.uniform(-30, 30)), rr=0.03)
    else:
        destroyed(B, rng)
    sc = Scene(B.p)
    sc.wear = state
    sc.fires = fires
    return sc


def heap(B, rng, g, cx, cz, rx, rz, h, n, mats=("stone", "stone", "stone", "tisa", "stone_dark"), base=True):
    """a rubble heap: a low faceted mound with loose blocks lying on its surface"""
    def top(x, z):
        r2 = ((x - cx) / rx) ** 2 + ((z - cz) / rz) ** 2
        return 0.12 + h * max(0.0, 1 - r2) ** 0.8
    if base:
        B.ell(g, "rubble", (cx, 0.12, cz), (rx, h, rz))
    for _ in range(n):
        a, r = rng.uniform(0, 2 * math.pi), math.sqrt(rng.uniform(0, 1)) * 1.05
        x, z = cx + r * rx * math.cos(a), cz + r * rz * math.sin(a)
        s = rng.uniform(0.15, 0.5)
        B.rbox(g, mats[rng.integers(len(mats))], np.array([x, top(x, z) + s * 0.25, z]), np.array([s, s * 0.55, s * 0.8]),
               eul(rng.uniform(-35, 35), rng.uniform(0, 180), rng.uniform(-35, 35)), rr=0.04)


def destroyed(B, rng):
    B.box("ground", "stone_dark", -NX, NX, 0.0, 0.16, NZ0, FZ0)                         # nave floor
    B.cyl("ground", "stone_dark", (0, 0.08, NZ0), NX - 0.4, 0.08, cuts=[((0, 0, 1.0), 0.0)])
    B.box("ground", "stone_dark", TX0, TX1, 0.0, 0.16, TZ0, TZ1)
    # nave walls broken down to jagged stonework, buttresses standing in places
    ruined(B, rng, "walls", "stone", "x", -NX, NZ0, FZ0, 0.9, 2.0, 7.5, +1)
    ruined(B, rng, "walls", "stone", "x", NX, NZ0, FZ0, 0.9, 1.5, 6.5, -1)
    for z in (-12.0, -2.0, 8.0):
        for s in (-1, 1):
            x0, x1 = sorted((s * NX, s * (NX + 1.0)))
            B.box("walls", "stone_dark", x0, x1, 0.1, rng.uniform(3.0, 6.5), z - 0.45, z + 0.45)
    B.cyl("walls", "stone", (0, 1.6, NZ0), NX - 0.4, 1.5, cuts=[((0, 0, 1.0), 0.0)])
    B.box("walls", "stone", -4.0, 2.0, 0.1, 5.2, NZ0 - 0.8, NZ0)
    # facade still standing, the pediment gone, the doorway blown open
    B.box("facade", "stone", -7.0, 7.0, 0.1, 10.6, FZ0, FZ1)
    B.box("facade", "stone", -7.0, 1.5, 10.6, 11.8, FZ0, FZ1)
    B.box("facade", "stone", -2.0, 2.0, 0.27, 4.6, FZ0 - 0.3, FZ1 + 0.3, sub=True)
    B.cyl("facade", "stone", (0, 4.6, (FZ0 + FZ1) / 2), 2.0, 1.0, R=eul(90, 0, 0))
    B.p[-1].sub = True
    B.cyl("facade", "stone", (2.5, 9.4, FZ1), 1.6, 0.8, R=eul(90, 0, 0))
    B.p[-1].sub = True
    for x in (-6.5, -2.4):
        B.box("facade", "stone_dark", x - 0.32, x + 0.32, 0.1, 10.4, FZ1 - 0.1, FZ1 + 0.22)
    for x in (-4.45, 4.45):
        arch(B, "facade", "stone", "z", FZ1, x, 1.2, 2.0, 3.6, 0.5, 1, fill="interior")
    # tower: the first tier stands, the rest came down beside it
    B.box("tower", "stone", TX0, TX1, 0.1, 6.8, TZ0, TZ1)
    B.box("tower", "stone", TX0, -8.0, 6.8, 8.6, TZ0, TZ1)
    arch(B, "tower", "stone", "z", TZ1, -8.0, 1.0, 5.2, 6.4, 0.4, 1, fill="interior")
    # rubble: the fallen tower, the roof and the upper walls inside the nave, the pediment on the steps
    heap(B, rng, "heap_t", -12.0, 2.5, 2.4, 3.4, 1.3, 26)
    heap(B, rng, "heap_n1", -1.0, -6.5, 3.6, 4.6, 1.5, 30)
    heap(B, rng, "heap_n2", 1.0, 3.0, 3.4, 4.2, 1.2, 28)
    heap(B, rng, "heap_s", 2.4, 12.2, 2.4, 1.3, 0.55, 16, mats=("stone", "stone", "stone_dark"))
    heap(B, rng, "heap_w", 7.4, -4.0, 1.4, 4.0, 0.7, 18)
    B.ell("bell", "bronze", (-11.2, 1.25, 6.6), (0.62, 0.72, 0.62), R=eul(70, 30, 0), cuts=[((0, -1.0, 0), 0.55)])
    for _ in range(36):                                                                  # loose stones near the walls
        x, z = rng.uniform(-13.5, 7.5), rng.uniform(-14.5, 14.0)
        if -NX + 0.5 < x < NX - 0.5 and NZ0 < z < FZ0:
            continue
        if TX0 < x < TX1 and TZ0 < z < TZ1:
            continue
        s = rng.uniform(0.12, 0.35)
        B.rbox("chunks", "stone" if rng.uniform() < 0.75 else "tisa", np.array([x, s * 0.4, z]), np.array([s, s * 0.55, s * 0.8]),
               eul(rng.uniform(-15, 15), rng.uniform(0, 180), rng.uniform(-15, 15)), rr=0.03)
    for _ in range(9):                                                                   # burnt roof beams
        z = rng.uniform(-10, 8)
        x0 = rng.uniform(-5, -1)
        a = (x0, 1.6 + 0.4 * rng.uniform(), z)
        b = (x0 + rng.uniform(3, 6), rng.uniform(0.5, 3.5), z + rng.uniform(-2, 2))
        B.rod("beams", "beam_burnt", a, b, 0.11)
    B.rbox("beams", "beam_burnt", np.array([0.0, 5.9, -3.0]), np.array([5.6, 0.13, 0.13]), eul(0, 8, 6))


FOOTPRINT = {"nave": [11.0, 22.0], "with_tower_apse_plaza": [18.6, 32.4]}
HEIGHT = {"nave_walls": WALL, "ridge": round(RIDGE, 2), "facade": 15.6, "tower_cross": 20.6}
FRONT = "the facade and main doors"
PIVOT = "the middle of the nave floor (the bell tower stands to the left of the facade, the plaza in front)"

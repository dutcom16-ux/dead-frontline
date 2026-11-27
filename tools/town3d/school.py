"""Toledo school: a large three-storey public-school classroom building (generic Philippine design).

Building space: x = length (38 m), y = up, z = depth, +z = the open corridor side and the school
yard. Reinforced-concrete frame, cream walls with a green dado and green trim, twelve classrooms
(four a floor) opening onto a open corridor with a solid parapet, steel-grilled windows on the back,
jalousie windows and wooden doors on the corridor, ventilation-block stair bays at both ends, a
green corrugated hip roof, the school's sign on the parapet and a flagpole on the concrete yard.

States: 0 intact; 1 damaged (shot up, windows blown out with soot plumes, the roof holed and
peeled back to burnt rafters, shell holes in the back wall and a parapet, sandbagged firing
positions on the corridors, the flagpole bent, debris and roof sheets on the yard);
2 destroyed (the right part of the building has pancaked onto the ground floor, the left part
stands as a roofless burnt-out shell with broken top-floor walls; rubble, roof sheets and the
fallen flagpole on the yard).
"""
import math

import numpy as np

from bsdf import Prim, Scene, eul
from townhouse import MAT, Builder, shade   # noqa: F401

MAT.update({
    "roof_green": ((0.24, 0.45, 0.31), 0.22, "roof"),
    "breeze":     ((0.86, 0.82, 0.72), 0.03, "breeze"),
    "dado":       ((0.47, 0.61, 0.49), 0.04, "plaster"),
    "trim_g":     ((0.16, 0.36, 0.24), 0.25, "plain"),
    "flag_b":     ((0.05, 0.22, 0.62), 0.05, "plain"),
    "flag_r":     ((0.80, 0.10, 0.14), 0.05, "plain"),
    "flag_w":     ((0.95, 0.95, 0.93), 0.05, "plain"),
    "flag_y":     ((0.98, 0.80, 0.15), 0.05, "plain"),
    "beam_burnt": ((0.13, 0.10, 0.08), 0.02, "wood"),
})

HX = 19.0                      # half length
ZB, ZW, ZC = -4.7, 2.3, 4.7    # back wall, classroom front wall, corridor edge
LV = [0.0, 3.4, 6.8, 10.2]
RL = LV[-1]
ROOMS = [(-15.5, -7.75), (-7.75, 0.0), (0.0, 7.75), (7.75, 15.5)]
COLX = [-18.8, -15.5, -11.6, -7.75, -3.9, 0.0, 3.9, 7.75, 11.6, 15.5, 18.8]
PITCH = math.radians(22)


def floor_y(f):
    return 0.3 if f == 0 else LV[f]


def win(B, g, axis, face, out, u0, u1, y0, y1, fill, depth=0.12):
    """recess an opening into a wall face and put the fill (glass, door, darkness) at its back.
    axis 'z': wall facing +-z (u along x); out = +1 if the face looks toward +axis"""
    a, b = (face - depth, face + 0.3) if out > 0 else (face - 0.3, face + depth)
    f0 = face - out * depth
    fa, fb = sorted((f0 - out * 0.02, f0 + out * 0.04))                                  # proud of the recess back
    if axis == "z":
        B.box(g, "cream", u0, u1, y0, y1, a, b, sub=True)
        B.box(g, fill, u0, u1, y0, y1, fa, fb)
    else:
        B.box(g, "cream", a, b, y0, y1, u0, u1, sub=True)
        B.box(g, fill, fa, fb, y0, y1, u0, u1)


def yard(B):
    k = 1 / math.sqrt(2)
    cut = [((k, 0, k), 25.0 * k), ((-k, 0, k), 25.0 * k)]                                  # front corners cut off
    B.box("yard", "concrete", -HX - 1.0, HX + 1.0, 0.0, 0.12, ZB - 1.0, 11.0, cuts=cut)
    B.box("yard", "base", -HX - 1.0, HX + 1.0, 0.0, 0.16, 10.85, 11.0, cuts=cut)
    B.box("slab0", "frame", -HX, HX, 0.0, 0.3, ZB, ZC)


def flagpole(B, state):
    B.box("flag", "frame", -1.1, 1.1, 0.12, 0.35, 7.4, 9.6)
    B.box("flag", "frame", -0.7, 0.7, 0.35, 0.58, 7.8, 9.2)
    if state == 0:
        R, top = np.eye(3), np.array([0.0, 9.2, 8.5])
    else:
        R = eul(0, 0, -12)
        top = np.array([0.0, 0.58, 8.5]) + R @ np.array([0, 8.6, 0])
    if state == 2:                                                                       # fallen across the yard
        B.rod("flag", "silver", (0.2, 0.25, 8.6), (7.8, 0.2, 9.6), 0.07)
        B.rbox("flag", "flag_b", np.array([7.0, 0.16, 10.1]), np.array([0.8, 0.02, 0.25]), eul(0, -8, 0))
        B.rbox("flag", "flag_r", np.array([7.1, 0.15, 10.55]), np.array([0.8, 0.02, 0.22]), eul(0, -8, 0))
        return
    B.rod("flag", "silver", (0, 0.58, 8.5), tuple(top), 0.06)
    B.ell("flag", "silver", tuple(top + R @ np.array([0, 0.1, 0])), (0.1, 0.1, 0.1))
    L = 1.8 if state == 0 else 1.1                                                       # torn when damaged
    c = top + R @ np.array([0.07 + L / 2, -0.5, 0.0])
    B.rbox("flag", "flag_b", c + R @ np.array([0, 0.225, 0]), np.array([L / 2, 0.225, 0.015]), R)
    B.rbox("flag", "flag_r", c + R @ np.array([0, -0.225, 0]), np.array([L / 2, 0.225, 0.015]), R)
    hx0 = top + R @ np.array([0.07, -0.5, 0])                                            # the hoist, mid height
    k = 1 / math.hypot(0.45, 0.78)                                                       # white triangle at the hoist
    B.p.append(Prim("box", "flag_w", "flag", c=hx0 + R @ np.array([0.4, 0, 0]), h=np.array([0.42, 0.46, 0.025]), R=R,
                    cuts=[(np.array([0.45 * k, 0.78 * k, 0]), 0.19), (np.array([0.45 * k, -0.78 * k, 0]), 0.19)]))
    B.ell("flag", "flag_y", tuple(hx0 + R @ np.array([0.27, 0, -0.03])), (0.09, 0.09, 0.02))


def roof(B, state):
    """green corrugated hip roof, built as four planes so the corrugations run down every slope"""
    Lx, Lz, t = HX + 0.8, -ZB + 0.8, math.tan(PITCH)
    Ye = RL + 0.2
    cp, sp = math.cos(PITCH), math.sin(PITCH)
    planes = [((0, cp, sp), (Ye + Lz * t) * cp), ((0, cp, -sp), (Ye + Lz * t) * cp),
              ((sp, cp, 0), (Ye + Lx * t) * cp), ((-sp, cp, 0), (Ye + Lx * t) * cp)]
    r2 = 1 / math.sqrt(2)
    splits = {"+z": [((r2, 0, -r2), (Lx - Lz) * r2), ((-r2, 0, -r2), (Lx - Lz) * r2)],
              "-z": [((r2, 0, r2), (Lx - Lz) * r2), ((-r2, 0, r2), (Lx - Lz) * r2)],
              "+x": [((-r2, 0, r2), (Lz - Lx) * r2), ((-r2, 0, -r2), (Lz - Lx) * r2)],
              "-x": [((r2, 0, r2), (Lz - Lx) * r2), ((r2, 0, -r2), (Lz - Lx) * r2)]}
    for k, cuts in splits.items():
        B.box("roof", "roof_green", -Lx, Lx, RL - 0.12, Ye + Lz * t + 0.1, -Lz, Lz, cuts=planes + cuts)
        B.p[-1].axis = 0 if k in ("+z", "-z") else 2
    ry = Ye + Lz * t + 0.02
    B.rod("roof", "ridge", (-(Lx - Lz), ry, 0), (Lx - Lz, ry, 0), 0.1)
    for sx in (-1, 1):
        for sz in (-1, 1):
            B.rod("roof", "ridge", (sx * (Lx - Lz), ry, 0), (sx * Lx, Ye + 0.03, sz * Lz), 0.08)
    B.box("roof", "trim_g", -Lx, Lx, RL - 0.12, RL + 0.2, Lz - 0.06, Lz)                # fascia boards
    B.box("roof", "trim_g", -Lx, Lx, RL - 0.12, RL + 0.2, -Lz, -Lz + 0.06)
    if state == 1:
        holes = [(-12.5, -9.8, 1.0, 5.4), (4.0, 6.6, -5.4, -1.2), (10.6, 12.0, 0.6, 3.8)]
        for (x0, x1, z0, z1) in holes:
            B.box("roof", "roof_green", x0, x1, RL + 0.05, 14.0, z0, z1, sub=True)
            for x in np.arange(x0 + 0.35, x1, 0.9):
                s = 1 if z0 + z1 > 0 else -1
                B.rod("rafters", "beam_burnt", (x, ry - 0.2, 0.0), (x, Ye - 0.05, s * Lz), 0.07)
        B.rbox("roof", "roof_green", np.array([-11.1, Ye + 2.3, 0.5]), np.array([1.25, 0.03, 0.8]), eul(-55, 8, 0), axis=0)
        B.rbox("roof", "roof_green", np.array([5.3, Ye + 2.2, -0.6]), np.array([1.1, 0.03, 0.75]), eul(55, -10, 0), axis=0)


def storey(B, rng, f, x0, x1, state, broken):
    """walls of one floor between x0 and x1: back wall with grilled windows, classroom fronts with
    doors and jalousies, the corridor parapet; broken = probability a window is blown out"""
    y0, y1 = floor_y(f), LV[f + 1] - 0.2
    g = f"s{f}_{int(x0)}"
    B.box(g, "cream", x0, x1, y0, y1, ZB, ZB + 0.2)
    B.box(g, "cream", x0, x1, y0, y1, ZW - 0.2, ZW)
    B.box(g, "dado", x0, x1, y0, y0 + 1.0, ZW, ZW + 0.015)
    for (r0, r1) in ROOMS:
        if r1 <= x0 or r0 >= x1:
            continue
        gw = f"w{f}_{int(r0)}"
        for (u0, u1) in ((r0 + 0.7, r0 + 3.6), (r1 - 3.6, r1 - 0.7)):
            u0, u1 = max(u0, x0 + 0.3), min(u1, x1 - 0.3)
            if u1 - u0 < 0.8:
                continue
            br = rng.uniform() < broken
            win(B, gw, "z", ZB, -1, u0, u1, y0 + 0.9, y0 + 2.6, "interior" if br else "glass_grille")
            if br and state == 1 and f > 0 and rng.uniform() < 0.6:
                B.fires.append((np.array([(u0 + u1) / 2, y0 + 2.6, ZB]), np.array([0, 0, -1.0]), 1.2))
        for (u0, u1) in ((r0 + 0.5, r0 + 1.45), (r1 - 1.45, r1 - 0.5)):
            if u0 < x0 or u1 > x1:
                continue
            win(B, gw, "z", ZW, 1, u0, u1, y0 + 0.02, y0 + 2.1, "interior" if (state and rng.uniform() < 0.5) else "door")
        br = rng.uniform() < broken
        u0, u1 = max(r0 + 2.0, x0 + 0.3), min(r1 - 2.0, x1 - 0.3)
        if u1 - u0 > 0.8:
            win(B, gw, "z", ZW, 1, u0, u1, y0 + 1.2, y0 + 2.6, "interior" if br else "jalousie")
    if f > 0:
        B.box(g, "cream", x0, x1, LV[f], LV[f] + 1.0, ZC - 0.15, ZC)                    # corridor parapet
        B.box(g, "frame", x0, x1, LV[f] + 1.0, LV[f] + 1.1, ZC - 0.2, ZC + 0.05)


def frame(B, rng, x0, x1, top_f=3, ends=(True, True)):
    for x in COLX:
        if x0 - 0.3 <= x <= x1 + 0.3:
            B.box("cols", "frame", x - 0.18, x + 0.18, 0.3, LV[top_f] - 0.2, ZC - 0.36, ZC)
            B.box("cols", "frame", x - 0.2, x + 0.2, 0.3, LV[top_f] - 0.2, ZB - 0.06, ZB + 0.25)
    for f in range(1, top_f + 1):
        L = LV[f]
        mat = "interior" if f == 3 else "frame"
        B.box(f"slab{f}", "frame", x0, x1, L - 0.45, L, ZC - 0.3, ZC)                     # corridor beam
        B.box(f"slab{f}", "frame", x0, x1, L - 0.25, L, ZB, ZB + 0.25)
        B.box(f"slab{f}", mat, x0, x1, L - 0.2, L - 0.02, ZB, ZC)


def stair_bay(B, s, top_f=3):
    """end bay: ventilation-block screens on the yard side and in the end wall"""
    xa, xb = sorted((s * 15.5, s * HX))
    g = f"bay{s}"
    for f in range(top_f):
        y0, y1 = floor_y(f), LV[f + 1] - 0.2
        B.box(g, "cream", HX - 0.2 if s > 0 else -HX, HX if s > 0 else -HX + 0.2, y0, y1, ZB, ZC)   # end wall
        B.box(g, "cream", s * 15.5 - 0.1, s * 15.5 + 0.1, y0, y1, ZB, ZW)                         # classroom side wall
        win(B, g, "x", s * HX, s, -2.4, 2.4, y0 + 0.9, y1 - 0.3, "interior", depth=0.3)
        b0, b1 = sorted((s * HX - s * 0.21, s * HX - s * 0.25))
        B.box(g, "breeze", b0, b1, y0 + 0.9, y1 - 0.3, -2.4, 2.4)
        if f > 0:
            B.box(g, "breeze", xa + 0.2, xb - 0.2, LV[f], y1, ZC - 0.14, ZC - 0.04)


def planters(B, rng):
    for x in (-13.6, -5.8, 5.8, 13.6):
        B.box("plant", "frame", x - 0.9, x + 0.9, 0.12, 0.62, ZC + 0.5, ZC + 1.1)
        for k in range(4):
            B.ell("plant", "leaf", (x - 0.65 + 0.43 * k, 0.85, ZC + 0.8), (0.32, 0.38, 0.3))


def sign(B):
    B.box("sign", "sign_g", -4.6, 4.6, LV[1] + 0.12, LV[1] + 0.88, ZC, ZC + 0.05)


def debris(B, rng, n, zone):
    x0, x1, z0, z1 = zone
    for _ in range(n):
        x, z = rng.uniform(x0, x1), rng.uniform(z0, z1)
        s = rng.uniform(0.12, 0.4)
        B.rbox("debris", "rubble" if rng.uniform() < 0.7 else "concrete", np.array([x, 0.12 + s * 0.4, z]),
               np.array([s, s * 0.55, s * 0.8]), eul(rng.uniform(-20, 20), rng.uniform(0, 180), rng.uniform(-20, 20)), rr=0.03)


def build(state=0):
    B = Builder(seed=91 + state)
    B.fires = []
    rng = B.rng
    yard(B)
    if state < 2:
        frame(B, rng, -HX, HX)
        for f in range(3):
            storey(B, rng, f, -15.5, 15.5, state, (0.0, 0.45)[state])
        for s in (-1, 1):
            stair_bay(B, s)
        for f in (1, 2):
            for s in (-1, 1):
                xa, xb = sorted((s * 15.5, s * HX))
                B.box(f"par{s}", "cream", xa, xb, LV[f], LV[f] + 1.0, ZC - 0.15, ZC)
                B.box(f"par{s}", "frame", xa, xb, LV[f] + 1.0, LV[f] + 1.1, ZC - 0.2, ZC + 0.05)
        roof(B, state)
        sign(B)
        planters(B, rng)
        flagpole(B, state)
        if state == 1:
            damage(B, rng)
    else:
        destroyed(B, rng)
    sc = Scene(B.p)
    sc.wear = state
    sc.fires = B.fires
    return sc


def damage(B, rng):
    # shell holes: the back wall of the second floor, a corridor parapet on the third floor
    B.box("hits", "cream", 2.0, 4.6, LV[1] + 0.6, LV[2] - 0.1, ZB - 0.4, ZB + 0.5, sub=True)
    B.box("hits", "interior", 2.0, 4.6, LV[1] + 0.6, LV[2] - 0.1, ZB + 0.5, ZB + 0.55)
    B.box("hits", "cream", -9.4, -7.6, LV[2] + 0.35, LV[2] + 1.3, ZC - 0.4, ZC + 0.3, sub=True)
    B.fires.append((np.array([3.3, LV[2] - 0.1, ZB]), np.array([0, 0, -1.0]), 1.4))
    for _ in range(6):                                                                   # bits of the parapet below
        debris(B, rng, 1, (-10.0, -7.0, ZC + 0.4, ZC + 2.2))
    # sandbagged firing positions on the corridors and at the entrance
    for (x, f) in ((-4.0, 2), (9.6, 1), (-12.0, 1)):
        for k in range(5):
            B.ell("sandbags", "sandbag", (x - 1.2 + 0.6 * k, LV[f] + 1.22, ZC - 0.12), (0.31, 0.13, 0.22))
        for k in range(4):
            B.ell("sandbags", "sandbag", (x - 0.9 + 0.6 * k, LV[f] + 1.46, ZC - 0.12), (0.31, 0.13, 0.22))
    for k in range(9):
        a = math.radians(-64 + k * 16)
        for r in range(3):
            B.ell("sandbags", "sandbag", (3.0 * math.sin(a), 0.32 + r * 0.25, ZC + 0.6 + 1.6 * math.cos(a)),
                  (0.32, 0.14, 0.22), R=eul(0, math.degrees(a) + 90, 0))
    # roof sheets and debris on the yard
    for (x, z, yaw) in ((-9.0, 7.2, 30), (7.5, 9.2, -20), (-15.0, 9.8, 75)):
        B.rbox("sheets", "roof_green", np.array([x, 0.2, z]), np.array([1.4, 0.03, 0.45]), eul(6, yaw, 4), axis=0)
    debris(B, rng, 26, (-HX, HX, ZC + 0.3, 10.5))
    debris(B, rng, 10, (-HX, HX, ZB - 0.9, ZB - 0.2))


def ruined_z(B, rng, g, z0, z1, x0, x1, lo, hi):
    """a jagged broken wall along x (facing z) between heights lo and hi"""
    x = x0
    while x < x1 - 1e-6:
        w = min(x1 - x, rng.uniform(0.5, 1.6))
        B.box(g, "cream", x, x + w, LV[2], LV[2] + rng.uniform(lo, hi), z0, z1)
        x += w


def destroyed(B, rng):
    XB = 3.2                                                                             # where the collapse begins
    # ---- left part: a roofless burnt-out shell
    frame(B, rng, -HX, XB, top_f=2)
    for x in (-18.8, -15.5, -11.6, -7.75, -3.9, 0.0):                                    # top-floor columns, broken
        top = LV[2] + rng.uniform(0.6, 3.0)
        B.box("cols3", "frame", x - 0.18, x + 0.18, LV[2], top, ZC - 0.36, ZC)
        B.rod("rebar", "rebar", (x, top, ZC - 0.18), (x + rng.uniform(-0.2, 0.2), top + 0.5, ZC - 0.1), 0.02)
    for f in range(2):
        storey(B, rng, f, -15.5, XB, 2, 0.7)
    ruined_z(B, rng, "top_b", ZB, ZB + 0.2, -15.5, XB - 0.5, 0.4, 3.0)
    ruined_z(B, rng, "top_f", ZW - 0.2, ZW, -15.5, XB - 1.0, 0.3, 2.6)
    for x in (-15.5, -7.75, 0.0):                                                       # classroom partitions
        B.box("part", "cream", x - 0.1, x + 0.1, LV[2], LV[2] + rng.uniform(1.2, 2.8), ZB, ZW)
    B.box("par_l", "cream", -HX, XB - 0.8, LV[1], LV[1] + 1.0, ZC - 0.15, ZC)
    B.box("par_l", "frame", -HX, XB - 0.8, LV[1] + 1.0, LV[1] + 1.1, ZC - 0.2, ZC + 0.05)
    x = -HX
    while x < XB - 2.0:                                                                  # third-floor parapet, broken
        w = rng.uniform(1.0, 3.0)
        if rng.uniform() < 0.6:
            B.box("par_l", "cream", x, min(x + w, XB - 2.0), LV[2], LV[2] + rng.uniform(0.4, 1.0), ZC - 0.15, ZC)
        x += w + rng.uniform(0.3, 1.2)
    stair_bay(B, -1, top_f=2)
    B.box("bay-1", "cream", -HX, -HX + 0.2, LV[2], LV[2] + 1.6, ZB, ZC)
    for _ in range(14):                                                                  # burnt debris inside
        x, z = rng.uniform(-15, XB - 1), rng.uniform(ZB + 0.4, ZW - 0.4)
        B.box("inside", "burnt", x, x + rng.uniform(0.3, 1.2), LV[2], LV[2] + rng.uniform(0.2, 0.7), z, z + rng.uniform(0.3, 1.0))
    for _ in range(8):                                                                   # fallen roof trusses
        x = rng.uniform(-14, XB - 1)
        B.rod("inside", "beam_burnt", (x, LV[2] + rng.uniform(1.5, 2.8), ZB + 0.3), (x + rng.uniform(-2, 2), LV[2] + 0.2, ZW - 0.3), 0.09)
    # ---- right part: the upper floors pancaked onto the ground floor
    for x in (3.9, 7.75, 11.6, 15.5, 18.8):
        top = rng.uniform(1.0, 2.8) * (1 - (x - XB) / 24)
        for z in (ZC - 0.18, ZB + 0.1):
            B.box("rcols", "frame", x - 0.18, x + 0.18, 0.3, 0.3 + top, z - 0.18, z + 0.18)
    ln = HX - XB + 0.6
    for k, (y, tilt) in enumerate(((LV[1], 8.0), (LV[1] + 0.75, 9.5))):                # floor slabs, stacked
        c = np.array([XB + ln / 2, y - ln / 2 * math.sin(math.radians(tilt)), 0.2 + rng.uniform(-0.3, 0.3)])
        R = eul(rng.uniform(-2, 2), rng.uniform(-2, 2), -tilt)
        B.rbox("pancake", "concrete", c, np.array([ln / 2, 0.14, 4.8]), R)
    x = XB
    for k in range(3):                                                                   # the roof slab, broken in three
        w = ln / 3
        t0 = 9.5 + rng.uniform(1, 4)
        y = LV[1] + 1.45 - (x - XB) * math.sin(math.radians(10.5))
        c = np.array([x + w / 2, y - w / 2 * math.sin(math.radians(t0)), rng.uniform(-0.4, 0.6)])
        R = eul(rng.uniform(-6, 6), rng.uniform(-4, 4), -t0)
        B.rbox("pancake", "concrete", c, np.array([w / 2 - 0.15, 0.14, 4.7]), R)
        for _ in range(9):
            p = c + R @ np.array([rng.uniform(-w / 2 + 0.3, w / 2 - 0.3), 0.2, rng.uniform(-4.2, 4.2)])
            sz = rng.uniform(0.15, 0.5)
            B.rbox("pancake", "rubble" if rng.uniform() < 0.7 else "cream", p, np.array([sz, sz * 0.6, sz * 0.8]),
                   eul(rng.uniform(-40, 40), rng.uniform(0, 180), rng.uniform(-40, 40)), rr=0.03)
        for _ in range(2):                                                               # roof sheets and trusses on top
            p = c + R @ np.array([rng.uniform(-w / 2 + 1, w / 2 - 1), 0.25, rng.uniform(-3.5, 3.5)])
            B.rbox("pancake", "roof_green", p, np.array([1.3, 0.03, 0.5]), R @ eul(rng.uniform(-15, 15), rng.uniform(0, 180), 0), axis=0)
        p = c + R @ np.array([0, 0.3, 0])
        B.rod("pancake", "beam_burnt", tuple(p + np.array([-1.5, 0, -3.5])), tuple(p + np.array([1.2, 0.4, 3.0])), 0.09)
        x += w
    for k in range(6):                                                                   # rebar at the break
        y, z = rng.choice([LV[1], LV[2]]), rng.uniform(-4.4, 4.4)
        B.rod("rebar", "rebar", (XB - 0.2, y - 0.1, z), (XB + rng.uniform(0.3, 0.8), y - rng.uniform(0.2, 0.8), z), 0.02)
    B.rbox("pancake", "cream", np.array([XB + 3.0, 2.4, ZC + 0.4]), np.array([3.0, 0.8, 0.1]), eul(-35, 0, -8))   # a parapet slab
    B.ell("rubble", "rubble", (11.0, 0.12, ZC + 1.8), (8.6, 1.4, 2.0))
    B.ell("rubble", "rubble", (11.5, 0.12, ZB - 0.6), (8.0, 1.2, 1.4))
    B.ell("rubble", "rubble", (HX + 0.4, 0.12, 0.0), (1.3, 1.0, 5.2))
    B.ell("rubble", "rubble", (-6.0, 0.12, ZC + 1.2), (7.0, 0.7, 1.2))
    for _ in range(34):
        x, z = rng.uniform(3, HX + 0.8), rng.choice([rng.uniform(ZC + 0.5, ZC + 3.6), rng.uniform(ZB - 1.0, ZB - 0.1)])
        s = rng.uniform(0.15, 0.5)
        B.rbox("chunks", "rubble" if rng.uniform() < 0.6 else "cream", np.array([x, 0.5 + rng.uniform(0, 0.8), z]),
               np.array([s, s * 0.6, s * 0.8]), eul(rng.uniform(-40, 40), rng.uniform(0, 180), rng.uniform(-40, 40)), rr=0.03)
    for (x, z, yaw) in ((-9.0, 7.6, 30), (6.5, 9.6, -20), (-15.0, 9.6, 75), (12.0, 8.4, 50), (0.0, 10.0, 5)):
        B.rbox("sheets", "roof_green", np.array([x, 0.2, z]), np.array([1.4, 0.03, 0.45]), eul(6, yaw, 4), axis=0)
    planters(B, rng)
    flagpole(B, 2)
    debris(B, rng, 30, (-HX, HX, ZC + 0.3, 10.5))


FRONT = "the open corridors and the school yard"
PIVOT = "the middle of the building's footprint on the ground (the yard and flagpole extend to the front)"
FOOTPRINT = {"building": [38.0, 9.4], "with_yard": [40.0, 16.7]}
HEIGHT = {"floors": 3, "eave": RL, "ridge": round(RL + 0.2 + (-ZB + 0.8) * math.tan(PITCH), 2), "flagpole": 9.2}

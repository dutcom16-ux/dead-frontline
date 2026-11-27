"""Toledo hospital: a four-storey provincial hospital (generic design).

Building space: x = width (28 m), y = up, z = depth (14 m), +z = the front and the forecourt.
A white concrete block with teal floor bands and strip windows, a main entrance with a glazed lobby
under a canopy, an emergency bay with a drive-through canopy, a red "emergency" sign and an
ambulance, a stair core on the left end, a blue "H" hospital sign on the parapet and the side,
a raised helipad on the right half of the roof and a machine room, water tanks and air-conditioning
condensers on the left half.

States: 0 intact; 1 damaged (windows blown out with soot plumes, shell holes in the front and side,
the H sign knocked askew, the emergency canopy sagging on a lost column, a hole blown through the
helipad, sandbags at the entrance and on the roof, debris, the ambulance shot up);
2 destroyed (the right half has collapsed floor on floor with the helipad deck on top, the left half
stands as a gutted, burnt-out shell with its stair core, the canopy lies on the burnt ambulance).
"""
import math

import numpy as np

from bsdf import Scene, eul
from townhouse import MAT, Builder, shade   # noqa: F401

MAT.update({
    "hosp_wall":  ((0.90, 0.90, 0.87), 0.05, "plaster"),
    "teal":       ((0.12, 0.47, 0.52), 0.15, "plain"),
    "hsign":      ((0.10, 0.30, 0.72), 0.20, "hsign"),
    "helipad":    ((0.30, 0.31, 0.32), 0.05, "helipad"),
    "ribbon":     ((0.24, 0.40, 0.47), 0.75, "ribbon"),
    "sign_er":    ((0.78, 0.12, 0.12), 0.10, "sign", (0.97, 0.97, 0.95)),
    "sign_t":     ((0.12, 0.47, 0.52), 0.10, "sign", (0.97, 0.97, 0.95)),
    "amb_body":   ((0.94, 0.94, 0.92), 0.30, "plain"),
    "amb_stripe": ((0.95, 0.45, 0.08), 0.20, "plain"),
    "lightbar":   ((0.15, 0.35, 0.95), 0.60, "plain"),
    "tyre":       ((0.08, 0.08, 0.08), 0.10, "plain"),
    "beam_burnt": ((0.13, 0.10, 0.08), 0.02, "wood"),
})

W2, D2 = 14.0, 7.0
LV = [0.25, 4.2, 7.8, 11.4, 15.0]
RL = LV[-1]
FRONT_SEGS = [(-13.2, -4.9), (-4.3, 4.3), (4.9, 13.2)]
SIDE_SEGS = [(-6.2, -0.4), (0.4, 6.2)]


def win(B, g, axis, face, out, u0, u1, y0, y1, fill, depth=0.14):
    a, b = (face - depth, face + 0.3) if out > 0 else (face - 0.3, face + depth)
    f0 = face - out * depth
    fa, fb = sorted((f0 - out * 0.02, f0 + out * 0.04))                                  # proud of the recess back
    if axis == "z":
        B.box(g, "hosp_wall", u0, u1, y0, y1, a, b, sub=True)
        B.box(g, fill, u0, u1, y0, y1, fa, fb)
    else:
        B.box(g, "hosp_wall", a, b, y0, y1, u0, u1, sub=True)
        B.box(g, fill, fa, fb, y0, y1, u0, u1)


def ground(B):
    k = 1 / math.sqrt(2)
    B.box("ground", "base", -16.5, 15.5, 0.0, 0.1, -8.0, 15.5,                          # driveway, front corners cut
          cuts=[((-k, 0, k), 26.0 * k), ((k, 0, k), 26.0 * k)])
    B.box("ground", "concrete", -16.5, 15.0, 0.0, 0.2, -8.0, 8.8)                        # walk around the building
    B.box("ground", "concrete", -11.0, -1.0, 0.0, 0.2, 8.8, 12.0)                        # entrance plaza
    for x in (-12.6, 0.6):
        B.box("ground", "frame", x - 0.9, x + 0.9, 0.2, 0.7, 9.6, 10.6)
        for k in range(4):
            B.ell("ground", "leaf", (x - 0.65 + 0.43 * k, 0.95, 10.1), (0.32, 0.38, 0.3))
    for j in range(4):                                                                   # parking lines
        x = -9.5 + 2.6 * j
        B.box("ground", "white", x, x + 0.1, 0.1, 0.11, 12.6, 15.2)


def ambulance(B, state):
    mat = "burnt" if state == 2 else "amb_body"
    g = "amb"
    B.box(g, mat, 7.0, 9.0, 0.55, 2.85, 9.4, 13.2, rr=0.05)
    B.box(g, mat, 7.05, 8.95, 0.55, 2.1, 13.2, 14.6, rr=0.05)
    if state < 2:
        B.box(g, "amb_stripe", 6.98, 9.02, 1.3, 1.55, 9.38, 14.62)
        B.box(g, "lightbar", 7.3, 8.7, 2.85, 3.0, 12.9, 13.15)
        B.box(g, "lightbar", 7.3, 8.7, 2.85, 3.0, 9.5, 9.7)
    B.box(g, "interior" if state else "glass", 7.1, 8.9, 1.45, 2.02, 14.6, 14.66)
    for z in (10.2, 13.8):
        for x in (6.98, 9.02):
            r = 0.42 if state < 2 else 0.3
            B.cyl(g, "tyre", (x, r, z), r, 0.12, R=eul(0, 0, 90))


def h_sign(B, state):
    if state == 0:
        B.box("hsign", "hsign", -1.2, 1.2, RL + 0.25, RL + 2.65, D2 - 0.12, D2 - 0.02)
        for x in (-0.8, 0.8):
            B.box("hsign", "steel", x - 0.05, x + 0.05, RL + 0.2, RL + 2.5, D2 - 0.3, D2 - 0.12)
    elif state == 1:                                                                     # hanging askew off one bolt
        B.rbox("hsign", "hsign", np.array([-0.5, RL + 1.0, D2 + 0.05]), np.array([1.2, 1.2, 0.05]), eul(0, 0, 28))
        B.box("hsign", "steel", -0.85, -0.75, RL + 0.2, RL + 2.3, D2 - 0.3, D2 - 0.12)
    B.box("hsign", "hsign", W2, W2 + 0.1, RL - 3.0, RL - 0.6, -1.2, 1.2)                  # on the right end wall


def roof_kit(B, rng, state):
    """machine room, tanks and condensers on the left half; the helipad on the right"""
    B.box("rooftop", "roofdeck", -W2 + 0.25, W2 - 0.25, RL - 0.05, RL + 0.05, -D2 + 0.25, D2 - 0.25)
    B.box("rooftop", "hosp_wall", -12.0, -7.0, RL, RL + 3.0, -5.6, -1.2)
    B.box("rooftop", "frame", -12.15, -6.85, RL + 3.0, RL + 3.2, -5.75, -1.05)
    B.box("rooftop", "door", -9.2, -8.2, RL + 0.05, RL + 2.2, -1.25, -1.15)
    B.box("rooftop", "steel", -5.6, -0.6, RL, RL + 0.6, 2.2, 5.4)
    for x in (-4.3, -1.9):
        B.cyl("rooftop", "tank", (x, RL + 1.65, 3.8), 1.0, 1.05)
    for i in range(3):
        for j in range(2):
            x, z = -12.3 + 1.7 * i, 1.6 + 2.0 * j
            B.box("rooftop", "ac", x - 0.6, x + 0.6, RL, RL + 1.1, z - 0.55, z + 0.55, rr=0.03)
    # helipad on legs, with a stair up from the roof
    hy = RL + 1.6
    B.box("helipad", "helipad", 1.5, 13.5, hy - 0.3, hy, -6.0, 6.0)
    B.box("helipad", "steel", 1.6, 13.4, hy - 0.75, hy - 0.3, -5.9, 5.9)
    for x in (2.2, 7.5, 12.8):
        for z in (-5.3, 0.0, 5.3):
            B.rod("helipad", "steel", (x, RL, z), (x, hy - 0.7, z), 0.16)
    B.rbox("helipad", "steel", np.array([0.6, RL + 0.75, -3.0]), np.array([0.5, 0.06, 1.4]), eul(-32, 0, 0))
    for (x0, x1, z0, z1) in ((1.0, 14.0, -6.5, -6.4), (1.0, 14.0, 6.4, 6.5), (13.9, 14.0, -6.5, 6.5)):
        B.box("helipad", "steel", x0, x1, hy - 0.25, hy - 0.2, z0, z1)                   # safety-net frame
    if state == 1:
        B.ell("helipad", "burnt", (9.0, hy - 0.02, 2.0), (2.6, 0.04, 2.4))                   # scorch, then the hole
        B.cyl("helipad", "burnt", (9.0, hy - 0.4, 2.0), 1.5, 0.6)
        B.p[-1].sub = True
        for _ in range(8):
            s = rng.uniform(0.1, 0.3)
            B.rbox("helipad", "rubble", np.array([rng.uniform(-6, 0.5), RL + s * 0.5, rng.uniform(-5, 5)]), np.array([s, s * 0.5, s * 0.7]),
                   eul(rng.uniform(-30, 30), rng.uniform(0, 180), 0), rr=0.02)


def facade(B, rng, state, x_max=W2, broken=0.0):
    """strip windows, lobby and emergency glazing, teal floor bands"""
    for f in range(1, 4):
        y0 = LV[f]
        for (u0, u1) in FRONT_SEGS:
            if u0 >= x_max - 0.5:
                continue
            u1 = min(u1, x_max - 0.5)
            for (face, out) in ((D2, 1), (-D2, -1)):
                br = rng.uniform() < broken
                win(B, f"win{f}", "z", face, out, u0, u1, y0 + 0.9, y0 + 2.6, "interior" if br else "ribbon")
                if br and state == 1 and rng.uniform() < 0.5:
                    B.fires.append((np.array([(u0 + u1) / 2 + rng.uniform(-2, 2), y0 + 2.6, face]), np.array([0, 0, out * 1.0]), 1.3))
        for (u0, u1) in SIDE_SEGS:
            for (face, out) in ((-W2, -1), (W2, 1)):
                if face > x_max:
                    continue
                br = rng.uniform() < broken
                win(B, f"win{f}", "x", face, out, u0, u1, y0 + 0.9, y0 + 2.6, "interior" if br else "ribbon")
    # ground floor: lobby curtain wall, emergency doors, strip windows on the back
    for (u0, u1, y0, y1, fill) in ((-10.0, -3.0, 0.3, 3.7, "interior" if state else "ribbon"),
                                   (5.0, 11.0, 0.3, 3.4, "interior" if state else "ribbon"),
                                   (-13.2, -11.0, 1.1, 3.0, "interior" if rng.uniform() < broken else "ribbon"),
                                   (-2.0, 4.0, 1.1, 3.0, "interior" if rng.uniform() < broken else "ribbon")):
        u1 = min(u1, x_max - 0.5)
        if u1 - u0 > 0.8:
            win(B, "gf", "z", D2, 1, u0, u1, y0, y1, fill)
    for (u0, u1) in FRONT_SEGS:
        if u0 < x_max - 0.5:
            win(B, "gf", "z", -D2, -1, u0, min(u1, x_max - 0.5), 1.1, 3.0, "interior" if rng.uniform() < broken else "ribbon")
    for f in range(1, 4):                                                                # teal bands
        y = LV[f]
        B.box("bands", "teal", -W2 - 0.06, min(W2 + 0.06, x_max + 0.6), y - 0.22, y + 0.12, -D2 - 0.06, D2 + 0.06)


def build(state=0):
    B = Builder(seed=131 + state)
    B.fires = []
    rng = B.rng
    ground(B)
    if state < 2:
        B.box("mass", "hosp_wall", -W2, W2, LV[0], RL, -D2, D2)
        for (x0, x1, z0, z1) in ((-W2, W2, -D2, -D2 + 0.25), (-W2, W2, D2 - 0.25, D2), (-W2, -W2 + 0.25, -D2, D2), (W2 - 0.25, W2, -D2, D2)):
            B.box("parapet", "hosp_wall", x0, x1, RL, RL + 1.1, z0, z1)
            B.box("parapet", "frame", x0 - 0.04, x1 + 0.04, RL + 1.1, RL + 1.22, z0 - 0.04, z1 + 0.04)
        for (x0, x1, z0, z1) in ((-W2 - 0.06, W2 + 0.06, -D2 - 0.06, -D2 + 0.1), (-W2 - 0.06, W2 + 0.06, D2 - 0.1, D2 + 0.06),
                                 (-W2 - 0.06, -W2 + 0.1, -D2, D2), (W2 - 0.1, W2 + 0.06, -D2, D2)):
            B.box("bands", "teal", x0, x1, RL - 0.22, RL + 0.12, z0, z1)                 # top band, a ring
        facade(B, rng, state, broken=(0.0, 0.55)[state])
        stair_core(B, state)
        canopies(B, state)
        h_sign(B, state)
        roof_kit(B, rng, state)
        ambulance(B, state)
        if state == 1:
            damage(B, rng)
    else:
        destroyed(B, rng)
    sc = Scene(B.p)
    sc.wear = state
    sc.fires = B.fires
    return sc


def stair_core(B, state, top=RL + 3.0):
    B.box("core", "hosp_wall", -16.2, -W2 + 0.1, LV[0], top, -2.6, 2.6)
    B.box("core", "frame", -16.35, -W2 + 0.1, top, top + 0.2, -2.75, 2.75)
    win(B, "core", "x", -16.2, -1, -0.5, 0.5, 1.0, top - 1.2, "interior" if state else "glass_win")
    B.box("core", "teal", -16.26, -15.0, LV[0], top, 2.6, 2.66)


def canopies(B, state):
    # main entrance
    B.box("canopy", "frame", -10.6, -2.4, 3.85, 4.15, D2, 11.2)
    B.box("canopy", "sign_t", -10.0, -3.0, 3.6, 4.15, 11.2, 11.26)
    for x in (-10.0, -3.0):
        B.cyl("canopy", "frame", (x, 2.0, 10.8), 0.2, 1.85)
    # emergency bay: a drive-through canopy; it sags on a lost column when damaged
    if state == 0:
        B.box("er", "frame", 3.6, 12.4, 4.5, 4.85, D2, 14.4)
        B.box("er", "sign_er", 4.4, 11.6, 4.0, 4.85, 14.4, 14.46)
        for x in (4.0, 12.0):
            B.cyl("er", "frame", (x, 2.3, 14.0), 0.22, 2.2)
    else:
        R = eul(6.5, 0, -7.0)
        c = np.array([8.0, 4.15, 10.7])
        B.rbox("er", "frame", c, np.array([4.4, 0.17, 3.7]), R)
        B.rbox("er", "sign_er", c + R @ np.array([0, -0.25, 3.73]), np.array([3.6, 0.4, 0.03]), R)
        B.cyl("er", "frame", (4.0, 2.3, 14.0), 0.22, 2.2)
        B.cyl("er", "frame", (12.6, 0.25, 14.8), 0.22, 2.1, R=eul(0, 0, 90))               # the fallen column
    B.box("er", "frame", 3.6, 12.4, 0.0, 0.12, 8.8, 14.4)


def damage(B, rng):
    for (x0, x1, y0, y1) in ((2.2, 5.0, LV[3] + 0.4, LV[4] - 0.3), (-8.5, -6.5, LV[1] + 0.6, LV[2] - 0.2)):
        B.box("hits", "hosp_wall", x0, x1, y0, y1, D2 - 1.0, D2 + 0.4, sub=True)
        B.box("hits", "interior", x0, x1, y0, y1, D2 - 1.0, D2 - 0.95)
        B.fires.append((np.array([(x0 + x1) / 2, y1, D2]), np.array([0, 0, 1.0]), (x1 - x0) / 2 + 0.3))
    B.box("hits", "hosp_wall", W2 - 1.0, W2 + 0.4, LV[2] + 0.5, LV[3] - 0.2, -5.0, -2.6, sub=True)
    B.box("hits", "interior", W2 - 1.0, W2 - 0.95, LV[2] + 0.5, LV[3] - 0.2, -5.0, -2.6)
    for k in range(9):                                                                   # sandbags at the lobby
        a = math.radians(-64 + k * 16)
        for r in range(3):
            B.ell("sandbags", "sandbag", (-6.5 + 3.0 * math.sin(a), 0.42 + r * 0.25, D2 + 2.4 + 1.5 * math.cos(a)),
                  (0.32, 0.14, 0.22), R=eul(0, math.degrees(a) + 90, 0))
    for k in range(6):                                                                   # and on the roof edge
        B.ell("sandbags", "sandbag", (-6.0 + 0.62 * k, RL + 1.34, D2 - 0.12), (0.31, 0.13, 0.22))
        if k < 5:
            B.ell("sandbags", "sandbag", (-5.7 + 0.62 * k, RL + 1.58, D2 - 0.12), (0.31, 0.13, 0.22))
    for _ in range(36):
        x, z = rng.uniform(-15, 14), rng.uniform(D2 + 0.4, 14.5)
        if 6.6 < x < 9.4 and 9.0 < z < 15:
            continue
        s = rng.uniform(0.1, 0.35)
        B.rbox("debris", "rubble" if rng.uniform() < 0.6 else "hosp_wall", np.array([x, 0.1 + s * 0.4, z]), np.array([s, s * 0.55, s * 0.8]),
               eul(rng.uniform(-20, 20), rng.uniform(0, 180), rng.uniform(-20, 20)), rr=0.03)


def destroyed(B, rng):
    XB = 1.0
    # ---- left half: a gutted shell, open where the right half fell away
    B.box("mass", "hosp_wall", -W2, XB, LV[0], RL - 0.6, -D2, D2)
    B.box("mass", "hosp_wall", -W2, -4.0, RL - 0.6, RL, -D2, D2)
    for f in range(4):                                                                   # open floors at the break
        B.box("open", "hosp_wall", XB - 2.2, XB + 0.5, LV[f] + 0.25, LV[f + 1] - 0.3, -D2 + 0.25, D2 - 0.25, sub=True)
        B.box("open", "interior", XB - 2.25, XB - 2.2, LV[f] + 0.25, LV[f + 1] - 0.3, -D2 + 0.25, D2 - 0.25)
        for _ in range(4):
            z = rng.uniform(-6, 6)
            y = LV[f + 1] - 0.3 if f < 3 else RL - 0.6
            B.rod("rebar", "rebar", (XB, y + 0.1, z), (XB + rng.uniform(0.3, 0.8), y + 0.1 - rng.uniform(0.1, 0.6), z + rng.uniform(-0.2, 0.2)), 0.02)
    facade(B, rng, 2, x_max=XB - 0.6, broken=1.0)
    for (x0, x1, y0, y1, face) in ((-11.0, -8.0, LV[2] + 0.4, LV[3] + 0.6, D2), (-5.0, -2.2, LV[1] + 0.5, LV[2] + 0.2, -D2),
                                   (-13.0, -10.5, LV[3] + 0.5, RL - 0.2, -D2)):
        s = 1 if face > 0 else -1
        a, b = sorted((face - s * 1.5, face + s * 0.5))
        B.box("hits", "hosp_wall", x0, x1, y0, y1, a, b, sub=True)
        a, b = sorted((face - s * 1.5, face - s * 1.45))
        B.box("hits", "interior", x0, x1, y0, y1, a, b)
    x = -W2
    while x < -4.6:                                                                      # broken parapet
        w = rng.uniform(1.0, 2.6)
        if rng.uniform() < 0.6:
            B.box("parapet", "hosp_wall", x, min(x + w, -4.6), RL, RL + rng.uniform(0.3, 1.1), D2 - 0.25, D2)
        x += w + rng.uniform(0.3, 1.0)
    B.box("parapet", "hosp_wall", -W2, -W2 + 0.25, RL, RL + 1.1, -D2, D2)
    B.box("rooftop", "hosp_wall", -12.0, -9.0, RL, RL + 2.2, -5.6, -1.2)                 # what's left of the machine room
    B.box("rooftop", "roofdeck", -W2 + 0.25, -4.0, RL - 0.05, RL + 0.05, -D2 + 0.25, D2 - 0.25)
    B.box("rooftop", "roofdeck", -4.0, XB - 2.3, RL - 0.65, RL - 0.55, -D2 + 0.25, D2 - 0.25)
    for _ in range(14):
        x, z = rng.uniform(-13, -4.5), rng.uniform(-6.3, 6.3)
        sz = rng.uniform(0.15, 0.45)
        B.rbox("rooftop", "rubble" if rng.uniform() < 0.5 else "ac", np.array([x, RL + sz * 0.5, z]), np.array([sz, sz * 0.6, sz * 0.8]),
               eul(rng.uniform(-30, 30), rng.uniform(0, 180), rng.uniform(-30, 30)), rr=0.03)
    B.cyl("rooftop", "tank", (-3.0, RL - 0.55 + 0.9, 3.4), 0.9, 1.0, R=eul(80, 20, 0))       # a toppled tank
    stair_core(B, 2, top=RL + 1.4)
    B.box("hsign", "hsign", -W2 - 0.1, -W2, RL - 3.0, RL - 0.6, -5.2, -2.8)
    # ---- right half: floor on floor, the helipad deck on top
    for k, (y, tilt) in enumerate(((LV[0] + 1.9, 5.0), (LV[0] + 2.6, 6.5), (LV[0] + 3.3, 8.0), (LV[0] + 4.0, 9.0))):
        ln = W2 - XB + 0.4
        c = np.array([XB + ln / 2, y - ln / 2 * math.sin(math.radians(tilt)), rng.uniform(-0.4, 0.4)])
        R = eul(rng.uniform(-3, 3), rng.uniform(-2, 2), -tilt)
        B.rbox("pancake", "concrete", c, np.array([ln / 2, 0.16, D2 + 0.1]), R)
        B.rbox("pancake", "teal", c + R @ np.array([0, -0.18, 0]), np.array([ln / 2 - 0.05, 0.08, D2 + 0.12]), R)
        for _ in range(7):
            p = c + R @ np.array([rng.uniform(-ln / 2 + 0.4, ln / 2 - 0.4), 0.22, rng.uniform(-6.3, 6.3)])
            s = rng.uniform(0.15, 0.5)
            B.rbox("pancake", "rubble" if rng.uniform() < 0.6 else "hosp_wall", p, np.array([s, s * 0.6, s * 0.8]),
                   eul(rng.uniform(-40, 40), rng.uniform(0, 180), rng.uniform(-40, 40)), rr=0.03)
    for (cz, hz, ang) in ((-2.4, 3.4, (9, 0, -11)), (3.2, 2.2, (-4, 6, -15))):         # the deck, broken in two
        R = eul(*ang)
        c = np.array([9.3, 3.35 + (0.25 if cz > 0 else 0.0), cz])
        B.rbox("pancake", "helipad", c, np.array([5.6, 0.15, hz]), R)
        B.p[-1].tex_off, B.p[-1].tex_half = (0.0, 0.0, cz - 0.4 + (0.6 if cz > 0 else -0.6) * 0), (6.0, 0.15, 6.0)
        for z in (-hz + 0.8, hz - 0.8):                                                  # its legs, bent
            p = c + R @ np.array([5.0, -0.2, z])
            B.rod("pancake", "steel", tuple(p), tuple(p + np.array([1.2, -1.5, 0.4])), 0.14)
        for _ in range(7):
            p = c + R @ np.array([rng.uniform(-5, 5), 0.2, rng.uniform(-hz + 0.3, hz - 0.3)])
            sz = rng.uniform(0.15, 0.45)
            B.rbox("pancake", "rubble" if rng.uniform() < 0.6 else "hosp_wall", p, np.array([sz, sz * 0.6, sz * 0.8]),
                   eul(rng.uniform(-40, 40), rng.uniform(0, 180), rng.uniform(-40, 40)), rr=0.03)
    B.ell("pancake", "burnt", (8.0, 3.2, -0.6), (2.6, 0.5, 2.0))
    for x in (2.0, 6.0, 10.0, 13.6):                                                    # ground-floor stubs
        for z in (-D2 + 0.2, D2 - 0.2):
            B.box("stubs", "hosp_wall", x - 0.25, x + 0.25, LV[0], LV[0] + rng.uniform(0.8, 1.8), z - 0.25, z + 0.25)
    B.ell("rubble", "rubble", (8.0, 0.1, D2 + 1.6), (7.0, 1.6, 2.4))
    B.ell("rubble", "rubble", (8.0, 0.1, -D2 - 1.2), (6.5, 1.3, 1.8))
    B.ell("rubble", "rubble", (W2 + 1.0, 0.1, 0.0), (1.8, 1.4, 6.5))
    B.ell("rubble", "rubble", (-6.0, 0.1, D2 + 1.0), (5.0, 0.6, 1.1))
    for _ in range(30):
        x, z = rng.uniform(1.5, W2 + 2.0), rng.choice([rng.uniform(D2 + 0.6, D2 + 4.0), rng.uniform(-D2 - 3.0, -D2 - 0.3)])
        s = rng.uniform(0.15, 0.5)
        B.rbox("chunks", "rubble" if rng.uniform() < 0.6 else "hosp_wall", np.array([x, 0.5 + rng.uniform(0, 0.9), z]), np.array([s, s * 0.6, s * 0.8]),
               eul(rng.uniform(-40, 40), rng.uniform(0, 180), rng.uniform(-40, 40)), rr=0.03)
    # the main canopy still stands; the emergency canopy lies on the burnt ambulance
    B.box("canopy", "frame", -10.6, -2.4, 3.85, 4.15, D2, 11.2)
    for x in (-10.0, -3.0):
        B.cyl("canopy", "frame", (x, 2.0, 10.8), 0.2, 1.85)
    ambulance(B, 2)
    R = eul(-4, 0, -9)
    B.rbox("er", "frame", np.array([8.3, 3.2, 11.2]), np.array([4.4, 0.17, 3.6]), R)
    B.rbox("er", "sign_er", np.array([8.3, 3.0, 14.85]), np.array([3.6, 0.4, 0.03]), R @ eul(-20, 0, 0))
    for _ in range(30):
        x, z = rng.uniform(-15, 0), rng.uniform(D2 + 0.4, 14.5)
        s = rng.uniform(0.1, 0.35)
        B.rbox("debris", "rubble" if rng.uniform() < 0.6 else "hosp_wall", np.array([x, 0.1 + s * 0.4, z]), np.array([s, s * 0.55, s * 0.8]),
               eul(rng.uniform(-20, 20), rng.uniform(0, 180), rng.uniform(-20, 20)), rr=0.03)


FRONT = "the main entrance, the emergency bay and the forecourt"
PIVOT = "the middle of the building's footprint on the ground (the forecourt extends to the front)"
FOOTPRINT = {"building": [28.0, 14.0], "with_stair_core_and_forecourt": [34.5, 25.0]}
HEIGHT = {"floors": 4, "roof": RL, "helipad": RL + 1.6, "stair_core": RL + 3.2}

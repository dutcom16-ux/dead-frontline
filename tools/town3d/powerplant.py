"""Toledo power plant: a compact thermal (oil/coal-fired) power station (generic design).

Building space: x = width, y = up, z = depth, +z = the front gate. A turbine hall in ribbed metal
cladding with a blue base band, clerestory windows, a roller door and the plant's sign; a taller
boiler house with an outside stair tower and a flue duct to a 30 m concrete chimney with red and
white bands and a gallery; two fuel tanks in a bund wall behind; a two-fan cooling tower with
louvred sides and a pipe rack; a fenced switchyard with three transformers, a steel gantry and
lines into the hall; a gatehouse with a barrier on a concrete yard.

States: 0 intact; 1 damaged (cladding torn open, windows out, soot, a fuel tank burnt out, a
transformer burnt and the lines down, the cooling-tower fans wrecked, sandbags at the gate,
debris); 2 destroyed (the hall roof down and its cladding stripped to the steel frame, the boiler
house collapsed to half its height, the chimney broken off with its top lying across the yard,
a tank burst, the switchyard burnt, rubble).
"""
import math

import numpy as np

from bsdf import Prim, Scene, eul
from kit import MAT, debris, heap, sandbag_row, win   # noqa: F401
from townhouse import Builder, shade   # noqa: F401

MAT.update({
    "clad_light":  ((0.74, 0.77, 0.80), 0.25, "cladding"),
    "clad_dark":   ((0.50, 0.53, 0.57), 0.25, "cladding"),
    "clad_blue":   ((0.20, 0.34, 0.56), 0.25, "cladding"),
    "roof_grey":   ((0.62, 0.63, 0.64), 0.25, "roof"),
    "glass_ind":   ((0.30, 0.42, 0.48), 0.70, "ribbon"),
    "band_red":    ((0.78, 0.17, 0.13), 0.10, "plain"),
    "transformer": ((0.36, 0.42, 0.33), 0.25, "ac"),
    "insulator":   ((0.55, 0.33, 0.20), 0.40, "plain"),
    "fence":       ((0.60, 0.62, 0.64), 0.30, "window_grille"),
    "gravel":      ((0.56, 0.55, 0.51), 0.02, "concrete"),
    "tank_w":      ((0.88, 0.88, 0.86), 0.30, "tank"),
    "jalousie_g":  ((0.42, 0.46, 0.46), 0.30, "jalousie"),
    "sign_p":      ((0.14, 0.30, 0.60), 0.10, "sign", (0.97, 0.97, 0.95)),
    "shutter":     ((0.62, 0.64, 0.66), 0.35, "shutter"),
})

# turbine hall, boiler house, chimney
HX0, HX1, HZ0, HZ1, HH = -15.0, 5.0, -4.0, 6.0, 12.0
BX0, BX1, BZ0, BZ1, BH = 5.0, 13.0, -8.0, 4.0, 21.0
CX, CZ, CHT = 9.0, -11.0, 30.0
SHIFT = 0.0


def build(state=0):
    B = Builder(seed=401 + state)
    B.fires = []
    rng = B.rng
    B.box("yard", "concrete", -17.0, 16.0, 0.0, 0.1, -14.6, 13.6)
    B.box("yard", "paint_w", -3.2, 3.2, 0.1, 0.11, 8.6, 8.75)
    if state < 2:
        turbine_hall(B, rng, state)
        boiler_house(B, rng, state)
        chimney(B, rng, state)
    else:
        ruins(B, rng)
    tanks(B, rng, state)
    cooling_tower(B, rng, state)
    switchyard(B, rng, state)
    gatehouse(B, rng, state)
    if state == 1:
        debris(B, rng, "debris", 40, (-16, 15, 6.5, 13.4))
        debris(B, rng, "debris", 20, (-16, 15, -14, -4.5))
    sc = Scene(B.p)
    sc.wear = state
    sc.fires = B.fires
    return sc


def frame_columns(B, g, x0, x1, z0, z1, h, step):
    for x in np.arange(x0, x1 + 1e-6, step):
        for z in (z0, z1):
            B.box(g, "steel", x - 0.2, x + 0.2, 0.1, h, z - 0.2, z + 0.2)


def turbine_hall(B, rng, state):
    dmg = state == 1
    B.box("hall", "clad_light", HX0, HX1, 0.1, HH, HZ0, HZ1)
    B.box("hall", "interior", HX0 + 0.3, HX1 - 0.3, 0.1, HH - 0.3, HZ0 + 0.3, HZ1 - 0.3)
    B.box("hall", "clad_blue", HX0 - 0.05, HX1 + 0.05, 0.1, 3.0, HZ0 - 0.05, HZ1 + 0.05)
    # low gable roof along x
    p = math.radians(8)
    half = (HZ1 - HZ0) / 2 + 0.5
    ridge = HH + half * math.tan(p)
    zc = (HZ0 + HZ1) / 2
    for s in (-1, 1):
        R = eul(s * 8, 0, 0)
        c = np.array([(HX0 + HX1) / 2, HH + half / 2 * math.tan(p) + 0.05, zc + s * half / 2])
        B.rbox("roof", "roof_grey", c, np.array([(HX1 - HX0) / 2 + 0.4, 0.08, half / 2 / math.cos(p)]), R, axis=0)
    B.rod("roof", "ridge", (HX0 - 0.4, ridge + 0.05, zc), (HX1 + 0.4, ridge + 0.05, zc), 0.1)
    for x in (HX0, HX1):                                                                     # gable ends
        B.box("hall", "clad_light", x - 0.15 if x == HX0 else x - 0.15, x + 0.15, HH, ridge, HZ0, HZ1,
              cuts=[((0, math.cos(p), math.sin(p)), (ridge * math.cos(p) + zc * math.sin(p))),
                    ((0, math.cos(p), -math.sin(p)), (ridge * math.cos(p) - zc * math.sin(p)))])
    # clerestory windows, roller door, personnel doors, the sign
    for (face, out) in ((HZ1, 1), (HZ0, -1)):
        for k in range(4):
            x0 = HX0 + 1.0 + k * 4.75
            br = dmg and rng.uniform() < 0.6
            win(B, "hallwin", "z", face, out, x0, x0 + 3.9, 8.6, 10.8, "interior" if br else "glass_ind", wall="clad_light")
            if br and out > 0:
                B.fires.append((np.array([x0 + 1.9, 10.8, face]), np.array([0, 0, 1.0]), 1.6))
    win(B, "hallwin", "x", HX0, -1, -1.5, 3.5, 0.1, 7.0, "interior" if dmg else "shutter", wall="clad_light")
    win(B, "hallwin", "z", HZ1, 1, -12.6, -11.6, 0.1, 2.2, "door", wall="clad_light")
    win(B, "hallwin", "z", HZ1, 1, 1.6, 2.6, 0.1, 2.2, "door", wall="clad_light")
    if state == 0:
        B.box("sign", "sign_p", -9.0, -1.0, 5.6, 7.4, HZ1 + 0.02, HZ1 + 0.14)
    else:
        B.rbox("sign", "sign_p", np.array([-5.0, 6.2, HZ1 + 0.12]), np.array([4.0, 0.9, 0.06]), eul(0, 0, 11))
    if dmg:                                                                                  # cladding torn open
        for (x0, x1, y0, y1) in ((-11.0, -7.5, 3.4, 7.8), (-2.5, 0.5, 5.0, 8.2)):
            B.box("holes", "clad_light", x0, x1, y0, y1, HZ1 - 0.5, HZ1 + 0.4, sub=True)
            B.box("holes", "interior", x0, x1, y0, y1, HZ1 - 0.5, HZ1 - 0.45)
            for x in np.arange(x0 + 0.6, x1, 1.2):
                B.rod("holes", "steel", (x, y0, HZ1 - 0.2), (x, y1, HZ1 - 0.2), 0.05)
            B.fires.append((np.array([(x0 + x1) / 2, y1, HZ1]), np.array([0, 0, 1.0]), (x1 - x0) / 2 + 0.4))
        B.rbox("holes", "clad_light", np.array([-9.0, 0.3, HZ1 + 1.6]), np.array([1.7, 0.05, 1.1]), eul(4, 20, 3))
        B.box("roof", "roof_grey", -6.0, -3.0, HH - 0.2, ridge + 1.0, zc - 0.2, HZ1 + 0.6, sub=True)
        B.box("roof", "interior", -6.0, -3.0, HH - 0.6, HH - 0.5, zc - 0.2, HZ1 - 0.3)
        for x in np.arange(-5.6, -3.0, 0.9):
            B.rod("roof", "beam_burnt", (x, ridge - 0.2, zc), (x, HH - 0.1, HZ1 + 0.4), 0.07)


def boiler_house(B, rng, state):
    dmg = state == 1
    B.box("boiler", "clad_dark", BX0, BX1, 0.1, BH, BZ0, BZ1)
    B.box("boiler", "clad_blue", BX0 - 0.05, BX1 + 0.05, 0.1, 3.0, BZ0 - 0.05, BZ1 + 0.05)
    B.box("boiler", "steel", BX0 - 0.2, BX1 + 0.2, BH, BH + 0.5, BZ0 - 0.2, BZ1 + 0.2)
    B.box("boiler", "roofdeck", BX0, BX1, BH + 0.45, BH + 0.55, BZ0, BZ1)
    for y in (6.5, 13.0, 18.5):                                                              # window bands
        win(B, "boilwin", "z", BZ1, 1, BX0 + 0.8, BX1 - 0.8, y, y + 1.2, "interior" if dmg else "glass_ind", wall="clad_dark")
        win(B, "boilwin", "x", BX1, 1, BZ0 + 1.0, BZ1 - 1.0, y, y + 1.2, "interior" if (dmg and y > 10) else "glass_ind", wall="clad_dark")
    # outside stair tower on the right
    sx0, sx1 = BX1, BX1 + 2.6
    for (x, z) in ((sx0 + 0.1, BZ1 - 0.2), (sx1, BZ1 - 0.2), (sx0 + 0.1, BZ1 - 3.6), (sx1, BZ1 - 3.6)):
        B.box("stair", "steel", x - 0.08, x + 0.08, 0.1, BH + 1.0, z - 0.08, z + 0.08)
    for k in range(7):
        y = 1.5 + k * 3.0
        B.box("stair", "steel", sx0, sx1, y, y + 0.1, BZ1 - 3.6, BZ1 - 0.2)
        B.box("stair", "hazard", sx1 - 0.06, sx1 + 0.06, y + 0.9, y + 1.0, BZ1 - 3.6, BZ1 - 0.2)
        a, b = (BZ1 - 3.4, BZ1 - 0.4) if k % 2 else (BZ1 - 0.4, BZ1 - 3.4)
        B.rbox("stair", "steel", np.array([(sx0 + sx1) / 2, y + 1.5, (a + b) / 2]), np.array([1.0, 0.06, 1.9]),
               eul(math.degrees(math.atan2(3.0, 3.0)) * (1 if k % 2 else -1), 0, 0))
    # flue duct to the chimney and pipes up the side
    B.box("duct", "clad_dark", CX - 1.1, CX + 1.1, 15.5, 17.8, CZ + 1.2, BZ0 + 0.1)
    for x in (BX0 - 0.6, BX0 - 1.4):
        B.rod("pipes", "silver", (x, 0.1, -1.0), (x, 14.0, -1.0), 0.28)
        B.rod("pipes", "silver", (x, 14.0, -1.0), (BX0 + 0.1, 14.0, -1.0), 0.28)


def chimney(B, rng, state, top=CHT):
    B.cyl("stack", "concrete", (CX, 0.6, CZ), 2.4, 0.5)
    B.p.append(Prim("rcone", "concrete", "stack", a=(CX, 0.6, CZ), b=(CX, top, CZ), r1=1.8, r2=1.25))
    if top >= CHT:
        for k in range(4):
            y0 = top - 8.0 + 2.0 * k
            r = 1.25 + (1.8 - 1.25) * (1 - (y0 + 1.0) / top) + 0.02
            B.cyl("stack", "band_red" if k % 2 == 0 else "paint_w", (CX, y0 + 1.0, CZ), r, 1.0)
        B.cyl("stack", "steel", (CX, top - 4.2, CZ), 2.1, 0.08)                              # gallery
        B.cyl("stack", "interior", (CX, top - 0.05, CZ), 1.0, 0.1)
        if state == 1:
            B.cyl("stack", "burnt", (CX, top - 0.9, CZ), 1.3, 0.9)


def tanks(B, rng, state):
    for (x0, x1, z0, z1) in ((-17.0, -2.5, -14.5, -14.2), (-17.0, -2.5, -6.6, -6.3), (-17.0, -16.7, -14.5, -6.3), (-2.8, -2.5, -14.5, -6.3)):
        B.box("bund", "concrete", x0, x1, 0.1, 1.1, z0, z1)
    for k, x in enumerate((-12.6, -6.4)):
        burnt = (state == 1 and k == 0) or (state == 2 and k == 1)
        burst = state == 2 and k == 0
        mat = "burnt" if (burnt or burst) else "tank_w"
        if burst:
            B.cyl("tanks", mat, (x, 1.6, -10.4), 3.0, 1.5)
            B.rbox("tanks", "burnt", np.array([x + 0.5, 2.4, -10.0]), np.array([2.4, 0.08, 2.0]), eul(30, 15, -20))
            B.rbox("tanks", "burnt", np.array([x - 1.5, 3.4, -11.0]), np.array([1.8, 0.08, 1.6]), eul(-40, 0, 35))
            continue
        B.cyl("tanks", mat, (x, 3.1, -10.4), 3.0, 3.0)
        B.ell("tanks", mat, (x, 6.1, -10.4), (3.0, 0.5, 3.0), cuts=[((0, -1.0, 0), 0.0)])
        B.rod("tanks", "steel", (x + 2.95, 0.1, -10.4), (x + 2.95, 6.3, -10.4), 0.05)        # ladder rail
        if burnt:
            B.fires.append((np.array([x, 6.2, -7.4]), np.array([0, 0, 1.0]), 2.6))
    B.rod("pipes", "silver", (-6.4, 0.6, -7.3), (-6.4, 0.6, -5.0), 0.2)
    B.rod("pipes", "silver", (-6.4, 0.6, -5.0), (HX0 + 4.0, 0.6, -5.0), 0.2)


def cooling_tower(B, rng, state):
    x0, x1, z0, z1, h = -16.4, -8.0, 7.4, 12.6, 6.0
    if state == 2:
        B.box("ct", "concrete", x0, x1, 0.1, 2.6, z0, z1)
        B.box("ct", "jalousie_g", x0 - 0.05, x1 + 0.05, 0.4, 2.2, z0 - 0.05, z1 + 0.05)
        heap(B, rng, "ct", (x0 + x1) / 2, (z0 + z1) / 2, 3.4, 2.0, 1.2, 14, y0=2.4)
        return
    B.box("ct", "concrete", x0, x1, 0.1, h, z0, z1)
    B.box("ct", "jalousie_g", x0 - 0.05, x1 + 0.05, 0.6, h - 1.4, z0 - 0.05, z1 + 0.05)
    for k, x in enumerate((x0 + 2.1, x1 - 2.1)):
        if state == 1 and k == 1:
            B.cyl("ct", "burnt", (x, h + 0.4, (z0 + z1) / 2), 1.9, 0.4)
            B.rbox("ct", "silver", np.array([x + 0.6, h + 0.9, (z0 + z1) / 2 + 0.5]), np.array([1.2, 0.05, 0.4]), eul(20, 40, 10))
            continue
        B.cyl("ct", "silver", (x, h + 0.7, (z0 + z1) / 2), 1.9, 0.7)
        B.cyl("ct", "interior", (x, h + 1.32, (z0 + z1) / 2), 1.6, 0.1)
        for a in range(3):
            R = eul(0, a * 60, 0)
            B.rbox("ct", "steel", np.array([x, h + 1.2, (z0 + z1) / 2]), np.array([1.5, 0.04, 0.12]), R)
    # pipe rack to the hall
    for z in (8.0, 10.0):
        for x in (-7.0, -4.0):
            B.rod("rack", "steel", (x, 0.1, z), (x, 4.2, z), 0.1)
    for z in (8.0, 10.0):
        B.rod("rack", "steel", (-8.0, 4.2, z), (-3.6, 4.2, z), 0.1)
    for dz in (-0.3, 0.3):
        B.rod("rack", "silver", (-8.0, 4.55, 9.0 + dz), (-3.4, 4.55, 9.0 + dz), 0.22)
        B.rod("rack", "silver", (-3.4, 4.55, 9.0 + dz), (-3.4, 4.55, HZ1 + 0.1), 0.22)


def switchyard(B, rng, state):
    x0, x1, z0, z1 = 6.2, 15.6, 5.8, 13.4
    B.box("sy", "gravel", x0, x1, 0.0, 0.14, z0, z1)
    for (a0, a1, b0, b1) in ((x0, x1, z1 - 0.06, z1), (x0, x0 + 0.06, z0, z1), (x1 - 0.06, x1, z0, z1)):
        if state == 2 and a0 == x0 and b0 == z0:
            continue
        B.box("sy", "fence", a0, a1, 0.1, 2.2, b0, b1)
    for k, x in enumerate((8.0, 10.9, 13.8)):
        burnt = state == 2 or (state == 1 and k == 1)
        m = "burnt" if burnt else "transformer"
        B.box("sy", m, x - 1.0, x + 1.0, 0.14, 2.4, 9.0, 11.4, rr=0.05)
        B.box("sy", m, x - 1.25, x + 1.25, 0.6, 2.0, 9.4, 11.0)                              # radiator fins
        for dx in (-0.55, 0.0, 0.55):
            B.cyl("sy", "insulator", (x + dx, 2.75, 10.2), 0.12, 0.38)
        if burnt:
            B.fires.append((np.array([x, 2.4, 11.4]), np.array([0, 0, 1.0]), 1.3))
    # the gantry and the lines into the hall
    for x in (7.0, 14.6):
        B.rod("sy", "steel", (x, 0.14, 7.0), (x, 8.0, 7.0), 0.16)
    if state < 2:
        B.rod("sy", "steel", (7.0, 8.0, 7.0), (14.6, 8.0, 7.0), 0.14)
        for x in (8.0, 10.9, 13.8):
            B.rod("sy", "steel", (x, 7.95, 7.0), (x, 2.9, 10.2), 0.03)
            if state == 0:
                B.rod("lines", "steel", (x, 7.95, 7.0), (HX1 - 0.4 + (x - 10.9) * 0.2, HH - 1.0, HZ1 - 0.2), 0.025)
            else:
                B.rod("lines", "steel", (x, 7.95, 7.0), (x - 1.2, 0.2, 7.8), 0.025)
    else:
        B.rod("sy", "steel", (14.6, 8.0, 7.0), (9.0, 0.3, 8.6), 0.14)


def gatehouse(B, rng, state):
    if state == 2:
        heap(B, rng, "gate", -1.5, 12.2, 1.8, 1.4, 0.7, 8)
        return
    B.box("gate", "white", -3.0, 0.0, 0.1, 2.8, 11.0, 13.4)
    B.box("gate", "roof_grey", -3.3, 0.3, 2.8, 2.95, 10.7, 13.7)
    win(B, "gate", "z", 11.0, -1, -2.6, -0.4, 1.0, 2.2, "interior" if state else "glass_win", wall="white")
    B.box("gate", "sign_p", -2.8, -0.2, 2.95, 3.55, 11.95, 12.05)
    B.cyl("gate", "hazard", (0.6, 0.6, 12.3), 0.18, 0.5)
    if state == 0:
        B.rod("gate", "hazard", (0.6, 1.0, 12.3), (6.0, 1.0, 12.3), 0.07)
    else:
        B.rod("gate", "hazard", (0.6, 1.0, 12.3), (4.6, 0.15, 13.6), 0.07)
        sandbag_row(B, "sandbags", 1.0, 5.6, 13.9, 0.1, rows=3)


def ruins(B, rng):
    # turbine hall: cladding stripped to the frame, part of the walls left, roof down inside
    frame_columns(B, "hall", HX0, HX1, HZ0, HZ1, HH - 0.3, 5.0)
    for x in np.arange(HX0, HX1 - 1, 5.0):
        if rng.uniform() < 0.7:
            B.box("hall", "steel", x, x + 5.0, HH - 0.6, HH - 0.2, HZ1 - 0.2, HZ1 + 0.2)
    for (face, z) in ((HZ1, HZ1 - 0.15), (HZ0, HZ0)):
        x = HX0
        while x < HX1 - 0.5:
            w = rng.uniform(1.5, 4.0)
            top = rng.uniform(0.8, 7.0) if rng.uniform() < 0.7 else 0.0
            if top > 0:
                B.box("hall", "clad_light", x, min(x + w, HX1), 0.1, top, z, z + 0.15)
                B.box("hall", "clad_blue", x - 0.02, min(x + w, HX1) + 0.02, 0.1, min(top, 3.0), z - 0.03, z + 0.18)
            x += w
    B.box("hall", "clad_light", HX0 - 0.15, HX0, 0.1, 9.0, HZ0, HZ1)
    for (cx, cz, a, b) in ((-11.0, 0.5, 14, -10), (-3.5, 1.5, -12, 8)):
        R = eul(a, 0, b)
        B.rbox("hall", "roof_grey", np.array([cx, 2.0, cz]), np.array([4.0, 0.08, 4.6]), R, axis=0)
    heap(B, rng, "hall", -6.0, 1.0, 7.5, 4.0, 1.3, 24)
    # boiler house collapsed to half its height, its frame sticking out
    B.box("boiler", "clad_dark", BX0, BX1, 0.1, 9.0, BZ0, BZ1)
    B.box("boiler", "clad_blue", BX0 - 0.05, BX1 + 0.05, 0.1, 3.0, BZ0 - 0.05, BZ1 + 0.05)
    for x in (BX0, BX1):
        for z in (BZ0, BZ1):
            B.box("boiler", "steel", x - 0.25, x + 0.25, 9.0, 9.0 + rng.uniform(1.5, 5.0), z - 0.25, z + 0.25)
    B.box("boiler", "clad_dark", BX0 + 0.5, BX1 - 0.5, 8.0, 10.5, BZ0 + 0.5, BZ1 - 0.5, sub=True)
    heap(B, rng, "boiler", (BX0 + BX1) / 2, (BZ0 + BZ1) / 2, 3.6, 5.4, 1.4, 16, y0=8.0)
    # the chimney broken at 15 m, its top lying across the yard
    chimney(B, rng, 2, top=15.0)
    for k in range(4):                                                                       # jagged break
        a = k * math.pi / 2 + 0.4
        B.rbox("stack", "concrete", np.array([CX + 1.2 * math.cos(a), 15.4, CZ + 1.2 * math.sin(a)]), np.array([0.5, 0.6, 0.25]),
               eul(0, math.degrees(-a), rng.uniform(-15, 15)))
    a = np.array([CX - 2.2, 1.35, -8.2])
    b = a + 17.0 * np.array([-0.985, 0.0, 0.17]) - np.array([0, 0.1, 0])                   # fell into the gap behind the hall
    B.p.append(Prim("rcone", "concrete", "fallen", a=tuple(a), b=tuple(b), r1=1.3, r2=1.25))
    for k in range(4):
        t = 0.62 + 0.09 * k
        p = a + (b - a) * t
        B.p.append(Prim("rcone", "band_red" if k % 2 == 0 else "paint_w", "fallen", a=tuple(p), b=tuple(p + (b - a) * 0.085), r1=1.3, r2=1.3))
    heap(B, rng, "fallen", CX - 1.2, CZ + 2.0, 2.6, 2.4, 1.0, 12)
    B.box("duct", "clad_dark", CX - 1.1, CX + 1.1, 0.1, 1.5, CZ + 2.6, BZ0 - 0.2)
    debris(B, rng, "debris", 70, (-16.5, 15.5, -14, 13.2), mats=("rubble", "concrete", "clad_light", "clad_dark"))


FRONT = "the gate, the switchyard and the turbine hall's long side"
PIVOT = "the middle of the plant's yard (the chimney stands behind the boiler house, right of centre)"
FOOTPRINT = {"turbine_hall": [20.0, 10.0], "boiler_house": [8.0, 12.0], "yard": [33.0, 28.2]}
HEIGHT = {"turbine_hall": HH, "boiler_house": BH + 0.55, "chimney": CHT}

"""Toledo mid-rise: a five-storey concrete-frame commercial and residential block.

Building space: x = width (10 m), y = up, z = depth (12 m), +z = the street front. Exposed concrete
frame (columns and floor bands) with painted infill, three shops on the ground floor behind roll-up
shutters under a concrete marquee carrying their signs, four residential floors with aluminium
windows (steel grilles on the lower two), balconies with laundry and plants on the front, window
air-conditioners, a blank firewall on the left side with a drain pipe, a side entrance on the right,
and a rooftop with a parapet, a stair housing, water tanks, a stainless tank, solar panels, a dish,
an antenna and a washing line.

States: 0 intact; 1 damaged (shot up, windows blown out with soot plumes, a burnt-out top corner,
boarded and sandbagged shop fronts, fallen signs and debris); 2 destroyed (the right half of the
upper floors has pancaked onto the second floor, a slab hangs off the break, the rest is a burnt-out
frame with its walls blown out; rubble fills the street).
"""
import math

import numpy as np

from bsdf import Prim, Scene, eul
from townhouse import GOODS, Builder, MAT, shade   # noqa: F401  (shared materials and shading)

W2, D2 = 5.0, 6.0
LV = [0.0, 3.8, 7.0, 10.2, 13.4, 16.6]          # floor levels
RL = LV[-1]
COLS_X = (-5.0, -1.65, 1.65, 5.0)
COLS_Z = (-6.0, -2.0, 2.0, 6.0)
BAYS_X = (-3.3, 0.0, 3.3)                        # window centres, front and back
BAYS_Z = (-4.0, 0.0, 4.0)                        # window centres, right side
SHOPS = ((-4.55, -2.05), (-1.25, 1.25), (2.05, 4.55))
SIGNS = ("sign", "sign_b", "sign_g")
CLOTHES = [(0.85, 0.2, 0.2), (0.95, 0.95, 0.9), (0.2, 0.45, 0.85), (0.95, 0.75, 0.2), (0.35, 0.7, 0.4)]


def sidewalk(B):
    B.box("base", "concrete", -W2 - 0.15, W2 + 0.15, 0.0, 0.15, -D2 - 0.15, D2 + 0.15)
    B.box("base", "concrete", -W2 - 0.15, W2 + 1.6, 0.0, 0.12, D2, D2 + 2.6)         # front sidewalk
    B.box("base", "concrete", W2, W2 + 1.6, 0.0, 0.12, -D2 - 0.15, D2)                 # right sidewalk
    B.box("base", "base", -W2 - 0.15, W2 + 1.6, 0.0, 0.18, D2 + 2.48, D2 + 2.6)        # curbs
    B.box("base", "base", W2 + 1.48, W2 + 1.6, 0.0, 0.18, -D2 - 0.15, D2 + 2.6)


def window(B, g, face, u, f, width, mat, broken=False, h=1.6):
    """face 'f' front, 'b' back, 'r' right; recess + glass (or dark when broken)"""
    y0, y1 = LV[f] + 0.85, LV[f] + 0.85 + h
    if face == "f":
        B.box(g, "beige", u - width / 2, u + width / 2, y0, y1, D2 - 0.18, D2 + 0.4, sub=True)
        B.box(g, "interior" if broken else mat, u - width / 2, u + width / 2, y0, y1, D2 - 0.14, D2 - 0.1)
    elif face == "b":
        B.box(g, "beige", u - width / 2, u + width / 2, y0, y1, -D2 - 0.4, -D2 + 0.18, sub=True)
        B.box(g, "interior" if broken else mat, u - width / 2, u + width / 2, y0, y1, -D2 + 0.1, -D2 + 0.14)
    else:
        B.box(g, "beige", W2 - 0.18, W2 + 0.4, y0, y1, u - width / 2, u + width / 2, sub=True)
        B.box(g, "interior" if broken else mat, W2 - 0.14, W2 - 0.1, y0, y1, u - width / 2, u + width / 2)


def ac_unit(B, face, u, y):
    if face == "f":
        B.box("ac", "ac", u - 0.33, u + 0.33, y, y + 0.42, D2, D2 + 0.5, rr=0.03)
    elif face == "b":
        B.box("ac", "ac", u - 0.33, u + 0.33, y, y + 0.42, -D2 - 0.5, -D2, rr=0.03)
    elif face == "r":
        B.box("ac", "ac", W2, W2 + 0.5, y, y + 0.42, u - 0.33, u + 0.33, rr=0.03)
    else:
        B.box("ac", "ac", -W2 - 0.5, -W2, y, y + 0.42, u - 0.33, u + 0.33, rr=0.03)


def balcony(B, f, rng, laundry=False, plant=False, rail_gap=False):
    y = LV[f]
    B.box("balc", "frame", -1.45, 1.45, y - 0.18, y + 0.04, D2, D2 + 1.25)
    B.box("balc", "beige", -1.0, 1.0, y + 0.05, y + 2.5, D2 - 0.2, D2 + 0.4, sub=True)
    B.box("balc", "glass_door", -1.0, 1.0, y + 0.05, y + 2.5, D2 - 0.16, D2 - 0.12)
    top = y + 1.05
    xs = np.arange(-1.38, 1.39, 0.3)
    for x in xs:
        if rail_gap and -0.6 < x < 0.7:
            continue
        B.rod("rail", "grille", (x, y + 0.04, D2 + 1.2), (x, top, D2 + 1.2), 0.018)
    if rail_gap:
        B.rod("rail", "grille", (-1.4, top, D2 + 1.2), (-0.65, top, D2 + 1.2), 0.03)
        B.rod("rail", "grille", (0.75, top, D2 + 1.2), (1.4, top - 0.4, D2 + 1.35), 0.03)
    else:
        B.rod("rail", "grille", (-1.4, top, D2 + 1.2), (1.4, top, D2 + 1.2), 0.03)
    for x in (-1.4, 1.4):
        B.rod("rail", "grille", (x, top, D2 + 0.05), (x, top, D2 + 1.2), 0.03)
        for z in (D2 + 0.45, D2 + 0.85):
            B.rod("rail", "grille", (x, y + 0.04, z), (x, top, z), 0.018)
    if laundry:
        B.rod("rail", "steel", (-1.3, y + 2.2, D2 + 0.9), (1.3, y + 2.2, D2 + 0.9), 0.012)
        x = -1.15
        for k in range(5):
            w = rng.uniform(0.3, 0.45)
            col = CLOTHES[k % len(CLOTHES)]
            B.box("rail", "cloth", x, x + w, y + 1.55 + rng.uniform(0, 0.25), y + 2.18, D2 + 0.88, D2 + 0.92, col=col)
            x += w + 0.08
    if plant:
        for x in (-1.1, 1.05):
            B.p.append(Prim("rcone", "pot", "rail", a=(x, y + 0.04, D2 + 0.95), b=(x, y + 0.36, D2 + 0.95), r1=0.12, r2=0.16))
            B.ell("rail", "leaf", (x, y + 0.66, D2 + 0.95), (0.28, 0.32, 0.28))


def rooftop(B, rng, state):
    B.box("deck", "roofdeck", -W2, W2, RL, RL + 0.1, -D2, D2)
    for (x0, x1, z0, z1) in ((-W2 - 0.12, W2 + 0.12, D2 - 0.2, D2 + 0.12), (-W2 - 0.12, W2 + 0.12, -D2 - 0.12, -D2 + 0.2),
                             (-W2 - 0.12, -W2 + 0.2, -D2, D2), (W2 - 0.2, W2 + 0.12, -D2, D2)):
        B.box("parapet", "frame", x0, x1, RL, RL + 1.0, z0, z1)
        B.box("parapet", "concrete", x0 - 0.03, x1 + 0.03, RL + 1.0, RL + 1.08, z0 - 0.03, z1 + 0.03)
    # stair housing with its door
    B.box("stairhouse", "beige", -4.7, -1.7, RL, RL + 2.8, -5.7, -2.7)
    B.box("stairhouse", "frame", -4.85, -1.55, RL + 2.8, RL + 2.95, -5.85, -2.55)
    B.box("stairhouse", "beige", -3.7, -2.7, RL + 0.1, RL + 2.2, -2.9, -2.5, sub=True)
    B.box("stairhouse", "door", -3.7, -2.7, RL + 0.1, RL + 2.2, -2.86, -2.82)
    # water tanks on a stand
    B.box("tanks", "steel", 1.1, 4.6, RL + 0.75, RL + 0.9, -5.3, -3.5)
    for x in (1.2, 4.5):
        for z in (-5.2, -3.6):
            B.box("tanks", "steel", x - 0.05, x + 0.05, RL + 0.1, RL + 0.75, z - 0.05, z + 0.05)
    if state == 1:
        B.cyl("tanks", "tank", (2.0, RL + 1.7, -4.4), 0.7, 0.8)
        B.cyl("tanks", "tank", (3.4, RL + 0.8, -1.7), 0.7, 0.8, R=eul(0, 25, 88))          # knocked over
    else:
        for x in (2.0, 3.7):
            B.cyl("tanks", "tank", (x, RL + 1.7, -4.4), 0.7, 0.8)
            B.cyl("tanks", "tank", (x, RL + 2.53, -4.4), 0.38, 0.04)
        B.cyl("tanks", "silver", (2.8, RL + 0.65, -1.6), 0.5, 1.0, R=eul(0, 0, 90))
        for x in (2.0, 3.6):
            B.box("tanks", "steel", x - 0.08, x + 0.08, RL + 0.1, RL + 0.25, -2.1, -1.1)
    # solar panels, satellite dish, antenna, washing line
    for k in range(3):
        x = -0.9 + k * 1.25
        B.rbox("roofkit", "solar", np.array([x, RL + 0.55, 2.6]), np.array([0.55, 0.025, 0.9]), eul(-18, 0, 0))
        B.box("roofkit", "steel", x - 0.04, x + 0.04, RL + 0.1, RL + 0.5, 3.0, 3.1)
    dish_tilt = (35, 30, 0) if state == 1 else (55, 220, 0)
    B.rod("roofkit", "steel", (3.9, RL + 0.1, 4.6), (3.9, RL + 1.0, 4.6), 0.04)
    B.ell("roofkit", "dish", (3.9, RL + 1.15, 4.6), (0.45, 0.07, 0.45), R=eul(*dish_tilt))
    B.rod("roofkit", "steel", (-3.2, RL + 2.95, -4.2), (-3.2, RL + 5.0, -4.2), 0.035)
    for y, L in ((RL + 4.3, 0.6), (RL + 4.75, 0.4)):
        B.rod("roofkit", "steel", (-3.2 - L, y, -4.2), (-3.2 + L, y, -4.2), 0.02)
    B.rod("roofkit", "steel", (-4.2, RL + 0.1, 1.0), (-4.2, RL + 1.9, 1.0), 0.03)
    B.rod("roofkit", "steel", (-4.2, RL + 0.1, 4.8), (-4.2, RL + 1.9, 4.8), 0.03)
    B.rod("roofkit", "steel", (-4.2, RL + 1.85, 1.0), (-4.2, RL + 1.85, 4.8), 0.01)
    z = 1.3
    for k in range(5):
        w = rng.uniform(0.4, 0.6)
        B.box("roofkit", "cloth", -4.24, -4.16, RL + 1.15 + rng.uniform(0, 0.2), RL + 1.83, z, z + w, col=CLOTHES[k % 5])
        z += w + 0.12


def build(state=0):
    B = Builder(seed=21 + state)
    rng = B.rng
    sidewalk(B)
    fires = []
    if state < 2:
        # ------------------------------------------------------------ the block, frame and floor bands
        B.box("core", "beige", -W2, W2, 0.15, RL, -D2, D2)
        for L in LV[1:]:
            B.box("bands", "frame", -W2 - 0.12, W2 + 0.12, L - 0.42, L + 0.02, -D2 - 0.12, D2 + 0.12)
        for x in COLS_X:
            B.box("cols", "frame", x - 0.25, x + 0.25, 0.15, RL, D2 - 0.1, D2 + 0.18)
            B.box("cols", "frame", x - 0.25, x + 0.25, 0.15, RL, -D2 - 0.18, -D2 + 0.1)
        for z in COLS_Z:
            B.box("cols", "frame", W2 - 0.1, W2 + 0.18, 0.15, RL, z - 0.25, z + 0.25)
            B.box("cols", "frame", -W2 - 0.18, -W2 + 0.1, 0.15, RL, z - 0.25, z + 0.25)
        # ------------------------------------------------------------ windows, balconies, AC units
        burnt = {("f", 2, 4), ("r", 4, 4), ("f", 2, 3), ("r", 4, 3)} if state == 1 else set()
        for f in range(1, 5):
            mat = "glass_grille" if f <= 2 else "glass_win"
            for i, u in enumerate(BAYS_X):
                if i == 1 and f >= 2:
                    continue                                    # balcony bay
                br = state == 1 and ((i, f) in ((0, 1), (2, 2), (0, 3)) or ("f", i, f) in burnt)
                window(B, f"wf{f}", "f", u, f, 2.0, mat, broken=br)
                if br:
                    fires.append((np.array([u, LV[f] + 2.3, D2]), np.array([0, 0, 1.0]), 0.9))
                bk = state == 1 and (i, f) in ((1, 2), (2, 4))
                window(B, f"wb{f}", "b", u, f, 2.0, mat, broken=bk)
            for i, u in enumerate(BAYS_Z):
                br = state == 1 and ((i, f) in ((0, 2),) or ("r", i, f) in burnt)
                window(B, f"wr{f}", "r", u, f, 2.2, mat, broken=br)
                if br:
                    fires.append((np.array([W2, LV[f] + 2.3, u]), np.array([1.0, 0, 0]), 0.9))
        for f in (2, 3, 4):
            balcony(B, f, rng, laundry=(f == 3 and state == 0), plant=(f == 4), rail_gap=(f == 3 and state == 1))
        for (face, u, f) in (("f", 3.3, 1), ("f", -3.3, 3), ("r", -4.0, 1), ("r", 4.0, 3), ("r", 0.0, 4),
                             ("b", 0.0, 1), ("b", -3.3, 2), ("b", 3.3, 4), ("l", -3.6, 1), ("l", 0.8, 2),
                             ("l", -1.6, 3), ("l", 3.0, 4), ("l", 4.4, 2)):
            if state == 1 and (face, u, f) in (("f", 3.3, 1), ("r", 4.0, 3)):
                continue                                        # fallen
            y = LV[f] + 0.5 if face != "l" else LV[f] + 1.3
            ac_unit(B, face, u, y)
        B.rod("ac", "steel", (-W2 - 0.12, 0.2, -5.0), (-W2 - 0.12, RL + 0.9, -5.0), 0.07)   # drain pipe
        # ------------------------------------------------------------ ground floor: shops, marquee, signs
        for k, (x0, x1) in enumerate(SHOPS):
            B.box("shops", "beige", x0, x1, 0.15, 3.15, D2 - 0.55, D2 + 0.4, sub=True)
            B.box("shops", "steel", x0, x1, 2.95, 3.15, D2 - 0.5, D2 - 0.3)                   # shutter housing
            if k == 1:                                                                         # open store
                B.box("shops", "interior", x0, x1, 0.15, 3.15, D2 - 0.56, D2 - 0.5)
                for y in (0.9, 1.45, 2.0):
                    B.box("shops", "wood", x0 + 0.05, x1 - 0.05, y - 0.03, y, D2 - 0.5, D2 - 0.36)
                    x = x0 + 0.1
                    while x < x1 - 0.2:
                        w = rng.uniform(0.09, 0.16)
                        B.box("shops", "goods", x, x + w, y, y + rng.uniform(0.1, 0.22), D2 - 0.49, D2 - 0.39,
                              col=GOODS[rng.integers(len(GOODS))])
                        x += w + 0.02
                if state == 1:                                                                 # boarded + sandbags
                    for y, ang in ((0.8, 3), (1.4, -4), (2.0, 5), (2.6, -2)):
                        B.rbox("shops", "plywood", np.array([(x0 + x1) / 2, y, D2 + 0.05]), np.array([1.35, 0.16, 0.025]), eul(0, 0, ang))
                    for j in range(5):
                        B.ell("shops", "sandbag", (x0 + 0.25 + j * 0.5, 0.3, D2 + 0.45), (0.27, 0.15, 0.2), R=eul(0, rng.uniform(-10, 10), 0))
                    for j in range(4):
                        B.ell("shops", "sandbag", (x0 + 0.5 + j * 0.5, 0.58, D2 + 0.45), (0.27, 0.15, 0.2), R=eul(0, rng.uniform(-10, 10), 0))
                else:
                    B.box("shops", "wood", x0 + 0.1, x1 - 0.1, 0.8, 0.9, D2 - 0.1, D2 + 0.3)     # counter
            else:
                low = 0.15 if k == 0 else 1.7
                if state == 1 and k == 0:
                    B.rbox("shops", "shutter", np.array([(x0 + x1) / 2, 1.75, D2 - 0.42]), np.array([(x1 - x0) / 2, 1.2, 0.03]), eul(6, 0, 3))
                else:
                    B.box("shops", "shutter", x0, x1, low, 2.95, D2 - 0.45, D2 - 0.39)
                if low > 0.2:
                    B.box("shops", "interior", x0, x1, 0.15, low, D2 - 0.56, D2 - 0.5)
        B.box("marquee", "frame", -W2 - 0.15, W2 + 0.15, 3.42, 3.75, D2, D2 + 1.7)
        for k, (x0, x1) in enumerate(SHOPS):
            if state == 1 and k == 2:
                B.rbox("marquee", SIGNS[k], np.array([(x0 + x1) / 2 + 0.6, 0.16, D2 + 2.2]), np.array([1.3, 0.035, 0.4]), eul(0, 18, 3))
            elif state == 1 and k == 1:
                B.rbox("marquee", SIGNS[k], np.array([(x0 + x1) / 2, 3.72, D2 + 1.74]), np.array([1.3, 0.38, 0.03]), eul(0, 0, -12))
            else:
                B.box("marquee", SIGNS[k], x0 - 0.05, x1 + 0.05, 3.38, 4.15, D2 + 1.7, D2 + 1.76)
        # side entrance (right) with a canopy
        B.box("entry", "beige", W2 - 0.3, W2 + 0.4, 0.15, 2.6, 2.6, 4.0, sub=True)
        B.box("entry", "glass_door", W2 - 0.26, W2 - 0.22, 0.15, 2.6, 2.6, 4.0)
        B.box("entry", "frame", W2, W2 + 1.0, 2.78, 2.92, 2.4, 4.2)
        if state == 1:                                                                         # barricaded
            for j in range(4):
                for r in range(3):
                    B.ell("entry", "sandbag", (W2 + 0.45, 0.26 + r * 0.27, 2.55 + j * 0.42 + (r % 2) * 0.2), (0.2, 0.14, 0.26))
            B.rbox("entry", "plywood", np.array([W2 + 0.08, 1.6, 3.3]), np.array([0.025, 0.9, 0.12]), eul(0, 0, 0) @ eul(35, 0, 0))
        rooftop(B, rng, state)
        if state == 1:
            for _ in range(26):                                                                # debris and glass
                x, z = rng.uniform(-5, 6.4), rng.uniform(6.3, 8.4)
                s = rng.uniform(0.05, 0.22)
                mat = "glass" if rng.uniform() < 0.3 else "rubble"
                B.rbox("debris", mat, np.array([x, s * 0.5, z]), np.array([s, s * 0.4, s * 0.7]),
                       eul(rng.uniform(-30, 30), rng.uniform(0, 180), rng.uniform(-30, 30)), rr=0.01)
            B.rbox("debris", "ac", np.array([4.0, 0.25, 7.3]), np.array([0.33, 0.21, 0.25]), eul(10, 40, 70), rr=0.03)
            B.rbox("debris", "ac", np.array([W2 + 0.9, 0.25, 3.0]), np.array([0.33, 0.21, 0.25]), eul(-5, 10, 95), rr=0.03)
            B.rbox("debris", "plywood", np.array([-3.0, 0.08, 7.7]), np.array([1.1, 0.025, 0.6]), eul(0, 25, 3))
    else:
        destroyed(B, rng)
    sc = Scene(B.p)
    sc.wear = state
    sc.fires = fires
    return sc


def destroyed(B, rng):
    """the right half of floors 3-5 pancaked onto floor 2; a burnt-out frame stands on the left"""
    edge = 0.15
    # ---- left half: columns, slabs, firewall, back wall
    for x in (-5.0, -1.65):
        for z in COLS_Z:
            top = RL if not (x == -1.65 and z == 6.0) else LV[4] - 0.6
            B.box("lcols", "frame", x - 0.24, x + 0.24, 0.15, top, z - 0.24, z + 0.24)
    for k, L in enumerate(LV[1:]):
        e = edge + rng.uniform(-0.4, 0.3)
        x0 = -W2 - 0.12
        x1 = e if L < RL else -0.9
        B.box("lslab", "frame", x0, x1, L - 0.42, L - 0.25, -D2 - 0.12, D2 + 0.12)
        B.box("lslab", "concrete", x0 + 0.1, x1, L - 0.25, L, -D2, D2)
        for j in range(4):                                                                     # rebar at the break
            z = rng.uniform(-5.5, 5.5)
            B.rod("rebar", "rebar", (x1, L - 0.15, z), (x1 + rng.uniform(0.3, 0.7), L - 0.15 - rng.uniform(0.05, 0.5), z + rng.uniform(-0.2, 0.2)), 0.022)
    for f in range(5):                                                                         # left firewall, holed
        y0, y1 = LV[f] + 0.15 if f == 0 else LV[f], LV[f + 1] - 0.42
        B.box("lwall", "beige", -W2, -W2 + 0.2, y0, y1, -D2, D2)
        if f >= 2:
            z = rng.uniform(-3, 3)
            B.box("lwall", "beige", -W2 - 0.3, -W2 + 0.4, y0 + rng.uniform(0.4, 1.0), y1, z - rng.uniform(0.6, 1.4), z + rng.uniform(0.6, 1.4), sub=True)
    for f in range(4):                                                                         # back wall, left half
        y0, y1 = (0.15 if f == 0 else LV[f]), LV[f + 1] - 0.42
        B.box("lwall", "beige", -W2, edge - 0.3 - f * 0.4, y0, y1, -D2, -D2 + 0.2)
        B.box("lwall", "beige", -4.1, -2.5, LV[f] + 0.85 if f else 1.0, LV[f] + 2.4 if f else 2.4, -D2 - 0.3, -D2 + 0.4, sub=True)
    B.box("lwall", "beige", -W2, -2.1, 0.15, 3.15, D2 - 0.2, D2)                              # ground floor front stub
    B.box("lwall", "beige", -4.55, -2.05, 0.15, 3.15, D2 - 0.4, D2 + 0.2, sub=True)
    B.box("lwall", "shutter", -4.55, -2.05, 0.15, 2.95, D2 - 0.25, D2 - 0.19)
    B.box("lwall", "beige", -W2, -3.6, LV[1], LV[2] - 0.42, D2 - 0.2, D2)                      # a front panel, floor 2
    # interiors seen through the blown-out walls: burnt partitions, furniture
    for f in range(1, 4):
        for _ in range(3):
            x, z = rng.uniform(-4.4, -0.8), rng.uniform(-5, 5)
            B.box("lint", "burnt", x, x + rng.uniform(0.4, 1.2), LV[f], LV[f] + rng.uniform(0.4, 1.1), z, z + rng.uniform(0.3, 0.9))
        B.box("lint", "beige", -2.6, -2.45, LV[f], LV[f] + rng.uniform(1.2, 2.6), -5.8, rng.uniform(-3, 1))
    # roof stair housing on the left, still standing
    B.box("stairhouse", "beige", -4.7, -1.7, RL, RL + 2.8, -5.7, -2.7)
    B.box("stairhouse", "frame", -4.85, -1.55, RL + 2.8, RL + 2.95, -5.85, -2.55)
    B.box("lparapet", "frame", -W2 - 0.12, -W2 + 0.2, RL, RL + 1.0, -D2, D2)
    B.box("lparapet", "frame", -W2 - 0.12, -1.4, RL, RL + 1.0, -D2 - 0.12, -D2 + 0.2)
    # ---- right half: two storeys stand, the rest came down on them
    for x in (1.65, 5.0):
        for z in COLS_Z:
            top = LV[2] + rng.uniform(0.2, 1.1)
            B.box("rcols", "frame", x - 0.24, x + 0.24, 0.15, top, z - 0.24, z + 0.24)
            for dx in (-0.1, 0.1):
                B.rod("rebar", "rebar", (x + dx, top, z), (x + dx * 2.5 + rng.uniform(-0.1, 0.1), top + rng.uniform(0.3, 0.7), z + rng.uniform(-0.15, 0.15)), 0.022)
    for L in (LV[1], LV[2]):
        B.box("rslab", "frame", edge - 0.2, W2 + 0.12, L - 0.42, L - 0.25, -D2 - 0.12, D2 + 0.12)
        B.box("rslab", "concrete", edge - 0.2, W2, L - 0.25, L, -D2, D2)
    B.box("rwall", "beige", W2 - 0.2, W2, 0.15, 3.15, -D2, 1.8)                               # ground floor right wall
    B.box("rwall", "beige", W2 - 0.2, W2, LV[1], LV[2] - 0.42, -D2, -1.0)
    B.box("rwall", "beige", 0.6, W2, 0.15, 3.15, -D2, -D2 + 0.2)
    # the pancaked slabs lying on floor 2, and one hanging from the left half's top floors
    for k, (dy, ang, sh) in enumerate(((0.45, (4, 0, -6), 0.0), (1.0, (-7, 8, -10), 0.4), (1.6, (6, -5, -15), 0.8))):
        c = np.array([2.6 + sh, LV[2] + dy, 0.2 + rng.uniform(-0.6, 0.6)])
        B.rbox("pancake", "concrete", c, np.array([2.6, 0.13, 5.6]), eul(*ang))
        B.rbox("pancake", "frame", c + np.array([0, -0.2, 0]), np.array([2.5, 0.08, 5.5]), eul(*ang))
        for _ in range(8):
            p = c + np.array([rng.uniform(-2.2, 2.2), 0.18, rng.uniform(-5, 5)])
            s = rng.uniform(0.12, 0.4)
            B.rbox("pancake", "rubble", p, np.array([s, s * 0.6, s * 0.8]), eul(rng.uniform(-40, 40), rng.uniform(0, 180), rng.uniform(-40, 40)), rr=0.03)
    hang = np.array([2.5, (LV[4] + LV[2] + 2.4) / 2, 0.0])
    ang = math.degrees(math.atan2(LV[4] - (LV[2] + 2.4), 5.0))
    B.rbox("pancake", "concrete", hang, np.array([2.7, 0.13, 5.8]), eul(0, 0, -ang))
    B.rbox("pancake", "beige", hang + np.array([0.3, 0.6, 5.7]), np.array([2.2, 0.7, 0.1]), eul(0, 0, -ang))       # wall stuck to it
    # rubble spilling into the street and the right sidewalk
    B.ell("rubble", "rubble", (3.5, 0.2, 6.8), (3.4, 1.3, 2.4))
    B.ell("rubble", "rubble", (6.3, 0.2, 0.5), (1.6, 1.0, 5.5))
    for _ in range(55):
        x, z = rng.uniform(0.5, 7.0), rng.uniform(-5.5, 9.0)
        if x < 5.2 and z < 5.8:
            continue
        s = rng.uniform(0.12, 0.5)
        B.rbox("chunks", "rubble", np.array([x, rng.uniform(0.1, 0.9), z]), np.array([s, s * 0.6, s * 0.8]),
               eul(rng.uniform(-40, 40), rng.uniform(0, 180), rng.uniform(-40, 40)), rr=0.03)
    # the marquee: the left part holds, the right part hangs down to the sidewalk
    B.box("marquee", "frame", -W2 - 0.15, -0.6, 3.42, 3.75, D2, D2 + 1.7)
    B.box("marquee", "sign", -4.6, -2.0, 3.38, 4.15, D2 + 1.7, D2 + 1.76)
    B.rbox("marquee", "frame", np.array([2.3, 2.1, D2 + 0.9]), np.array([2.9, 0.16, 0.85]), eul(0, 0, -32))
    B.rbox("marquee", "sign_b", np.array([0.4, 0.15, D2 + 2.6]), np.array([1.3, 0.035, 0.4]), eul(0, -14, 4))
    B.rbox("marquee", "sign_g", np.array([4.6, 0.6, D2 + 2.3]), np.array([1.3, 0.035, 0.4]), eul(20, 30, 35))
    # tanks and a solar panel fell into the street
    B.cyl("tanks", "tank", (6.2, 0.75, 7.8), 0.7, 0.8, R=eul(0, 60, 90))
    B.cyl("tanks", "silver", (-2.0, 0.5, 8.0), 0.5, 1.0, R=eul(0, 10, 90))
    B.rbox("tanks", "solar", np.array([1.0, 0.25, 8.0]), np.array([0.55, 0.025, 0.9]), eul(-14, 50, 10))

FOOTPRINT = {"walls": [10.0, 12.0], "with_sidewalks_marquee": [11.75, 14.75]}
HEIGHT = {"roof": 16.6, "parapet": 17.6, "stair_housing": 19.55, "antenna": 21.6}

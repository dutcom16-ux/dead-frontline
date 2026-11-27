"""Toledo bungalow: a single-storey Filipino concrete house on its own fenced lot (generic design).

Building space: x = width, y = up, z = depth, +z = the street front. A raised house (9 x 7 m) in
pastel-painted plaster with white trim, a front porch on three columns behind a ventilation-block
railing, sliding windows with steel grilles, a panel door, a blue corrugated hip roof over house and
porch; a carport on the right with a tricycle under a single-slope roof; a low hollow-block fence
with a steel gate, potted plants, a blue water drum and a laundry line at the side.

States: 0 intact; 1 damaged (windows blown out, the door boarded, roof sheets torn off to the
rafters, soot, the gate hanging open, sandbags at the gate, the tricycle on its side, debris);
2 destroyed (the roof down on the ruins, the walls broken to stubs, the carport collapsed on the
burnt tricycle, rubble, the fence knocked down).
"""
import math

import numpy as np

from bsdf import Scene, eul
from kit import (MAT, car, debris, heap, hip_roof, ruined_wall, sandbag_arc, tricycle, win)   # noqa: F401
from townhouse import Builder, shade   # noqa: F401

MAT.update({
    "pink":      ((0.91, 0.72, 0.66), 0.04, "plaster"),
    "roof_blue": ((0.20, 0.38, 0.64), 0.22, "roof"),
    "tile_floor": ((0.80, 0.74, 0.66), 0.10, "tiles"),
    "gate":      ((0.12, 0.26, 0.18), 0.30, "window_grille"),
    "drum":      ((0.15, 0.36, 0.72), 0.30, "tank"),
    "grass":     ((0.36, 0.52, 0.24), 0.02, "leaf"),
    "breeze":    ((0.93, 0.93, 0.90), 0.03, "breeze"),
})

X0, X1, Z0, Z1 = -5.5, 5.5, -4.0, 2.4      # house walls
PZ = 4.3                                   # front of the porch
CX0, CX1 = 5.7, 9.0                        # carport
FL = 0.45                                  # floor level
WALL = FL + 2.9
LX0, LX1, LZ0, LZ1 = -6.6, 9.4, -5.6, 6.2  # the lot (fence line)


def build(state=0):
    B = Builder(seed=211 + state)
    B.fires = []
    rng = B.rng
    ruin = state == 2
    # ---------------------------------------------------------------- lot
    B.box("lot", "concrete", LX0, LX1, 0.0, 0.08, LZ0, LZ1)
    B.box("lot", "grass", LX0 + 0.2, X0 - 0.2, 0.0, 0.1, LZ0 + 0.2, LZ1 - 0.3)
    B.box("lot", "grass", X0, X1 - 0.6, 0.0, 0.1, PZ + 0.6, LZ1 - 0.3)
    B.box("lot", "concrete", CX0, CX1, 0.0, 0.12, -3.0, LZ1)                                 # carport slab
    B.box("lot", "concrete", -1.9, -0.5, 0.0, 0.12, 4.4, LZ1)                                # path to the porch
    B.box("lot", "base", X0 - 0.3, X1 + 0.3, 0.0, FL, Z0 - 0.3, PZ + 0.1)                    # raised floor
    for k in range(3):                                                                       # porch steps
        B.box("lot", "concrete", -1.9, -0.5, 0.0, FL - 0.15 * k, PZ + 0.1, PZ + 0.4 + 0.3 * (2 - k))
    if not ruin:
        house(B, rng, state)
    else:
        ruins(B, rng)
    fence(B, rng, state)
    yard(B, rng, state)
    sc = Scene(B.p)
    sc.wear = state
    sc.fires = B.fires
    return sc


def house(B, rng, state):
    # walls
    B.box("walls", "pink", X0, X1, FL, WALL, Z0, Z1)
    B.box("walls", "interior", X0 + 0.25, X1 - 0.25, FL, WALL - 0.3, Z0 + 0.25, Z1 - 0.25)
    B.box("walls", "white", X0 - 0.05, X1 + 0.05, WALL - 0.25, WALL, Z0 - 0.05, Z1 + 0.05)     # ring beam
    B.box("walls", "white", X0 - 0.04, X1 + 0.04, FL, FL + 0.35, Z0 - 0.04, Z1 + 0.04)       # base course
    broken = state == 1
    # front: door and a wide sliding window, side and back windows
    door = "plywood" if broken else "door"
    win(B, "front", "z", Z1, 1, -1.7, -0.7, FL + 0.02, FL + 2.15, door, wall="pink")
    if broken:
        for a in (25, -25):
            B.rbox("front", "plywood", np.array([-1.2, FL + 1.1, Z1 + 0.06]), np.array([0.7, 0.09, 0.025]), eul(0, 0, a))
    for (u0, u1) in ((0.4, 3.6),):
        win(B, "front", "z", Z1, 1, u0, u1, FL + 0.95, FL + 2.2, "interior" if broken else "glass_grille", wall="pink")
        B.box("front", "white", u0 - 0.1, u1 + 0.1, FL + 0.85, FL + 0.95, Z1, Z1 + 0.12)
    for (u0, u1) in ((-3.8, -1.6), (0.6, 2.8)):
        win(B, "back", "z", Z0, -1, u0, u1, FL + 1.0, FL + 2.2, "interior" if (broken and u0 > 0) else "glass_grille", wall="pink")
    for (face, out) in ((X0, -1), (X1, 1)):
        for (u0, u1) in ((-3.6, -1.8), (-0.4, 1.4)):
            br = broken and rng.uniform() < 0.5
            win(B, "side", "x", face, out, u0, u1, FL + 1.0, FL + 2.2, "interior" if br else "glass_grille", wall="pink")
            if br:
                B.fires.append((np.array([face, FL + 2.2, (u0 + u1) / 2]), np.array([out * 1.0, 0, 0]), 0.9))
    if broken:
        B.fires.append((np.array([2.0, FL + 2.2, Z1]), np.array([0, 0, 1.0]), 1.4))
    # porch: floor tiles, three columns, ventilation-block railing either side of the steps
    B.box("porch", "tile_floor", X0, X1, FL - 0.05, FL + 0.02, Z1, PZ)
    for x in (X0 + 0.2, -2.5, 0.1, 2.8, X1 - 0.2):
        B.box("porch", "white", x - 0.17, x + 0.17, FL, WALL, PZ - 0.36, PZ - 0.02)
    for (a, b) in ((X0 + 0.37, -2.0), (-0.4, X1 - 0.37)):
        B.box("porch", "breeze", a, b, FL, FL + 0.9, PZ - 0.24, PZ - 0.12)
        B.box("porch", "white", a, b, FL + 0.9, FL + 0.98, PZ - 0.28, PZ - 0.08)
    B.box("porch", "white", X0 - 0.05, X1 + 0.05, WALL - 0.3, WALL, PZ - 0.42, PZ)           # porch beam
    # roof over house and porch
    top = hip_roof(B, "roof", "roof_blue", X0 - 0.6, X1 + 0.6, Z0 - 0.6, PZ + 0.6, WALL + 0.05, 20)
    if state == 1:
        for (x0, x1, z0, z1) in ((-3.9, -2.1, -0.4, 2.0), (1.8, 3.6, -4.6, -2.4)):
            B.box("roof", "roof_blue", x0, x1, WALL + 0.12, top + 0.6, z0, z1, sub=True)
            for x in np.arange(x0 + 0.3, x1, 0.6):
                B.rod("rafters", "beam_burnt", (x, top - 0.15, 0.0), (x, WALL + 0.1, 5.0 if z0 > -3 else -5.0), 0.05)
        B.rbox("roof", "roof_blue", np.array([-3.0, top + 0.1, 0.0]), np.array([0.9, 0.025, 0.7]), eul(-48, 6, 0), axis=0)
        B.box("ceiling", "interior", X0 + 0.1, X1 - 0.1, WALL - 0.02, WALL + 0.02, Z0 + 0.1, Z1 - 0.1)
    # carport: posts and a single-slope roof
    for z in (-2.6, 1.0, 4.6):
        B.rod("carport", "steel", (CX1 - 0.3, 0.1, z), (CX1 - 0.3, 2.55, z), 0.06)
    B.rbox("carport", "roof_blue", np.array([(CX0 + CX1) / 2, 2.68, 1.0]), np.array([1.8, 0.04, 4.0]), eul(0, 0, 6), axis=2)
    B.rod("carport", "steel", (CX0 - 0.1, 2.75, -2.9), (CX0 - 0.1, 2.75, 4.9), 0.05)
    B.rod("carport", "steel", (CX1 - 0.3, 2.5, -2.9), (CX1 - 0.3, 2.5, 4.9), 0.05)
    tx = (CX0 + CX1) / 2
    if state == 0:
        tricycle(B, "trike", tx - 0.1, 1.0, 0, (0.15, 0.45, 0.85))
    else:
        tricycle(B, "trike", tx, 2.0, 25, (0.15, 0.45, 0.85), roll=-80, y=1.1)             # on its side
    if state == 1:
        sandbag_arc(B, "sandbags", tx, LZ1 + 0.2, 2.0, 1.2, -60, 60, 7, rows=2)
        debris(B, rng, "debris", 22, (LX0, LX1, 4.8, LZ1 + 1.5))
        debris(B, rng, "debris", 10, (X0 - 1, X1 + 1, Z0 - 1.4, Z0 - 0.4))


def ruins(B, rng):
    ruined_wall(B, rng, "walls", "pink", "z", Z1 - 0.25, X0, X1, 0.25, 0.4, 2.3, y0=FL)
    ruined_wall(B, rng, "walls", "pink", "z", Z0, X0, X1, 0.25, 0.8, 2.8, y0=FL)
    ruined_wall(B, rng, "walls", "pink", "x", X0, Z0, Z1, 0.25, 0.6, 2.6, y0=FL)
    ruined_wall(B, rng, "walls", "pink", "x", X1 - 0.25, Z0, Z1, 0.25, 0.3, 1.8, y0=FL)
    B.box("walls", "white", 0.1 - 0.17, 0.1 + 0.17, FL, FL + 1.6, PZ - 0.36, PZ - 0.02)     # a porch column stands
    B.box("floor", "burnt", X0 + 0.25, X1 - 0.25, FL - 0.02, FL + 0.02, Z0 + 0.25, Z1 - 0.25)
    heap(B, rng, "heap", -0.5, -0.8, 4.2, 2.4, 0.9, 24, y0=FL)
    for (c, R) in (((-2.2, FL + 0.9, -0.4), eul(14, 8, -10)), ((1.9, FL + 0.7, 0.6), eul(-12, -6, 16)), ((0.0, FL + 0.5, 3.4), eul(20, 3, 4))):
        B.rbox("roofdown", "roof_blue", np.array(c), np.array([2.1, 0.03, 1.6]), R, axis=0)  # roof sheets on the ruins
    for _ in range(7):
        x = rng.uniform(-3.5, 3.5)
        B.rod("roofdown", "beam_burnt", (x, FL + rng.uniform(1.0, 2.0), -3.5), (x + rng.uniform(-1, 1), FL + 0.3, 2.0), 0.06)
    B.rbox("carport", "roof_blue", np.array([(CX0 + CX1) / 2, 0.9, 1.0]), np.array([1.8, 0.04, 4.0]), eul(4, 0, -22), axis=2)
    B.rod("carport", "steel", (CX1 - 0.3, 0.1, -2.6), (CX1 - 0.3, 1.6, -2.6), 0.06)
    B.rod("carport", "steel", (CX1 - 0.3, 0.1, 4.6), (CX1 - 1.0, 1.1, 4.9), 0.06)
    tricycle(B, "trike", (CX0 + CX1) / 2 - 0.2, 1.2, 15, (0.15, 0.45, 0.85), state=2)
    debris(B, rng, "debris", 40, (LX0, LX1, LZ0, LZ1 + 1.5))


def fence(B, rng, state):
    H = 1.25
    def wall(x0, x1, z0, z1):
        if state == 2:
            a = "z" if (x1 - x0) > (z1 - z0) else "x"
            if a == "z":
                ruined_wall(B, rng, "fence", "cream", "z", z0, x0, x1, z1 - z0, 0.2, 1.1)
            else:
                ruined_wall(B, rng, "fence", "cream", "x", x0, z0, z1, x1 - x0, 0.2, 1.1)
            return
        B.box("fence", "cream", x0, x1, 0.0, H, z0, z1)
        B.box("fence", "white", x0 - 0.03, x1 + 0.03, H, H + 0.08, z0 - 0.03, z1 + 0.03)
    wall(LX0, CX0 - 0.1, LZ1 - 0.2, LZ1)
    wall(LX0, LX0 + 0.2, LZ0, LZ1)
    wall(LX1 - 0.2, LX1, LZ0, LZ1)
    wall(LX0, LX1, LZ0, LZ0 + 0.2)
    for x in (CX0 - 0.1, LX1 - 0.2):
        B.box("fence", "white", x - 0.2, x + 0.2, 0.0, 1.7, LZ1 - 0.3, LZ1 + 0.1)              # gate pillars
    g0, g1 = CX0 + 0.1, LX1 - 0.4
    if state == 0:
        B.box("gate", "gate", g0, g1, 0.08, 1.55, LZ1 - 0.14, LZ1 - 0.08)
    elif state == 1:
        B.rbox("gate", "gate", np.array([g0 + 0.8, 0.8, LZ1 + 0.6]), np.array([0.8, 0.72, 0.03]), eul(0, -62, 4))
        B.rbox("gate", "gate", np.array([g1 - 0.4, 0.6, LZ1 + 0.9]), np.array([0.8, 0.72, 0.03]), eul(70, 30, 0))
    else:
        B.rbox("gate", "burnt", np.array([(g0 + g1) / 2, 0.12, LZ1 + 1.0]), np.array([1.5, 0.05, 0.72]), eul(0, 8, 0))


def yard(B, rng, state):
    if state == 2:
        return
    for (x, z) in ((-5.6, 5.4), (-4.1, 5.5), (-2.9, 5.4), (2.6, 5.5), (4.2, 5.4)):            # potted plants
        B.cyl("plants", "pot", (x, 0.25, z), 0.22, 0.25)
        B.ell("plants", "leaf", (x, 0.75, z), (0.42, 0.45, 0.42))
    B.cyl("yard", "drum", (-6.0, 0.55, -4.6), 0.32, 0.45)
    B.cyl("yard", "drum", (-5.95, 0.98, -4.6), 0.33, 0.03)
    for z in (-3.8, 1.6):                                                                    # laundry line
        B.rod("yard", "steel", (-6.1, 0.05, z), (-6.1, 1.95, z), 0.03)
    B.rod("yard", "steel", (-6.1, 1.9, -3.8), (-6.1, 1.9, 1.6), 0.012)
    cols = [(0.85, 0.2, 0.2), (0.95, 0.95, 0.92), (0.2, 0.45, 0.8), (0.95, 0.8, 0.2), (0.3, 0.65, 0.35)]
    for k, z in enumerate(np.arange(-3.3, 1.1, 0.85)):
        B.box("yard", "cloth", -6.13, -6.07, 1.35 - 0.1 * (k % 2), 1.88, z, z + 0.6, col=cols[k % len(cols)])


FRONT = "the porch, the gate and the street"
PIVOT = "the middle of the house (the carport is on its right, the gate in front)"
FOOTPRINT = {"house": [11.0, 6.4], "with_porch": [11.0, 8.3], "lot_with_fence": [16.0, 11.8]}
HEIGHT = {"floor": FL, "eaves": WALL, "ridge": round(WALL + 0.05 + 4.75 * math.tan(math.radians(20)), 2)}

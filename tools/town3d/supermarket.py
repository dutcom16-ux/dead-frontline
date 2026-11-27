"""Toledo supermarket: a single-storey big-box grocery store with its car park (generic design).

Building space: x = width (28 m), y = up, z = depth, +z = the shop front and the car park. A
plastered hall with a red band, a glass shopfront with two entrances under a full-width canopy on
columns, a raised sign wall with the store's sign, advertising boards on the side, a loading dock
with roller shutters, pallets and a dumpster at the back, air-conditioning units, fans and a
water tank on the flat roof; in front a car park with marked bays, parked cars, trolleys,
light poles and a planted kerb.

States: 0 intact; 1 damaged (looted and shot up: the shopfront smashed, a car rammed through the
glass, the canopy sagging on a lost column, the sign hanging, a burnt-out car, trolleys and goods
strewn over the car park, sandbags at the entrance, a hole burnt through the roof, soot);
2 destroyed (the roof fallen into the hall with its trusses, the walls broken down, the canopy and
the sign on the ground, burnt cars, rubble).
"""
import math

import numpy as np

from bsdf import Scene, eul
from kit import MAT, car, debris, heap, ruined_wall, sandbag_arc, win   # noqa: F401
from townhouse import GOODS, Builder, shade   # noqa: F401

MAT.update({
    "store_wall": ((0.90, 0.88, 0.82), 0.04, "plaster"),
    "store_band": ((0.78, 0.14, 0.12), 0.15, "plain"),
    "sign_s":     ((0.80, 0.14, 0.12), 0.10, "sign", (0.98, 0.98, 0.95)),
    "shopglass":  ((0.30, 0.44, 0.50), 0.80, "ribbon"),
    "cart":       ((0.74, 0.75, 0.77), 0.60, "window_grille"),
    "dumpster":   ((0.16, 0.40, 0.26), 0.20, "plain"),
    "pallet":     ((0.66, 0.52, 0.34), 0.04, "wood"),
    "kerb":       ((0.75, 0.74, 0.70), 0.03, "concrete"),
    "lamp":       ((0.95, 0.93, 0.80), 0.40, "plain"),
    "shutter":    ((0.62, 0.64, 0.66), 0.35, "shutter"),
})

X0, X1, Z0, Z1 = -12.0, 12.0, -8.0, 7.0    # hall
H = 6.4                                     # wall top / roof
CZ = 10.2                                   # front of the canopy
PZ0, PZ1 = 10.6, 18.4                       # car park
CARS = [(-9.1, (0.75, 0.10, 0.10)), (-1.3, (0.92, 0.92, 0.90)), (3.9, (0.55, 0.57, 0.60)), (9.1, (0.12, 0.25, 0.55))]
SHIFT = -4.3                                # the whole lot is centred on the pivot


def build(state=0):
    B = Builder(seed=307 + state)
    B.fires = []
    rng = B.rng
    ground(B, rng, state)
    if state < 2:
        hall(B, rng, state)
    else:
        ruins(B, rng)
    d = np.array([0.0, 0.0, SHIFT])
    for p in B.p:                                                                            # centre the lot on the pivot
        p.c = p.c + d
        p.bc = p.c
        if p.a is not None:
            p.a, p.b = p.a + d, p.b + d
    sc = Scene(B.p)
    sc.wear = state
    sc.fires = [(f0 + d, fn, fw) for (f0, fn, fw) in B.fires]
    return sc


def ground(B, rng, state):
    B.box("ground", "asphalt", X0 - 1.5, X1 + 1.5, 0.0, 0.08, PZ0 - 0.4, PZ1)
    B.box("ground", "concrete", X0 - 1.0, X1 + 1.0, 0.0, 0.16, Z1, PZ0 - 0.4)                # walk under the canopy
    B.box("ground", "concrete", X0 - 0.6, X1 + 0.6, 0.0, 0.12, Z0 - 2.4, Z1)                 # apron and dock yard
    B.box("ground", "kerb", X0 - 1.5, X1 + 1.5, 0.0, 0.25, PZ1, PZ1 + 0.6)
    for k in range(11):                                                                      # bay lines
        x = -13.0 + k * 2.6
        B.box("ground", "paint_w", x - 0.06, x + 0.06, 0.08, 0.09, PZ1 - 4.9, PZ1 - 0.2)
    B.box("ground", "paint_w", -13.0, 13.0, 0.08, 0.09, PZ1 - 4.96, PZ1 - 4.84)
    for k in range(5):                                                                       # crossing to the doors
        B.box("ground", "paint_w", -1.6 + 0.0, 1.6, 0.08, 0.09, PZ0 + 0.3 + 0.6 * k, PZ0 + 0.6 + 0.6 * k)
    if state < 2:
        for x in np.arange(X0 - 1.0, X1 + 1.2, 1.6):                                          # shrubs on the kerb
            B.ell("ground", "leaf", (x, 0.45, PZ1 + 0.3), (0.6, 0.4, 0.35))
    for x in (-7.8, 0.0, 7.8):                                                                # light poles
        if state == 2 and x > 0:
            B.rod("poles", "steel", (x, 0.05, PZ1 - 5.2), (x + 5.0, 0.3, PZ1 - 3.4), 0.09)
            continue
        B.cyl("poles", "concrete", (x, 0.3, PZ1 - 5.2), 0.25, 0.3)
        B.rod("poles", "steel", (x, 0.5, PZ1 - 5.2), (x, 6.4, PZ1 - 5.2), 0.08)
        for s in (-1, 1):
            B.rod("poles", "steel", (x, 6.3, PZ1 - 5.2), (x + s * 0.9, 6.45, PZ1 - 5.2), 0.04)
            B.box("poles", "lamp", x + s * 0.9 - 0.3, x + s * 0.9 + 0.3, 6.3, 6.5, PZ1 - 5.35, PZ1 - 5.05)
    # parked cars
    for k, (x, col) in enumerate(CARS):
        car(B, f"car{k}", x, PZ1 - 2.6, 180 + (6 if k == 2 else 0), col, state=2 if (state == 2 or (state == 1 and k == 1)) else 0)
    # back of the shop: dock, pallets, dumpster
    B.box("dock", "concrete", 1.5, 10.8, 0.0, 1.2, Z0 - 2.2, Z0)
    B.box("dock", "hazard", 1.5, 10.8, 0.95, 1.2, Z0 - 2.25, Z0 - 2.15)
    for x in (2.5, 5.8, 6.6, 9.9):
        B.box("dock", "tyre", x - 0.2, x + 0.2, 0.5, 1.1, Z0 - 2.4, Z0 - 2.2)
    if state < 2:
        B.box("yard", "dumpster", -10.0, -7.8, 0.1, 1.5, Z0 - 2.0, Z0 - 0.6, rr=0.05)
        for k in range(3):
            B.box("yard", "pallet", -6.6 + 1.3 * k, -5.4 + 1.3 * k, 0.12, 0.27, Z0 - 2.0, Z0 - 0.8)
            B.box("yard", "plywood", -6.5 + 1.3 * k, -5.5 + 1.3 * k, 0.27, 0.27 + 0.4 * (k + 1), Z0 - 1.9, Z0 - 0.9)


def hall(B, rng, state):
    dmg = state == 1
    B.box("hall", "store_wall", X0, X1, 0.16, H, Z0, Z1)
    B.box("hall", "interior", X0 + 0.25, X1 - 0.25, 0.16, H - 0.3, Z0 + 0.25, Z1 - 0.25)
    B.box("hall", "store_band", X0 - 0.04, X1 + 0.04, H - 0.75, H - 0.15, Z0 - 0.04, Z1 + 0.04)
    for (x0, x1, z0, z1) in ((X0, X1, Z0, Z0 + 0.25), (X0, X0 + 0.25, Z0, Z1), (X1 - 0.25, X1, Z0, Z1)):
        B.box("parapet", "store_wall", x0, x1, H, H + 0.7, z0, z1)
    B.box("parapet", "store_wall", -9.0, 9.0, H, 9.2, Z1 - 0.3, Z1)                           # sign wall
    B.box("parapet", "store_wall", X0, -9.0, H, H + 0.7, Z1 - 0.25, Z1)
    B.box("parapet", "store_wall", 9.0, X1, H, H + 0.7, Z1 - 0.25, Z1)
    B.box("parapet", "store_band", -9.1, 9.1, 9.0, 9.3, Z1 - 0.35, Z1 + 0.05)
    # the sign
    if state == 0:
        B.box("sign", "sign_s", -7.4, 7.4, H + 0.4, 8.7, Z1, Z1 + 0.15)
    else:
        B.rbox("sign", "sign_s", np.array([-2.6, 7.0, Z1 + 0.3]), np.array([4.8, 0.95, 0.07]), eul(0, 0, -9))
        B.rbox("sign", "sign_s", np.array([5.5, 3.2, Z1 + 1.4]), np.array([2.6, 0.9, 0.07]), eul(-60, 4, 12))
    # shopfront glazing with two entrances, side doors, back shutters
    glass = "interior" if dmg else "shopglass"
    win(B, "front", "z", Z1, 1, X0 + 1.2, X1 - 1.2, 0.3, 3.4, glass, depth=0.15, wall="store_wall")
    for x in (-5.0, 5.0):
        B.box("front", "white", x - 1.7, x + 1.7, 0.16, 3.5, Z1 - 0.1, Z1 + 0.06)
        B.box("front", "glass_dark" if not dmg else "interior", x - 1.5, x + 1.5, 0.2, 3.0, Z1 + 0.02, Z1 + 0.08)
        B.box("front", "white", x - 0.04, x + 0.04, 0.2, 3.0, Z1 + 0.06, Z1 + 0.1)
    win(B, "side", "x", X1, 1, -2.0, -0.6, 0.16, 2.4, "door", wall="store_wall")
    for (x0, x1) in ((2.5, 5.8), (6.6, 9.9)):
        win(B, "back", "z", Z0, -1, x0, x1, 1.2, 4.6, "shutter", wall="store_wall")
    # advertising boards on the left side
    for (z0, z1, m) in ((-6.5, -1.5, "sign_b"), (0.0, 5.0, "sign_g")):
        B.box("ads", m, X0 - 0.12, X0 - 0.02, 2.4, 4.6, z0, z1)
    # roof: deck, air conditioning, fans, a water tank, a hatch
    B.box("roof", "roofdeck", X0 + 0.25, X1 - 0.25, H - 0.05, H + 0.05, Z0 + 0.25, Z1 - 0.3)
    for i in range(3):
        for j in range(2):
            x, z = -8.0 + 5.0 * i, -4.5 + 4.0 * j
            B.box("roof", "ac", x - 1.0, x + 1.0, H, H + 1.2, z - 0.8, z + 0.8, rr=0.04)
    for (x, z) in ((6.5, -5.0), (9.0, -5.0), (6.5, 1.0)):
        B.cyl("roof", "silver", (x, H + 0.35, z), 0.55, 0.35)
        B.cyl("roof", "steel", (x, H + 0.72, z), 0.5, 0.03)
    B.box("roof", "steel", 7.8, 10.4, H, H + 0.8, 0.0, 2.6)
    B.cyl("roof", "tank", (9.1, H + 1.9, 1.3), 1.1, 1.1)
    B.box("roof", "store_wall", -10.8, -9.3, H, H + 1.1, -6.8, -5.4)
    if dmg:
        B.box("roof", "roofdeck", -2.6, 1.4, H - 0.4, H + 0.6, -3.2, 0.2, sub=True)
        B.box("roof", "interior", -2.6, 1.4, H - 0.36, H - 0.3, -3.2, 0.2)
        for x in np.arange(-2.3, 1.4, 0.9):
            B.rod("roof", "beam_burnt", (x, H - 0.15, -3.4), (x, H - 0.15, 0.4), 0.06)
        B.fires.append((np.array([-0.6, H, Z1]), np.array([0, 0, 1.0]), 2.5))
    # the canopy on columns
    cols = [-10.0, -5.0, 0.0, 5.0, 10.0]
    if state == 0:
        B.box("canopy", "white", X0 - 0.5, X1 + 0.5, 3.75, 4.0, Z1, CZ)
        B.box("canopy", "store_band", X0 - 0.5, X1 + 0.5, 3.4, 4.05, CZ - 0.12, CZ)
        for x in cols:
            B.cyl("canopy", "white", (x, 1.95, CZ - 0.35), 0.18, 1.8)
    else:
        B.box("canopy", "white", X0 - 0.5, 3.0, 3.75, 4.0, Z1, CZ)
        B.box("canopy", "store_band", X0 - 0.5, 3.0, 3.4, 4.05, CZ - 0.12, CZ)
        R = eul(8, 0, -16)
        B.rbox("canopy", "white", np.array([7.6, 2.6, (Z1 + CZ) / 2 + 0.2]), np.array([4.9, 0.13, 1.6]), R)
        B.rbox("canopy", "store_band", np.array([7.6, 2.2, CZ + 0.1]), np.array([4.9, 0.3, 0.06]), R)
        for x in cols[:3]:
            B.cyl("canopy", "white", (x, 1.95, CZ - 0.35), 0.18, 1.8)
        B.cyl("canopy", "white", (9.5, 0.32, CZ + 1.4), 0.18, 1.8, R=eul(0, 20, 90))       # the column that went
    # trolleys
    if state == 0:
        for k in range(6):
            B.box("carts", "cart", 7.4 + 0.32 * k, 8.0 + 0.32 * k, 0.45, 1.05, 8.2, 9.1)
            for dx in (0.05, 0.55):
                B.rod("carts", "chrome", (7.4 + 0.32 * k + dx, 0.18, 8.3), (7.4 + 0.32 * k + dx, 0.45, 8.3), 0.02)
    else:
        damage(B, rng)


def damage(B, rng):
    # a car rammed through the glass at the left entrance
    car(B, "crash", -5.3, Z1 + 1.0, 8, (0.85, 0.75, 0.15))
    for _ in range(10):                                                                      # trolleys strewn about
        x, z = rng.uniform(-11, 11), rng.uniform(Z1 + 1.5, PZ1 - 1)
        yaw, roll = rng.uniform(0, 180), (rng.uniform() < 0.4) * 80
        R = eul(0, yaw, roll)
        B.rbox("carts", "cart", np.array([x, 0.55 if not roll else 0.35, z]), np.array([0.3, 0.3, 0.45]), R)
    for _ in range(40):                                                                      # looted goods
        x, z = rng.uniform(-12, 12), rng.uniform(Z1 + 0.4, PZ1 - 0.5)
        s = rng.uniform(0.12, 0.3)
        B.rbox("goods", "goods", np.array([x, 0.16 + s * 0.5, z]), np.array([s, s * 0.7, s * 0.8]),
               eul(rng.uniform(-30, 30), rng.uniform(0, 180), 0), col=GOODS[rng.integers(len(GOODS))])
    sandbag_arc(B, "sandbags", 5.0, Z1 + 0.6, 2.6, 2.3, -75, 75, 9, rows=3, y=0.16)
    debris(B, rng, "glass", 30, (X0 + 1, X1 - 1, Z1 + 0.1, Z1 + 2.5), mats=("glass", "shopglass"), y0=0.16, smax=0.18)
    for x in (-9.0, -2.0, 8.0):
        B.fires.append((np.array([x, 3.4, Z1]), np.array([0, 0, 1.0]), 1.8))


def ruins(B, rng):
    ruined_wall(B, rng, "walls", "store_wall", "z", Z0, X0, X1, 0.25, 1.5, 5.5, y0=0.16)
    ruined_wall(B, rng, "walls", "store_wall", "x", X0, Z0, Z1, 0.25, 1.0, 5.0, y0=0.16)
    ruined_wall(B, rng, "walls", "store_wall", "x", X1 - 0.25, Z0, Z1, 0.25, 0.8, 4.2, y0=0.16)
    ruined_wall(B, rng, "walls", "store_wall", "z", Z1 - 0.25, X0, -7.0, 0.25, 0.4, 2.0, y0=0.16)
    ruined_wall(B, rng, "walls", "store_wall", "z", Z1 - 0.25, 7.0, X1, 0.25, 0.4, 2.4, y0=0.16)
    B.box("floor", "burnt", X0 + 0.25, X1 - 0.25, 0.12, 0.2, Z0 + 0.25, Z1 - 0.25)
    # the roof deck in pieces on the floor and its trusses
    for k, (cx, cz, a, b) in enumerate(((-7.5, -3.5, 12, -8), (0.5, -2.0, -10, 6), (7.5, -1.0, 9, 10), (-3.5, 3.0, -6, -12))):
        R = eul(a, rng.uniform(-10, 10), b)
        c = np.array([cx, 1.1, cz])
        B.rbox("roofdown", "roofdeck" if k % 2 == 0 else "burnt", c, np.array([3.4, 0.1, 2.4]), R)
        for _ in range(8):                                                                   # rubble and ducts on the slabs
            p = c + R @ np.array([rng.uniform(-3, 3), 0.15, rng.uniform(-2, 2)])
            s = rng.uniform(0.15, 0.45)
            B.rbox("roofdown", "rubble" if rng.uniform() < 0.6 else "ac", p, np.array([s, s * 0.6, s * 0.8]),
                   eul(rng.uniform(-30, 30), rng.uniform(0, 180), rng.uniform(-30, 30)), rr=0.03)
    for x in np.arange(X0 + 2.0, X1 - 1.0, 3.0):
        y = rng.uniform(1.0, 3.8)
        B.rod("trusses", "steel", (x, 0.3 + rng.uniform(0, 1.5), Z0 + 0.4), (x + rng.uniform(-1.5, 1.5), y, Z1 - 0.8), 0.09)
    heap(B, rng, "heap", -1.5, 0.0, 8.0, 4.5, 1.4, 32, y0=0.16)
    # canopy down across the walk, the sign face down on it
    B.rbox("canopy", "white", np.array([-1.0, 0.9, (Z1 + CZ) / 2 + 0.4]), np.array([11.5, 0.13, 1.7]), eul(-14, 2, 3))
    B.rbox("canopy", "sign_s", np.array([3.0, 0.4, CZ + 1.3]), np.array([5.0, 0.07, 0.9]), eul(4, 12, 0))
    for x in (-10.0, 0.0, 5.0):
        B.cyl("canopy", "white", (x, 0.8, CZ - 0.35), 0.18, 0.65)
    car(B, "crash", -5.5, Z1 + 1.2, 8, (0.85, 0.75, 0.15), state=2)
    for _ in range(30):
        x, z = rng.uniform(-11, 11), rng.uniform(Z1 + 0.4, PZ1 - 0.5)
        s = rng.uniform(0.12, 0.35)
        B.rbox("goods", "goods" if rng.uniform() < 0.5 else "rubble", np.array([x, 0.16 + s * 0.5, z]), np.array([s, s * 0.7, s * 0.8]),
               eul(rng.uniform(-30, 30), rng.uniform(0, 180), 0), col=GOODS[rng.integers(len(GOODS))] if rng.uniform() < 0.5 else None)
    debris(B, rng, "debris", 40, (X0 - 1, X1 + 1, Z0 - 2.4, PZ1))


FRONT = "the shopfront, the canopy and the car park"
PIVOT = "the middle of the whole lot: the hall runs from 12.3 m behind it to 2.7 m in front, the car park in front of that"
FOOTPRINT = {"hall": [24.0, 15.0], "with_canopy_car_park_dock": [27.0, 29.4]}
HEIGHT = {"walls": H, "sign_wall": 9.3, "light_poles": 6.5}

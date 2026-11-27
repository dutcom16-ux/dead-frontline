"""Toledo townhouse: a two-storey Filipino house with a sari-sari store on the ground floor.

Building space: x = width (7 m), y = up, z = depth (9 m), +z = the street front. Ground floor in
painted hollow-block (CHB) plaster with the store window (steel grille, counter, shelves of goods,
hanging sachet strips, painted sign) and a steel door; a concrete beam and a cantilevered upper floor
in a second colour with aluminium jalousie windows; red-painted corrugated GI roof (gable), concrete
stairs up the left side to the upper door, a blue water tank on a stand at the back, potted plants.

States: 0 intact, 1 damaged (shot up, boarded, roof sheets torn off, debris), 2 destroyed (upper
floor collapsed onto the ruins of the ground floor, rubble, scattered roof sheets).
"""
import math

import numpy as np

from bsdf import Prim, Scene, eul, hash01, noise, nrm

W, D = 7.0, 9.0                 # walls
X0, X1, Z0, Z1 = -3.5, 3.5, -4.5, 4.5
F1 = 3.0                        # top of the ground floor walls
SL = 3.25                       # top of the floor slab / beam
FRONT2 = 5.3                    # upper floor overhangs the front by 0.8 m
TOP = 5.9                       # top of the upper walls
PITCH = math.radians(24)
RIDGE = TOP + 3.5 * math.tan(PITCH)

MAT = {   # base colour, specular, texture
    "cream":    ((0.88, 0.81, 0.64), 0.04, "plaster"),
    "mint":     ((0.58, 0.76, 0.66), 0.04, "plaster"),
    "concrete": ((0.63, 0.62, 0.59), 0.03, "concrete"),
    "base":     ((0.44, 0.44, 0.43), 0.03, "concrete"),
    "roof":     ((0.64, 0.22, 0.17), 0.22, "roof"),
    "ridge":    ((0.56, 0.57, 0.58), 0.30, "metal"),
    "white":    ((0.90, 0.90, 0.86), 0.06, "plain"),
    "jalousie": ((0.40, 0.50, 0.55), 0.70, "jalousie"),
    "grille":   ((0.15, 0.30, 0.21), 0.30, "plain"),
    "wood":     ((0.55, 0.37, 0.21), 0.05, "wood"),
    "plywood":  ((0.72, 0.58, 0.40), 0.04, "plywood"),
    "door":     ((0.38, 0.23, 0.15), 0.25, "door"),
    "interior": ((0.09, 0.075, 0.065), 0.0, "plain"),
    "sign":     ((0.80, 0.16, 0.12), 0.10, "sign"),
    "tank":     ((0.14, 0.38, 0.72), 0.35, "tank"),
    "steel":    ((0.26, 0.27, 0.28), 0.35, "metal"),
    "pot":      ((0.66, 0.33, 0.20), 0.05, "plain"),
    "leaf":     ((0.22, 0.47, 0.19), 0.05, "leaf"),
    "goods":    ((0.80, 0.80, 0.80), 0.20, "plain"),
    "ac":       ((0.86, 0.86, 0.83), 0.15, "ac"),
    "rubble":   ((0.58, 0.57, 0.53), 0.02, "rubble"),
    "rebar":    ((0.32, 0.20, 0.13), 0.20, "plain"),
    "glass":    ((0.55, 0.65, 0.68), 0.80, "plain"),
    # mid-rise (midrise.py)
    "beige":    ((0.86, 0.81, 0.70), 0.04, "plaster"),
    "frame":    ((0.80, 0.80, 0.78), 0.04, "plaster"),
    "glass_win": ((0.26, 0.40, 0.45), 0.75, "window"),
    "glass_grille": ((0.26, 0.40, 0.45), 0.60, "window_grille"),
    "glass_door": ((0.28, 0.42, 0.47), 0.75, "window"),
    "shutter":  ((0.60, 0.62, 0.64), 0.35, "shutter"),
    "sign_b":   ((0.14, 0.32, 0.72), 0.10, "sign", (0.97, 0.97, 0.95)),
    "sign_g":   ((0.12, 0.50, 0.28), 0.10, "sign", (0.98, 0.92, 0.55)),
    "roofdeck": ((0.58, 0.57, 0.54), 0.03, "deck"),
    "silver":   ((0.78, 0.79, 0.80), 0.70, "metal"),
    "solar":    ((0.10, 0.16, 0.32), 0.80, "solar"),
    "sandbag":  ((0.62, 0.55, 0.38), 0.03, "sack"),
    "dish":     ((0.88, 0.88, 0.86), 0.30, "plain"),
    "cloth":    ((0.80, 0.80, 0.80), 0.02, "plain"),
    "burnt":    ((0.16, 0.15, 0.14), 0.02, "concrete"),
}
GOODS = [(0.85, 0.15, 0.12), (0.98, 0.80, 0.15), (0.15, 0.40, 0.80), (0.20, 0.65, 0.30),
         (0.95, 0.95, 0.92), (0.95, 0.50, 0.12), (0.55, 0.20, 0.60)]


class Builder:
    def __init__(self, seed=3):
        self.p = []
        self.rng = np.random.default_rng(seed)

    def box(self, g, mat, x0, x1, y0, y1, z0, z1, rr=0.0, col=None, sub=False, cuts=None, R=None):
        c = np.array([(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2])
        h = np.array([abs(x1 - x0) / 2, abs(y1 - y0) / 2, abs(z1 - z0) / 2])
        lc = []
        for n, o in (cuts or []):          # cutting planes given in building space: keep p.n <= o
            n = np.asarray(n, float)
            lc.append((n, o - float(c @ n)))
        self.p.append(Prim("box", mat, g, c=c, h=h, rr=rr, col=col, sub=sub, cuts=lc, R=R))

    def rbox(self, g, mat, c, h, R, rr=0.0, col=None, sub=False, axis=None):
        self.p.append(Prim("box", mat, g, c=c, h=h, rr=rr, col=col, sub=sub, R=R, axis=axis))

    def cyl(self, g, mat, c, r, hh, R=None, col=None, cuts=None):
        self.p.append(Prim("cyl", mat, g, c=c, r=r, hh=hh, R=R, col=col, cuts=[(np.asarray(n, float), o) for n, o in (cuts or [])]))

    def rod(self, g, mat, a, b, r, col=None):
        self.p.append(Prim("rcone", mat, g, a=a, b=b, r1=r, r2=r, col=col))

    def ell(self, g, mat, c, h, R=None, col=None, cuts=None):
        self.p.append(Prim("ell", mat, g, c=c, h=h, R=R, col=col, cuts=[(np.asarray(n, float), o) for n, o in (cuts or [])]))


def window_frame(B, g, axis, face, u0, u1, y0, y1, out=0.05, t=0.06):
    """white frame around an opening on a wall face; axis 'z' = front/back wall (u along x),
    'x' = side wall (u along z); face = wall plane coordinate, out = outward sign * depth"""
    s = 1 if out > 0 else -1
    a, b = (face, face + out) if s > 0 else (face + out, face)
    for (uu0, uu1, yy0, yy1) in ((u0 - t, u1 + t, y1, y1 + t), (u0 - t, u1 + t, y0 - t, y0),
                                 (u0 - t, u0, y0, y1), (u1, u1 + t, y0, y1)):
        if axis == "z":
            B.box(g, "white", uu0, uu1, yy0, yy1, a, b)
        else:
            B.box(g, "white", a, b, yy0, yy1, uu0, uu1)


def opening(B, g, axis, face, u0, u1, y0, y1, depth, inside_sign):
    """cut an opening into a wall: inside_sign = -1 if the wall interior is toward -axis"""
    lo, hi = (face - depth, face + 0.2) if inside_sign < 0 else (face - 0.2, face + depth)
    if axis == "z":
        B.box(g, "cream", u0, u1, y0, y1, lo, hi, sub=True)
    else:
        B.box(g, "cream", lo, hi, y0, y1, u0, u1, sub=True)


def build(state=0):
    B = Builder(seed=7 + state)
    rng = B.rng
    wear = state
    broken = state == 2
    # ------------------------------------------------------------ ground
    B.box("base", "concrete", X0 - 0.12, X1 + 0.12, 0.0, 0.14, Z0 - 0.12, Z1 + 0.12)
    B.box("base", "concrete", X0 - 0.12, X1 + 0.12, 0.0, 0.10, Z1, FRONT2 + 0.35)        # front apron
    if not broken:
        # ---------------------------------------------------------- ground floor
        B.box("gf", "cream", X0, X1, 0.14, F1, Z0, Z1)
        B.box("gf", "base", X0 - 0.03, X1 + 0.03, 0.14, 0.55, Z0 - 0.03, Z1 + 0.03)        # dado band
        # openings: store window, door (front); side and back windows
        B.box("gf", "cream", 0.3, 2.9, 0.92, 2.3, Z1 - 0.3, Z1 + 0.3, sub=True)
        B.box("gf", "cream", -2.7, -1.5, 0.14, 2.3, Z1 - 0.18, Z1 + 0.3, sub=True)
        B.box("gf", "cream", X1 - 0.18, X1 + 0.3, 1.0, 2.2, -2.2, -0.2, sub=True)
        B.box("gf", "cream", 1.0, 2.6, 1.1, 2.1, Z0 - 0.3, Z0 + 0.18, sub=True)
        B.box("gf", "cream", X0 - 0.3, X0 + 0.18, 1.0, 2.2, 0.2, 2.0, sub=True)
        # floor slab / beam and the upper floor (cantilevered over the front)
        B.box("slab", "concrete", X0 - 0.1, X1 + 0.1, F1, SL, Z0 - 0.1, FRONT2 + 0.1)
        for x in (X0 + 0.02, X1 - 0.32):                                                   # front columns
            B.box("slab", "concrete", x, x + 0.3, 0.1, F1, FRONT2 - 0.3, FRONT2)
        B.box("uf", "mint", X0, X1, SL, TOP, Z0, FRONT2)
        B.box("uf", "interior", X0 + 0.06, X1 - 0.06, TOP - 0.06, TOP + 0.005, Z0 + 0.06, FRONT2 - 0.06)
        for (u0, u1) in ((-2.7, -0.7), (0.7, 2.7)):                                         # front windows
            B.box("uf", "mint", u0, u1, 3.9, 5.1, FRONT2 - 0.16, FRONT2 + 0.3, sub=True)
        B.box("uf", "mint", -1.0, 1.0, 3.9, 5.1, Z0 - 0.3, Z0 + 0.16, sub=True)            # back
        B.box("uf", "mint", X1 - 0.16, X1 + 0.3, 3.9, 5.1, -1.6, 0.4, sub=True)            # right
        B.box("uf", "mint", X0 - 0.3, X0 + 0.16, SL, 5.35, -3.3, -2.3, sub=True)           # side door
        # ---------------------------------------------------------- roof (gable, ridge along z)
        cutL = [((math.sin(PITCH), math.cos(PITCH), 0), RIDGE * math.cos(PITCH)),
                ((-math.sin(PITCH), math.cos(PITCH), 0), RIDGE * math.cos(PITCH))]
        B.box("roof", "mint", X0, X1, TOP - 0.01, RIDGE, FRONT2 - 0.12, FRONT2, cuts=cutL)  # gable ends
        B.box("roof", "mint", X0, X1, TOP - 0.01, RIDGE, Z0, Z0 + 0.12, cuts=cutL)
        ov, t = 0.55, 0.07
        half = (3.5 + ov) / math.cos(PITCH) / 2
        zs0, zs1 = Z0 - 0.45, FRONT2 + 0.45
        holes = []
        if state == 1:
            holes = [(+1, 0.35, -1.2, 1.0), (+1, 0.7, 2.4, 0.9), (-1, 0.55, -3.2, 1.1)]     # side, along, z, len
        for s in (-1, 1):
            cx = s * (3.5 + ov) / 2
            cy = RIDGE - (3.5 + ov) / 2 * math.tan(PITCH) + t / 2 / math.cos(PITCH)
            R = eul(0, 0, -s * math.degrees(PITCH))
            B.rbox("roof", "roof", np.array([cx, cy, (zs0 + zs1) / 2]), np.array([half, t / 2, (zs1 - zs0) / 2]),
                   R, axis=2)
            for (hs, along, hz, hl) in holes:
                if hs != s:
                    continue
                c = np.array([cx, cy, 0]) + R @ np.array([(along - 0.5) * 2 * half, 0, 0])
                c[2] = hz
                B.rbox("roof", "roof", c, np.array([0.9, 0.4, hl / 2]), R, sub=True)
            # white fascia along the eave
            ex = s * (3.5 + ov)
            ey = RIDGE - (3.5 + ov) * math.tan(PITCH) - 0.02
            B.rod("trim", "white", (ex, ey, zs0), (ex, ey, zs1), 0.07)
            for zz in (zs0, zs1):                                                          # barge boards
                B.rod("trim", "white", (0, RIDGE + 0.06, zz), (ex, ey + 0.05, zz), 0.06)
        B.rod("trim", "ridge", (0, RIDGE + 0.07, zs0), (0, RIDGE + 0.07, zs1), 0.11)
        if state == 1:                                                                     # rafters in the holes
            for s in (-1, 1):
                for zz in (-3.6, -2.4, -1.2, 0.0, 1.2, 2.4, 3.6):
                    a = (0, RIDGE - 0.1, zz)
                    b = (s * 3.4, TOP + 0.02, zz)
                    B.rod("rafters", "wood", a, b, 0.05)
        # ---------------------------------------------------------- front: store and door
        Zf = Z1
        B.box("store", "interior", 0.3, 2.9, 0.92, 2.3, Zf - 0.32, Zf - 0.27)
        for k, y in enumerate((1.18, 1.58, 1.98)):
            B.box("store", "wood", 0.32, 2.88, y - 0.03, y, Zf - 0.28, Zf - 0.14)
            x = 0.36
            while x < 2.8:
                w = rng.uniform(0.09, 0.16)
                hh = rng.uniform(0.1, 0.2)
                col = GOODS[rng.integers(len(GOODS))]
                B.box("store", "goods", x, x + w, y, y + hh, Zf - 0.27, Zf - 0.17, col=col)
                x += w + 0.02
        for k in range(6):                                                                 # hanging sachet strips
            x = 0.55 + k * 0.42
            col = GOODS[rng.integers(len(GOODS))]
            B.box("store", "goods", x, x + 0.12, 1.75, 2.28, Zf - 0.12, Zf - 0.1, col=col)
        if state == 1:
            for y, ang in ((1.25, 4), (1.65, -3), (2.05, 6)):                               # boarded up
                R = eul(0, 0, ang)
                B.rbox("store", "plywood", np.array([1.6, y, Zf + 0.06]), np.array([1.45, 0.16, 0.025]), R)
        else:
            x = 0.38
            while x < 2.85:                                                                 # steel grille
                B.box("store", "grille", x - 0.014, x + 0.014, 0.92, 2.3, Zf - 0.07, Zf - 0.04)
                x += 0.19
            for y in (1.4, 1.9):
                B.box("store", "grille", 0.3, 2.9, y - 0.015, y + 0.015, Zf - 0.07, Zf - 0.04)
        B.box("store", "wood", 0.22, 2.98, 0.86, 0.94, Zf - 0.05, Zf + 0.3)                   # counter
        zs = FRONT2 + 0.13                                                                 # sign under the overhang's edge
        if state == 1:                                                                     # hangs by one end
            R = eul(0, 0, -10)
            B.rbox("store", "sign", np.array([1.6, 2.68, zs]), np.array([1.5, 0.26, 0.03]), R)
        else:
            B.box("store", "sign", 0.05, 3.15, 2.5, 3.02, zs - 0.03, zs + 0.03)
            for x in (0.4, 2.8):
                B.box("store", "steel", x - 0.02, x + 0.02, 3.0, 3.06, zs - 0.02, zs + 0.02)
        if state == 0:
            B.box("store", "door", -2.7, -1.5, 0.14, 2.3, Zf - 0.17, Zf - 0.13)
            B.box("store", "steel", -1.72, -1.62, 1.1, 1.18, Zf - 0.13, Zf - 0.08)
        else:
            B.box("store", "interior", -2.7, -1.5, 0.14, 2.3, Zf - 0.2, Zf - 0.17)
            R = eul(0, -70, 0)                                                             # door hanging open
            B.rbox("store", "door", np.array([-2.65 + 0.2, 1.22, Zf + 0.4]), np.array([0.58, 1.08, 0.02]), R)
        B.box("store", "steel", -3.25, -2.98, 2.0, 2.38, Zf, Zf + 0.1)                      # electric meter
        # ---------------------------------------------------------- windows (frames, jalousies, grilles)
        for i, (u0, u1) in enumerate(((-2.7, -0.7), (0.7, 2.7))):
            window_frame(B, "win", "z", FRONT2, u0, u1, 3.9, 5.1, out=0.05)
            if state == 1 and i == 0:
                B.box("win", "interior", u0, u1, 3.9, 5.1, FRONT2 - 0.15, FRONT2 - 0.11)
            elif state == 1:
                B.box("win", "interior", u0, u1, 3.9, 5.1, FRONT2 - 0.15, FRONT2 - 0.11)
                for y, ang in ((4.2, 8), (4.75, -6)):
                    B.rbox("win", "plywood", np.array([(u0 + u1) / 2, y, FRONT2 + 0.07]),
                           np.array([1.15, 0.17, 0.025]), eul(0, 0, ang))
            else:
                B.box("win", "jalousie", u0, u1, 3.9, 5.1, FRONT2 - 0.13, FRONT2 - 0.09)
        window_frame(B, "win", "z", Z0, -1.0, 1.0, 3.9, 5.1, out=-0.05)
        B.box("win", "jalousie" if state == 0 else "interior", -1.0, 1.0, 3.9, 5.1, Z0 + 0.09, Z0 + 0.13)
        window_frame(B, "win", "x", X1, -1.6, 0.4, 3.9, 5.1, out=0.05)
        B.box("win", "jalousie", X1 - 0.13, X1 - 0.09, 3.9, 5.1, -1.6, 0.4)
        B.box("win", "interior", X1 - 0.17, X1 - 0.13, 1.0, 2.2, -2.2, -0.2)
        for z in np.arange(-2.1, -0.2, 0.19):
            B.box("win", "grille", X1 - 0.03, X1 + 0.0, 1.0, 2.2, z - 0.013, z + 0.013)
        B.box("win", "interior", 1.0, 2.6, 1.1, 2.1, Z0 + 0.13, Z0 + 0.17)
        B.box("win", "interior", X0 + 0.13, X0 + 0.17, 1.0, 2.2, 0.2, 2.0)
        B.box("win", "door", X0 + 0.12, X0 + 0.16, SL, 5.35, -3.3, -2.3)                     # upper side door
        # air-conditioner on the right wall
        B.box("win", "ac", X1, X1 + 0.5, 3.7, 4.2, 1.4, 2.15, rr=0.03)
    else:
        # ---------------------------------------------------------- destroyed: ruined walls, collapsed floor
        def ruined_wall(axis, face, u0, u1, inward):
            u = u0
            while u < u1 - 1e-6:
                w = min(u1 - u, rng.uniform(0.35, 0.9))
                top = rng.uniform(0.6, 2.7)
                if axis == "z":
                    B.box("ruin", "cream", u, u + w, 0.14, top, face - (0.2 if inward < 0 else 0), face + (0.2 if inward > 0 else 0))
                else:
                    B.box("ruin", "cream", face - (0.2 if inward < 0 else 0), face + (0.2 if inward > 0 else 0), 0.14, top, u, u + w)
                if rng.uniform() < 0.35:                                                   # rebar from the wall top
                    m = u + w / 2
                    a = (m, top, face) if axis == "z" else (face, top, m)
                    b = (m + rng.uniform(-0.2, 0.2), top + rng.uniform(0.3, 0.6), face + rng.uniform(-0.15, 0.15)) if axis == "z" \
                        else (face + rng.uniform(-0.15, 0.15), top + rng.uniform(0.3, 0.6), m + rng.uniform(-0.2, 0.2))
                    B.rod("rebar", "rebar", a, b, 0.025)
                u += w
        ruined_wall("z", Z1, X0, X1, -1)
        ruined_wall("z", Z0, X0, X1, +1)
        ruined_wall("x", X0, Z0, Z1, +1)
        ruined_wall("x", X1, Z0, Z1, -1)
        B.box("ruin", "base", X0 - 0.03, X1 + 0.03, 0.14, 0.55, Z0 - 0.03, Z0 + 0.25)
        # rubble mound inside and spilling out
        B.ell("rubble", "rubble", (0.2, 0.3, 0.6), (3.4, 1.0, 4.4))
        for _ in range(70):
            x = rng.uniform(-4.5, 4.5)
            z = rng.uniform(-5.2, 6.2)
            inside = abs(x) < 3.6 and abs(z) < 4.6
            y = (rng.uniform(0.6, 1.6) if inside else rng.uniform(0.05, 0.25))
            s = rng.uniform(0.12, 0.45)
            B.rbox("chunks", "rubble", np.array([x, y, z]), np.array([s, s * rng.uniform(0.4, 0.9), s * rng.uniform(0.5, 1.0)]),
                   eul(rng.uniform(-40, 40), rng.uniform(0, 180), rng.uniform(-40, 40)), rr=0.03)
        # the upper floor broke into pieces and came down onto the rubble (pancake collapse)
        for (c, h, ang) in (((0.4, 2.0, -2.4), (3.2, 0.13, 1.9), (13, 4, -5)),
                            ((-1.7, 1.25, 2.1), (1.8, 0.13, 2.1), (-19, -6, 11)),
                            ((1.9, 0.95, 2.5), (1.5, 0.13, 1.8), (-27, 8, -14))):
            R = eul(*ang)
            c = np.array(c)
            B.rbox("slabs", "concrete", c, np.array(h), R)
            for k in range(5):                                                             # rebar at the broken edge
                e = c + R @ np.array([rng.uniform(-h[0], h[0]), 0, h[2] * rng.choice([-1, 1])])
                B.rod("rebar", "rebar", e, e + R @ np.array([rng.uniform(-0.2, 0.2), rng.uniform(-0.1, 0.25), rng.uniform(0.25, 0.5) * np.sign(e[2] - c[2] + 1e-6)]), 0.022)
            for k in range(9):                                                             # rubble on top of it
                p = c + R @ np.array([rng.uniform(-h[0], h[0]) * 0.8, 0.15, rng.uniform(-h[2], h[2]) * 0.8])
                sz = rng.uniform(0.1, 0.35)
                B.rbox("chunks", "rubble", p, np.array([sz, sz * 0.6, sz * 0.8]), eul(rng.uniform(-40, 40), rng.uniform(0, 180), rng.uniform(-40, 40)), rr=0.03)
        B.rbox("slabs", "mint", np.array([0.9, 1.15, 4.6]), np.array([1.8, 0.5, 0.12]), eul(-62, 4, 6))       # front wall slab
        # the back-left corner still stands two storeys high
        B.box("corner", "cream", X0, X0 + 2.2, 0.14, F1, Z0, Z0 + 0.2)
        B.box("corner", "cream", X0, X0 + 0.2, 0.14, F1, Z0, Z0 + 1.6)
        B.box("corner", "concrete", X0 - 0.1, X0 + 2.0, F1, SL, Z0 - 0.1, Z0 + 0.35)
        B.box("corner", "mint", X0, X0 + 1.5, SL, 5.2, Z0, Z0 + 0.2)
        B.box("corner", "mint", X0, X0 + 0.7, 5.2, 5.75, Z0, Z0 + 0.2)
        B.box("corner", "mint", X0, X0 + 0.2, SL, 4.7, Z0, Z0 + 1.1)
        for x in (X0 + 1.55, X0 + 0.8):
            B.rod("rebar", "rebar", (x, 4.9 if x > X0 + 1 else 5.6, Z0 + 0.1), (x + 0.15, 5.5 if x > X0 + 1 else 6.1, Z0 + 0.05), 0.022)
        # roof sheets scattered on top and around
        for (cx, cy, cz, p, y, r, L) in ((0.6, 2.25, -0.6, -8, 15, 9, 2.6), (-1.5, 2.15, 1.8, 14, -30, -6, 2.2),
                                         (2.2, 1.6, 2.7, 22, 60, 12, 1.9), (-0.4, 2.05, -2.6, -12, 95, -10, 2.4),
                                         (4.6, 0.35, -1.0, 4, 10, 62, 2.2), (-3.0, 0.9, 5.4, 30, -15, 6, 1.6)):
            B.rbox("sheets", "roof", np.array([cx, cy, cz]), np.array([L / 2, 0.035, 0.55]), eul(p, y, r), axis=2)
        # one column still standing, with its rebar
        B.box("ruin", "concrete", X1 - 0.32, X1 - 0.02, 0.1, 2.4, FRONT2 - 0.3, FRONT2)
        for dx in (-0.08, 0.08):
            B.rod("rebar", "rebar", (X1 - 0.17 + dx, 2.4, FRONT2 - 0.15), (X1 - 0.17 + dx * 2.5, 3.0, FRONT2 - 0.1), 0.025)
        # the shop sign lies in the street
        B.rbox("chunks", "sign", np.array([1.2, 0.12, 6.0]), np.array([1.5, 0.03, 0.24]), eul(0, 12, 4))
    # ------------------------------------------------------------ side stairs (left), railing
    n_steps = 16 if not broken else 10
    for i in range(n_steps):
        z_hi = 3.6 - 0.28 * i
        B.box("stairs", "concrete", X0 - 1.0, X0 - 0.02, 0.0, 0.2 * (i + 1), z_hi - 0.28, z_hi)
    if not broken:
        B.box("stairs", "concrete", X0 - 1.0, X0 - 0.02, 3.0, 3.22, -3.5, 3.6 - 0.28 * 16)    # landing
        B.box("stairs", "concrete", X0 - 0.95, X0 - 0.65, 0.0, 3.0, -3.45, -3.15)            # landing column
        top = (X0 - 0.95, 4.25, 3.6 - 0.28 * 16)
        B.rod("rail", "grille", (X0 - 0.95, 1.2, 3.55), top, 0.035)
        B.rod("rail", "grille", top, (X0 - 0.95, 4.25, -3.45), 0.035)
        for k in range(0, 17, 3):
            z = 3.55 - 0.28 * k
            y = 0.2 * (k + 1)
            B.rod("rail", "grille", (X0 - 0.95, y, z), (X0 - 0.95, y + 1.0, z), 0.025)
        for z in (-1.6, -3.4):
            B.rod("rail", "grille", (X0 - 0.95, 3.22, z), (X0 - 0.95, 4.25, z), 0.025)
    else:
        R = eul(0, 0, -38)                                                                 # landing fell over
        B.rbox("stairs", "concrete", np.array([X0 - 1.1, 0.6, -2.3]), np.array([0.5, 0.11, 1.2]), R)
    # ------------------------------------------------------------ water tank on a stand (back right)
    tx, tz = 2.4, -5.35
    if not broken:
        for dx in (-0.55, 0.55):
            for dz in (-0.55, 0.55):
                B.box("tank", "steel", tx + dx - 0.05, tx + dx + 0.05, 0.0, 2.0, tz + dz - 0.05, tz + dz + 0.05)
        B.box("tank", "steel", tx - 0.68, tx + 0.68, 2.0, 2.1, tz - 0.68, tz + 0.68)
        B.cyl("tank", "tank", (tx, 2.8, tz), 0.62, 0.7)
        B.cyl("tank", "tank", (tx, 3.53, tz), 0.36, 0.04)
    else:
        B.cyl("tank", "tank", (tx + 0.6, 0.62, tz - 0.4), 0.62, 0.7, R=eul(0, 30, 90))
        B.box("tank", "steel", tx - 1.2, tx + 0.2, 0.0, 0.1, tz - 0.5, tz + 0.6)
    # ------------------------------------------------------------ potted plants by the door
    pots = ((-1.15, 4.95), (-3.05, 4.95), (3.05, 5.75))
    for k, (px, pz) in enumerate(pots):
        if state == 1 and k == 0:                                                          # knocked over
            B.p.append(Prim("rcone", "pot", "plants", a=(px, 0.18, pz), b=(px + 0.32, 0.16, pz + 0.12), r1=0.17, r2=0.13))
            B.ell("plants", "leaf", (px + 0.62, 0.2, pz + 0.22), (0.3, 0.16, 0.25))
            continue
        if broken and k < 2:
            continue
        B.p.append(Prim("rcone", "pot", "plants", a=(px, 0.0, pz), b=(px, 0.34, pz), r1=0.13, r2=0.17))
        B.ell("plants", "leaf", (px, 0.62, pz), (0.3, 0.33, 0.3))
    # ------------------------------------------------------------ debris (damaged)
    if state == 1:
        for _ in range(16):
            x, z = rng.uniform(-3.8, 3.8), rng.uniform(4.7, 6.3)
            s = rng.uniform(0.06, 0.2)
            B.rbox("debris", "rubble", np.array([x, s * 0.6, z]), np.array([s, s * 0.6, s * 0.8]),
                   eul(rng.uniform(-30, 30), rng.uniform(0, 180), rng.uniform(-30, 30)), rr=0.02)
        B.rbox("debris", "roof", np.array([X1 + 0.45, 1.3, 2.2]), np.array([1.3, 0.035, 0.5]), eul(0, 90, 68), axis=2)
        B.rbox("debris", "roof", np.array([-1.0, 0.06, 6.4]), np.array([1.1, 0.03, 0.5]), eul(0, 20, 2), axis=2)
    sc = Scene(B.p)
    sc.wear = wear
    return sc


# ---------------------------------------------------------------- shading
def shade(scene, P, ids, n):
    k = len(P)
    alb = np.zeros((k, 3))
    spec = np.zeros(k)
    n2 = n.copy()
    wear = getattr(scene, "wear", 0)
    for i in np.unique(ids):
        m = np.nonzero(ids == i)[0]
        if i < 0:
            alb[m] = (0.5, 0.5, 0.5)
            continue
        pr = scene.prims[i]
        col, sp, tex = MAT[pr.mat][:3]
        band = MAT[pr.mat][3] if len(MAT[pr.mat]) > 3 else (0.98, 0.80, 0.18)
        Pm = P[m]
        q = pr.local(Pm)
        c = np.tile(np.array(pr.col if pr.col is not None else col, float), (len(m), 1))
        if tex == "plaster":
            c *= (0.94 + 0.05 * noise(Pm, 2.2, 0) + 0.03 * noise(Pm, 9, 1))[:, None]
            streak = np.clip(noise(Pm * np.array([3.0, 0.25, 3.0]), 1.0, 2), 0, 1)      # rain streaks
            c *= (1 - 0.10 * streak)[:, None]
            c *= (1 - 0.18 * np.exp(-(Pm[:, 1] - 0.14) / 0.35) * (Pm[:, 1] < 3.0))[:, None]  # splash dirt
        elif tex == "concrete" or tex == "rubble":
            c *= (0.9 + 0.08 * noise(Pm, 3.0, 1) + 0.05 * noise(Pm, 13, 3))[:, None]
            if tex == "rubble":
                c *= (0.8 + 0.3 * hash01(Pm, 3.0))[:, None]
                v = np.stack([hash01(Pm + o, 3.0) for o in (0.11, 0.53, 0.97)], 1) - 0.5    # faceted stones
                n2[m] = n[m] + 1.1 * v
        elif tex == "roof":
            ax = pr.R[:, pr.axis if pr.axis is not None else 2]
            ph = q[:, pr.axis if pr.axis is not None else 2] * (2 * math.pi / 0.17)
            top = (n[m] @ pr.R[:, 1]) > 0.5
            n2[m] = n[m] + np.where(top[:, None], ax[None] * (0.45 * np.cos(ph))[:, None], 0)
            dn = Pm - pr.c
            streaky = noise(np.stack([dn @ pr.R[:, 0] * 0.6, dn[:, 1] * 0, dn @ pr.R[:, 2] * 4.0], 1), 1.0, 4)
            rust = np.clip(0.6 * noise(Pm, 3.2, 2) + 0.6 * streaky - 0.62 + 0.35 * wear, 0, 1)
            if pr.mat in ("roof_green", "roof_blue", "roof_grey"):                       # painted sheets: faded, little rust
                rust *= 0.4
                c *= (0.93 + 0.1 * streaky)[:, None]
            c = c * (1 - rust[:, None]) + np.array([0.47, 0.28, 0.16]) * rust[:, None]
            c *= (0.92 + 0.08 * np.cos(ph))[:, None]
        elif tex == "jalousie":
            f = (q[:, 1] / 0.1) % 1.0
            slat = f > 0.22
            c = np.where(slat[:, None], c * (0.85 + 0.45 * f)[:, None], np.array([0.78, 0.79, 0.8]))
        elif tex == "sign":
            v = q[:, 1] / max(pr.h[1], 1e-6)
            yellow = np.abs(v) < 0.38
            c = np.where(yellow[:, None], np.array(band), c)
            letters = yellow & (np.abs(v) < 0.2) & (((q[:, 0] / 0.11) % 1.0) < 0.62) & (np.abs(q[:, 0]) < pr.h[0] * 0.82)
            c = np.where(letters[:, None], np.array([0.18, 0.12, 0.35]), c)
        elif tex == "wood":
            c *= (0.88 + 0.12 * np.sin(q[:, 0] * 40 + 3 * noise(Pm, 4, 2)))[:, None]
        elif tex == "ribbon":                                                            # strip windows, mullions every 1.2 m
            thin = int(np.argmin(pr.h))
            ua = 0 if thin == 2 else 2
            u, v = q[:, ua], q[:, 1]
            hu, hv = pr.h[ua], pr.h[1]
            frame = (np.abs(u) > hu - 0.05) | (np.abs(v) > hv - 0.05) | (((u + 60.0) % 1.2) < 0.06) | (np.abs(v + hv * 0.35) < 0.025)
            g = c * (0.72 + 0.55 * ((v / hv + 1) / 2))[:, None]
            sheen = (((u + v * 0.8) * 1.6) % 2.4) < 0.3
            g = np.where(sheen[:, None], g * 1.35 + 0.05, g)
            c = np.where(frame[:, None], np.array([0.80, 0.81, 0.82]), g)
        elif tex == "hsign":                                                             # white H on a blue panel
            thin = int(np.argmin(pr.h))
            ua = 0 if thin == 2 else 2
            un, vn = q[:, ua] / pr.h[ua], q[:, 1] / pr.h[1]
            H = ((np.abs(un) > 0.32) & (np.abs(un) < 0.58) & (np.abs(vn) < 0.62)) | ((np.abs(un) < 0.58) & (np.abs(vn) < 0.11))
            rim = (np.abs(un) > 0.86) | (np.abs(vn) > 0.86)
            c = np.where((H | rim)[:, None], np.array([0.96, 0.96, 0.95]), c)
        elif tex == "helipad" and pr.h is not None:                                      # deck markings
            off = getattr(pr, "tex_off", (0.0, 0.0, 0.0))                              # pieces of one broken deck
            hh = getattr(pr, "tex_half", pr.h)
            x, z = q[:, 0] + off[0], q[:, 2] + off[2]
            r = np.hypot(x, z)
            ring = np.abs(r - 5.0) < 0.22
            H = ((np.abs(x) > 1.0) & (np.abs(x) < 1.55) & (np.abs(z) < 2.3)) | ((np.abs(x) < 1.55) & (np.abs(z) < 0.28))
            edge = (np.abs(x) > hh[0] - 0.3) | (np.abs(z) > hh[2] - 0.3)
            c = c * (0.9 + 0.08 * noise(Pm, 3.0, 2))[:, None]
            c = np.where((ring | H)[:, None], np.array([0.93, 0.93, 0.9]), c)
            c = np.where(edge[:, None], np.array([0.95, 0.78, 0.15]), c)
            c = np.where(((r < 5.8) & ~ring & ~H & (r > 0))[:, None] & (wear > 0), c, c)
        elif tex == "cladding":                                                          # ribbed metal wall sheets
            thin = int(np.argmin(pr.h))
            ua = 0 if thin == 2 else 2
            ph = q[:, ua] * (2 * math.pi / 0.3)
            face = np.abs(n[m] @ pr.R[:, thin]) > 0.5
            n2[m] = n[m] + np.where(face[:, None], pr.R[:, ua][None] * (0.4 * np.cos(ph))[:, None], 0)
            c *= (0.9 + 0.1 * np.cos(ph))[:, None]
            dirt = np.clip(noise(np.stack([Pm[:, 0] * 2.0, Pm[:, 1] * 0.2, Pm[:, 2] * 2.0], 1), 1.0, 6), 0, 1)
            c *= (1 - 0.12 * dirt)[:, None]
            rust = np.clip(0.7 * noise(Pm, 2.5, 7) - 0.78 + 0.32 * wear, 0, 1)
            c = c * (1 - rust[:, None]) + np.array([0.45, 0.28, 0.17]) * rust[:, None]
        elif tex == "asphalt":
            c *= (0.88 + 0.12 * noise(Pm, 6.0, 2) + 0.05 * hash01(Pm, 30.0))[:, None]
            crack = np.abs(noise(Pm, 0.9, 8)) < 0.012
            c *= np.where(crack, 0.6, 1.0)[:, None]
        elif tex == "hazard":                                                            # yellow and black stripes
            st = (((q[:, 0] + q[:, 1] + q[:, 2]) / 0.35) % 2.0) < 1.0
            c = np.where(st[:, None], np.array([0.95, 0.75, 0.10]), np.array([0.10, 0.10, 0.10]))
        elif tex == "breeze":                                                            # ventilation blocks
            thin = int(np.argmin(pr.h))
            ua, va = [k for k in range(3) if k != thin]
            fu, fv = (q[:, ua] / 0.2 + 50) % 1.0, (q[:, va] / 0.2 + 50) % 1.0
            hole = (fu > 0.16) & (fu < 0.84) & (fv > 0.16) & (fv < 0.84)
            web = (np.abs(fu - 0.5) < 0.07) | (np.abs(fv - 0.5) < 0.07)
            c = np.where((hole & ~web)[:, None], np.array([0.10, 0.09, 0.08]), c)
        elif tex == "plywood":
            c *= (0.9 + 0.1 * np.sin(q[:, 0] * 25 + 4 * noise(Pm, 3, 3)))[:, None]
        elif tex == "door":
            g = ((np.abs(q[:, 0]) % 0.25) < 0.02) | ((np.abs(q[:, 1]) % 0.5) < 0.025)
            c *= np.where(g, 0.7, 1.0)[:, None]
        elif tex == "tank":
            ring = ((q[:, 1] + 10) % 0.28) < 0.04
            c *= np.where(ring, 0.8, 1.0)[:, None]
        elif tex == "leaf":
            c *= (0.75 + 0.5 * np.clip(noise(Pm, 14, 5) * 0.8 + 0.5, 0, 1))[:, None]
        elif tex == "ac":
            g = ((q[:, 1] + 10) % 0.06) < 0.02
            c *= np.where(g & (q[:, 0] > -0.1), 0.75, 1.0)[:, None]
        elif tex in ("window", "window_grille"):
            thin = int(np.argmin(pr.h))
            ua = [k for k in (0, 2) if k != thin][0] if thin != 1 else 0
            u, v = q[:, ua], q[:, 1]
            hu, hv = pr.h[ua], pr.h[1]
            frame = (np.abs(u) > hu - 0.06) | (np.abs(v) > hv - 0.06) | (np.abs(u) < 0.03)
            g = c * (0.75 + 0.55 * ((v / hv + 1) / 2))[:, None]
            sheen = (((u + v * 0.8) * 2.2) % 2.0) < 0.28
            g = np.where(sheen[:, None], g * 1.35 + 0.05, g)
            c = np.where(frame[:, None], np.array([0.74, 0.75, 0.76]), g)
            if tex == "window_grille":
                bar = (np.abs(((u + 10) % 0.13) - 0.065) < 0.014) | (np.abs(v) < 0.018)
                c = np.where(bar[:, None], np.array([0.14, 0.20, 0.17]), c)
        elif tex == "shutter":
            ph = q[:, 1] * (2 * math.pi / 0.085)
            fr = (n[m] @ pr.R[:, int(np.argmin(pr.h))])
            face = np.abs(fr) > 0.5
            n2[m] = n[m] + np.where(face[:, None], pr.R[:, 1][None] * (0.45 * np.cos(ph))[:, None], 0)
            c *= (0.86 + 0.14 * np.cos(ph))[:, None]
        elif tex == "deck":
            c *= (0.9 + 0.08 * noise(Pm, 3.0, 1))[:, None]
            stain = np.clip(noise(Pm, 0.7, 4) * 1.5 - 0.6, 0, 1)
            c *= (1 - 0.28 * stain)[:, None]
        elif tex == "solar":
            thin = int(np.argmin(pr.h))
            ua, va = [k for k in range(3) if k != thin]
            gl = (((q[:, ua] + 10) % 0.32) < 0.02) | (((q[:, va] + 10) % 0.5) < 0.02)
            c = np.where(gl[:, None], np.array([0.75, 0.76, 0.78]), c)
        elif tex == "sack":
            c *= (0.82 + 0.25 * np.clip(noise(Pm, 9, 2) * 0.7 + 0.5, 0, 1))[:, None]
        elif tex == "masonry":
            nm = n[m]
            u = np.where(np.abs(nm[:, 2]) > np.abs(nm[:, 0]), Pm[:, 0], Pm[:, 2])
            v = Pm[:, 1]
            top = nm[:, 1] > 0.7
            u = np.where(top, Pm[:, 0], u)
            v = np.where(top, Pm[:, 2], v)
            row = np.floor(v / 0.42)
            uu = u + (row % 2) * 0.42
            joint = ((v % 0.42) < 0.035) | ((uu % 0.85) < 0.035)
            blk = hash01(np.stack([np.floor(uu / 0.85), row, np.zeros_like(u)], 1), 1.0)
            c *= (0.86 + 0.2 * blk)[:, None] * (0.95 + 0.06 * noise(Pm, 3.5, 2))[:, None]
            c = np.where(joint[:, None], c * 0.72, c)
            streak = np.clip(noise(Pm * np.array([2.5, 0.2, 2.5]), 1.0, 5), 0, 1)
            c *= (1 - 0.22 * streak)[:, None]
            moss = np.clip(1 - Pm[:, 1] / 1.4, 0, 1) * np.clip(noise(Pm, 2.0, 3) + 0.3, 0, 1)
            c = c * (1 - 0.35 * moss[:, None]) + np.array([0.30, 0.34, 0.20]) * 0.35 * moss[:, None]
        elif tex == "tiles":
            ax = pr.R[:, pr.axis if pr.axis is not None else 2]
            across = q[:, pr.axis if pr.axis is not None else 2]
            down = q[:, 0]
            ph = across * (2 * math.pi / 0.3)
            top = (n[m] @ pr.R[:, 1]) > 0.5
            n2[m] = n[m] + np.where(top[:, None], ax[None] * (0.5 * np.sin(ph))[:, None], 0)
            rowl = ((down + 50) % 0.36) < 0.05
            c *= (0.85 + 0.15 * np.sin(ph))[:, None]
            c = np.where(rowl[:, None], c * 0.7, c)
            age = np.clip(noise(Pm, 1.6, 4) * 1.2 - 0.2, 0, 1)
            c = c * (1 - 0.4 * age[:, None]) + np.array([0.30, 0.24, 0.20]) * 0.4 * age[:, None]
        elif tex == "stained":
            cell = hash01(Pm, 7.0)
            pal = np.array([(0.15, 0.25, 0.62), (0.62, 0.12, 0.12), (0.85, 0.62, 0.18), (0.15, 0.48, 0.28), (0.45, 0.22, 0.55)])
            c = pal[(cell * 5).astype(int) % 5] * 0.75
            lead = (hash01(Pm + 0.071, 7.0) != cell)
            c = np.where(lead[:, None], np.array([0.08, 0.08, 0.08]), c)
        elif tex == "cobble":
            cx = np.floor(Pm[:, 0] / 0.3)
            cz = np.floor((Pm[:, 2] + (cx % 2) * 0.15) / 0.3)
            j = (((Pm[:, 0]) % 0.3) < 0.03) | (((Pm[:, 2] + (cx % 2) * 0.15) % 0.3) < 0.03)
            c *= (0.85 + 0.25 * hash01(np.stack([cx, cz, np.zeros_like(cx)], 1), 1.0))[:, None]
            c = np.where(j[:, None], c * 0.65, c)
        elif tex == "rings":
            c *= (0.84 + 0.16 * np.cos(q[:, 1] * 2 * math.pi / 0.14) + 0.05 * noise(Pm, 6, 2))[:, None]
        elif tex == "bark":
            ang = np.arctan2(q[:, 2], q[:, 0])
            c *= (0.82 + 0.18 * np.sin(ang * 14 + 3 * noise(Pm, 2.5, 3)))[:, None]
        elif tex == "frond":
            hz = max(pr.h[2], 1e-3) if pr.kind == "box" else 1.0
            st = np.sin((q[:, 0] + np.abs(q[:, 2]) * 0.7) * 2 * math.pi / 0.075)
            c *= np.where(st > -0.35, 1.0, 0.55)[:, None]
            fringe = np.abs(q[:, 2]) > 0.82 * hz
            c = np.where(fringe[:, None], c * 0.8 + np.array([0.08, 0.06, 0.0]), c)
            c *= (0.9 + 0.12 * noise(Pm, 1.5, 4))[:, None]
        elif tex == "broadleaf":
            hz = max(pr.h[2], 1e-3) if pr.kind == "box" else 1.0
            c *= (0.95 + 0.05 * np.sin((q[:, 0] * 0.4 + np.abs(q[:, 2])) * 2 * math.pi / 0.05))[:, None]
            tear = (np.sin(q[:, 0] * 5.0 + 1.3) > 0.985) & (np.abs(q[:, 2]) > 0.45 * hz)
            c = np.where(tear[:, None], c * 0.6, c)
            c = np.where((np.abs(q[:, 2]) < 0.025)[:, None], c * 1.25 + 0.05, c)                 # midrib
            c *= (0.88 + 0.14 * noise(Pm, 1.2, 5))[:, None]
        elif tex == "foliage":
            jit = np.stack([noise(Pm, 6.5, 1), 0.4 * noise(Pm, 6.5, 2), noise(Pm, 6.5, 3)], 1)
            n2[m] = n[m] + 0.6 * jit
            c *= (0.7 + 0.45 * np.clip(noise(Pm, 9, 4) * 0.5 + 0.5, 0, 1))[:, None]
            spk = hash01(Pm, 16.0) > 0.88
            c = np.where(spk[:, None], c * 1.35, c)
        # soot plumes above burnt-out windows (damaged mid-rise)
        for (f0, fn, fw) in getattr(scene, "fires", ()):
            rel = Pm - f0
            dy = rel[:, 1]
            off = np.abs(rel @ fn)
            tang = np.cross(fn, [0, 1.0, 0])
            dh = np.abs(rel @ tang)
            wdt = fw + 0.32 * np.maximum(dy, 0)
            k_ = np.clip(1 - dh / wdt, 0, 1) * np.clip(1 - dy / 4.2, 0, 1) * (dy > -0.3) * (off < 0.7)
            k_ = np.clip(k_ * 1.6, 0, 0.92)
            c = c * (1 - k_[:, None]) + np.array([0.08, 0.07, 0.07]) * k_[:, None]
        # weathering and battle damage on walls and concrete
        if wear and tex in ("plaster", "concrete", "rubble", "plain", "wood", "masonry", "tiles", "helipad", "hsign", "cladding", "asphalt"):
            soot = np.clip(noise(Pm, 0.9, 3) * 1.3 - (1.05 - 0.4 * wear), 0, 1)
            c = c * (1 - 0.75 * soot[:, None]) + np.array([0.10, 0.09, 0.08]) * 0.75 * soot[:, None]
            if tex in ("plaster", "masonry"):
                vert = np.abs(n[m][:, 1]) < 0.5                                         # walls, not floors
                holes = vert & (hash01(Pm + 0.37, 14.0) > 1 - 0.012 * wear * 2) if tex == "plaster" else \
                        (hash01(Pm + 0.37, 9.0) > 1 - 0.005 * wear * 2)
                c = np.where(holes[:, None], np.array([0.15, 0.13, 0.12]), c)
                crack = vert & (np.abs(noise(Pm, 2.6, 5)) < 0.018 * wear)
                c = np.where(crack[:, None], c * 0.45, c)
        alb[m] = np.clip(c, 0, 1)
        spec[m] = sp
    n2 /= np.linalg.norm(n2, axis=1, keepdims=True) + 1e-9
    return alb, spec, n2

FOOTPRINT = {"walls": [7.0, 9.0], "with_stairs_porch_tank": [8.2, 11.9]}
HEIGHT = round(RIDGE + 0.1, 2)

"""Shared building parts for the later town sprites (bungalow, supermarket, power plant)."""
import math

import numpy as np

from bsdf import Prim, eul
from townhouse import MAT

MAT.update({
    "carpaint":   ((0.70, 0.70, 0.70), 0.55, "plain"),
    "tyre":       ((0.08, 0.08, 0.08), 0.10, "plain"),
    "glass_dark": ((0.16, 0.22, 0.26), 0.85, "plain"),
    "chrome":     ((0.75, 0.76, 0.78), 0.80, "metal"),
    "asphalt":    ((0.27, 0.27, 0.28), 0.04, "asphalt"),
    "paint_w":    ((0.92, 0.92, 0.88), 0.05, "plain"),
    "beam_burnt": ((0.13, 0.10, 0.08), 0.02, "wood"),
    "hazard":     ((0.95, 0.75, 0.10), 0.20, "hazard"),
})


def win(B, g, axis, face, out, u0, u1, y0, y1, fill, depth=0.12, wall="cream"):
    """recess an opening into a wall face and put the fill (glass, door, darkness) just proud of
    its back. axis 'z': wall facing +-z (u along x); out = +1 if the face looks toward +axis"""
    a, b = (face - depth, face + 0.3) if out > 0 else (face - 0.3, face + depth)
    f0 = face - out * depth
    fa, fb = sorted((f0 - out * 0.02, f0 + out * 0.04))
    if axis == "z":
        B.box(g, wall, u0, u1, y0, y1, a, b, sub=True)
        if fill:
            B.box(g, fill, u0, u1, y0, y1, fa, fb)
    else:
        B.box(g, wall, a, b, y0, y1, u0, u1, sub=True)
        if fill:
            B.box(g, fill, fa, fb, y0, y1, u0, u1)


def hip_roof(B, g, mat, x0, x1, z0, z1, ye, pitch_deg, t=0.12, ridge="ridge"):
    """corrugated hip roof over the rectangle (overhangs included), eaves at height ye; four planes,
    so the corrugations run down every slope. Returns the ridge height."""
    cx, cz, Lx, Lz = (x0 + x1) / 2, (z0 + z1) / 2, (x1 - x0) / 2, (z1 - z0) / 2
    p = math.radians(pitch_deg)
    tp, cp, sp = math.tan(p), math.cos(p), math.sin(p)
    planes = []   # (normal, offset): keep n.p <= o
    for (nx, nz, L) in ((0, 1, Lz), (0, -1, Lz), (1, 0, Lx), (-1, 0, Lx)):
        n = np.array([nx * sp, cp, nz * sp])
        o = (ye + L * tp) * cp + n[0] * cx + n[2] * cz
        planes.append((n, o))
    top = ye + min(Lx, Lz) * tp
    for k, (nk, ok) in enumerate(planes):
        cuts = list(planes)
        for j, (nj, oj) in enumerate(planes):
            if j == k:
                continue
            d = np.array([nj[0] - nk[0], 0.0, nj[2] - nk[2]])
            L = np.linalg.norm(d)
            cuts.append((d / L, (oj - ok) / L))
        B.box(g, mat, x0, x1, ye - t, top + 0.1, z0, z1, cuts=cuts)
        B.p[-1].axis = 0 if k < 2 else 2
    ry = top + 0.02
    if Lx >= Lz:
        a, b = (cx - (Lx - Lz), ry, cz), (cx + (Lx - Lz), ry, cz)
    else:
        a, b = (cx, ry, cz - (Lz - Lx)), (cx, ry, cz + (Lz - Lx))
    if ridge:
        B.rod(g, ridge, a, b, 0.08)
        for (sx, sz) in ((-1, -1), (-1, 1), (1, -1), (1, 1)):
            end = a if (sx < 0 if Lx >= Lz else sz < 0) else b
            B.rod(g, ridge, end, (cx + sx * Lx, ye + 0.03, cz + sz * Lz), 0.06)
    return top


def car(B, g, x, z, yaw, colour, state=0, y=0.0):
    """a small car, length along its local z; state 2 = burnt out"""
    R = eul(0, yaw, 0)
    burnt = state == 2
    body = "burnt" if burnt else "carpaint"
    col = None if burnt else colour
    P = lambda lx, ly, lz: np.array([x, y, z]) + R @ np.array([lx, ly, lz])
    B.rbox(g, body, P(0, 0.62, 0), np.array([0.86, 0.3, 2.1]), R, rr=0.12, col=col)
    if burnt:
        B.rbox(g, "burnt", P(0, 1.08, -0.25), np.array([0.74, 0.22, 1.0]), R @ eul(4, 0, 6), rr=0.08)
    else:
        B.rbox(g, "glass_dark", P(0, 1.12, -0.2), np.array([0.76, 0.27, 1.05]), R, rr=0.12)
        B.rbox(g, body, P(0, 1.38, -0.3), np.array([0.7, 0.04, 0.8]), R, rr=0.03, col=col)
        B.rbox(g, "chrome", P(0, 0.55, 2.1), np.array([0.7, 0.08, 0.04]), R)
    for sx in (-0.84, 0.84):
        for sz in (-1.35, 1.35):
            r = 0.32 if not burnt else 0.27
            B.p.append(Prim("cyl", "tyre", g, c=P(sx, r, sz), r=r, hh=0.12, R=R @ eul(0, 0, 90)))


def tricycle(B, g, x, z, yaw, colour, state=0, roll=0.0, y=0.0):
    """a Philippine tricycle: motorcycle with a roofed sidecar on its right (roll: tipped over)"""
    R = eul(0, yaw, 0) @ eul(0, 0, roll)
    burnt = state == 2
    P = lambda lx, ly, lz: np.array([x, y, z]) + R @ np.array([lx, ly, lz])
    side = "burnt" if burnt else "carpaint"
    col = None if burnt else colour
    B.rbox(g, "steel", P(-0.55, 0.6, 0.0), np.array([0.16, 0.25, 0.85]), R, rr=0.05)                 # motorcycle
    B.rbox(g, "tyre", P(-0.55, 0.95, -0.25), np.array([0.14, 0.06, 0.3]), R)                         # seat
    B.rod(g, "chrome", P(-0.55, 0.9, 0.8), P(-0.55, 1.25, 0.65), 0.03)
    B.rod(g, "chrome", P(-0.85, 1.25, 0.65), P(-0.25, 1.25, 0.65), 0.025)
    B.rbox(g, side, P(0.45, 0.75, 0.05), np.array([0.55, 0.45, 0.8]), R, rr=0.08, col=col)            # sidecar
    if not burnt:
        B.rbox(g, side, P(0.15, 1.62, 0.0), np.array([0.95, 0.04, 1.0]), R, col=col)                # roof
        for (lx, lz) in ((-0.7, 0.9), (0.95, 0.9), (-0.7, -0.9), (0.95, -0.9)):
            B.rod(g, "steel", P(lx, 1.2, lz), P(lx, 1.6, lz), 0.025)
    for (lx, lz, ax) in ((-0.55, 0.85, 0), (-0.55, -0.85, 0), (0.75, 0.05, 0)):
        B.p.append(Prim("cyl", "tyre", g, c=P(lx, 0.3, lz), r=0.3, hh=0.07, R=R @ eul(0, 0, 90)))


def debris(B, rng, g, n, zone, mats=("rubble", "concrete"), y0=0.0, smax=0.35):
    x0, x1, z0, z1 = zone
    for _ in range(n):
        x, z = rng.uniform(x0, x1), rng.uniform(z0, z1)
        s = rng.uniform(0.1, smax)
        B.rbox(g, mats[rng.integers(len(mats))], np.array([x, y0 + s * 0.4, z]), np.array([s, s * 0.55, s * 0.8]),
               eul(rng.uniform(-20, 20), rng.uniform(0, 180), rng.uniform(-20, 20)), rr=0.03)


def heap(B, rng, g, cx, cz, rx, rz, h, n, mats=("rubble", "concrete", "rubble"), y0=0.0):
    """a rubble heap: a low faceted mound with loose blocks on it"""
    B.ell(g, "rubble", (cx, y0, cz), (rx, h, rz))
    for _ in range(n):
        a, r = rng.uniform(0, 2 * math.pi), math.sqrt(rng.uniform(0, 1)) * 1.0
        x, z = cx + r * rx * math.cos(a), cz + r * rz * math.sin(a)
        top = y0 + h * max(0.0, 1 - r * r) ** 0.8
        s = rng.uniform(0.15, 0.45)
        B.rbox(g, mats[rng.integers(len(mats))], np.array([x, top + s * 0.2, z]), np.array([s, s * 0.55, s * 0.8]),
               eul(rng.uniform(-35, 35), rng.uniform(0, 180), rng.uniform(-35, 35)), rr=0.04)


def sandbag_row(B, g, x0, x1, z, y, rows=2, along="x"):
    n = max(1, int((x1 - x0) / 0.6))
    for r in range(rows):
        for k in range(n - r):
            u = x0 + 0.3 + 0.6 * k + 0.3 * r
            c = (u, y + 0.13 + r * 0.24, z) if along == "x" else (z, y + 0.13 + r * 0.24, u)
            B.ell(g, "sandbag", c, (0.31, 0.13, 0.22) if along == "x" else (0.22, 0.13, 0.31))


def sandbag_arc(B, g, cx, cz, rx, rz, a0, a1, n, rows=3, y=0.0):
    for k in range(n):
        a = math.radians(a0 + (a1 - a0) * k / max(1, n - 1))
        for r in range(rows):
            B.ell(g, "sandbag", (cx + rx * math.sin(a), y + 0.13 + r * 0.24, cz + rz * math.cos(a)),
                  (0.32, 0.13, 0.22), R=eul(0, math.degrees(a) + 90, 0))


def ruined_wall(B, rng, g, mat, axis, face, u0, u1, t, lo, hi, y0=0.0):
    """a wall broken down to jagged stubs; axis 'z': wall along x at z = face..face + t"""
    u = u0
    while u < u1 - 1e-6:
        w = min(u1 - u, rng.uniform(0.5, 1.5))
        top = y0 + rng.uniform(lo, hi)
        if axis == "z":
            B.box(g, mat, u, u + w, y0, top, face, face + t)
        else:
            B.box(g, mat, face, face + t, y0, top, u, u + w)
        u += w

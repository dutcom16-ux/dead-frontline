"""Animation keyframes for the soldier rig (character space: +z forward,
+y up, character's left = +x, ground at y=0)."""
import copy
import math

import numpy as np

import soldier3d as S

A = S.ANKLE_H


def base_low_ready():
    return dict(
        pel=(0.0, 0.945, 0.0), pel_rot=(0, -8, 0),
        spine=(6, -6, 0), head=(-20, 14, 0),
        footL=(0.12, A, 0.07), footL_rot=(0, 6, 0),
        footR=(-0.13, A, -0.08), footR_rot=(0, -18, 0),
        gun_chest=((-0.12, 0.22, 0.12), (34, 26, -14)),
        poleR=(-1.0, -1.0, -0.6), poleL=(0.6, -1.6, -0.2),
        on_gun=1.0, kpoleL=(0.15, 0, 1.0), kpoleR=(-0.15, 0, 1.0),
    )


def base_aim():
    return dict(
        pel=(0.0, 0.925, -0.02), pel_rot=(0, -22, 0),
        spine=(9, -12, 0), head=(14, 32, -6),
        footL=(0.13, A, 0.17), footL_rot=(0, 4, 0),
        footR=(-0.15, A, -0.16), footR_rot=(0, -40, 0),
        gun_chest=((-0.10, 0.295, 0.07), (-9, 34, 0)),
        poleR=(-1.0, -0.5, -0.5), poleL=(0.4, -1.6, -0.1),
        on_gun=1.0, kpoleL=(0.15, 0, 1.0), kpoleR=(-0.15, 0, 1.0),
    )


# ----------------------------------------------------------------- idle (8)
def idle():
    out = []
    for i in range(8):
        p = 2 * math.pi * i / 8
        P = base_low_ready()
        P["pel"] = (0.0, 0.945 - 0.006 * (1 - math.cos(p)) / 2, 0.0)
        P["spine"] = (6 + 1.6 * math.sin(p), -6, 0.6 * math.sin(p))
        P["head"] = (-20 - 1.2 * math.sin(p), 14 + 3 * math.sin(p * 0.5 + 0.3), 0)
        (gp, gr) = P["gun_chest"]
        P["gun_chest"] = ((gp[0], gp[1] + 0.006 * math.sin(p), gp[2]),
                          (gr[0] + 1.5 * math.sin(p + 0.6), gr[1], gr[2]))
        out.append((P, {}))
    return out


# ----------------------------------------------------------------- walk (12)
def foot_cycle(ph, stride=0.27):
    """ph in [0,1): 0 = heel strike. stance 0..0.6, swing 0.6..1."""
    if ph < 0.6:
        s = ph / 0.6
        z = stride * (1 - 2 * s)
        y = A
        pitch = -12 * max(0, 1 - s / 0.15) + 28 * max(0, (s - 0.7) / 0.3)
        y += 0.035 * max(0, (s - 0.7) / 0.3)            # heel lift at toe-off
    else:
        s = (ph - 0.6) / 0.4
        e = 0.5 - 0.5 * math.cos(math.pi * s)
        z = -stride + 2 * stride * e
        y = A + 0.11 * math.sin(math.pi * s) ** 1.2
        pitch = 28 * (1 - s) ** 2 - 12 * s ** 2 + 10 * math.sin(math.pi * s)
    return z, y, pitch


def walk():
    out = []
    for i in range(12):
        ph = i / 12
        P = base_low_ready()
        zL, yL, pL = foot_cycle(ph)
        zR, yR, pR = foot_cycle((ph + 0.5) % 1)
        P["footL"] = (0.11, yL, zL + 0.02)
        P["footR"] = (-0.11, yR, zR + 0.02)
        P["footL_rot"] = (pL, 4, 0)
        P["footR_rot"] = (pR, -4, 0)
        w = 2 * math.pi * ph
        bob = -0.022 * math.cos(2 * w)
        P["pel"] = (0.018 * math.sin(w - 0.6), 0.925 + bob, 0.0)
        P["pel_rot"] = (2, 6 * math.cos(w), 2.5 * math.sin(w))
        P["spine"] = (8, -6 - 8 * math.cos(w), -2.0 * math.sin(w))
        P["head"] = (-21, 12 + 2 * math.cos(w), 0)
        gp, gr = P["gun_chest"]
        P["gun_chest"] = ((gp[0], gp[1] + 0.008 * math.cos(2 * w), gp[2]),
                          (gr[0] + 2 * math.sin(2 * w), gr[1] + 2 * math.cos(w), gr[2]))
        out.append((P, {}))
    return out


# ----------------------------------------------------------------- fire (6)
def fire():
    spec = [  # recoil back, muzzle rise (deg), shoulder push, flash, casing
        (0.000, 0.0, 0.0, 0.0, None),
        (0.032, 3.0, 2.0, 1.0, None),
        (0.040, 6.0, 3.0, 0.55, ((-0.09, 0.07, 0.29), 0.8)),
        (0.022, 4.0, 1.8, 0.0, ((-0.20, 0.10, 0.25), 2.6)),
        (0.008, 1.5, 0.6, 0.0, ((-0.30, 0.04, 0.21), 4.4)),
        (0.000, 0.3, 0.1, 0.0, None),
    ]
    out = []
    for back, rise, push, flash, casing in spec:
        P = base_aim()
        gp, gr = P["gun_chest"]
        P["gun_chest"] = ((gp[0], gp[1] + back * 0.3, gp[2] - back), (gr[0] - rise, gr[1], gr[2]))
        sp = P["spine"]
        P["spine"] = (sp[0] - push, sp[1], sp[2])
        hd = P["head"]
        P["head"] = (hd[0] - push * 0.6, hd[1], hd[2])
        fx = {}
        if flash:
            fx["flash"] = flash
        if casing:
            fx["casing"] = casing
        out.append((P, fx))
    return out


# ----------------------------------------------------------------- death (12)
def _key(**kw):
    P = base_low_ready()
    P.update(kw)
    return P


def death():
    K = [
        (0.0, _key()),
        (1.0, _key(pel=(0.0, 0.93, -0.05), pel_rot=(-7, -4, 3), spine=(-16, -2, 6),
                   head=(-22, 8, 4),
                   gun_chest=((-0.12, 0.24, 0.10), (12, 30, -20)))),
        (2.3, _key(pel=(0.0, 0.80, -0.03), pel_rot=(4, 2, 6), spine=(6, 2, 8), head=(10, 4, 8),
                   footL=(0.13, A, 0.05), footR=(-0.15, A, -0.06),
                   handL=(0.26, 0.62, 0.20), handR=(-0.27, 0.60, 0.16), on_gun=0.0,
                   poleR=(-1.0, -0.8, -0.2), poleL=(1.0, -0.8, -0.2))),
        (4.2, _key(pel=(0.0, 0.56, 0.04), pel_rot=(14, 4, 4), spine=(22, 0, 6), head=(18, 0, 6),
                   footL=(0.15, 0.10, -0.30), footL_rot=(70, 0, 0),
                   footR=(-0.15, 0.10, -0.28), footR_rot=(70, 0, 0),
                   handL=(0.27, 0.40, 0.16), handR=(-0.27, 0.40, 0.18), on_gun=0.0,
                   poleR=(-1.0, -0.6, 0.3), poleL=(1.0, -0.6, 0.3))),
        (6.3, _key(pel=(0.0, 0.42, 0.12), pel_rot=(50, 6, 4), spine=(24, 0, 2), head=(-12, 10, 0),
                   footL=(0.16, 0.10, -0.40), footL_rot=(78, 0, 0),
                   footR=(-0.18, 0.10, -0.38), footR_rot=(78, 0, 0),
                   handL=(0.30, 0.20, 0.60), handR=(-0.30, 0.24, 0.48), on_gun=0.0,
                   poleR=(-1.0, -0.6, 0.5), poleL=(1.0, -0.6, 0.5))),
        (8.0, _key(pel=(0.0, 0.135, 0.02), pel_rot=(87, 8, 0), spine=(3, 0, -2), head=(-26, 62, 0),
                   footL=(0.15, 0.075, -0.84), footL_rot=(155, 10, 0),
                   footR=(-0.40, 0.08, -0.56), footR_rot=(140, -35, 0),
                   kpoleR=(-1.0, 0.0, 0.35),
                   handL=(0.40, 0.05, 0.66), handR=(-0.30, 0.05, -0.10), on_gun=0.0,
                   poleR=(-1.0, -0.2, 0.6), poleL=(1.0, -0.2, 0.6))),
        (9.0, _key(pel=(0.0, 0.16, 0.02), pel_rot=(84, 8, 0), spine=(7, 0, -2), head=(-18, 60, 0),
                   footL=(0.15, 0.08, -0.83), footL_rot=(152, 10, 0),
                   footR=(-0.40, 0.085, -0.55), footR_rot=(138, -35, 0),
                   kpoleR=(-1.0, 0.0, 0.35),
                   handL=(0.40, 0.06, 0.65), handR=(-0.30, 0.06, -0.09), on_gun=0.0,
                   poleR=(-1.0, -0.2, 0.6), poleL=(1.0, -0.2, 0.6))),
        (11.0, _key(pel=(0.0, 0.13, 0.02), pel_rot=(88, 8, 0), spine=(2, 0, -2), head=(-28, 64, 0),
                    footL=(0.16, 0.075, -0.84), footL_rot=(156, 14, 0),
                    footR=(-0.41, 0.075, -0.56), footR_rot=(142, -36, 0),
                    kpoleR=(-1.0, 0.0, 0.35),
                    handL=(0.41, 0.045, 0.66), handR=(-0.31, 0.045, -0.10), on_gun=0.0,
                    poleR=(-1.0, -0.2, 0.6), poleL=(1.0, -0.2, 0.6))),
    ]
    times = [k[0] for k in K]
    keys = [k[1] for k in K]
    # make every key carry all fields
    for k in keys:
        k.setdefault("handL", (0.25, 0.7, 0.2))
        k.setdefault("handR", (-0.25, 0.7, 0.2))

    def interp(t):
        i = max(j for j in range(len(times)) if times[j] <= t)
        if i == len(times) - 1:
            return copy.deepcopy(keys[-1])
        u = (t - times[i]) / (times[i + 1] - times[i])
        k0, k1 = keys[max(i - 1, 0)], keys[i]
        k2, k3 = keys[i + 1], keys[min(i + 2, len(keys) - 1)]
        out = {}
        for name in k1:
            v = [np.array(k[name], dtype=object if name == "gun_chest" else float)
                 for k in (k0, k1, k2, k3)]
            if name == "gun_chest":
                out[name] = tuple(
                    tuple(_cr(np.array(k0[name][j]), np.array(k1[name][j]), np.array(k2[name][j]),
                              np.array(k3[name][j]), u)) for j in range(2))
            else:
                r = _cr(*v, u)
                out[name] = float(r) if np.ndim(r) == 0 else tuple(r)
        return out

    # gun: held for frames 0-1, then drops (world space) with an arc and lands
    frames = []
    g_land = ((-0.46, 0.032, 0.10), (0, 28, 90))
    g_start = None
    for f in range(12):
        P = interp(float(f))
        fx = {}
        if f >= 2:
            if g_start is None:
                J = S.resolve(interp(2.0))
                go = J["gun_o"]
                g_start = (tuple(go), _euler_from(J["gun_R"]))
            u = min(1.0, (f - 2) / 3.0)
            ue = u * u
            pos = np.array(g_start[0]) * (1 - ue) + np.array(g_land[0]) * ue
            pos[1] += 0.10 * math.sin(math.pi * u) * (1 - u)
            if f == 6:
                pos[1] += 0.03
            rot = np.array(g_start[1]) * (1 - u) + np.array(g_land[1]) * u
            P["gun_world"] = (tuple(pos), tuple(rot))
        frames.append((P, fx))
    return frames


def _cr(p0, p1, p2, p3, u):
    p0, p1, p2, p3 = (np.asarray(x, float) for x in (p0, p1, p2, p3))
    u2, u3 = u * u, u * u * u
    return 0.5 * ((2 * p1) + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u2 +
                  (-p0 + 3 * p1 - 3 * p2 + p3) * u3)


def _euler_from(R):
    """inverse of eul(): R = Ry(y) Rx(p) Rz(r)"""
    p = math.asin(max(-1, min(1, -R[1, 2])))
    y = math.atan2(R[0, 2], R[2, 2])
    r = math.atan2(R[1, 0], R[1, 1])
    return (math.degrees(p), math.degrees(y), math.degrees(r))


ANIMS = [  # name, frames fn, fps, loop
    ("idle", idle, 8, True),
    ("walk", walk, 14, True),
    ("fire", fire, 16, True),
    ("death", death, 12, False),
]

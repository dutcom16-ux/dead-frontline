"""3/4-view soldier sprite renderer.

A rigged soldier is built from signed-distance primitives (round cones,
ellipsoids, rounded boxes) and ray-marched with numpy from a fixed
orthographic camera. Every frame comes from the same rig, so proportions,
gear and camo are identical across all frames and directions.
"""
import math

import numpy as np

# ----------------------------------------------------------------- config
FRAME = 160          # output frame size (px)
SS = 2               # supersampling factor
VIEW_W = 2.6         # world units across a frame
ANCHOR_Y = 0.73      # feet anchor, fraction of frame height from top
ELEV = math.radians(30)

N = FRAME * SS
PX = VIEW_W / N
CAM_F = np.array([0.0, -math.sin(ELEV), -math.cos(ELEV)])     # view direction
CAM_U = np.array([0.0, math.cos(ELEV), -math.sin(ELEV)])      # screen up
CAM_R = np.array([1.0, 0.0, 0.0])                             # screen right


def nrm(v):
    return v / np.linalg.norm(v)


KEY = nrm(np.array([-0.55, 0.8, 0.55]))    # key light (world), top-left-front
FILL = nrm(np.array([0.8, 0.25, -0.35]))   # cool fill from right-back
SHADOW_L = nrm(np.array([-0.05, 1.0, 0.24]))  # ground-shadow light (steep)
SHADOW_A = 0.40


# ----------------------------------------------------------------- math
def Rx(a):
    c, s = math.cos(a), math.sin(a)
    return np.array([[1, 0, 0], [0, c, -s], [0, s, c]])


def Ry(a):
    c, s = math.cos(a), math.sin(a)
    return np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]])


def Rz(a):
    c, s = math.cos(a), math.sin(a)
    return np.array([[c, -s, 0], [s, c, 0], [0, 0, 1]])


def eul(p, y=0.0, r=0.0):
    """degrees: pitch (+ leans +y toward +z), yaw (+ turns +z toward +x), roll"""
    return Ry(math.radians(y)) @ Rx(math.radians(p)) @ Rz(math.radians(r))


def frame_from(dir_y, ref):
    """orthonormal frame with local +y along dir_y, x close to ref"""
    y = nrm(dir_y)
    x = ref - y * np.dot(ref, y)
    if np.linalg.norm(x) < 1e-6:
        x = np.array([1.0, 0, 0]) - y * y[0]
    x = nrm(x)
    z = np.cross(x, y)
    return np.stack([x, y, z], axis=1)


def ik2(A, T, la, lb, pole):
    v = T - A
    d0 = np.linalg.norm(v)
    dv = v / max(d0, 1e-6)
    d = min(max(d0, abs(la - lb) + 1e-4), la + lb - 1e-4)
    ca = (la * la + d * d - lb * lb) / (2 * la * d)
    sa = math.sqrt(max(0.0, 1 - ca * ca))
    u = pole - dv * np.dot(pole, dv)
    u = nrm(u) if np.linalg.norm(u) > 1e-6 else np.array([0.0, 0, 1])
    E = A + la * (ca * dv + sa * u)
    W = E + lb * nrm(T - E)
    return E, W


# ----------------------------------------------------------------- materials
MAT = {
    "camo":   dict(col=(0.76, 0.67, 0.50), spec=0.04, camo=True),
    "olive":  dict(col=(0.42, 0.40, 0.25), spec=0.06),
    "olive2": dict(col=(0.33, 0.31, 0.20), spec=0.05),
    "coyote": dict(col=(0.56, 0.47, 0.33), spec=0.05),
    "skin":   dict(col=(0.80, 0.58, 0.44), spec=0.10),
    "glove":  dict(col=(0.30, 0.27, 0.22), spec=0.06),
    "boot":   dict(col=(0.52, 0.42, 0.30), spec=0.06),
    "sole":   dict(col=(0.20, 0.18, 0.16), spec=0.05),
    "gun":    dict(col=(0.15, 0.15, 0.16), spec=0.45),
    "gunlt":  dict(col=(0.30, 0.28, 0.24), spec=0.25),
    "lens":   dict(col=(0.05, 0.06, 0.08), spec=0.9),
    "brass":  dict(col=(0.90, 0.68, 0.26), spec=0.8),
}
MAT_IDS = {k: i for i, k in enumerate(MAT)}
CAMO_COLS = np.array([
    (0.74, 0.64, 0.47),   # base sand
    (0.87, 0.80, 0.64),   # light
    (0.55, 0.44, 0.30),   # brown
    (0.38, 0.30, 0.21),   # dark
])
_rng = np.random.default_rng(7)
_K1 = _rng.normal(size=(4, 3))
_K1 = _K1 / np.linalg.norm(_K1, axis=1, keepdims=True) * 13.0
_K2 = _rng.normal(size=(4, 3))
_K2 = _K2 / np.linalg.norm(_K2, axis=1, keepdims=True) * 21.0
_P1 = _rng.uniform(0, 6.28, 4)
_P2 = _rng.uniform(0, 6.28, 4)


def camo_color(q):
    n1 = np.sin(q @ _K1.T + _P1).sum(1) + 0.5 * np.sin(q @ (_K1.T * 2.1) + _P2).sum(1)
    n2 = np.sin(q @ _K2.T + _P2).sum(1) + 0.5 * np.sin(q @ (_K2.T * 1.7) + _P1).sum(1)
    idx = np.zeros(len(q), int)
    idx[n2 > 1.3] = 1
    idx[n1 > 1.2] = 2
    idx[n1 > 2.4] = 3
    return CAMO_COLS[idx]


# ----------------------------------------------------------------- primitives
class Prim:
    __slots__ = ("kind", "a", "b", "r1", "r2", "c", "R", "h", "rr", "mat", "k",
                 "tex_o", "tex_R", "tex_off", "bc", "br", "cut")

    def __init__(self, kind, mat, k=0.0, tex=None, **kw):
        self.kind, self.mat, self.k = kind, MAT_IDS[mat], k
        for n in ("a", "b", "c"):
            setattr(self, n, np.asarray(kw[n], float) if n in kw else None)
        self.r1, self.r2 = kw.get("r1", 0.0), kw.get("r2", 0.0)
        self.R = kw.get("R")
        self.h = np.asarray(kw["h"], float) if "h" in kw else None
        self.rr = kw.get("rr", 0.0)
        self.cut = kw.get("cut")
        if kind == "rcone":
            self.bc = (self.a + self.b) / 2
            self.br = np.linalg.norm(self.b - self.a) / 2 + max(self.r1, self.r2)
            o = self.a
            R = frame_from(self.b - self.a, np.array([1.0, 0, 0]))
        else:
            self.bc = self.c
            self.br = float(np.max(self.h)) * 1.75 if self.h is not None else self.r1
            o = self.c
            R = self.R if self.R is not None else np.eye(3)
        if tex is not None:
            o, R = tex
        self.tex_o, self.tex_R = o, R
        self.tex_off = _rng.uniform(-3, 3, 3)

    def dist(self, P):
        k = self.kind
        if k == "rcone":
            a, b, r1, r2 = self.a, self.b, self.r1, self.r2
            ba = b - a
            l2 = float(ba @ ba)
            rr = r1 - r2
            a2 = l2 - rr * rr
            il2 = 1.0 / l2
            pa = P - a
            y = pa @ ba
            z = y - l2
            w = pa * l2 - y[:, None] * ba
            x2 = np.einsum("ij,ij->i", w, w)
            y2 = y * y * l2
            z2 = z * z * l2
            kk = math.copysign(1, rr) * rr * rr * x2 if rr != 0 else np.zeros_like(x2)
            d3 = (np.sqrt(np.maximum(x2 * a2 * il2, 0)) + y * rr) * il2 - r1
            d1 = np.sqrt(x2 + z2) * il2 - r2
            d2 = np.sqrt(x2 + y2) * il2 - r1
            return np.where(np.sign(z) * a2 * z2 > kk, d1,
                            np.where(np.sign(y) * a2 * y2 < kk, d2, d3))
        q = (P - self.c) @ self.R if self.R is not None else P - self.c
        if k == "sph":
            d = np.sqrt(np.einsum("ij,ij->i", q, q)) - self.r1
            if self.cut is not None:        # helmet: cut by tilted plane
                nrm_, off = self.cut
                d = np.maximum(d, -(q @ nrm_ - off))
            return d
        if k == "ell":
            h = self.h
            k0 = np.linalg.norm(q / h, axis=1)
            k1 = np.linalg.norm(q / (h * h), axis=1)
            return k0 * (k0 - 1.0) / np.maximum(k1, 1e-9)
        if k == "box":
            qq = np.abs(q) - (self.h - self.rr)
            return np.linalg.norm(np.maximum(qq, 0), axis=1) + \
                np.minimum(qq.max(1), 0) - self.rr
        raise ValueError(k)


def smin(a, b, k):
    h = np.clip(0.5 + 0.5 * (b - a) / k, 0, 1)
    return b * (1 - h) + a * h - k * h * (1 - h)


class Scene:
    def __init__(self, prims):
        self.prims = prims
        # group by bounding sphere for per-ray culling
        self.groups = []
        for p in prims:
            self.groups.append(p)
        cs = np.array([p.bc for p in prims])
        rs = np.array([p.br for p in prims])
        self.lo = (cs - rs[:, None]).min(0) - 0.02
        self.hi = (cs + rs[:, None]).max(0) + 0.02
        self.cs, self.rs = cs, rs

    def sdf(self, P, ids=False):
        n = len(P)
        d = np.full(n, 1e3)
        mid = np.zeros(n, int) if ids else None
        best = np.full(n, 1e3) if ids else None
        # cheap bound test per primitive
        bd = np.sqrt(((P[:, None, :] - self.cs[None]) ** 2).sum(-1)) - self.rs[None]
        for i, p in enumerate(self.prims):
            margin = p.k + 0.005
            sel = bd[:, i] < d + margin if not ids else np.ones(n, bool)
            cnt = int(sel.sum())
            if cnt == 0:
                continue
            if cnt == n:
                di = p.dist(P)
                if ids:
                    upd = di < best
                    best = np.where(upd, di, best)
                    mid = np.where(upd, i, mid)
                d = smin(d, di, p.k) if p.k > 0 else np.minimum(d, di)
            else:
                ix = np.nonzero(sel)[0]
                di = p.dist(P[ix])
                d[ix] = smin(d[ix], di, p.k) if p.k > 0 else np.minimum(d[ix], di)
        return (d, mid) if ids else d


# ----------------------------------------------------------------- rig
L_THIGH, L_SHIN = 0.44, 0.43
L_UARM, L_FARM = 0.29, 0.27
HIP_OFF = 0.10
ANKLE_H = 0.085

# rifle, in gun space: butt at origin, barrel along +z, top +y, gun's right = -x
GS = 1.15  # rifle scale
GRIP_R = np.array([0.0, -0.07, 0.20]) * GS
GRIP_L = np.array([0.0, -0.045, 0.44]) * GS
MUZZLE = np.array([0.0, 0.005, 0.84]) * GS
EJECT = np.array([-0.03, 0.015, 0.31]) * GS


def resolve(P):
    """pose params -> joint positions & frames (character space)"""
    J = {}
    pel = np.asarray(P["pel"], float)
    Rp = eul(*P["pel_rot"])
    Rc = Rp @ eul(*P["spine"])
    Rh = Rc @ eul(*P["head"])
    J["pel"], J["Rp"], J["Rc"], J["Rh"] = pel, Rp, Rc, Rh
    J["chest_base"] = pel + Rp @ np.array([0, 0.12, 0])
    J["chest"] = J["chest_base"] + Rc @ np.array([0, 0.17, 0.0])
    J["neck"] = J["chest_base"] + Rc @ np.array([0, 0.36, 0.0])
    J["head"] = J["neck"] + Rh @ np.array([0, 0.14, 0.015])
    for s, sx in (("L", 1), ("R", -1)):
        J["sh" + s] = J["chest_base"] + Rc @ np.array([0.205 * sx, 0.28, -0.01])
        J["hip" + s] = pel + Rp @ np.array([HIP_OFF * sx, -0.06, 0])
    # gun
    if "gun_world" in P:
        gp, gr = P["gun_world"]
        J["gun_o"], J["gun_R"] = np.asarray(gp, float), eul(*gr)
    else:
        gp, gr = P["gun_chest"]
        J["gun_o"] = J["chest_base"] + Rc @ np.asarray(gp, float)
        J["gun_R"] = Rc @ eul(*gr)
    g = lambda v: J["gun_o"] + J["gun_R"] @ v
    w = P.get("on_gun", 1.0)
    tgtR = g(GRIP_R) * w + np.asarray(P.get("handR", g(GRIP_R))) * (1 - w)
    tgtL = g(GRIP_L) * w + np.asarray(P.get("handL", g(GRIP_L))) * (1 - w)
    poleR = Rc @ nrm(np.array(P.get("poleR", (-1.0, -1.2, -0.4))))
    poleL = Rc @ nrm(np.array(P.get("poleL", (0.8, -1.5, -0.2))))
    J["elR"], J["wrR"] = ik2(J["shR"], tgtR, L_UARM, L_FARM, poleR)
    J["elL"], J["wrL"] = ik2(J["shL"], tgtL, L_UARM, L_FARM, poleL)
    # legs
    for s, sx in (("L", 1), ("R", -1)):
        ft = np.asarray(P["foot" + s], float)
        Rf = eul(*P["foot%s_rot" % s])
        pole = Rp @ nrm(np.array(P.get("kpole" + s, (0.15 * sx, 0, 1.0)), float))
        J["kn" + s], J["an" + s] = ik2(J["hip" + s], ft, L_THIGH, L_SHIN, pole)
        J["Rf" + s] = Rf
    J["muzzle"] = g(MUZZLE)
    J["muzzle_dir"] = J["gun_R"] @ np.array([0, 0, 1.0])
    return J


def build(J, fx=None):
    fx = fx or {}
    pr = []
    Rp, Rc, Rh = J["Rp"], J["Rc"], J["Rh"]
    up_c = Rc[:, 1]
    K = 0.035   # smooth blend for body parts
    # legs
    for s, sx in (("L", 1), ("R", -1)):
        hip, kn, an, Rf = J["hip" + s], J["kn" + s], J["an" + s], J["Rf" + s]
        thigh_tex = (hip, frame_from(hip - kn, Rp[:, 0]))
        pr.append(Prim("rcone", "camo", K, tex=thigh_tex, a=hip, b=kn, r1=0.108, r2=0.080))
        pr.append(Prim("rcone", "camo", K, tex=thigh_tex, a=kn, b=an + (kn - an) * 0.12,
                       r1=0.078, r2=0.060))
        # knee pad
        kdir = nrm(np.cross(nrm(an - kn), Rp[:, 0] * sx)) * sx
        fwd = Rp[:, 2]
        kd = nrm(fwd - nrm(kn - hip) * np.dot(fwd, nrm(kn - hip)))
        pr.append(Prim("ell", "olive", 0.0, c=kn + kd * 0.058,
                       R=frame_from(kn - an, Rp[:, 0]), h=(0.062, 0.075, 0.036)))
        # cargo pocket on thigh side
        mid = hip * 0.45 + kn * 0.55
        pr.append(Prim("box", "camo", 0.0, tex=thigh_tex,
                       c=mid + Rp[:, 0] * sx * 0.095, R=frame_from(hip - kn, Rp[:, 2]),
                       h=(0.035, 0.075, 0.06), rr=0.025))
        # boot
        bc = an + Rf @ np.array([0, -0.03, 0.06])
        pr.append(Prim("box", "boot", 0.0, c=bc, R=Rf, h=(0.064, 0.064, 0.14), rr=0.045))
        pr.append(Prim("box", "sole", 0.0, c=an + Rf @ np.array([0, -0.082, 0.06]), R=Rf,
                       h=(0.068, 0.018, 0.145), rr=0.014))
    # pelvis / belt
    pr.append(Prim("ell", "camo", K, tex=(J["pel"], Rp), c=J["pel"], R=Rp,
                   h=(0.19, 0.13, 0.13)))
    pr.append(Prim("box", "olive2", 0.0, c=J["pel"] + Rp @ np.array([0, 0.06, 0]), R=Rp,
                   h=(0.192, 0.032, 0.135), rr=0.03))
    # torso
    pr.append(Prim("rcone", "camo", K, tex=(J["pel"], Rc), a=J["pel"] + Rp @ np.array([0, 0.05, 0]),
                   b=J["chest"], r1=0.15, r2=0.16))
    pr.append(Prim("ell", "camo", K, tex=(J["pel"], Rc), c=J["chest"] + Rc @ np.array([0, 0.03, 0]),
                   R=Rc, h=(0.215, 0.17, 0.13)))
    # plate carrier + pouches
    vc = J["chest"] + Rc @ np.array([0, 0.0, 0.01])
    pr.append(Prim("box", "olive", 0.0, c=vc, R=Rc, h=(0.19, 0.18, 0.15), rr=0.06))
    for i, x in enumerate((-0.085, 0.0, 0.085)):
        pr.append(Prim("box", "olive2", 0.0, c=J["chest"] + Rc @ np.array([x * 1.1, -0.07, 0.155]),
                       R=Rc, h=(0.04, 0.066, 0.034), rr=0.014))
    pr.append(Prim("box", "olive2", 0.0, c=J["chest"] + Rc @ np.array([0.10, 0.09, 0.15]),
                   R=Rc @ eul(0, 0, -12), h=(0.035, 0.04, 0.022), rr=0.01))
    # backpack
    pr.append(Prim("box", "olive", 0.0, c=J["chest"] + Rc @ np.array([0, 0.03, -0.235]),
                   R=Rc, h=(0.17, 0.21, 0.10), rr=0.06))
    pr.append(Prim("box", "olive2", 0.0, c=J["chest"] + Rc @ np.array([0, -0.07, -0.335]),
                   R=Rc, h=(0.12, 0.085, 0.035), rr=0.022))
    pr.append(Prim("rcone", "coyote", 0.0, a=J["chest"] + Rc @ np.array([-0.17, 0.25, -0.23]),
                   b=J["chest"] + Rc @ np.array([0.17, 0.25, -0.23]), r1=0.062, r2=0.062))
    # neck + head
    pr.append(Prim("rcone", "skin", K, a=J["neck"] - up_c * 0.03, b=J["head"] - Rh[:, 1] * 0.04,
                   r1=0.065, r2=0.06))
    pr.append(Prim("ell", "skin", K, c=J["head"], R=Rh, h=(0.096, 0.112, 0.105)))
    pr.append(Prim("sph", "skin", 0.0, c=J["head"] + Rh @ np.array([0, -0.015, 0.106]), r1=0.022))
    pr.append(Prim("box", "lens", 0.0, c=J["head"] + Rh @ np.array([0, 0.02, 0.088]), R=Rh,
                   h=(0.078, 0.021, 0.02), rr=0.013))
    hel_c = J["head"] + Rh @ np.array([0, 0.036, -0.016])
    cut_n = nrm(np.array([0, 1.0, 0.62]))
    pr.append(Prim("sph", "olive", 0.0, c=hel_c, R=Rh, r1=0.140, cut=(cut_n, -0.018)))
    pr.append(Prim("box", "olive2", 0.0, c=hel_c + Rh @ np.array([0, 0.03, -0.128]), R=Rh,
                   h=(0.035, 0.025, 0.02), rr=0.012))
    # arms
    for s, sx in (("L", 1), ("R", -1)):
        sh, el, wr = J["sh" + s], J["el" + s], J["wr" + s]
        tex = (sh, frame_from(sh - el, Rc[:, 2]))
        pr.append(Prim("rcone", "camo", K, tex=tex, a=sh, b=el, r1=0.086, r2=0.068))
        pr.append(Prim("rcone", "camo", K, tex=tex, a=el, b=wr, r1=0.066, r2=0.052))
        hd = nrm(wr - el)
        pr.append(Prim("ell", "glove", 0.0, c=wr + hd * 0.05, R=frame_from(hd, Rc[:, 0]),
                       h=(0.05, 0.066, 0.038)))
    # rifle
    go, gR = J["gun_o"], J["gun_R"]
    G = lambda v: go + gR @ (np.asarray(v, float) * GS)
    pr.append(Prim("box", "gun", 0.0, c=G((0, -0.01, 0.08)), R=gR, h=(0.0253, 0.0575, 0.1035), rr=0.018))
    pr.append(Prim("box", "gun", 0.0, c=G((0, 0.0, 0.29)), R=gR, h=(0.0299, 0.0437, 0.1495), rr=0.01))
    pr.append(Prim("box", "gunlt", 0.0, c=G((0, -0.005, 0.5)), R=gR, h=(0.0333, 0.0368, 0.1035), rr=0.012))
    pr.append(Prim("rcone", "gun", 0.0, a=G((0, 0.005, 0.58)), b=go + gR @ MUZZLE, r1=0.016, r2=0.016))
    pr.append(Prim("box", "gun", 0.0, c=G((0, -0.1, 0.33)), R=gR @ eul(12, 0, 0),
                   h=(0.0184, 0.0747, 0.0310), rr=0.008))
    pr.append(Prim("box", "gun", 0.0, c=G((0, -0.065, 0.2)), R=gR @ eul(-18, 0, 0),
                   h=(0.0184, 0.0517, 0.0230), rr=0.008))
    pr.append(Prim("box", "gun", 0.0, c=G((0, 0.06, 0.3)), R=gR, h=(0.0230, 0.0299, 0.0633), rr=0.012))
    pr.append(Prim("box", "lens", 0.0, c=G((0, 0.062, 0.358)), R=gR, h=(0.0184, 0.0207, 0.0046),
                   rr=0.003))
    # ejected casing
    if fx.get("casing") is not None:
        cp, ang = fx["casing"]
        c = G(cp)
        ax = gR @ np.array([math.cos(ang), math.sin(ang), 0.0])
        pr.append(Prim("rcone", "brass", 0.0, a=c - ax * 0.02, b=c + ax * 0.02, r1=0.011, r2=0.011))
    return Scene(pr)


# ----------------------------------------------------------------- render
_jj, _ii = np.mgrid[0:N, 0:N].astype(np.float64)
SCR_X = (_ii + 0.5 - N / 2) * PX
SCR_Y = (_jj + 0.5 - N * ANCHOR_Y) * PX


def project(p_world):
    return (np.dot(p_world, CAM_R) / PX + N / 2, -np.dot(p_world, CAM_U) / PX + N * ANCHOR_Y,
            np.dot(p_world, CAM_F))


def render(J, yaw_deg, fx=None):
    """returns float RGBA (N,N,4) premultiplied + depth"""
    fx = fx or {}
    scene = build(J, fx)
    Ryaw = Ry(math.radians(yaw_deg))            # local -> world
    # rays (world) -> local
    org_w = SCR_X[..., None] * CAM_R - SCR_Y[..., None] * CAM_U - CAM_F * 6.0
    org = org_w.reshape(-1, 3) @ Ryaw           # world -> local (row vectors)
    dirl = CAM_F @ Ryaw
    keyl, filll = KEY @ Ryaw, FILL @ Ryaw
    # slab test against scene AABB
    inv = 1.0 / np.where(np.abs(dirl) < 1e-9, 1e-9, dirl)
    t0 = (scene.lo - org) * inv
    t1 = (scene.hi - org) * inv
    tn = np.minimum(t0, t1).max(1)
    tf = np.maximum(t0, t1).min(1)
    cand = np.nonzero((tf > tn) & (tf > 0))[0]
    t = np.maximum(tn[cand], 0)
    tf = tf[cand]
    hit = np.zeros(len(cand), bool)
    alive = np.arange(len(cand))
    for _ in range(90):
        if len(alive) == 0:
            break
        P = org[cand[alive]] + t[alive, None] * dirl
        d = scene.sdf(P)
        h = d < 0.0012
        hit[alive[h]] = True
        t[alive] += d * 0.92
        alive = alive[(~h) & (t[alive] < tf[alive])]
    hidx = np.nonzero(hit)[0]
    rgba = np.zeros((N * N, 4))
    depth = np.full(N * N, np.inf)
    # --- soft cast shadow on the ground plane (y = 0)
    sl = SHADOW_L @ Ryaw
    corners = np.array([[x, y, z] for x in (scene.lo[0], scene.hi[0])
                        for y in (0.0, scene.hi[1]) for z in (scene.lo[2], scene.hi[2])])
    proj = corners - sl[None] * (corners[:, 1:2] / sl[1])
    glo, ghi = proj.min(0) - 0.08, proj.max(0) + 0.08
    tg = -org[:, 1] / dirl[1]
    Gp = org + tg[:, None] * dirl
    gsel = (Gp[:, 0] > glo[0]) & (Gp[:, 0] < ghi[0]) & (Gp[:, 2] > glo[2]) & (Gp[:, 2] < ghi[2])
    hitmask = np.zeros(N * N, bool)
    hitmask[cand[hidx]] = True
    gidx = np.nonzero(gsel & ~hitmask)[0]
    if len(gidx):
        G0 = Gp[gidx] + np.array([0, 0.004, 0])
        res = np.ones(len(gidx))
        ts = np.full(len(gidx), 0.01)
        act = np.arange(len(gidx))
        for _ in range(26):
            if len(act) == 0:
                break
            d = scene.sdf(G0[act] + ts[act, None] * sl)
            res[act] = np.minimum(res[act], np.clip(6 * d / ts[act], 0, 1))
            ts[act] += np.clip(d, 0.01, 0.15)
            act = act[(res[act] > 0.02) & (ts[act] < 2.2)]
        a = (1 - res)
        a = a * a * (3 - 2 * a) * SHADOW_A
        rgba[gidx, 3] = a
    if len(hidx) == 0:
        return rgba.reshape(N, N, 4), depth.reshape(N, N)
    pix = cand[hidx]
    P = org[pix] + t[hidx, None] * dirl
    depth[pix] = t[hidx] - 6.0
    # normals (tetrahedron)
    e = 0.0015
    ks = np.array([[1, -1, -1], [-1, -1, 1], [-1, 1, -1], [1, 1, 1]], float)
    n = np.zeros_like(P)
    for k in ks:
        n += k * scene.sdf(P + k * e)[:, None]
    n /= np.linalg.norm(n, axis=1, keepdims=True) + 1e-9
    _, mid = scene.sdf(P, ids=True)
    mats = np.array([scene.prims[i].mat for i in mid])
    # albedo
    names = list(MAT)
    alb = np.array([MAT[names[m]]["col"] for m in range(len(names))])[mats]
    spec_k = np.array([MAT[names[m]]["spec"] for m in range(len(names))])[mats]
    camo_mask = mats == MAT_IDS["camo"]
    if camo_mask.any():
        ci = np.nonzero(camo_mask)[0]
        q = np.zeros((len(ci), 3))
        for pi in np.unique(mid[ci]):
            sel = ci[mid[ci] == pi]
            pr = scene.prims[pi]
            q[np.searchsorted(ci, sel)] = (P[sel] - pr.tex_o) @ pr.tex_R + pr.tex_off
        alb[ci] = camo_color(q)
    # ambient occlusion
    occ = np.zeros(len(P))
    w = 1.0
    for hh in (0.015, 0.04, 0.075, 0.12):
        occ += (hh - scene.sdf(P + n * hh)) * w
        w *= 0.65
    ao = np.clip(1 - 3.0 * occ, 0.25, 1)
    # soft shadow toward key light
    sh = np.ones(len(P))
    ts = np.full(len(P), 0.02)
    act = np.arange(len(P))
    Ps = P + n * 0.004
    for _ in range(22):
        if len(act) == 0:
            break
        d = scene.sdf(Ps[act] + ts[act, None] * keyl)
        sh[act] = np.minimum(sh[act], np.clip(10 * d / ts[act], 0, 1))
        ts[act] += np.clip(d, 0.012, 0.12)
        keep = (sh[act] > 0.02) & (ts[act] < 1.2)
        act = act[keep]
    sh = np.clip(sh, 0, 1)
    sh = sh * sh * (3 - 2 * sh)
    V = -dirl
    ndl = np.clip(n @ keyl, 0, 1)
    ndf = np.clip(n @ filll, 0, 1)
    up = n[:, 1]
    amb = (0.22 + 0.13 * up) * ao
    hvec = nrm(keyl + V)
    spec = spec_k * np.clip(n @ hvec, 0, 1) ** 24 * sh
    rim = np.clip(1 - np.clip(n @ V, 0, 1), 0, 1) ** 3 * 0.22
    lit = amb[:, None] + (ndl * sh * 1.12)[:, None] * np.array([1.0, 0.96, 0.88]) + \
        (ndf * 0.28 * ao)[:, None] * np.array([0.75, 0.82, 1.0])
    col = alb * lit + spec[:, None] + (rim * ao)[:, None] * alb
    col = np.clip(col, 0, 1)
    rgba[pix, :3] = col
    rgba[pix, 3] = 1
    return rgba.reshape(N, N, 4), depth.reshape(N, N)


def draw_flash(rgba, depth, J, yaw_deg, size):
    """additive muzzle flash in screen space, depth-tested against the body"""
    Ryaw = Ry(math.radians(yaw_deg))
    m = Ryaw @ J["muzzle"]
    dv = Ryaw @ J["muzzle_dir"]
    mx, my, mz = project(m + dv * 0.02)
    sdx, sdy = np.dot(dv, CAM_R), -np.dot(dv, CAM_U)
    plen = math.hypot(sdx, sdy)
    ux, uy = (sdx / plen, sdy / plen) if plen > 1e-4 else (1.0, 0.0)
    X, Y = _ii + 0.5 - mx, _jj + 0.5 - my
    a = X * ux + Y * uy          # along barrel (screen)
    b = -X * uy + Y * ux         # across
    s = size / PX * 0.01         # internal px per cm
    L = (0.13 * plen + 0.05) * s * 100   # forward flame length (px)
    W = 0.045 * s * 100
    core = np.exp(-(X * X + Y * Y) / (2 * (W * 0.7) ** 2))
    fwd = np.where(a > -W * 0.5,
                   np.exp(-(b * b) / (2 * (W * 0.55 * (1 - np.clip(a / (L + 1e-6), 0, 1)) + 0.6) ** 2))
                   * np.exp(-np.maximum(a, 0) / (L * 0.55 + 1e-6)), 0)
    ang = np.arctan2(b, a)
    rr = np.hypot(a, b)
    star = np.exp(-rr / (W * 1.4)) * (0.5 + 0.5 * np.cos(ang * 5) ** 8)
    glow = np.exp(-rr / (W * 2.0)) * 0.22
    inten = np.clip(core * 1.2 + fwd + star * 0.7 + glow, 0, 2.0)
    vis = ~(depth < mz - 0.03)
    inten = inten * vis
    colr = np.stack([np.clip(inten * 1.0, 0, 1), np.clip(inten * 0.78, 0, 1),
                     np.clip(inten * 0.35 + core * 0.4, 0, 1)], -1)
    al = np.clip(inten, 0, 1)
    rgba[..., :3] = rgba[..., :3] * (1 - al[..., None] * 0.3) + colr
    rgba[..., 3] = np.maximum(rgba[..., 3], al)
    rgba[..., :3] = np.minimum(rgba[..., :3], rgba[..., 3:4])
    return rgba


def downsample(rgba):
    r = rgba.reshape(FRAME, SS, FRAME, SS, 4).mean((1, 3))
    out = np.zeros_like(r)
    a = r[..., 3:4]
    out[..., :3] = np.where(a > 1e-4, r[..., :3] / np.maximum(a, 1e-4), 0)
    out[..., 3:4] = a
    return out

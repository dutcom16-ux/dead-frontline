"""Small signed-distance renderer for building sprites.

Orthographic camera at the game's pitch (IsoCamera.pitch = 0.87 rad, ~50 deg), light fixed on screen
(top-left), so every rotation view is lit the same way. Primitives are boxes (with optional cutting
planes), capped cylinders, round cones and ellipsoids, in building space: x = width, y = up,
z = depth (+z = the front). Subtraction primitives cut openings. Primitives are grouped (by name) and
culled by bounding spheres, rays are marched in chunks.
"""
import math

import numpy as np

PITCH = 0.87                     # the game camera's pitch (rad)
CAM_F = np.array([0.0, -math.sin(PITCH), -math.cos(PITCH)])
CAM_U = np.array([0.0, math.cos(PITCH), -math.sin(PITCH)])
CAM_R = np.array([1.0, 0.0, 0.0])


def nrm(v):
    v = np.asarray(v, float)
    return v / np.linalg.norm(v)


KEY = nrm([-0.62, 0.78, 0.42])     # key light, from screen top-left
FILL = nrm([0.75, 0.3, -0.4])
SHADOW_L = nrm([-0.30, 1.0, 0.24])  # ground shadow light (a little steeper: compact shadow)


def Rx(a):
    c, s = math.cos(a), math.sin(a)
    return np.array([[1, 0, 0], [0, c, -s], [0, s, c]])


def Ry(a):
    c, s = math.cos(a), math.sin(a)
    return np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]])


def Rz(a):
    c, s = math.cos(a), math.sin(a)
    return np.array([[c, -s, 0], [s, c, 0], [0, 0, 1]])


def eul(p=0.0, y=0.0, r=0.0):
    """degrees; R = Ry(y) Rx(p) Rz(r)"""
    return Ry(math.radians(y)) @ Rx(math.radians(p)) @ Rz(math.radians(r))


class Prim:
    def __init__(self, kind, mat, group, c=(0, 0, 0), R=None, h=None, rr=0.0, r=0.0, hh=0.0,
                 a=None, b=None, r1=0.0, r2=0.0, cuts=None, col=None, sub=False, axis=None):
        self.kind, self.mat, self.group, self.sub = kind, mat, group, sub
        self.c = np.asarray(c, float)
        self.R = np.eye(3) if R is None else np.asarray(R, float)
        self.h = None if h is None else np.asarray(h, float)
        self.rr, self.r, self.hh = rr, r, hh
        self.a = None if a is None else np.asarray(a, float)
        self.b = None if b is None else np.asarray(b, float)
        self.r1, self.r2 = r1, r2
        self.cuts = cuts or []          # [(n_local, o_local)]: keep q.n <= o
        self.col = col
        self.axis = axis                # corrugation axis (local) for roof sheets
        if kind == "rcone":
            self.c = (self.a + self.b) / 2
            self.bc = self.c
            self.br = np.linalg.norm(self.b - self.a) / 2 + max(r1, r2)
            ab = self.b - self.a
            y = ab / np.linalg.norm(ab)
            x = np.cross(y, [0, 0, 1.0]) if abs(y[2]) < 0.9 else np.cross(y, [1.0, 0, 0])
            x /= np.linalg.norm(x)
            self.R = np.stack([x, y, np.cross(x, y)], axis=1)
        elif kind == "box":
            self.bc, self.br = self.c, float(np.linalg.norm(self.h))
        elif kind == "cyl":
            self.bc, self.br = self.c, math.hypot(r, hh)
        elif kind == "ell":
            self.bc, self.br = self.c, float(np.max(self.h))
        else:
            raise ValueError(kind)

    def local(self, P):
        return (P - self.c) @ self.R

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
            return np.where(np.sign(z) * a2 * z2 > kk, d1, np.where(np.sign(y) * a2 * y2 < kk, d2, d3))
        q = self.local(P)
        if k == "box":
            qq = np.abs(q) - (self.h - self.rr)
            d = np.linalg.norm(np.maximum(qq, 0), axis=1) + np.minimum(qq.max(1), 0) - self.rr
            for n, o in self.cuts:
                d = np.maximum(d, q @ n - o)
            return d
        if k == "cyl":
            dr = np.hypot(q[:, 0], q[:, 2]) - self.r
            dy = np.abs(q[:, 1]) - self.hh
            d = np.minimum(np.maximum(dr, dy), 0) + np.hypot(np.maximum(dr, 0), np.maximum(dy, 0))
            for n, o in self.cuts:
                d = np.maximum(d, q @ n - o)
            return d
        if k == "ell":
            h = self.h
            k0 = np.linalg.norm(q / h, axis=1)
            k1 = np.linalg.norm(q / (h * h), axis=1)
            d = k0 * (k0 - 1.0) / np.maximum(k1, 1e-9)
            for n, o in self.cuts:
                d = np.maximum(d, q @ n - o)
            return d
        raise ValueError(k)


class Scene:
    def __init__(self, prims):
        self.prims = prims
        order, groups = [], {}
        for i, p in enumerate(prims):
            if p.group not in groups:
                groups[p.group] = []
                order.append(p.group)
            groups[p.group].append(i)
        self.groups = []
        for g in order:
            ids = np.array(groups[g])
            cs = np.array([prims[i].bc for i in ids])
            rs = np.array([prims[i].br for i in ids])
            lo, hi = (cs - rs[:, None]).min(0), (cs + rs[:, None]).max(0)
            gc = (lo + hi) / 2
            gr = float(np.max(np.linalg.norm(cs - gc, axis=1) + rs))
            self.groups.append((ids, cs, rs, gc, gr))
        allc = np.array([p.bc for p in prims])
        allr = np.array([p.br for p in prims])
        solid = np.array([not p.sub for p in prims])
        self.lo = (allc[solid] - allr[solid][:, None]).min(0) - 0.05
        self.hi = (allc[solid] + allr[solid][:, None]).max(0) + 0.05

    def sdf(self, P, ids=False):
        n = len(P)
        d = np.full(n, 1e3)
        who = np.full(n, -1) if ids else None
        for gids, cs, rs, gc, gr in self.groups:
            gd = np.linalg.norm(P - gc, axis=1) - gr
            sel = np.nonzero(gd < np.abs(d) + 0.02)[0]
            if len(sel) == 0:
                continue
            Ps = P[sel]
            ds = d[sel]
            ws = who[sel] if ids else None
            for j, i in enumerate(gids):
                p = self.prims[i]
                pb = np.linalg.norm(Ps - cs[j], axis=1) - rs[j]
                m = np.nonzero(pb < np.abs(ds) + 0.02)[0]
                if len(m) == 0:
                    continue
                di = p.dist(Ps[m])
                if p.sub:
                    nd = np.maximum(ds[m], -di)
                else:
                    nd = np.minimum(ds[m], di)
                if ids:
                    ws[m] = np.where(nd != ds[m], i, ws[m])
                ds[m] = nd
            d[sel] = ds
            if ids:
                who[sel] = ws
        return (d, who) if ids else d


# ---------------------------------------------------------------- procedural noise
_rng = np.random.default_rng(11)
_DIRS = [_rng.normal(size=(5, 3)) for _ in range(6)]
_DIRS = [k / np.linalg.norm(k, axis=1, keepdims=True) for k in _DIRS]
_PH = [_rng.uniform(0, 6.283, 5) for _ in range(6)]


def noise(P, freq, octave=0):
    """smooth pseudo-noise in about [-1, 1]"""
    K = _DIRS[octave % 6] * freq
    return np.sin(P @ K.T + _PH[octave % 6]).sum(1) / 2.2


def hash01(P, scale):
    c = np.floor(P * scale)
    v = np.sin(c @ np.array([12.9898, 78.233, 37.719])) * 43758.5453
    return v - np.floor(v)

"""Ray-march a bsdf.Scene into an RGBA sprite frame (premultiplied), with AO, soft shadows and a
soft ground shadow. `shade(scene, P, ids, nrm)` gives albedo, specular and a perturbed normal."""
import math

import numpy as np

from bsdf import CAM_F, CAM_R, CAM_U, FILL, KEY, SHADOW_L, Ry


def render(scene, shade, yaw_deg, frame, view_w, anchor, ss=2, shadow_a=0.42, chunk=40000):
    N = frame * ss
    px = view_w / N
    jj, ii = np.mgrid[0:N, 0:N].astype(np.float64)
    sx = (ii + 0.5 - N * anchor[0]) * px
    sy = (jj + 0.5 - N * anchor[1]) * px
    Rw = Ry(math.radians(yaw_deg))                     # building -> world
    org = (sx[..., None] * CAM_R - sy[..., None] * CAM_U - CAM_F * 60.0).reshape(-1, 3) @ Rw
    dirl = CAM_F @ Rw
    keyl, filll, shl = KEY @ Rw, FILL @ Rw, SHADOW_L @ Rw
    inv = 1.0 / np.where(np.abs(dirl) < 1e-9, 1e-9, dirl)
    t0 = (scene.lo - org) * inv
    t1 = (scene.hi - org) * inv
    tn, tf = np.minimum(t0, t1).max(1), np.maximum(t0, t1).min(1)
    cand = np.nonzero((tf > tn) & (tf > 0))[0]
    rgba = np.zeros((N * N, 4))
    for c0 in range(0, len(cand), chunk):
        cc = cand[c0:c0 + chunk]
        t = np.maximum(tn[cc], 0)
        tfc = tf[cc]
        hit = np.zeros(len(cc), bool)
        alive = np.arange(len(cc))
        for _ in range(110):
            if len(alive) == 0:
                break
            d = scene.sdf(org[cc[alive]] + t[alive, None] * dirl)
            h = d < 0.004
            hit[alive[h]] = True
            t[alive] += np.maximum(d, 0.002) * 0.95
            alive = alive[(~h) & (t[alive] < tfc[alive])]
        hi = np.nonzero(hit)[0]
        if len(hi) == 0:
            continue
        pix = cc[hi]
        P = org[pix] + t[hi, None] * dirl
        # normal
        e = 0.004
        n = np.zeros_like(P)
        for k in np.array([[1, -1, -1], [-1, -1, 1], [-1, 1, -1], [1, 1, 1]], float):
            n += k * scene.sdf(P + k * e)[:, None]
        n /= np.linalg.norm(n, axis=1, keepdims=True) + 1e-9
        _, ids = scene.sdf(P, ids=True)
        alb, spec, n2 = shade(scene, P, ids, n)
        # ambient occlusion
        occ = np.zeros(len(P))
        w = 1.0
        for hh in (0.04, 0.12, 0.26, 0.45):
            occ += np.maximum(hh - scene.sdf(P + n * hh), 0) * w
            w *= 0.6
        ao = np.clip(1 - 1.6 * occ, 0.3, 1)
        # soft shadow toward the key light
        sh = np.ones(len(P))
        ts = np.full(len(P), 0.03)
        act = np.arange(len(P))
        Ps = P + n * 0.01
        for _ in range(40):
            if len(act) == 0:
                break
            d = scene.sdf(Ps[act] + ts[act, None] * keyl)
            sh[act] = np.minimum(sh[act], np.clip(12 * d / ts[act], 0, 1))
            ts[act] += np.clip(d, 0.03, 0.8)
            act = act[(sh[act] > 0.02) & (ts[act] < 14)]
        sh = sh * sh * (3 - 2 * sh)
        V = -dirl
        ndl = np.clip(n2 @ keyl, 0, 1)
        ndf = np.clip(n2 @ filll, 0, 1)
        amb = (0.30 + 0.16 * n2[:, 1]) * ao
        hv = keyl + V
        hv /= np.linalg.norm(hv)
        sp = spec * np.clip(n2 @ hv, 0, 1) ** 30 * sh
        lit = amb[:, None] + (ndl * sh * 1.0)[:, None] * np.array([1.0, 0.96, 0.88]) + \
            (ndf * 0.22 * ao)[:, None] * np.array([0.75, 0.82, 1.0])
        col = np.clip(alb * lit + sp[:, None], 0, 1)
        rgba[pix, :3] = col
        rgba[pix, 3] = 1
    img = rgba.reshape(N, N, 4)
    # downsample (premultiplied)
    img = img.reshape(frame, ss, frame, ss, 4).mean((1, 3))
    # soft ground shadow (y = 0), at frame resolution (it is soft: no need to supersample), under the
    # building's own pixels only where they are not fully covered
    if shadow_a > 0:
        fx = (np.arange(frame) + 0.5 - frame * anchor[0]) * (view_w / frame)
        fy = (np.arange(frame) + 0.5 - frame * anchor[1]) * (view_w / frame)
        gy, gx = np.meshgrid(fy, fx, indexing="ij")
        org2 = (gx[..., None] * CAM_R - gy[..., None] * CAM_U - CAM_F * 60.0).reshape(-1, 3) @ Rw
        corners = np.array([[x, y, z] for x in (scene.lo[0], scene.hi[0]) for y in (0.0, scene.hi[1])
                            for z in (scene.lo[2], scene.hi[2])])
        proj = corners - shl[None] * (corners[:, 1:2] / shl[1])
        glo, ghi = proj.min(0) - 0.5, proj.max(0) + 0.5
        tg = -org2[:, 1] / dirl[1]
        G = org2 + tg[:, None] * dirl
        cov = img[..., 3].reshape(-1)
        gsel = (G[:, 0] > glo[0]) & (G[:, 0] < ghi[0]) & (G[:, 2] > glo[2]) & (G[:, 2] < ghi[2]) & (cov < 0.999)
        gidx = np.nonzero(gsel)[0]
        sha = np.zeros(frame * frame)
        for c0 in range(0, len(gidx), chunk):
            gi = gidx[c0:c0 + chunk]
            G0 = G[gi] + np.array([0, 0.01, 0])
            res = np.ones(len(gi))
            ts = np.full(len(gi), 0.02)
            act = np.arange(len(gi))
            for _ in range(36):
                if len(act) == 0:
                    break
                d = scene.sdf(G0[act] + ts[act, None] * shl)
                res[act] = np.minimum(res[act], np.clip(7 * d / ts[act], 0, 1))
                ts[act] += np.clip(d, 0.03, 0.9)
                act = act[(res[act] > 0.02) & (ts[act] < 16)]
            a = 1 - res
            sha[gi] = a * a * (3 - 2 * a) * shadow_a
        sha = sha.reshape(frame, frame, 1)
        a0 = img[..., 3:4]
        img = np.concatenate([img[..., :3], a0 + (1 - a0) * sha], -1)     # shadow is black: colour unchanged
    out = np.zeros_like(img)
    a = img[..., 3:4]
    out[..., :3] = np.where(a > 1e-4, img[..., :3] / np.maximum(a, 1e-4), 0)
    out[..., 3:4] = a
    return out

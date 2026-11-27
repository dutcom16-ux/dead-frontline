"""Ground tiles (road, intersection, walkway) and animated water (sea, shoreline) as 10 x 10 m
height fields with procedural, seamlessly repeating surfaces.

Every pattern is periodic over the 10 m tile, so tiles join without seams in any arrangement.
Two outputs per tile:
  * sprites at the game camera (orthographic, 0.87 rad down, light from the screen's top-left), in 8
    rotation views, the same scale as the building sprites (17.3 px/m), with a small bleed so placed
    tiles overlap instead of leaving hairline gaps;
  * a straight-down albedo texture and height map (512 px per tile) for the 3D ground.
"""
import math

import numpy as np

PITCH = 0.87
PPM = 320 / 18.5
TILE = 10.0
TAU = 2 * math.pi
KEY = np.array([-0.62, 0.78, 0.42]); KEY /= np.linalg.norm(KEY)

_rng = np.random.default_rng(5)
# integer wave numbers over the tile -> periodic noise
_WAVES = [(_rng.integers(-9, 10, size=(6, 2)), _rng.uniform(0, TAU, 6)) for _ in range(8)]


def pnoise(x, z, scale=1, octave=0):
    """periodic noise in about [-1, 1]; `scale` multiplies the integer wave numbers"""
    K, ph = _WAVES[octave % 8]
    s = 0.0
    for (m, n), p in zip(K, ph):
        if m == 0 and n == 0:
            m = 1
        s = s + np.sin(TAU * (m * scale * x + n * scale * z) / TILE + p)
    return s / 3.0


def phash(x, z, cell, salt=0.0):
    """periodic hash per cell (cell must divide the tile)"""
    n = int(round(TILE / cell))
    i = np.floor((x + 5) / cell) % n
    j = np.floor((z + 5) / cell) % n
    v = np.sin(i * 12.9898 + j * 78.233 + salt * 37.71) * 43758.5453
    return v - np.floor(v)


# ---------------------------------------------------------------------------- materials
ASPHALT = np.array([0.21, 0.21, 0.22])
PAINT = np.array([0.88, 0.88, 0.84])
CURB = np.array([0.72, 0.71, 0.67])
PAVER = np.array([0.66, 0.64, 0.60])
GRASS = np.array([0.31, 0.47, 0.20])
BRICK = np.array([0.62, 0.36, 0.25])
MORTAR = np.array([0.47, 0.44, 0.40])
IRON = np.array([0.24, 0.23, 0.22])


def asphalt(x, z):
    c = ASPHALT * (0.92 + 0.06 * pnoise(x, z, 1, 0) + 0.03 * pnoise(x, z, 4, 1))[..., None]
    sp = phash(x, z, 0.05, 1)
    c = np.where((sp > 0.86)[..., None], c * 1.45, c)
    c = np.where((sp < 0.08)[..., None], c * 0.6, c)
    crack = np.abs(pnoise(x, z, 2, 3)) < 0.025
    c = np.where(crack[..., None], c * 0.65, c)
    patch = (pnoise(x, z, 1, 4) > 1.05)
    c = np.where(patch[..., None], c * 0.82, c)
    return c


def paint(c, mask, x, z):
    worn = pnoise(x, z, 6, 5) > 0.75
    m = mask & ~worn
    return np.where(m[..., None], PAINT * (0.94 + 0.05 * pnoise(x, z, 8, 6))[..., None], c)


def pavers(x, z, cell=0.5):
    joint = (((x + 5) % cell) < 0.014) | (((z + 5) % cell) < 0.014)
    v = 0.92 + 0.12 * phash(x, z, cell, 2)
    c = PAVER * v[..., None] * (0.95 + 0.04 * pnoise(x, z, 3, 2))[..., None]
    stain = pnoise(x, z, 1, 6) > 0.9
    c = np.where(stain[..., None], c * 0.85, c)
    return np.where(joint[..., None], c * 0.62, c)


def curb_paint(x, z):
    """Philippine curbs: alternating black and white segments"""
    seg = (np.floor((x + z + 10) / 0.5) % 2) == 0
    return np.where(seg[..., None], np.array([0.86, 0.86, 0.83]), np.array([0.12, 0.12, 0.12]))


def grass(x, z):
    c = GRASS * (0.85 + 0.15 * pnoise(x, z, 2, 2) + 0.08 * pnoise(x, z, 9, 3))[..., None]
    b = phash(x, z, 0.04, 3)
    c = np.where((b > 0.8)[..., None], c * 1.25, c)
    c = np.where((b < 0.12)[..., None], c * 0.7, c)
    fl = phash(x, z, 0.1, 9)
    c = np.where((fl > 0.993)[..., None], np.array([0.95, 0.85, 0.25]), c)
    c = np.where(((fl > 0.986) & (fl <= 0.993))[..., None], np.array([0.92, 0.92, 0.9]), c)
    return c


def manhole(c, h, x, z, cx, cz, r=0.33):
    d = np.hypot(x - cx, z - cz)
    m = d < r
    ring = (np.abs(d - r * 0.8) < 0.025) | ((((x - cx) * 0.7 + (z - cz)) % 0.12) < 0.03)
    col = np.where(ring[..., None], IRON * 0.7, IRON)
    return np.where(m[..., None], col, c), h


def grate(c, x, z, x0, x1, z0, z1):
    m = (x >= x0) & (x <= x1) & (z >= z0) & (z <= z1)
    bars = ((z - z0) % 0.06) < 0.025
    col = np.where(bars[..., None], IRON * 0.9, np.array([0.05, 0.05, 0.05]))
    return np.where(m[..., None], col, c)


# ---------------------------------------------------------------------------- tile layouts
def road(x, z):
    """straight road along z: 7 m carriageway, curbs, 1.35 m sidewalks"""
    ax = np.abs(x)
    c = asphalt(x, z)
    h = np.zeros_like(x)
    lane = np.abs(np.abs(x) - 1.75) < 0.55
    c = np.where(lane[..., None], c * 0.94, c)                                    # tyre-polished lanes
    c = paint(c, (np.abs(x) < 0.06) & (((z + 5) % 5.0) < 2.5), x, z)              # centre dashes
    c = paint(c, np.abs(ax - 3.25) < 0.05, x, z)                                  # edge lines
    for sx in (-1, 1):
        c = grate(c, x, z, *(sorted((sx * 3.02, sx * 3.47))), -0.35, 0.35)
    c, h = manhole(c, h, x, z, 1.75, -2.5)
    curb = (ax > 3.5) & (ax <= 3.65)
    side = ax > 3.65
    c = np.where(curb[..., None], CURB * (0.95 + 0.04 * pnoise(x, z, 5, 1))[..., None], c)
    c = np.where(side[..., None], pavers(x, z), c)
    h = np.where(ax > 3.5, 0.15, h)
    return c, h


def intersection(x, z):
    ax, az = np.abs(x), np.abs(z)
    R = 1.2
    c = asphalt(x, z)
    h = np.zeros_like(x)
    # sidewalk corners with rounded curbs
    dc = np.hypot(np.maximum(3.5 + R - ax, 0), np.maximum(3.5 + R - az, 0))
    inner = (ax < 3.5 + R) & (az < 3.5 + R)
    walk = (ax > 3.5) & (az > 3.5) & ~(inner & (dc < R))
    edge_d = np.where(inner, dc - R, np.minimum(ax - 3.5, az - 3.5))           # distance into the corner
    curb = walk & (edge_d < 0.15)
    # crosswalks on the four arms
    zebra_n = (az > 3.7) & (az < 4.85) & (ax < 3.3) & (((x + 5) % 0.8) < 0.45)
    zebra_e = (ax > 3.7) & (ax < 4.85) & (az < 3.3) & (((z + 5) % 0.8) < 0.45)
    c = paint(c, zebra_n | zebra_e, x, z)
    stop_n = (np.abs(az - 3.62) < 0.06) & (ax < 3.3)
    stop_e = (np.abs(ax - 3.62) < 0.06) & (az < 3.3)
    c = paint(c, stop_n | stop_e, x, z)
    c, h = manhole(c, h, x, z, -1.2, 1.0, 0.36)
    skid = (np.abs((x - 0.5) * 0.3 + (z + 1.0)) < 0.08) & (np.abs(x) < 2.2) & (pnoise(x, z, 3, 7) > -0.2)
    c = np.where(skid[..., None], c * 0.75, c)
    c = np.where(curb[..., None], curb_paint(x, z) * (0.94 + 0.05 * pnoise(x, z, 5, 1))[..., None], c)
    c = np.where((walk & ~curb)[..., None], pavers(x, z), c)
    h = np.where(walk, 0.15, h)
    return c, h


def walkway(x, z):
    """paved pedestrian walkway along z through grass: 3 m of clay pavers with concrete edging"""
    ax = np.abs(x)
    c = grass(x, z)
    h = 0.03 + 0.015 * pnoise(x, z, 3, 4)
    # running-bond clay pavers
    row = np.floor((x + 5) / 0.1)
    off = (row % 2) * 0.1
    jz = (((z + 5 + off) % 0.2) < 0.012)
    jx = (((x + 5) % 0.1) < 0.012)
    v = 0.86 + 0.2 * phash(x + 0.0, z + 5 + off, 0.1, 4)
    b = BRICK * v[..., None]
    b = np.where((phash(x, z + off, 0.1, 7) > 0.92)[..., None], b * 0.8, b)
    b = np.where((jz | jx)[..., None], MORTAR, b)
    band = (ax > 1.3) & (ax <= 1.5)                                               # soldier course border
    bb = np.where((((z + 5) % 0.1) < 0.012)[..., None], MORTAR, BRICK * 0.82 * (0.9 + 0.15 * phash(x, z, 0.1, 5))[..., None])
    b = np.where(band[..., None], bb, b)
    edge = (ax > 1.5) & (ax <= 1.75)
    c = np.where((ax <= 1.5)[..., None], b, c)
    c = np.where(edge[..., None], CURB * (0.93 + 0.05 * pnoise(x, z, 5, 2))[..., None], c)
    h = np.where(ax <= 1.5, 0.06, h)
    h = np.where(edge, 0.09, h)
    return c, h


# ---------------------------------------------------------------------------- water
SEA_DEEP = np.array([0.03, 0.22, 0.32])
SEA_SHALLOW = np.array([0.10, 0.52, 0.55])
SKY = np.array([0.72, 0.84, 0.92])
SAND = np.array([0.86, 0.78, 0.60])
WET = np.array([0.62, 0.54, 0.40])
FOAM = np.array([0.95, 0.97, 0.97])
# (wave numbers over the tile, amplitude, temporal cycles per loop) -> waves loop exactly
SEA_WAVES = [((2, 1), 0.10, 1), ((1, -2), 0.08, 1), ((3, 2), 0.05, 2), ((-2, 3), 0.045, 2),
             ((5, -1), 0.025, 3), ((4, 5), 0.02, 3), ((-6, 3), 0.014, 4), ((7, 6), 0.01, 5),
             ((9, -7), 0.007, 6), ((-11, 4), 0.005, 7)]
_WPH = _rng.uniform(0, TAU, len(SEA_WAVES))


def sea_height(x, z, t):
    h = np.zeros_like(x)
    hx = np.zeros_like(x)
    hz = np.zeros_like(x)
    for ((m, n), a, cyc), p in zip(SEA_WAVES, _WPH):
        kx, kz = TAU * m / TILE, TAU * n / TILE
        ph = kx * x + kz * z - TAU * cyc * t + p
        h += a * np.sin(ph)
        hx += a * kx * np.cos(ph)
        hz += a * kz * np.cos(ph)
    return h, hx, hz


def smooth(a, b, v):
    t = np.clip((v - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def water_shade(x, z, t, depth01, view, key=KEY):
    """colour of the water surface: body colour by depth, reflected sky (Fresnel), sun glints and
    foam on the crests; view = unit vector toward the camera, key = toward the light (tile space)"""
    h, hx, hz = sea_height(x, z, t)
    n = np.stack([-hx * 1.7, np.ones_like(h), -hz * 1.7], -1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    d = np.clip(depth01 + 0.12 * pnoise(x, z, 1, 6), 0, 1)
    body = SEA_SHALLOW * (1 - d[..., None]) + SEA_DEEP * d[..., None]
    body = body * (0.9 + 0.45 * np.clip(h, -0.25, 0.25))[..., None]
    cos_v = np.clip(n @ view, 0, 1)
    r = -view + 2 * cos_v[..., None] * n                                          # reflected ray
    sky = np.array([0.80, 0.88, 0.93]) * (1 - np.clip(r[..., 1], 0, 1)[..., None]) + \
        np.array([0.42, 0.60, 0.80]) * np.clip(r[..., 1], 0, 1)[..., None]
    refl = np.clip(0.16 + 2.2 * (0.04 + 0.96 * (1 - cos_v) ** 4), 0, 0.7)
    c = body * (1 - refl[..., None]) + sky * refl[..., None]
    glint = np.clip(r @ key, 0, 1) ** 160 * 2.2
    c = c + glint[..., None]
    crest = smooth(0.12, 0.24, h + 0.05 * pnoise(x, z, 8, 3)) * np.clip(0.45 + 0.8 * pnoise(x, z, 5, 2), 0, 1)
    lace = smooth(0.55, 0.9, pnoise(x, z, 7, 4)) * smooth(0.04, 0.16, h) * 0.6
    foam = np.clip(crest + lace, 0, 0.95)
    c = c * (1 - foam[..., None]) + FOAM * foam[..., None]
    return np.clip(c, 0, 1), n


def shore(x, z, t, view, key=KEY):
    """straight shoreline: sea toward -z, beach toward +z; waves run up and draw back once per loop"""
    beach = 0.08 * (z + 1.0)                                                       # sand height (slope)
    run = 0.9 + 1.3 * np.sin(TAU * t)                                              # swash line position (z)
    wob = 0.35 * pnoise(x, np.zeros_like(x), 2, 3) + 0.15 * pnoise(x, np.zeros_like(x) + 1.7, 5, 4)
    line = run + wob
    wet_max = 2.4 + wob
    depth = np.clip((-z + 1.0) / 6.0, 0, 1)
    wc, n = water_shade(x, z, t, depth, view, key)
    sand = SAND * (0.92 + 0.06 * pnoise(x, z, 4, 1) + 0.03 * pnoise(x, z, 14, 2))[..., None]
    wetness = np.clip((wet_max - z) / 1.2, 0, 1) * (z > line)
    sand = sand * (1 - 0.35 * wetness[..., None]) + WET * 0.35 * wetness[..., None]
    shells = phash(x, z, 0.08, 4) > 0.985
    sand = np.where((shells & (z > wet_max))[..., None], np.array([0.95, 0.93, 0.88]), sand)
    water = z < line
    # thin sheet of water near the edge: see-through to the sand
    sheet = np.clip((line - z) / 1.0, 0, 1)
    c = np.where(water[..., None], sand * (1 - sheet[..., None]) + wc * sheet[..., None], sand)
    # foam: the swash edge, and two breakers rolling in, each leaving lacy foam behind it
    lace = np.clip(0.55 + 0.6 * pnoise(x, z, 9, 6), 0, 1)
    edge = np.exp(-((z - line) / 0.2) ** 2) * (z < line + 0.08) * (0.6 + 0.4 * lace)
    br = np.zeros_like(x)
    for k in range(2):
        ph = (t + k * 0.5) % 1.0
        zb = -3.8 + 4.4 * ph + 0.5 * wob
        fade = np.sin(math.pi * ph)
        br += np.exp(-((z - zb) / 0.32) ** 2) * fade * (0.5 + 0.5 * lace)
        br += np.exp(-np.maximum(zb - z, 0) / 0.9) * (z < zb) * fade * 0.45 * smooth(0.5, 0.9, lace)
    foam = np.clip(edge * 0.95 + br * 0.8, 0, 0.95) * water
    c = c * (1 - foam[..., None]) + FOAM * foam[..., None]
    return c, np.zeros_like(x), water          # (flat: the beach slope is in the shading only)


# ---------------------------------------------------------------------------- rendering
def view_basis(comp_deg):
    """tile space -> screen: returns (right, up, forward) as tile-space vectors"""
    yaw = math.radians(180 - comp_deg)
    cy, sy = math.cos(yaw), math.sin(yaw)
    # world camera basis
    F = np.array([0.0, -math.sin(PITCH), -math.cos(PITCH)])
    U = np.array([0.0, math.cos(PITCH), -math.sin(PITCH)])
    R = np.array([1.0, 0.0, 0.0])
    Ry = np.array([[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]])                         # tile -> world
    return R @ Ry, U @ Ry, F @ Ry


def render_tile(kind, comp_deg, frame=256, t=0.0, ss=2, bleed=0.06, light_world=True):
    N = frame * ss
    px = (frame / PPM) / N
    jj, ii = np.mgrid[0:N, 0:N].astype(np.float64)
    sx = (ii + 0.5 - N / 2) * px
    sy = (jj + 0.5 - N / 2) * px
    R, U, F = view_basis(comp_deg)
    key = KEY @ np.array([[math.cos(math.radians(180 - comp_deg)), 0, math.sin(math.radians(180 - comp_deg))],
                          [0, 1, 0], [-math.sin(math.radians(180 - comp_deg)), 0, math.cos(math.radians(180 - comp_deg))]])
    O = sx[..., None] * R - sy[..., None] * U - F * 5.0                          # ray origins (tile space)
    # march the height field from y = 0.35 down to 0
    t0 = (0.6 - O[..., 1]) / F[1]
    t1 = (0.0 - O[..., 1]) / F[1]
    hitP = None
    found = np.zeros((N, N), bool)
    P = O + t1[..., None] * F
    steps = 0 if kind in ("sea", "shore") else 28      # water and beach are drawn flat: no march
    for k in range(steps + 1 if steps else 0):
        tt = t0 + (t1 - t0) * k / steps
        Q = O + tt[..., None] * F
        _, h = layout(kind, Q[..., 0], Q[..., 2], t, -F, key)
        hit = (Q[..., 1] <= h) & ~found
        P = np.where(hit[..., None], Q, P)
        found |= hit
    x, z = P[..., 0], P[..., 2]
    col, h = layout(kind, x, z, t, -F, key)
    if kind in ("sea", "shore"):
        lit = col
    else:
        e = 0.02
        _, hx1 = layout(kind, x + e, z, t)
        _, hx0 = layout(kind, x - e, z, t)
        _, hz1 = layout(kind, x, z + e, t)
        _, hz0 = layout(kind, x, z - e, t)
        n = np.stack([-(hx1 - hx0) / (2 * e), np.ones_like(x), -(hz1 - hz0) / (2 * e)], -1)
        n /= np.linalg.norm(n, axis=-1, keepdims=True)
        ndl = np.clip(n @ key, 0, 1)
        # cheap occlusion: lower than the surroundings -> darker (curb bases)
        _, hn = layout(kind, x + 0.12 * key[0], z + 0.12 * key[2], t)
        occ = np.clip((hn - h) * 4.0, 0, 0.35)
        lit = col * (0.42 + 0.68 * ndl - occ)[..., None]
    inside = (np.abs(x) <= TILE / 2 + bleed) & (np.abs(z) <= TILE / 2 + bleed)
    rgba = np.zeros((N, N, 4))
    rgba[..., :3] = np.clip(lit, 0, 1) * inside[..., None]
    rgba[..., 3] = inside
    img = rgba.reshape(frame, ss, frame, ss, 4).mean((1, 3))
    out = np.zeros_like(img)
    a = img[..., 3:4]
    out[..., :3] = np.where(a > 1e-4, img[..., :3] / np.maximum(a, 1e-4), 0)
    out[..., 3:4] = a
    return out


def layout(kind, x, z, t=0.0, view=None, key=None):
    if view is None:
        view = np.array([0.0, math.sin(PITCH), math.cos(PITCH)])
    if key is None:
        key = KEY
    if kind == "road":
        return road(x, z)
    if kind == "intersection":
        return intersection(x, z)
    if kind == "walkway":
        return walkway(x, z)
    if kind == "sea":
        c, _ = water_shade(x, z, t, np.full_like(x, 0.85), view, key)
        return c, np.zeros_like(x)
    if kind == "shore":
        c, h, _ = shore(x, z, t, view, key)
        return c, h
    raise ValueError(kind)


def topdown(kind, res=512, t=0.0):
    """straight-down albedo (unlit for tiles) and height map, 512 px per tile"""
    v = (np.arange(res) + 0.5) / res * TILE - TILE / 2
    z, x = np.meshgrid(v, v, indexing="ij")
    c, h = layout(kind, x, -z, t)
    return c, h

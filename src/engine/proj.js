// WGS84 <-> Transverse Mercator incl. UTM (Krueger series), identical maths to
// pipeline/toledo_map/projection.py. The game frame is projected metres minus a fixed origin: x = east, y = north (2D);
// in 3D, X = east, Y = up, Z = -north.

const PJ_A = 6378137.0, PJ_F = 1 / 298.257223563, PJ_K0 = 0.9996, PJ_E0 = 500000.0;
const pj_n = PJ_F / (2 - PJ_F);
const [pjn2, pjn3, pjn4, pjn5, pjn6] = [2, 3, 4, 5, 6].map((k) => pj_n ** k);
const pj_e = Math.sqrt(PJ_F * (2 - PJ_F));
const pj_A = (PJ_A / (1 + pj_n)) * (1 + pjn2 / 4 + pjn4 / 64 + pjn6 / 256);
const PJ_ALPHA = [
  pj_n / 2 - (2 * pjn2) / 3 + (5 * pjn3) / 16 + (41 * pjn4) / 180 - (127 * pjn5) / 288 + (7891 * pjn6) / 37800,
  (13 * pjn2) / 48 - (3 * pjn3) / 5 + (557 * pjn4) / 1440 + (281 * pjn5) / 630 - (1983433 * pjn6) / 1935360,
  (61 * pjn3) / 240 - (103 * pjn4) / 140 + (15061 * pjn5) / 26880 + (167603 * pjn6) / 181440,
  (49561 * pjn4) / 161280 - (179 * pjn5) / 168 + (6601661 * pjn6) / 7257600,
  (34729 * pjn5) / 80640 - (3418889 * pjn6) / 1995840,
  (212378941 * pjn6) / 319334400,
];
const PJ_BETA = [
  pj_n / 2 - (2 * pjn2) / 3 + (37 * pjn3) / 96 - pjn4 / 360 - (81 * pjn5) / 512 + (96199 * pjn6) / 604800,
  pjn2 / 48 + pjn3 / 15 - (437 * pjn4) / 1440 + (46 * pjn5) / 105 - (1118711 * pjn6) / 3870720,
  (17 * pjn3) / 480 - (37 * pjn4) / 840 - (209 * pjn5) / 4480 + (5569 * pjn6) / 90720,
  (4397 * pjn4) / 161280 - (11 * pjn5) / 504 - (830251 * pjn6) / 7257600,
  (4583 * pjn5) / 161280 - (108847 * pjn6) / 3991680,
  (20648693 * pjn6) / 638668800,
];
const PJ_DELTA = [
  2 * pj_n - (2 * pjn2) / 3 - 2 * pjn3 + (116 * pjn4) / 45 + (26 * pjn5) / 45 - (2854 * pjn6) / 675,
  (7 * pjn2) / 3 - (8 * pjn3) / 5 - (227 * pjn4) / 45 + (2704 * pjn5) / 315 + (2323 * pjn6) / 945,
  (56 * pjn3) / 15 - (136 * pjn4) / 35 - (1262 * pjn5) / 105 + (73814 * pjn6) / 2835,
  (4279 * pjn4) / 630 - (332 * pjn5) / 35 - (399572 * pjn6) / 14175,
  (4174 * pjn5) / 315 - (144838 * pjn6) / 6237,
  (601676 * pjn6) / 22275,
];
const RAD = Math.PI / 180;

export class LocalFrame {
  // crs = manifest.crs: generic Transverse Mercator (lon0, k0, false_easting/northing);
  // older manifests carried only a UTM EPSG code.
  constructor(crs) {
    this.epsg = crs.epsg;
    if (crs.lon0 !== undefined) {
      this.lon0 = crs.lon0 * RAD;
      this.k0 = crs.k0;
      this.E0 = crs.false_easting;
      this.N0 = crs.false_northing;
    } else {
      const zone = crs.epsg % 100, north = Math.floor(crs.epsg / 100) === 326;
      this.lon0 = (zone * 6 - 183) * RAD;
      this.k0 = PJ_K0;
      this.E0 = PJ_E0;
      this.N0 = north ? 0 : 10000000;
    }
    this.oe = crs.origin_easting;
    this.on = crs.origin_northing;
  }
  forward(lat, lon) {
    const phi = lat * RAD, lam = lon * RAD - this.lon0;
    const s = Math.sin(phi);
    const t = Math.sinh(Math.atanh(s) - pj_e * Math.atanh(pj_e * s));
    const xip = Math.atan2(t, Math.cos(lam));
    const etap = Math.atanh(Math.sin(lam) / Math.sqrt(1 + t * t));
    let xi = xip, eta = etap;
    for (let j = 1; j <= 6; j++) {
      const a = PJ_ALPHA[j - 1];
      xi += a * Math.sin(2 * j * xip) * Math.cosh(2 * j * etap);
      eta += a * Math.cos(2 * j * xip) * Math.sinh(2 * j * etap);
    }
    return [this.E0 + this.k0 * pj_A * eta, this.N0 + this.k0 * pj_A * xi];
  }
  inverse(E, N) {
    const xi = (N - this.N0) / (this.k0 * pj_A), eta = (E - this.E0) / (this.k0 * pj_A);
    let xip = xi, etap = eta;
    for (let j = 1; j <= 6; j++) {
      const b = PJ_BETA[j - 1];
      xip -= b * Math.sin(2 * j * xi) * Math.cosh(2 * j * eta);
      etap -= b * Math.cos(2 * j * xi) * Math.sinh(2 * j * eta);
    }
    const chi = Math.asin(Math.sin(xip) / Math.cosh(etap));
    let phi = chi;
    for (let j = 1; j <= 6; j++) phi += PJ_DELTA[j - 1] * Math.sin(2 * j * chi);
    const lam = Math.atan2(Math.sinh(etap), Math.cos(xip));
    return [phi / RAD, (lam + this.lon0) / RAD];
  }
  toLocal(lat, lon) {
    const [e, n] = this.forward(lat, lon);
    return [e - this.oe, n - this.on];
  }
  toWGS84(x, y) {
    return this.inverse(x + this.oe, y + this.on);
  }
  // grid convergence (deg): true bearing = grid bearing + gamma
  convergence(x, y) {
    const [lat, lon] = this.toWGS84(x, y);
    const [x2, y2] = this.toLocal(lat + 1e-4, lon);
    return -Math.atan2(x2 - x, y2 - y) / RAD;
  }
}

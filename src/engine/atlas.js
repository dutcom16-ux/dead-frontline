// Procedural facade/roof texture atlas, painted into an RGBA byte array (no image files).
// Alpha is a tint mask: 255 = multiply by the building's wall/roof colour, 0 = literal colour
// (glass, steel, wood, signs). Tile pixel rows run bottom-up (row 0 = floor level).
export const ATLAS_TILE = 64, ATLAS_COLS = 8, ATLAS_SIZE = 512;

export const T = {
  plain: 0, jalousie: 1, grille: 2, capiz: 3, shutter: 4, shopfront: 5, school: 6, wood: 7,
  sawali: 8, corrugated: 9, industrial: 10, civic: 11, church: 12, door_wood: 13, door_gate: 14,
  door_glass: 15, roof_gi: 16, roof_nipa: 17, roof_concrete: 18, roof_tile: 19, balcony: 20,
  aluminium: 21, open_bay: 22, floor_tiles: 23, sign_cross: 24, garage: 25, doorway: 26, sign_band: 27,
  stone: 28, roof_gi_rust: 29, column: 30, louvre_vent: 31,
};

export function buildAtlas() {
  const S = ATLAS_SIZE, data = new Uint8Array(S * S * 4);
  let ox = 0, oy = 0;
  let seed = 1;
  const rnd = () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 4294967296);
  const px = (x, y, r, g, b, a) => {
    if (x < 0 || y < 0 || x >= ATLAS_TILE || y >= ATLAS_TILE) return;
    const i = ((oy + y) * S + ox + x) * 4;
    data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = a;
  };
  const rect = (x, y, w, h, r, g, b, a = 0) => {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) px(i, j, r, g, b, a);
  };
  const wall = (k = 245) => {
    for (let j = 0; j < 64; j++) for (let i = 0; i < 64; i++) {
      const n = (rnd() * 14) | 0;
      px(i, j, k - n, k - n, k - n, 255);
    }
  };
  const frame = (x, y, w, h, c = [70, 72, 75], t = 2) => {
    rect(x, y, w, t, ...c); rect(x, y + h - t, w, t, ...c); rect(x, y, t, h, ...c); rect(x + w - t, y, t, h, ...c);
  };
  const sill = (x, y, w) => rect(x - 2, y - 3, w + 4, 3, 200, 200, 200, 255);
  const tiles = [];
  const def = (idx, fn) => (tiles[idx] = fn);

  def(T.plain, () => wall());
  def(T.jalousie, () => {
    wall(); sill(18, 20, 28);
    rect(18, 20, 28, 26, 150, 170, 180); for (let j = 22; j < 46; j += 3) rect(19, j, 26, 1, 95, 110, 120);
    frame(18, 20, 28, 26); rect(31, 20, 2, 26, 70, 72, 75);
  });
  def(T.grille, () => {
    wall(); sill(16, 20, 32);
    rect(16, 20, 32, 26, 120, 145, 160); rect(17, 21, 14, 24, 140, 165, 180);
    for (let i = 16; i < 48; i += 4) rect(i, 20, 1, 26, 40, 40, 42);
    for (let j = 20; j < 46; j += 6) rect(16, j, 32, 1, 40, 40, 42);
    frame(16, 20, 32, 26, [60, 60, 62]);
  });
  def(T.capiz, () => {
    for (let j = 0; j < 64; j++) for (let i = 0; i < 64; i++) px(i, j, 120 + ((rnd() * 10) | 0), 82, 50, 0); // timber upper floor
    for (let j = 0; j < 64; j += 8) rect(0, j, 64, 1, 90, 60, 36);
    rect(8, 14, 48, 36, 232, 226, 205);
    for (let i = 8; i < 56; i += 5) rect(i, 14, 1, 36, 95, 65, 40);
    for (let j = 14; j < 50; j += 5) rect(8, j, 48, 1, 95, 65, 40);
    frame(8, 14, 48, 36, [85, 55, 33], 2); rect(31, 14, 2, 36, 85, 55, 33);
    rect(6, 10, 52, 3, 70, 48, 30);
  });
  def(T.shutter, () => {
    wall(); rect(3, 0, 58, 44, 170, 172, 170);
    for (let j = 0; j < 44; j += 3) rect(3, j, 58, 1, 125, 128, 128);
    rect(3, 44, 58, 4, 110, 112, 112); rect(0, 50, 64, 12, 255, 255, 255, 255);
    rect(4, 52, 56, 8, ...[[200, 40, 40], [30, 90, 170], [240, 190, 40], [40, 140, 70]][0], 0);
  });
  def(T.shopfront, () => {
    wall(); rect(4, 0, 56, 44, 90, 120, 135); rect(6, 2, 24, 40, 120, 155, 170); rect(34, 2, 24, 40, 120, 155, 170);
    frame(4, 0, 56, 44, [150, 152, 155], 2); rect(31, 0, 2, 44, 150, 152, 155);
    rect(0, 48, 64, 14, 30, 90, 170); for (let i = 6; i < 58; i += 7) rect(i, 52, 4, 6, 245, 245, 245);
  });
  def(T.school, () => {
    wall(); rect(0, 0, 64, 14, 235, 235, 235, 255);
    rect(6, 18, 52, 28, 150, 172, 182); for (let j = 20; j < 46; j += 3) rect(7, j, 50, 1, 100, 118, 128);
    frame(6, 18, 52, 28, [40, 80, 60]); rect(31, 18, 2, 28, 40, 80, 60);
    rect(0, 14, 64, 2, 40, 80, 60);
  });
  def(T.wood, () => {
    for (let j = 0; j < 64; j++) for (let i = 0; i < 64; i++) {
      const n = (rnd() * 20) | 0, plank = (j % 8 === 0) ? 40 : 0;
      px(i, j, 235 - n - plank, 225 - n - plank, 210 - n - plank, 255);
    }
    rect(22, 22, 20, 20, 40, 32, 25); frame(22, 22, 20, 20, [95, 70, 45], 2);
    rect(18, 40, 28, 5, 120, 90, 55);
  });
  def(T.sawali, () => {
    for (let j = 0; j < 64; j++) for (let i = 0; i < 64; i++) {
      const w = (((i >> 2) + (j >> 2)) & 1) ? 30 : 0;
      px(i, j, 200 - w, 170 - w, 110 - w, 0);
    }
    rect(0, 0, 64, 3, 110, 80, 50); rect(0, 61, 64, 3, 110, 80, 50); rect(0, 0, 3, 64, 110, 80, 50); rect(61, 0, 3, 64, 110, 80, 50);
    rect(24, 26, 16, 16, 40, 30, 20);
  });
  def(T.corrugated, () => {
    for (let j = 0; j < 64; j++) for (let i = 0; i < 64; i++) {
      const k = [255, 235, 205, 235][i % 4] - ((rnd() * 8) | 0);
      px(i, j, k, k, k, 255);
    }
  });
  def(T.industrial, () => {
    tiles[T.corrugated](); rect(0, 48, 64, 9, 120, 140, 150); for (let i = 0; i < 64; i += 8) rect(i, 48, 1, 9, 60, 62, 65);
  });
  def(T.civic, () => {
    wall(); rect(20, 8, 24, 44, 115, 140, 155); frame(20, 8, 24, 44, [235, 235, 235], 3);
    rect(20, 28, 24, 2, 235, 235, 235); rect(31, 8, 2, 44, 235, 235, 235); rect(16, 5, 32, 3, 210, 210, 210, 255); rect(17, 52, 30, 4, 215, 215, 215, 255);
  });
  def(T.church, () => {
    wall(232);
    for (let j = 10; j < 50; j++) for (let i = 22; i < 42; i++) {
      const dx = i - 32, top = 40;
      if (j > top && dx * dx + (j - top) * (j - top) > 100) continue;
      const c = [[170, 40, 50], [40, 80, 160], [220, 180, 50], [60, 140, 80]][((i >> 2) + (j >> 2)) & 3];
      px(i, j, c[0], c[1], c[2], 0);
    }
    rect(31, 10, 2, 36, 60, 50, 40);
  });
  def(T.door_wood, () => {
    rect(0, 0, 64, 64, 120, 80, 48); frame(0, 0, 64, 64, [80, 52, 30], 4);
    frame(10, 8, 18, 22, [95, 62, 36]); frame(36, 8, 18, 22, [95, 62, 36]); frame(10, 36, 18, 22, [95, 62, 36]); frame(36, 36, 18, 22, [95, 62, 36]);
    rect(50, 28, 4, 6, 210, 180, 80);
  });
  def(T.door_gate, () => {
    rect(0, 0, 64, 64, 50, 52, 55); for (let i = 3; i < 64; i += 6) rect(i, 0, 2, 64, 120, 122, 125);
    rect(0, 30, 64, 3, 120, 122, 125); frame(0, 0, 64, 64, [120, 122, 125], 3);
  });
  def(T.door_glass, () => {
    rect(0, 0, 64, 64, 95, 125, 140); frame(0, 0, 64, 64, [170, 172, 175], 4); rect(30, 0, 4, 64, 170, 172, 175);
    rect(22, 26, 3, 12, 210, 210, 215); rect(39, 26, 3, 12, 210, 210, 215);
  });
  def(T.roof_gi, () => {
    for (let j = 0; j < 64; j++) for (let i = 0; i < 64; i++) {
      const k = [255, 238, 210, 238][i % 4] - ((rnd() * 10) | 0) - (j % 32 === 0 ? 40 : 0);
      px(i, j, k, k, k, 255);
    }
  });
  def(T.roof_gi_rust, () => {
    tiles[T.roof_gi]();
    for (let n = 0; n < 10; n++) {
      const cx = (rnd() * 64) | 0, cy = (rnd() * 64) | 0, r = 3 + rnd() * 7;
      for (let j = -r; j < r; j++) for (let i = -r; i < r; i++) if (i * i + j * j < r * r * rnd() * 1.6) px(cx + i, cy + j, 135 + ((rnd() * 25) | 0), 70, 40, 0);
    }
  });
  def(T.roof_nipa, () => {
    for (let j = 0; j < 64; j++) for (let i = 0; i < 64; i++) {
      const s = (j % 6 < 1 ? 35 : 0) + ((rnd() * 30) | 0);
      px(i, j, 170 - s, 140 - s, 85 - s, 0);
    }
  });
  def(T.roof_concrete, () => {
    for (let j = 0; j < 64; j++) for (let i = 0; i < 64; i++) {
      const k = 235 - ((rnd() * 25) | 0) - ((i % 32 === 0 || j % 32 === 0) ? 25 : 0);
      px(i, j, k, k, k, 255);
    }
  });
  def(T.roof_tile, () => {
    for (let j = 0; j < 64; j++) for (let i = 0; i < 64; i++) {
      const k = 255 - ((j % 8) * 6) - ((((i + ((j >> 3) & 1) * 4) % 8) === 0) ? 50 : 0) - ((rnd() * 10) | 0);
      px(i, j, k, k, k, 255);
    }
  });
  def(T.balcony, () => {
    tiles[T.aluminium](); rect(0, 0, 64, 16, 225, 225, 225, 255);
    for (let i = 0; i < 64; i += 5) rect(i, 2, 2, 14, 60, 62, 65); rect(0, 15, 64, 2, 60, 62, 65);
  });
  def(T.aluminium, () => {
    wall(); sill(12, 22, 40);
    rect(12, 22, 40, 24, 110, 140, 160); frame(12, 22, 40, 24, [185, 188, 190]); rect(31, 22, 2, 24, 185, 188, 190);
    if (true) { rect(48, 10, 12, 9, 225, 225, 222); rect(50, 12, 8, 5, 150, 150, 150); }
  });
  def(T.open_bay, () => {
    rect(0, 0, 64, 64, 35, 32, 30); rect(0, 0, 6, 64, 255, 255, 255, 255); rect(58, 0, 6, 64, 255, 255, 255, 255);
    rect(0, 54, 64, 10, 255, 255, 255, 255); rect(6, 0, 52, 14, 90, 80, 60);
    for (let i = 8; i < 56; i += 6) rect(i, 14, 4, 6, 120, 90, 50);
  });
  def(T.floor_tiles, () => {
    for (let j = 0; j < 64; j++) for (let i = 0; i < 64; i++) {
      const k = 225 - ((i % 16 === 0 || j % 16 === 0) ? 40 : 0) - ((rnd() * 10) | 0);
      px(i, j, k, k - 5, k - 12, 0);
    }
  });
  def(T.sign_cross, () => {
    rect(0, 0, 64, 64, 245, 245, 245); rect(26, 10, 12, 44, 200, 30, 35); rect(10, 26, 44, 12, 200, 30, 35);
  });
  def(T.garage, () => {
    wall(); rect(4, 0, 56, 46, 200, 200, 196); for (let j = 0; j < 46; j += 6) rect(4, j, 56, 1, 150, 150, 148);
  });
  def(T.doorway, () => rect(0, 0, 64, 64, 28, 26, 24));
  def(T.sign_band, () => {
    wall(); rect(0, 40, 64, 18, 200, 40, 40); for (let i = 6; i < 58; i += 7) rect(i, 45, 4, 8, 250, 240, 200);
  });
  def(T.stone, () => {
    for (let j = 0; j < 64; j++) for (let i = 0; i < 64; i++) {
      const row = j >> 3, off = (row & 1) * 8, mort = (j % 8 === 0 || ((i + off) % 16) === 0) ? 60 : 0;
      const k = 235 - mort - ((rnd() * 25) | 0);
      px(i, j, k, k - 6, k - 18, 255);
    }
    rect(22, 6, 20, 30, 70, 55, 40);
  });
  def(T.column, () => {
    for (let j = 0; j < 64; j++) for (let i = 0; i < 64; i++) {
      const k = 250 - Math.abs(i - 32) * 2 - ((rnd() * 8) | 0);
      px(i, j, k, k, k, 255);
    }
  });
  def(T.louvre_vent, () => {
    wall(); for (let j = 30; j < 56; j += 4) rect(8, j, 48, 2, 140, 140, 138, 255);
  });

  for (let t = 0; t < 64; t++) {
    ox = (t % ATLAS_COLS) * ATLAS_TILE;
    oy = Math.floor(t / ATLAS_COLS) * ATLAS_TILE;
    seed = 7 + t * 977;
    (tiles[t] || tiles[0])();
  }
  return data;
}

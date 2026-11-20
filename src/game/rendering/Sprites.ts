// Soldiers, infected, corpses and combat effects drawn from the supplied sprite sheets
// (public/sprites/troops.* and zombies.*, cut by tools/slice_sprites.py).
//
// Facing: each figure's map heading is turned into one of eight screen directions. The sheets
// have front (S), three-quarter front (SE), side (E) and back (N) views; the west-facing
// directions are those views mirrored, and NE/NW use the back view when standing. There is no walking cycle from behind, so a soldier walking
// away from the camera uses the two back frames with a step bob, and NE/NW movement uses the side
// cycle.
//
// Infantry (every class) use the infantry8.* sheet: walk, run, idle, firing standing and firing on the
// move, with frames sorted by the way they really face (tools/slice_sprites.py). To keep the motion
// steady, the renderer turns a soldier one view at a time through the views in between, holds a
// view until the heading is clearly past it, advances walk and run cycles by the distance actually
// covered (no foot sliding), switches walk/run with a speed margin, plays the firing frames once per
// shot and holds aim (no flash) between shots. Deaths use the 8-direction rifleman sheet and soldiers
// who turn into infected the 8-direction infected-soldier sheet (soldier8.*).
//
// Sprites are drawn on the 2D overlay sorted by screen depth. A figure behind a building is drawn
// faded so it stays visible. If the sheets fail to load the game keeps its 3D figures.
import type { Game } from "../Game";
import type { IsoCamera } from "../camera/IsoCamera";
import type { Battlefield } from "../Battlefield";
import { Unit, Zombie, Civilian, Corpse } from "../entities";
import { squadOf, OMNI } from "../units/Squads";

interface Frame { x: number; y: number; w: number; h: number; ax: number; ay: number; k?: number; mx?: number; my?: number }
interface Atlas { size: [number, number]; ref: number; frames: Frame[]; anims: Record<string, number[]> }
interface Sheet { img: HTMLImageElement; atlas: Atlas; tints: Map<string, HTMLCanvasElement> }
type Dir = "E" | "NE" | "N" | "S" | "SE";
type Dir8 = "N" | "NE" | "E" | "SE" | "S" | "SW" | "W" | "NW";
const SECT8: Dir8[] = ["E", "NE", "N", "NW", "W", "SW", "S", "SE"];
/** the 8-direction walk clips ramp from standing to a full stride: play them back and forth */
const STRIDE = [1, 2, 3, 4, 3, 2];
/** compass order, clockwise from facing away from the viewer */
const COMPASS: Dir8[] = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
const WALK_CYCLE_M = 1.6, RUN_CYCLE_M = 2.6;   // ground covered per animation cycle (two steps)
interface Anim8 { dir: number; prevDir: number; dirT: number; wantT: number; aimA: number; aimT: number; side: number; phase: number; lx: number; ly: number; lt: number; spd: number; run: boolean; shotT: number; flash: number }

const HUMAN_M = 1.8 * 1.3;   // figures are drawn a little larger than life so they read at RTS zoom
const TINTS: Record<string, string> = { bloater: "rgba(150,175,40,0.42)", brute: "rgba(30,18,12,0.38)", screamer: "rgba(235,215,225,0.30)", mutant: "rgba(150,25,20,0.36)", turned: "rgba(105,135,55,0.48)" };
const KNEEL = new Set(["line", "defensive", "circle", "box"]);

export class Sprites {
  troops: Sheet | null = null; zombies: Sheet | null = null; s8: Sheet | null = null; inf: Sheet | null = null;
  anim = new Map<number, Anim8>();
  ready = false; zready = false;
  flip = new Map<number, boolean>();
  occl = new Map<number, { t: number; v: boolean }>();
  async load(base = "sprites/") {
    const get = async (name: string): Promise<Sheet | null> => {
      try {
        const [atlas, img] = await Promise.all([
          fetch(base + name + ".json").then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.json(); }),
          new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = base + name + ".png"; }),
        ]);
        return { img, atlas, tints: new Map() };
      } catch (e) { return null; }
    };
    [this.troops, this.zombies, this.s8, this.inf] = await Promise.all([get("troops"), get("zombies"), get("soldier8"), get("infantry8")]);
    this.ready = !!this.troops; this.zready = !!this.zombies;
  }
  /** riflemen are drawn from the 8-direction sheet */
  private rifle8(u: Unit) { return !!this.s8 && u.type === "rifleman"; }
  covers(u: Unit) { return !u.vehicle && (this.ready || this.rifle8(u) || !!this.inf); }
  coversZombie(z: Zombie) { return z.soldier ? this.ready || !!this.s8 : this.zready && z.type !== "abomination"; }
  coversCorpse(c: Corpse) {
    if (c.model === "abomination") return false;
    if (c.soldier || (c.kind === "soldier" && (c.utype === "rifleman" || !!this.inf))) return this.ready || !!this.s8;
    if (c.sprite || c.kind === "soldier") return this.ready;
    return this.zready && !!c.kind;
  }
  /** one of eight screen directions (no mirroring: the 8-direction sheets draw them all) */
  dir8(cam: IsoCamera, heading: number): Dir8 {
    const [sx, sy] = this.facing(cam, heading);
    return SECT8[((Math.round(Math.atan2(sy, sx) / (Math.PI / 4)) % 8) + 8) % 8];
  }
  /** rifleman pose on the 8-direction sheet */
  pose8(g: Game, u: Unit, cam: IsoCamera, now: number): { anim: string; i: number } {
    const ph = (u.id % 7) * 0.37;
    const tgt = g.get(u.target);
    const engaging = !!tgt && !tgt.dead && u.losOk && (u.mag > 0 || u.reserve > 0);
    const toT = engaging ? this.dir8(cam, Math.atan2(tgt.y - u.y, tgt.x - u.x)) : null;
    if (u.moving) {
      if (toT && u.flashT > 0) return { anim: "r_fire_" + toT, i: 0 };   // a shot on the move
      const run = u.speedNow > 3.0 || u.order.kind === "retreat";
      return { anim: "r_walk_" + this.dir8(cam, u.heading), i: STRIDE[Math.floor((now + ph) * (run ? 13 : 9)) % STRIDE.length] };
    }
    if (toT) return { anim: (u.flashT > 0 ? "r_fire_" : "r_aim_") + toT, i: 0 };
    const d = this.dir8(cam, u.heading);
    // standing guard in line, box, circle, defensive and when holding: rifle up; otherwise at ease
    const sq = u.order.kind === "formation" ? squadOf(g, u) : null;
    const ready = u.reloadT <= 0 && (u.order.kind === "hold" || u.order.kind === "defend" || (!!sq && sq.halted && KNEEL.has(sq.formation)));
    return { anim: (ready ? "r_aim_" : "r_walk_") + d, i: 0 };
  }
  /** displayed compass direction with hysteresis; turns step through the views in between */
  private turnTo(st: Anim8, cam: IsoCamera, heading: number, now: number, settle = 0.12) {
    const [sx, sy] = this.facing(cam, heading);
    if (sx > 0.15) st.side = 1; else if (sx < -0.15) st.side = -1;
    const deg = (90 - (Math.atan2(sy, sx) * 180) / Math.PI + 360) % 360;   // 0 = N (away), clockwise
    const off = (((deg - st.dir * 45 + 540) % 360) - 180);
    if (Math.abs(off) <= 30.5) { st.wantT = -1; return; }    // still well inside the current view
    if (st.wantT < 0) st.wantT = now;
    if (now - st.wantT < settle) return;                     // the new view must be wanted for a moment (no flicker)
    if (now - st.dirT < 0.06) return;                        // then one view at a time
    const next = (st.dir + (off > 0 ? 1 : -1) + 8) % 8;
    if (next === st.prevDir && now - st.dirT < 0.3) return;  // never undo a turn straight away
    st.prevDir = st.dir; st.dir = next; st.dirT = now;
  }
  private state(u: { id: number; x: number; y: number }, cam: IsoCamera, heading: number, now: number): Anim8 {
    let st = this.anim.get(u.id);
    if (!st) {
      const [sx, sy] = this.facing(cam, heading);
      const deg = (90 - (Math.atan2(sy, sx) * 180) / Math.PI + 360) % 360;
      st = { dir: Math.round(deg / 45) % 8, prevDir: -1, dirT: -1, wantT: -1, aimA: 0, aimT: -9, side: sx >= 0 ? 1 : -1, phase: (u.id % 5) * 0.2, lx: u.x, ly: u.y, lt: now, spd: 0, run: false, shotT: -9, flash: 0 };
      this.anim.set(u.id, st);
    }
    return st;
  }
  /** clip name for an action in a compass direction (the sheet has no side or straight front/back firing views) */
  private clip(action: string, d: Dir8, side: number): string {
    if (d === "E") d = "SE"; else if (d === "W") d = "SW";
    if (action === "fire" || action === "aim" || action === "firemove" || action === "movaim") {
      if (d === "S") d = side > 0 ? "SE" : "SW";
      else if (d === "N") d = side > 0 ? "NE" : "NW";
    }
    if (action === "run" && d === "S") return "walk_S";
    return action + "_" + d;
  }
  /** infantry pose on the infantry8 sheet; also returns a breathing offset in px */
  poseInf(g: Game, u: Unit, cam: IsoCamera, now: number, human: number): { anim: string; i: number; bob: number } {
    const tgt = g.get(u.target);
    const engaging = !!tgt && !tgt.dead && u.losOk && (u.mag > 0 || u.reserve > 0);
    let face = engaging ? Math.atan2(tgt.y - u.y, tgt.x - u.x) : u.heading;
    const st = this.state(u, cam, face, now);
    // after a target falls, keep aiming that way for a moment instead of snapping back
    if (engaging) { st.aimA = face; st.aimT = now; }
    else if (now - st.aimT < 0.8 && !u.moving) face = st.aimA;
    // ground speed from the figure's real movement (smoothed); the cycle advances with distance
    const dt = now - st.lt;
    if (dt > 0 && dt < 0.5) {
      const d = Math.hypot(u.x - st.lx, u.y - st.ly);
      // walk or run from the intended speed (smoothed), with a wide margin so it does not flip
      const k = Math.min(1, dt * 4);
      st.spd = st.spd * (1 - k) + (u.moving ? u.speedNow : 0) * k;
      st.run = st.run ? st.spd > 1.7 : st.spd > 2.4;
      st.phase += Math.min(d, 1.5) / (st.run ? RUN_CYCLE_M : WALK_CYCLE_M);
    }
    st.lx = u.x; st.ly = u.y; st.lt = now;
    // a shot: rising edge of the muzzle flash timer
    if (u.flashT > st.flash + 1e-4) st.shotT = now;
    st.flash = u.flashT;
    const moving = u.moving && st.spd > 0.3;
    this.turnTo(st, cam, face, now, moving || engaging ? 0.12 : 0.25);   // standing soldiers turn less eagerly
    const d = COMPASS[st.dir];
    const cyc = (name: string) => { const n = this.inf!.atlas.anims[name]?.length || 1; return Math.floor(st.phase * n) % n; };
    const sinceShot = now - st.shotT;
    if (moving) {
      if (engaging) {
        const name = this.clip(sinceShot < 0.15 ? "firemove" : "movaim", d, st.side);
        return { anim: name, i: cyc(name), bob: 0 };
      }
      const name = this.clip(st.run ? "run" : "walk", d, st.side);
      return { anim: name, i: cyc(name), bob: 0 };
    }
    if (engaging) {
      // the four firing frames once per shot (big flash -> small), then hold aim without a flash
      if (sinceShot < 0.2) return { anim: this.clip("fire", d, st.side), i: Math.min(3, Math.floor(sinceShot / 0.05)), bob: 0 };
      return { anim: this.clip("aim", d, st.side), i: 3, bob: 0 };
    }
    const sq = u.order.kind === "formation" ? squadOf(g, u) : null;
    const ready = u.reloadT <= 0 && (u.order.kind === "hold" || u.order.kind === "defend" || (!!sq && sq.halted && KNEEL.has(sq.formation)));
    if (ready) return { anim: this.clip("aim", d, st.side), i: 3, bob: 0 };
    // idle: slow breathing (two frames and a slight rise and fall)
    const ph = (u.id % 7) * 0.9;
    return { anim: this.clip("idle", d, st.side), i: Math.floor((now + ph) / 1.4) % 2, bob: Math.sin((now + ph) * 2.1) * human * 0.006 };
  }
  /** a soldier who turned: 8-direction infected soldier */
  zpose8(g: Game, z: Zombie, cam: IsoCamera, now: number): { anim: string; i: number } {
    const ph = (z.id % 11) * 0.29;
    const t = g.get(z.target);
    if (z.state === "attack" && t) return { anim: "z_attack_" + this.dir8(cam, Math.atan2(t.y - z.y, t.x - z.x)), i: (now + ph) * 4 };
    const d = this.dir8(cam, z.heading);
    if (z.state === "chase" || z.state === "investigate" || z.state === "wander") return { anim: "z_walk_" + d, i: STRIDE[Math.floor((now + ph) * (z.state === "chase" ? 7 : 5)) % STRIDE.length] };
    return { anim: "z_walk_" + d, i: 0 };
  }

  /** a copy of a sheet with a colour wash (made once, on first use) */
  private tinted(sh: Sheet, key: string): CanvasImageSource {
    let c = sh.tints.get(key);
    if (!c) {
      c = document.createElement("canvas"); c.width = sh.img.width; c.height = sh.img.height;
      const x = c.getContext("2d")!;
      x.drawImage(sh.img, 0, 0);
      x.globalCompositeOperation = "source-atop"; x.fillStyle = TINTS[key]; x.fillRect(0, 0, c.width, c.height);
      sh.tints.set(key, c);
    }
    return c;
  }
  private frame(sh: Sheet, anim: string, i: number): Frame | null {
    const ids = sh.atlas.anims[anim];
    if (!ids || !ids.length) return null;
    return sh.atlas.frames[ids[((Math.floor(i) % ids.length) + ids.length) % ids.length]];
  }
  /** draw a frame with its feet at (sx, sy); `h` = figure height in screen px */
  private blit(ctx: CanvasRenderingContext2D, src: CanvasImageSource, sh: Sheet, f: Frame, sx: number, sy: number, h: number, flip: boolean, wide = 1) {
    const k = (h / sh.atlas.ref) * (f.k || 1), kx = k * wide;
    const w = f.w * kx, hh = f.h * k;
    if (flip) {
      ctx.save(); ctx.translate(sx, 0); ctx.scale(-1, 1);
      ctx.drawImage(src, f.x, f.y, f.w, f.h, -f.ax * kx, sy - f.ay * k, w, hh);
      ctx.restore();
    } else ctx.drawImage(src, f.x, f.y, f.w, f.h, sx - f.ax * kx, sy - f.ay * k, w, hh);
  }

  /** screen-space direction of a map heading: x>0 screen-right, y>0 up-screen (away from the viewer) */
  facing(cam: IsoCamera, heading: number): [number, number] {
    const fx = Math.cos(heading), fy = Math.sin(heading);
    const [rx, ry] = cam.right, [ux, uy] = cam.forward;
    return [fx * rx + fy * ry, fx * ux + fy * uy];
  }
  /** eight screen directions folded onto the five drawn ones (west = mirrored east) */
  dir(cam: IsoCamera, heading: number, id: number): { d: Dir; flip: boolean } {
    const [sx, sy] = this.facing(cam, heading);
    const sector = ((Math.round(Math.atan2(sy, sx) / (Math.PI / 4)) % 8) + 8) % 8; // 0 E, 1 NE, 2 N, 3 NW, 4 W, 5 SW, 6 S, 7 SE
    let flip = sx < -0.05 ? true : sx > 0.05 ? false : this.flip.get(id) ?? false;
    this.flip.set(id, flip);
    const d: Dir = sector === 0 || sector === 4 ? "E" : sector === 1 || sector === 3 ? "NE" : sector === 2 ? "N" : sector === 6 ? "S" : "SE";
    return { d, flip };
  }

  /** soldier pose: what he is doing and which way he faces */
  pose(g: Game, u: Unit, cam: IsoCamera, now: number): { anim: string; i: number; flip: boolean; bob: number; muzzle: boolean } {
    const ph = (u.id % 7) * 0.37;
    const tgt = g.get(u.target);
    const engaging = !!tgt && !tgt.dead && u.losOk && (u.mag > 0 || u.reserve > 0);
    const head = engaging ? Math.atan2(tgt.y - u.y, tgt.x - u.x) : u.heading;
    const { d, flip } = this.dir(cam, head, u.id);
    const out = (anim: string, i: number, bob = 0, muzzle = false) => ({ anim, i, flip, bob, muzzle });
    if (u.reloadT > 0 && u.weapon) {
      const p = 1 - u.reloadT / Math.max(0.1, u.weapon.reload);
      return out("reload_S", Math.max(0, Math.min(0.999, p)) * 6);
    }
    const walkBob = (fps: number) => Math.abs(Math.sin((now + ph) * fps * 0.5 * Math.PI)) * 2;
    if (u.moving) {
      const run = u.speedNow > 3.0 || u.order.kind === "retreat";
      if (d === "N") return out("back_N", (now + ph) * 4, walkBob(run ? 6 : 4));
      if (engaging && (d === "E" || d === "NE")) return out("advance_E", (now + ph) * 8, 0, u.flashT > 0);
      if (d === "S") return out("walk_S", (now + ph) * (run ? 13 : 9));
      if (d === "SE") return out(run ? (u.id % 2 ? "run_SE2" : "run_SE") : u.id % 2 ? "walk_SE2" : "walk_SE", (now + ph) * (run ? 11 : 9));
      return out(run ? "run_E" : "walk_E", (now + ph) * (run ? 11 : 8));
    }
    // standing: kneel in line, box, circle and defensive positions and when holding
    const sq = u.order.kind === "formation" ? squadOf(g, u) : null;
    const kneel = u.order.kind === "hold" || u.order.kind === "defend" || (!!sq && sq.halted && KNEEL.has(sq.formation));
    if (engaging) {
      if (d === "N") return out("back_N", 0, 0, u.flashT > 0);
      if (d === "E" || d === "NE") return kneel ? out("kneel_E", 0, 0, u.flashT > 0) : out("advance_E", u.id % 3, 0, u.flashT > 0);
      return out("aim_SE", u.id % 3, 0, u.flashT > 0);
    }
    if (d === "N" || d === "NE") return out("back_N", u.id % 2);
    if (kneel) return d === "E" ? out("kneel_E", 0) : out("crouch_S", (now + ph) * 2);
    if (d === "E") return out("advance_E", 0);
    return out(u.id % 2 ? "idle_S2" : "idle_S", (now + ph) * 4);
  }
  /** infected pose */
  zpose(g: Game, z: Zombie, cam: IsoCamera, now: number): { anim: string; i: number; flip: boolean; bob: number } {
    const ph = (z.id % 11) * 0.29;
    const t = g.get(z.target);
    const head = z.state === "attack" && t ? Math.atan2(t.y - z.y, t.x - z.x) : z.heading;
    const { d, flip } = this.dir(cam, head, z.id);
    const out = (anim: string, i: number, bob = 0) => ({ anim, i, flip, bob });
    const moving = Math.hypot(z.x - z.lastX, z.y - z.lastY) > 0.02 || z.state === "chase" || z.state === "investigate" || z.state === "wander";
    if (z.soldier) {
      // a turned soldier: his own uniform, a slow shamble
      if (z.state === "attack") return out(d === "N" ? "back_N" : "advance_E", (now + ph) * 3);
      if (d === "N") return out("back_N", (now + ph) * 2.5, Math.abs(Math.sin((now + ph) * 4)) * 2);
      return out(d === "S" ? "walk_S" : d === "SE" ? "walk_SE" : "walk_E", (now + ph) * 5.5);
    }
    if (z.type === "crawler") return out(z.state === "attack" ? "crawl_E" : "crawl_E", moving ? (now + ph) * 6 : 0);
    if (z.state === "attack") return out("attack_E", (now + ph) * 9);
    if (z.state === "idle" || !moving) {
      if (d === "N") return out("back_N", z.id % 2);
      return out(z.id % 2 ? "idle_S2" : "idle_S", (now + ph) * 3);
    }
    const fast = z.state === "chase" && z.def.run > 3;
    if (d === "N") return out("back_N", (now + ph) * (fast ? 6 : 3), Math.abs(Math.sin((now + ph) * (fast ? 9 : 5))) * 2);
    if (d === "S" || d === "SE") return out(["walk_S", "walk_S2", "walk_S3"][z.id % 3], (now + ph) * (fast ? 14 : z.state === "chase" ? 9 : 6));
    if (z.type === "mutant" && z.state === "chase") return out("charge_E", (now + ph) * 12);
    if (fast) return out(["run_E", "run_E2", "run_E3"][z.id % 3], (now + ph) * 12);
    return out(z.id % 2 ? "hunch_E" : "walk_E", (now + ph) * (z.state === "chase" ? 8 : 5));
  }

  /** a building between the figure and the camera? (cached about four times a second) */
  occluded(bf: Battlefield, cam: IsoCamera, id: number, x: number, y: number, z: number, now: number) {
    const c = this.occl.get(id);
    if (c && now - c.t < 0.25) return c.v;
    const [fx, fy] = cam.forward, rise = Math.tan(cam.pitch);
    let v = false;
    for (let k = 1.5; k <= 14 && !v; k += 1.5) {
      const px = x - fx * k, py = y - fy * k, hz = z + 1.4 + k * rise;
      const b = bf.map.buildingAt(px, py);
      if (b && !b.collapsed && (b.z || 0) + (b.h || 3) + (b.rh || 0) * 0.5 > hz) v = true;
    }
    this.occl.set(id, { t: now, v });
    return v;
  }

  /** draw corpses, soldiers, infected and combat effects on the overlay (before health bars and labels) */
  draw(ctx: CanvasRenderingContext2D, g: Game, bf: Battlefield, cam: IsoCamera, W: number, H: number, now: number) {
    if (!this.ready && !this.zready && !this.s8 && !this.inf) return;
    const ppm = H / (2 * cam.zoom);
    const human = Math.max(20, ppm * HUMAN_M);
    const on = (s: [number, number] | null, pad = 80) => !!s && s[0] > -pad && s[1] > -pad && s[0] < W + pad && s[1] < H + pad;
    ctx.imageSmoothingEnabled = human < 90;
    const T = this.troops, Z = this.zombies;
    // ---- bodies (piles stack because each corpse lies on top of the ones already there)
    const bodies: { y: number; d: () => void }[] = [];
    const S8 = this.s8;
    for (const c of g.corpses) {
      if (!this.coversCorpse(c)) continue;
      const s = bf.screen(c.x, c.y, c.z);
      if (!on(s)) continue;
      if (S8 && (c.soldier || (c.kind === "soldier" && (c.utype === "rifleman" || !!this.inf)))) {
        const f = this.frame(S8, (c.soldier ? "z_die_" : "r_die_") + this.dir8(cam, c.rot), Math.min(2, (g.time - c.t) * 6));
        if (f) bodies.push({ y: s![1], d: () => this.blit(ctx, S8.img, S8, f, s![0], s![1], human, false) });
      } else if (c.sprite || c.kind === "soldier" || c.soldier) {
        const f = this.frame(T!, "die_E", Math.min(5, (g.time - c.t) * 9));
        if (f) bodies.push({ y: s![1], d: () => this.blit(ctx, c.soldier ? this.tinted(T!, "turned") : T!.img, T!, f, s![0], s![1], human, !!c.flip) });
      } else {
        const f = this.frame(Z!, c.kind === "crawler" ? "crawl_E" : "dead", c.kind === "crawler" ? 3 : (c.id || 0) % 3);
        const tint = TINTS[c.kind || ""] ? this.tinted(Z!, c.kind!) : Z!.img;
        if (f) bodies.push({ y: s![1], d: () => this.blit(ctx, tint, Z!, f, s![0], s![1], human * Math.min(1.5, c.s || 1), !!c.flip, c.kind === "bloater" ? 1.2 : 1) });
      }
    }
    bodies.sort((a, b) => a.y - b.y);
    ctx.globalAlpha = 0.92;
    for (const b of bodies) b.d();
    ctx.globalAlpha = 1;
    // ---- standing figures, back to front
    const list: { y: number; d: () => void }[] = [];
    for (const u of g.units) {
      if (!u.alive || u.vehicle || u.inVehicle !== null) continue;
      const s = bf.screen(u.x, u.y, u.z);
      if (!on(s)) continue;
      const INF = this.inf;
      if (INF) {
        const p = this.poseInf(g, u, cam, now, human);
        const f = this.frame(INF, p.anim, p.i);
        if (!f) continue;
        const occ = this.occluded(bf, cam, u.id, u.x, u.y, u.z, now);
        list.push({ y: s![1], d: () => {
          ctx.globalAlpha = occ ? 0.45 : 1;
          if (u.hitT > 0) ctx.filter = "brightness(1.8)";
          this.blit(ctx, INF.img, INF, f, s![0], s![1] - p.bob, human, false);
          ctx.filter = "none";
        } });
        continue;
      }
      if (S8 && this.rifle8(u)) {
        const p = this.pose8(g, u, cam, now);
        const f = this.frame(S8, p.anim, p.i);
        if (!f) continue;
        const occ = this.occluded(bf, cam, u.id, u.x, u.y, u.z, now);
        list.push({ y: s![1], d: () => {
          ctx.globalAlpha = occ ? 0.45 : 1;
          if (u.hitT > 0) ctx.filter = "brightness(1.8)";
          this.blit(ctx, S8.img, S8, f, s![0], s![1], human, false);
          ctx.filter = "none";
        } });
        continue;
      }
      if (!T) continue;
      const p = this.pose(g, u, cam, now);
      const f = this.frame(T, p.anim, p.i);
      if (!f) continue;
      const occ = this.occluded(bf, cam, u.id, u.x, u.y, u.z, now);
      list.push({ y: s![1], d: () => {
        ctx.globalAlpha = occ ? 0.45 : 1;
        if (u.hitT > 0) ctx.filter = "brightness(1.8)";
        const sy = s![1] - p.bob;
        this.blit(ctx, T.img, T, f, s![0], sy, human, p.flip);
        ctx.filter = "none";
        if (p.muzzle) this.muzzle(ctx, T, f, s![0], sy, human, p.flip, now);
      } });
    }
    for (const c of g.civs as Civilian[]) {
      if (!c.military || c.dead || c.state === "gone") continue;
      const s = bf.screen(c.x, c.y, c.z);
      if (!on(s)) continue;
      if (this.inf) {
        const INF = this.inf, f = this.frame(INF, "idle_S", Math.floor(now / 1.4 + c.id) % 2);
        if (f) list.push({ y: s![1], d: () => { ctx.globalAlpha = 0.85; this.blit(ctx, INF.img, INF, f, s![0], s![1], human, false); } });
        continue;
      }
      if (!T) continue;
      const f = this.frame(T, c.state === "hiding" ? "crouch_S" : "idle_S", now * 3 + c.id);
      if (f) list.push({ y: s![1], d: () => { ctx.globalAlpha = 0.85; this.blit(ctx, T.img, T, f, s![0], s![1], human, false); } });
    }
    for (const z of g.zombies) {
      if (z.dead || !this.coversZombie(z)) continue;
      const s = bf.screen(z.x, z.y, z.z);
      if (!on(s)) continue;
      if (S8 && z.soldier) {
        const p = this.zpose8(g, z, cam, now);
        const f = this.frame(S8, p.anim, p.i);
        if (!f) continue;
        const occ = this.occluded(bf, cam, z.id, z.x, z.y, z.z, now);
        list.push({ y: s![1], d: () => {
          ctx.globalAlpha = occ ? 0.4 : 1;
          if (z.hitT > 0) ctx.filter = "brightness(1.7)";
          else if (z.burnT > 0) ctx.filter = "sepia(1) saturate(3) hue-rotate(-20deg)";
          this.blit(ctx, S8.img, S8, f, s![0], s![1], human, false);
          ctx.filter = "none";
        } });
        continue;
      }
      const p = this.zpose(g, z, cam, now);
      const sh = z.soldier ? T! : Z!;
      const f = this.frame(sh, p.anim, p.i);
      if (!f) continue;
      const src = z.soldier ? this.tinted(T!, "turned") : TINTS[z.type] ? this.tinted(Z!, z.type) : Z!.img;
      const size = z.soldier ? 1 : Math.min(1.6, z.def.size);
      const occ = this.occluded(bf, cam, z.id, z.x, z.y, z.z, now);
      list.push({ y: s![1], d: () => {
        ctx.globalAlpha = occ ? 0.4 : 1;
        if (z.hitT > 0) ctx.filter = "brightness(1.7)";
        else if (z.burnT > 0) ctx.filter = "sepia(1) saturate(3) hue-rotate(-20deg)";
        this.blit(ctx, src, sh, f, s![0], s![1] - p.bob, human * size * (z.type === "crawler" ? 1.15 : 1), p.flip, z.type === "bloater" ? 1.25 : 1);
        ctx.filter = "none";
      } });
    }
    list.sort((a, b) => a.y - b.y);
    for (const it of list) it.d();
    ctx.globalAlpha = 1;
    // ---- combat effects from the sheet
    if (T) for (const e of g.effects) {
      let anim = "", size = 0, comp: GlobalCompositeOperation = "source-over", alpha = 1;
      const fr = e.t / e.life;
      if (e.kind === "blast") { anim = "explosion"; size = e.s * 2.6; }
      else if (e.kind === "smoke") { anim = "smoke"; size = e.s * 2.4 * (0.7 + fr * 0.6); alpha = 0.75 * (1 - fr); }
      else if (e.kind === "hit") { anim = "bloodhit"; size = 1.4; }
      else if (e.kind === "spark") { anim = "sparks"; size = 1.1; comp = "lighter"; }
      else continue;
      const ids = T.atlas.anims[anim];
      if (!ids) continue;
      const f = T.atlas.frames[ids[Math.min(ids.length - 1, Math.floor(fr * ids.length))]];
      const s = bf.screen(e.x, e.y, e.z + (e.kind === "smoke" ? fr * 4 : 0));
      if (!on(s, 200)) continue;
      const k = Math.max(12, size * ppm) / Math.max(f.w, f.h);
      ctx.globalAlpha = alpha; ctx.globalCompositeOperation = comp;
      ctx.drawImage(T.img, f.x, f.y, f.w, f.h, s![0] - (f.w * k) / 2, s![1] - (f.h * k) / 2, f.w * k, f.h * k);
    }
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = "source-over";
  }
  /** muzzle flash at the rifle tip of an aiming frame */
  private muzzle(ctx: CanvasRenderingContext2D, T: Sheet, f: Frame, sx: number, sy: number, h: number, flip: boolean, now: number) {
    const m = this.frame(T, "muzzle", now * 30);
    if (!m) return;
    const k = (h / T.atlas.ref) * (f.k || 1);
    let mx: number, my: number;
    if (f.mx !== undefined && f.my !== undefined) { mx = (f.mx - f.ax) * k; my = (f.my - f.ay) * k; }
    else { mx = 0; my = -h * 0.75; }   // back view: flash above the shoulder
    const x = sx + (flip ? -mx : mx), y = sy + my, size = h * 0.32;
    const kk = size / Math.max(m.w, m.h);
    ctx.globalCompositeOperation = "lighter";
    ctx.drawImage(T.img, m.x, m.y, m.w, m.h, x - (m.w * kk) / 2, y - (m.h * kk) / 2, m.w * kk, m.h * kk);
    ctx.globalCompositeOperation = "source-over";
  }
  /** formation guides for selected squads, infection and leader markers */
  overlay(ctx: CanvasRenderingContext2D, g: Game, bf: Battlefield, W: number, H: number, now: number, part: "ground" | "labels") {
    if (part === "ground") for (const sq of g.squads) {
      const L = g.get(sq.acting) as Unit | null;
      if (!L) continue;
      const members = sq.members.map((id) => g.get(id) as Unit).filter((u) => u && u.alive && u.inVehicle === null && !u.detached);
      if (!members.some((u) => u.selected)) continue;
      ctx.strokeStyle = sq.broken > 0 ? "rgba(255,120,100,.7)" : "rgba(140,255,150,.55)"; ctx.lineWidth = 1.2;
      for (const u of members) {
        if (isNaN(u.slotX) || (u === L && !sq.halted)) continue;
        const s = bf.screen(u.slotX, u.slotY, bf.h(u.slotX, u.slotY));
        if (!s || s[0] < -20 || s[1] < -20 || s[0] > W + 20 || s[1] > H + 20) continue;
        ctx.beginPath(); ctx.ellipse(s[0], s[1], 7, 3.5, 0, 0, Math.PI * 2); ctx.stroke();
        // facing tick
        const t = bf.screen(u.slotX + Math.cos(u.slotFace) * 1.2, u.slotY + Math.sin(u.slotFace) * 1.2, bf.h(u.slotX, u.slotY));
        if (t) { ctx.beginPath(); ctx.moveTo(s[0], s[1]); ctx.lineTo(t[0], t[1]); ctx.stroke(); }
      }
      // formation front arrow from the centre
      const ox = sq.halted ? sq.cx : L.x, oy = sq.halted ? sq.cy : L.y;
      if (!OMNI.has(sq.formation)) {
        const a = bf.screen(ox, oy, bf.h(ox, oy)), b = bf.screen(ox + Math.cos(sq.facing) * 4, oy + Math.sin(sq.facing) * 4, bf.h(ox, oy));
        if (a && b) { ctx.strokeStyle = "rgba(255,230,120,.75)"; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); }
      }
    }
    if (part !== "labels") return;
    ctx.textAlign = "center";
    for (const u of g.units) {
      if (!u.alive || u.vehicle || u.inVehicle !== null) continue;
      const lead = g.squads.some((q) => q.leader === u.id && q.members.length > 1);
      if (!lead && u.infectedAt < 0) continue;
      const s = bf.screen(u.x, u.y, u.z + 3.3);
      if (!s || s[0] < 0 || s[1] < 0 || s[0] > W || s[1] > H) continue;
      if (u.infectedAt >= 0) {
        const left = Math.max(0, Math.ceil(u.turnAt - g.time));
        ctx.font = "bold 11px system-ui"; ctx.fillStyle = left < 8 && Math.floor(now * 4) % 2 ? "#ff6a4a" : "#c6f05a";
        ctx.fillText(`☣ ${left}s`, s[0], s[1] - 10);
      }
      if (lead) { ctx.font = "bold 12px system-ui"; ctx.fillStyle = "#ffd65a"; ctx.fillText("★", s[0], s[1] - (u.infectedAt >= 0 ? 22 : 10)); }
    }
  }
}
export { Unit };

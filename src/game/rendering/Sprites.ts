// Figures drawn from the supplied sprite sheets (public/sprites/*, cut by tools/slice_sprites.py):
//   military8          every infantry soldier: walk, idle, fire, die in 8 directions
//   infected_soldier8  soldiers who turned into infected (8 directions)
//   zombies            the infected
//   effects            explosion, smoke, blood, sparks
//
// Soldier animation (soldierPose):
//   * one state per soldier, by priority: dying (drawn from his corpse) > firing > walking > idle;
//   * eight screen directions, never mirrored at draw time (SE is SW mirrored once in the atlas, because
//     the sheet's SE row is drawn facing east). A soldier turns one view at a time through the views in
//     between, holds a view until the heading is clearly past it, never undoes a turn straight away, and
//     keeps aiming at a fallen target's spot for a moment instead of snapping back;
//   * the walk cycle (stride, passing step, stride, passing step) advances with the distance covered,
//     with a longer stride at higher speed, so the feet do not slide;
//   * firing: aim between shots; each shot (the weapon's real firing event, Unit.shotN) shows the shot
//     frame with a muzzle flash at the barrel tip, then the recoil frame, then aim again;
//   * dying: the six-frame fall plays once from the moment of death and the last frame stays.
// Sprites are drawn on the 2D overlay sorted by screen depth; a figure behind a building is drawn faded.
// If a sheet fails to load, the game draws its 3D figures for what that sheet covered.
import type { Game } from "../Game";
import type { IsoCamera } from "../camera/IsoCamera";
import type { Battlefield } from "../Battlefield";
import { Unit, Zombie, Civilian, Corpse } from "../entities";
import { squadOf, OMNI } from "../units/Squads";
import { canFireWhileMoving } from "../units/UnitAI";

interface Frame { x: number; y: number; w: number; h: number; ax: number; ay: number; k?: number; mx?: number; my?: number }
interface Atlas { size: [number, number]; ref: number; frames: Frame[]; anims: Record<string, number[]> }
interface Sheet { img: HTMLImageElement; atlas: Atlas; tints: Map<string, HTMLCanvasElement> }
type Dir = "E" | "NE" | "N" | "S" | "SE";
export type Dir8 = "N" | "NE" | "E" | "SE" | "S" | "SW" | "W" | "NW";
const SECT8: Dir8[] = ["E", "NE", "N", "NW", "W", "SW", "S", "SE"];
/** compass order, clockwise from facing away from the viewer */
const COMPASS: Dir8[] = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
/** the infected soldier's walk clips ramp from standing to a full stride: play them back and forth */
const STRIDE = [1, 2, 3, 4, 3, 2];
/** rifle direction on screen for each view (x right, y down); S points at the viewer, N away */
const RIFLE: Record<Dir8, [number, number]> = { N: [0, -1], NE: [0.6, -0.8], E: [1, 0], SE: [0.94, 0.34], S: [0, 1], SW: [-0.94, 0.34], W: [-1, 0], NW: [-0.6, -0.8] };
const HUMAN_M = 1.8 * 1.3;   // figures are drawn a little larger than life so they read at RTS zoom
const TINTS: Record<string, string> = { bloater: "rgba(150,175,40,0.42)", brute: "rgba(30,18,12,0.38)", screamer: "rgba(235,215,225,0.30)", mutant: "rgba(150,25,20,0.36)" };
const KNEEL = new Set(["line", "defensive", "circle", "box"]);
/** dying frames per second; shot frame and recoil frame lengths (s); aim kept after a target drops (s) */
const DIE_FPS = 10, SHOT_S = 0.06, RECOIL_S = 0.08, AIM_HOLD_S = 0.8;
export type SoldierState = "idle" | "walk" | "fire";
interface Anim { dir: number; prevDir: number; dirT: number; wantT: number; aimA: number; aimT: number; phase: number; lx: number; ly: number; lt: number; spd: number; vx: number; vy: number; shotT: number; shotN: number; state: SoldierState; stateT: number }
export interface SoldierPose { state: SoldierState; anim: string; i: number; bob: number; dir: Dir8; flash: boolean }

export class Sprites {
  mil: Sheet | null = null; zs: Sheet | null = null; zombies: Sheet | null = null; fx: Sheet | null = null;
  zready = false;
  anim = new Map<number, Anim>();
  /** view each fallen soldier dies in (fixed at the moment of death) */
  deathDir = new Map<number, Dir8>();
  flip = new Map<number, boolean>();
  occl = new Map<number, { t: number; v: boolean }>();
  /** recent muzzle flashes drawn (for tests): soldier, game time, offset from the feet in figure heights, view */
  flashes: { id: number; t: number; x: number; y: number; dir: Dir8 }[] = [];
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
    [this.mil, this.zs, this.zombies, this.fx] = await Promise.all([get("military8"), get("infected_soldier8"), get("zombies"), get("effects")]);
    this.zready = !!this.zombies;
  }
  /** the soldier sheet is loaded (infantry and military civilians are drawn as sprites) */
  get ready() { return !!this.mil; }
  covers(u: Unit) { return !!this.mil && !u.vehicle; }
  coversZombie(z: Zombie) { return z.soldier ? !!this.zs : this.zready && z.type !== "abomination"; }
  coversCorpse(c: Corpse) {
    if (c.model === "abomination") return false;
    if (c.soldier) return !!this.zs;
    if (c.kind === "soldier" || c.sprite) return !!this.mil;
    return this.zready && !!c.kind;
  }
  coversEffects() { return !!this.fx; }

  /** one of eight screen directions */
  dir8(cam: IsoCamera, heading: number): Dir8 {
    const [sx, sy] = this.facing(cam, heading);
    return SECT8[((Math.round(Math.atan2(sy, sx) / (Math.PI / 4)) % 8) + 8) % 8];
  }
  /** compass angle on screen: 0 = away from the viewer (N), clockwise */
  private compassDeg(cam: IsoCamera, heading: number) {
    const [sx, sy] = this.facing(cam, heading);
    return (90 - (Math.atan2(sy, sx) * 180) / Math.PI + 360) % 360;
  }
  /** displayed view: hysteresis, settle time, one view at a time, no undoing a turn straight away */
  private turnTo(st: Anim, cam: IsoCamera, heading: number, now: number, settle: number) {
    const off = (((this.compassDeg(cam, heading) - st.dir * 45 + 540) % 360) - 180);
    if (Math.abs(off) <= 30.5) { st.wantT = -1; return; }
    if (st.wantT < 0) st.wantT = now;
    if (now - st.wantT < settle) return;
    if (now - st.dirT < 0.06) return;
    const next = (st.dir + (off > 0 ? 1 : -1) + 8) % 8;
    if (next === st.prevDir && now - st.dirT < 0.3) return;
    st.prevDir = st.dir; st.dir = next; st.dirT = now;
  }
  private stateOf(u: Unit, cam: IsoCamera, heading: number, now: number): Anim {
    let st = this.anim.get(u.id);
    if (!st) {
      st = { dir: Math.round(this.compassDeg(cam, heading) / 45) % 8, prevDir: -1, dirT: -1, wantT: -1, aimA: heading, aimT: -9, phase: (u.id % 4) * 0.25, lx: u.x, ly: u.y, lt: now, spd: 0, vx: 0, vy: 0, shotT: -9, shotN: u.shotN, state: "idle", stateT: now };
      this.anim.set(u.id, st);
    }
    return st;
  }
  /**
   * Soldier animation state, by priority firing > walking > idle (dying is drawn from the corpse).
   * `now` is the render clock; movement is measured from the soldier's real position change.
   */
  soldierPose(g: Game, u: Unit, cam: IsoCamera, now: number, human: number): SoldierPose {
    const tgt = g.get(u.target);
    const engaging = !!tgt && !tgt.dead && u.losOk && (u.mag > 0 || u.reserve > 0);
    const st = this.stateOf(u, cam, u.heading, now);
    // ground speed and velocity (smoothed) and distance covered since the last frame
    const dt = now - st.lt;
    let moved = 0;
    if (dt > 0 && dt < 0.5) {
      moved = Math.min(1.5, Math.hypot(u.x - st.lx, u.y - st.ly));
      const k = Math.min(1, dt * 4);
      st.spd = st.spd * (1 - k) + (u.moving ? u.speedNow : 0) * k;
      st.vx = st.vx * (1 - k) + ((u.x - st.lx) / dt) * k; st.vy = st.vy * (1 - k) + ((u.y - st.ly) / dt) * k;
    }
    st.lx = u.x; st.ly = u.y; st.lt = now;
    // a shot: the weapon's firing event counts it. The shot frame and flash start on the first frame
    // drawn after it, so no shot is missed at a low frame rate, and nothing is shown without one
    if (u.shotN !== st.shotN) { st.shotN = u.shotN; st.shotT = now; }
    const sinceShot = now - st.shotT;
    const moving = u.moving && st.spd > 0.3;
    // ---- state by priority
    if (engaging) { st.aimA = Math.atan2(tgt.y - u.y, tgt.x - u.x); st.aimT = now; }
    const aiming = engaging || sinceShot < SHOT_S + RECOIL_S || (now - st.aimT < AIM_HOLD_S && !moving);
    // moving and shooting is part of the game for most weapons: those soldiers keep the firing stance
    const firing = aiming && (!moving || canFireWhileMoving(u) || sinceShot < SHOT_S + RECOIL_S);
    const state: SoldierState = firing ? "fire" : moving ? "walk" : "idle";
    if (state !== st.state) { st.state = state; st.stateT = now; }
    // ---- view: the rifle toward the target when firing; walking, the way he really goes (his heading
    // can lag behind or stay on a target he cannot shoot on the move); otherwise the way he faces
    const going = Math.hypot(st.vx, st.vy) > 0.8 ? Math.atan2(st.vy, st.vx) : u.heading;
    this.turnTo(st, cam, firing ? st.aimA : state === "walk" ? going : u.heading, now, firing || moving ? 0.12 : 0.25);
    const d = COMPASS[st.dir];
    if (state === "fire") {
      const i = sinceShot < SHOT_S ? 1 : sinceShot < SHOT_S + RECOIL_S ? 2 : 0;   // shot, recoil, aim
      return { state, anim: "fire_" + d, i, bob: 0, dir: d, flash: i === 1 && u.wid !== "flamer" };
    }
    if (state === "walk") {
      // stride lengthens with speed (2 steps = 1.4 m + 0.25 m per m/s; 2.3 m at 3.6 m/s): no foot sliding
      const cycle = 1.4 + 0.25 * Math.max(0, st.spd);
      st.phase += moved / cycle;
      const n = this.mil!.atlas.anims["walk_" + d].length;
      return { state, anim: "walk_" + d, i: Math.floor(st.phase * n) % n, bob: 0, dir: d, flash: false };
    }
    // idle: at the ready in line/box/circle/defensive positions and when holding; otherwise at ease, breathing
    const sq = u.order.kind === "formation" ? squadOf(g, u) : null;
    const ready = u.reloadT <= 0 && (u.order.kind === "hold" || u.order.kind === "defend" || (!!sq && sq.halted && KNEEL.has(sq.formation)));
    if (ready) return { state, anim: "fire_" + d, i: 0, bob: 0, dir: d, flash: false };
    const ph = (u.id % 7) * 0.9;
    return { state, anim: "idle_" + d, i: 0, bob: Math.sin((now + ph) * 2.1) * human * 0.005, dir: d, flash: false };
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
  /** draw a frame with its anchor (the feet) at (sx, sy); `h` = standing figure height in screen px */
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

  /** infected pose */
  zpose(g: Game, z: Zombie, cam: IsoCamera, now: number): { anim: string; i: number; flip: boolean; bob: number } {
    const ph = (z.id % 11) * 0.29;
    const t = g.get(z.target);
    const head = z.state === "attack" && t ? Math.atan2(t.y - z.y, t.x - z.x) : z.heading;
    const { d, flip } = this.dir(cam, head, z.id);
    const out = (anim: string, i: number, bob = 0) => ({ anim, i, flip, bob });
    const moving = Math.hypot(z.x - z.lastX, z.y - z.lastY) > 0.02 || z.state === "chase" || z.state === "investigate" || z.state === "wander";
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
    if (!this.mil && !this.zombies && !this.zs && !this.fx) return;
    const ppm = H / (2 * cam.zoom);
    const human = Math.max(20, ppm * HUMAN_M);
    const on = (s: [number, number] | null, pad = 80) => !!s && s[0] > -pad && s[1] > -pad && s[0] < W + pad && s[1] < H + pad;
    ctx.imageSmoothingEnabled = human < 90;
    const M = this.mil, Z = this.zombies, ZS = this.zs, FX = this.fx;
    // ---- bodies (piles stack because each corpse lies on top of the ones already there)
    const bodies: { y: number; d: () => void }[] = [];
    for (const c of g.corpses) {
      if (!this.coversCorpse(c)) continue;
      const s = bf.screen(c.x, c.y, c.z);
      if (!on(s)) continue;
      if (c.soldier && ZS) {
        const f = this.frame(ZS, "z_die_" + this.dir8(cam, c.rot), Math.min(2, (g.time - c.t) * 6));
        if (f) bodies.push({ y: s![1], d: () => this.blit(ctx, ZS.img, ZS, f, s![0], s![1], human, false) });
      } else if ((c.kind === "soldier" || c.sprite) && M) {
        // dying: the fall plays once from the moment of death, in the view he was last shown in, and
        // its last frame stays (game time, so a pause holds it)
        const p = this.dyingPose(g, c, cam);
        const f = this.frame(M, p.anim, p.i);
        if (f) bodies.push({ y: s![1], d: () => this.blit(ctx, M.img, M, f, s![0], s![1], human, false) });
      } else if (Z) {
        const f = this.frame(Z, c.kind === "crawler" ? "crawl_E" : "dead", c.kind === "crawler" ? 3 : (c.id || 0) % 3);
        const tint = TINTS[c.kind || ""] ? this.tinted(Z, c.kind!) : Z.img;
        if (f) bodies.push({ y: s![1], d: () => this.blit(ctx, tint, Z, f, s![0], s![1], human * Math.min(1.5, c.s || 1), !!c.flip, c.kind === "bloater" ? 1.2 : 1) });
      }
    }
    bodies.sort((a, b) => a.y - b.y);
    ctx.globalAlpha = 0.92;
    for (const b of bodies) b.d();
    ctx.globalAlpha = 1;
    // ---- standing figures, back to front
    const list: { y: number; d: () => void }[] = [];
    const flashes: (() => void)[] = [];
    if (M) for (const u of g.units) {
      if (!u.alive || u.vehicle || u.inVehicle !== null) continue;
      const s = bf.screen(u.x, u.y, u.z);
      if (!on(s)) continue;
      const p = this.soldierPose(g, u, cam, now, human);
      const f = this.frame(M, p.anim, p.i);
      if (!f) continue;
      const occ = this.occluded(bf, cam, u.id, u.x, u.y, u.z, now);
      list.push({ y: s![1], d: () => {
        ctx.globalAlpha = occ ? 0.45 : 1;
        if (u.hitT > 0) ctx.filter = "brightness(1.8)";
        this.blit(ctx, M.img, M, f, s![0], s![1] - p.bob, human, false);
        ctx.filter = "none";
      } });
      if (p.flash && f.mx !== undefined && f.my !== undefined) {
        // the barrel tip of this very frame, through the same anchor and scale as the figure
        const k = (human / M.atlas.ref) * (f.k || 1);
        const mx = s![0] + (f.mx - f.ax) * k, my = s![1] + (f.my - f.ay) * k;
        flashes.push(() => { ctx.globalAlpha = occ ? 0.45 : 1; this.muzzleFlash(ctx, mx, my, p.dir, human, u.shotN); });
        this.flashes.push({ id: u.id, t: g.time, x: ((f.mx - f.ax) * (f.k || 1)) / M.atlas.ref, y: ((f.my - f.ay) * (f.k || 1)) / M.atlas.ref, dir: p.dir });
        if (this.flashes.length > 400) this.flashes.splice(0, 200);
      }
    }
    if (M) for (const c of g.civs as Civilian[]) {
      if (!c.military || c.dead || c.state === "gone") continue;
      const s = bf.screen(c.x, c.y, c.z);
      if (!on(s)) continue;
      const f = this.frame(M, "idle_" + this.dir8(cam, c.heading), 0);
      if (f) list.push({ y: s![1], d: () => { ctx.globalAlpha = 0.85; this.blit(ctx, M.img, M, f, s![0], s![1], human, false); } });
    }
    for (const z of g.zombies) {
      if (z.dead || !this.coversZombie(z)) continue;
      const s = bf.screen(z.x, z.y, z.z);
      if (!on(s)) continue;
      if (ZS && z.soldier) {
        const p = this.zpose8(g, z, cam, now);
        const f = this.frame(ZS, p.anim, p.i);
        if (!f) continue;
        const occ = this.occluded(bf, cam, z.id, z.x, z.y, z.z, now);
        list.push({ y: s![1], d: () => {
          ctx.globalAlpha = occ ? 0.4 : 1;
          if (z.hitT > 0) ctx.filter = "brightness(1.7)";
          else if (z.burnT > 0) ctx.filter = "sepia(1) saturate(3) hue-rotate(-20deg)";
          this.blit(ctx, ZS.img, ZS, f, s![0], s![1], human, false);
          ctx.filter = "none";
        } });
        continue;
      }
      if (!Z || z.soldier) continue;
      const p = this.zpose(g, z, cam, now);
      const sh = Z;
      const f = this.frame(sh, p.anim, p.i);
      if (!f) continue;
      const src = TINTS[z.type] ? this.tinted(Z, z.type) : Z.img;
      const size = Math.min(1.6, z.def.size);
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
    for (const fl of flashes) fl();     // flashes on top of every figure
    // ---- combat effects from the sheet
    if (FX) for (const e of g.effects) {
      let anim = "", size = 0, comp: GlobalCompositeOperation = "source-over", alpha = 1;
      const fr = e.t / e.life;
      if (e.kind === "blast") { anim = "explosion"; size = e.s * 2.6; }
      else if (e.kind === "smoke") { anim = "smoke"; size = e.s * 2.4 * (0.7 + fr * 0.6); alpha = 0.75 * (1 - fr); }
      else if (e.kind === "hit") { anim = "bloodhit"; size = 1.4; }
      else if (e.kind === "spark") { anim = "sparks"; size = 1.1; comp = "lighter"; }
      else continue;
      const ids = FX.atlas.anims[anim];
      if (!ids) continue;
      const f = FX.atlas.frames[ids[Math.min(ids.length - 1, Math.floor(fr * ids.length))]];
      const s = bf.screen(e.x, e.y, e.z + (e.kind === "smoke" ? fr * 4 : 0));
      if (!on(s, 200)) continue;
      const k = Math.max(12, size * ppm) / Math.max(f.w, f.h);
      ctx.globalAlpha = alpha; ctx.globalCompositeOperation = comp;
      ctx.drawImage(FX.img, f.x, f.y, f.w, f.h, s![0] - (f.w * k) / 2, s![1] - (f.h * k) / 2, f.w * k, f.h * k);
    }
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = "source-over";
  }
  /** dying: the six-frame fall from the moment of death (game time), then the last frame for good */
  dyingPose(g: Game, c: Corpse, cam: IsoCamera): { anim: string; i: number; dir: Dir8 } {
    const d = this.dieDir(c, cam), anim = "die_" + d;
    const n = this.mil!.atlas.anims[anim].length;
    return { anim, i: Math.min(n - 1, Math.floor(Math.max(0, g.time - c.t) * DIE_FPS)), dir: d };
  }
  /** the view a fallen soldier dies in: the one he was shown in when he fell (fixed once) */
  private dieDir(c: Corpse, cam: IsoCamera): Dir8 {
    const key = c.id ?? -1;
    let d = this.deathDir.get(key);
    if (!d) {
      const a = c.uid !== undefined ? this.anim.get(c.uid) : undefined;
      d = a ? COMPASS[a.dir] : this.dir8(cam, c.rot);
      this.deathDir.set(key, d);
      if (c.uid !== undefined) this.anim.delete(c.uid);
      if (this.deathDir.size > 900) for (const k of [...this.deathDir.keys()].slice(0, 300)) this.deathDir.delete(k);
    }
    return d;
  }
  /**
   * Muzzle flash at the barrel tip, pointing along the rifle: a small yellow-orange flame with a
   * white-hot centre and a faint glow, about a sixth of the figure's height. Drawn only on the shot
   * frame of an actual shot (SHOT_S), so nothing stays lit between shots.
   */
  private muzzleFlash(ctx: CanvasRenderingContext2D, x: number, y: number, d: Dir8, human: number, seed: number) {
    const [vx, vy] = RIFLE[d];
    const end = d === "S" || d === "N";                 // rifle pointing at or away from the viewer: a short star
    const len = human * (end ? 0.09 : 0.15), wid = human * 0.06;
    const ang = Math.atan2(vy, vx) + (((seed * 7919) % 7) - 3) * 0.05;   // a little variation per shot
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const glow = ctx.createRadialGradient(x, y, 0, x, y, len * 1.1);
    glow.addColorStop(0, "rgba(255,190,90,0.35)"); glow.addColorStop(1, "rgba(255,130,40,0)");
    ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(x, y, len * 1.1, 0, Math.PI * 2); ctx.fill();
    ctx.translate(x, y); ctx.rotate(ang);
    const flame = ctx.createRadialGradient(0, 0, 0, 0, 0, len);
    flame.addColorStop(0, "rgba(255,255,240,1)"); flame.addColorStop(0.3, "rgba(255,222,110,0.95)");
    flame.addColorStop(0.65, "rgba(255,150,40,0.75)"); flame.addColorStop(1, "rgba(255,90,20,0)");
    ctx.fillStyle = flame;
    const spikes = end ? [0, 1.57, 3.14, 4.71] : [0];
    for (const a of spikes) {                             // flame cone(s) out of the barrel
      const c = Math.cos(a), s = Math.sin(a), l = end ? len * 0.8 : len;
      ctx.beginPath(); ctx.moveTo(-s * wid * 0.5, c * wid * 0.5);
      ctx.quadraticCurveTo(c * l * 0.35 - s * wid, s * l * 0.35 + c * wid, c * l, s * l);
      ctx.quadraticCurveTo(c * l * 0.35 + s * wid, s * l * 0.35 - c * wid, s * wid * 0.5, -c * wid * 0.5);
      ctx.fill();
    }
    if (!end) for (const a of [-0.95, 0.95]) {           // two short side spikes
      ctx.beginPath(); ctx.moveTo(0, 0);
      ctx.lineTo(Math.cos(a) * len * 0.38 - Math.sin(a) * wid * 0.15, Math.sin(a) * len * 0.38 + Math.cos(a) * wid * 0.15);
      ctx.lineTo(Math.cos(a) * len * 0.38 + Math.sin(a) * wid * 0.15, Math.sin(a) * len * 0.38 - Math.cos(a) * wid * 0.15);
      ctx.fill();
    }
    ctx.fillStyle = "rgba(255,255,255,0.95)";             // white-hot centre
    ctx.beginPath(); ctx.ellipse(end ? 0 : len * 0.06, 0, Math.max(1.2, wid * 0.3), Math.max(1, wid * 0.22), 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
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

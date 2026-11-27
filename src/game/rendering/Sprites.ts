// Figures drawn from the sprite sheets in public/sprites/:
//   soldier16          every infantry soldier: walk, idle, fire, die in 16 views (rendered from the 3D
//                      soldier rig, tools/soldier3d/game_atlas.py)
// and, cut by tools/slice_sprites.py from the supplied sheets:
//   infected_soldier8  soldiers who turned into infected (8 directions)
//   zombies            the infected
//   effects            explosion, smoke, blood, sparks
//
// Soldier animation (soldierPose):
//   * one state per soldier, by priority: dying (drawn from his corpse) > firing > walking > idle;
//   * sixteen screen views (the atlas's own list), never mirrored. A soldier turns one view at a time through the views in
//     between, holds a view until the heading is clearly past it, never undoes a turn straight away, and
//     keeps aiming at a fallen target's spot for a moment instead of snapping back;
//   * the walk cycle (12 frames, two steps) advances with the distance covered,
//     with a longer stride at higher speed, so the feet do not slide;
//   * firing: aim between shots; each shot (the weapon's real firing event, Unit.shotN) shows the shot
//     frame with a muzzle flash at the barrel tip, then the recoil frame, then aim again. Tracers start
//     at the barrel tip of the figure as drawn (muzzleOf);
//   * idle: the breathing clip loops;
//   * dying: the fall plays once from the moment of death and the last frame stays.
// Sprites are drawn on the 2D overlay sorted by screen depth; a figure behind a building is drawn faded.
// If a sheet fails to load, the game draws its 3D figures for what that sheet covered.
import type { Game } from "../Game";
import type { IsoCamera } from "../camera/IsoCamera";
import type { Battlefield } from "../Battlefield";
import { Unit, Zombie, Civilian, Corpse } from "../entities";
import { squadOf, OMNI } from "../units/Squads";
import { canFireWhileMoving } from "../units/UnitAI";

interface Frame { x: number; y: number; w: number; h: number; ax: number; ay: number; k?: number; mx?: number; my?: number;
  /** firing frames: the barrel's direction on screen (y down) and how much of it shows (1 side on, 0 end on) */
  md?: [number, number, number] }
interface Atlas { size: [number, number]; ref: number; frames: Frame[]; anims: Record<string, number[]>;
  /** view names clockwise from facing away from the viewer (sheets without it have the 8 of COMPASS) */
  views?: string[] }
interface Sheet { img: HTMLImageElement; atlas: Atlas; tints: Map<string, HTMLCanvasElement> }
export type Dir8 = "N" | "NE" | "E" | "SE" | "S" | "SW" | "W" | "NW";
const SECT8: Dir8[] = ["E", "NE", "N", "NW", "W", "SW", "S", "SE"];
/** compass order, clockwise from facing away from the viewer */
const COMPASS: Dir8[] = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
/** the infected soldier's walk clips ramp from standing to a full stride: play them back and forth */
const STRIDE = [1, 2, 3, 4, 3, 2];
/** rifle direction on screen for each view (x right, y down); S points at the viewer, N away */
const RIFLE: Record<Dir8, [number, number]> = { N: [0, -1], NE: [0.6, -0.8], E: [1, 0], SE: [0.97, 0.25], S: [0, 1], SW: [-0.94, 0.34], W: [-1, 0], NW: [-0.6, -0.8] };
/** on-screen height of a standing figure in metres: a 1.8 m man as the 50° camera sees him, a touch
 *  larger than life (1.1x), so every house, wall and tree stands taller than the soldiers and infected */
const HUMAN_M = 1.45;
/** far out, figures keep at least MIN_PX, but never more than a single-storey wall (FLOOR_M) */
const MIN_PX = 12, FLOOR_M = 1.85;
const TINTS: Record<string, string> = { bloater: "rgba(150,175,40,0.42)", brute: "rgba(30,18,12,0.38)", screamer: "rgba(235,215,225,0.30)", mutant: "rgba(150,25,20,0.36)" };
const KNEEL = new Set(["line", "defensive", "circle", "box"]);
/** dying frames per second; shot frame and recoil frame lengths (s); aim kept after a target drops (s) */
const DIE_FPS = 10, SHOT_S = 0.06, RECOIL_S = 0.08, AIM_HOLD_S = 0.8;
/** breathing clip frames per second (soldier sheets with an idle clip of several frames) */
const IDLE_FPS = 6;
/** weapons firing faster than this (s between rounds) hold the shot frame through a burst: carbine,
 * SMG, special-forces rifle, machine gun, flamethrower. Slower ones kick back on every round. */
const AUTO_S = 0.25;
export type SoldierState = "idle" | "walk" | "fire";
/** animation state of one figure: displayed view, cycle phase, measured movement, last shot / hit */
interface Anim { dir: number; nv: number; po: number; prevDir: number; dirT: number; wantT: number; aimA: number; aimT: number; phase: number; lx: number; ly: number; lt: number; spd: number; vx: number; vy: number; shotT: number; shotN: number; state: SoldierState; stateT: number; atk: number; hitT: number; flip: boolean; mt: number; run: boolean; inst: number }
/** the last pose an infected was drawn in (its fall starts from it) */
interface LastPose { anim: string; i: number; flip: boolean; size: number; wide: number; tint: string; sheet: "Z" | "ZS"; view: Dir8 }
/** metres covered by one loop of each infected clip (the loop advances with distance: no sliding) */
const LOOP_M: Record<string, number> = { walk_SW: 1.6, walk_SW2: 1.3, walk_E: 1.0, hunch_E: 1.0, run_E: 2.6, run_E2: 2.0, run_E3: 1.6, charge_E: 2.8, crawl_E: 0.7 };
/** walking clips are set for a walking pace (m/s); faster, the stride lengthens (a runner using a walk
 * clip in a view that has no run art takes longer steps, not a frantic shuffle) */
const WALK_PACE = 1.7;
const strideK = (spd: number) => (spd > WALK_PACE ? Math.pow(spd / WALK_PACE, 0.85) : 1);
/** turned soldier: the walk clip ramps from standing to a long stride; slow and fast step cycles */
const ZS_SLOW = [0, 1, 2, 3, 2, 1], ZS_FAST = [1, 2, 3, 4, 3, 2], ZS_LOOP_M = 1.4;
const FALL_S = 0.45;   // infected fall: standing pose tips over and gives way to the lying frame
export interface SoldierPose { state: SoldierState; anim: string; i: number; bob: number; dir: string; flash: boolean; sy: number }

export class Sprites {
  mil: Sheet | null = null; zs: Sheet | null = null; zombies: Sheet | null = null; fx: Sheet | null = null;
  zready = false;
  anim = new Map<number, Anim>();
  /** view each fallen soldier dies in (fixed at the moment of death) */
  deathDir = new Map<number, string>();
  /** last pose of each infected (its fall starts from it) */
  lastPose = new Map<number, LastPose>();
  private pruneT = -99;
  occl = new Map<number, { t: number; v: boolean }>();
  /** recent muzzle flashes drawn (for tests): soldier, game time, offset from the feet in figure heights, view */
  flashes: { id: number; t: number; x: number; y: number; dir: string }[] = [];
  /** each soldier's barrel tip (shot frame of the view he is shown in), from his feet in map metres,
   * so that tracers leave the rifle as drawn; t = game time it was measured */
  muzzleOff = new Map<number, { t: number; dx: number; dy: number; dz: number }>();
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
    [this.mil, this.zs, this.zombies, this.fx] = await Promise.all([get("soldier16"), get("infected_soldier8"), get("zombies"), get("effects")]);
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
  /** where a soldier's bullets leave his rifle (map x, y, z), as last drawn; null when not drawn lately */
  muzzleOf(g: Game, id: number): [number, number, number] | null {
    const o = this.muzzleOff.get(id), u = o ? (g.get(id) as Unit | null) : null;
    if (!o || !u || !u.alive || g.time - o.t > 0.5) return null;
    return [u.x + o.dx, u.y + o.dy, u.z + o.dz];
  }

  /** one of eight screen directions */
  dir8(cam: IsoCamera, heading: number): Dir8 {
    const [sx, sy] = this.facing(cam, heading);
    return SECT8[((Math.round(Math.atan2(sy, sx) / (Math.PI / 4)) % 8) + 8) % 8];
  }
  /** the soldier sheet's views, clockwise from N */
  private views(): string[] { return (this.mil && this.mil.atlas.views) || COMPASS; }
  /** nearest of `views` (evenly spaced, clockwise from N) for a map heading */
  private viewOf(cam: IsoCamera, heading: number, views: string[]): string {
    const n = views.length;
    return views[Math.round(this.compassDeg(cam, heading) / (360 / n)) % n];
  }
  /** compass angle on screen: 0 = away from the viewer (N), clockwise */
  private compassDeg(cam: IsoCamera, heading: number) {
    const [sx, sy] = this.facing(cam, heading);
    return (90 - (Math.atan2(sy, sx) * 180) / Math.PI + 360) % 360;
  }
  /**
   * Displayed view: hysteresis, settle time, one view at a time, no undoing a turn straight away.
   * `aim` (firing): the view follows the rifle (Unit.aimH, a smooth logic angle) with a tighter hold, a
   * view per frame and no delays, so the figure keeps up with the rifle coming round (faster than the
   * 400°/s aim turn) and faces where it fires.
   */
  private turnTo(st: Anim, cam: IsoCamera, heading: number, now: number, settle: number, aim = false) {
    const step = 360 / st.nv, deg = this.compassDeg(cam, heading), prev = st.po;
    st.po = deg;
    const off = (((deg - st.dir * step + 540) % 360) - 180);
    const hold = step * (aim ? 0.62 : 0.678);  // half a view and a margin (30.5° of 45°; 14° of 22.5° when aiming)
    if (Math.abs(off) <= hold) { st.wantT = -1; return; }
    if (aim) {
      if (now <= st.dirT) return;           // one view per frame
      // the rifle is already swinging back toward this view: stay (no step out and straight back)
      if (!isNaN(prev) && Math.abs(off) < Math.abs(((prev - st.dir * step + 540) % 360) - 180) - 0.5) return;
      // going straight back to the view just left takes a clear swing of the rifle, not a wobble
      const back = (st.dir + (off > 0 ? 1 : -1) + st.nv) % st.nv;
      if (back === st.prevDir && now - st.dirT < 0.25 && Math.abs(off) < hold + 6) return;
      st.prevDir = st.dir; st.dir = (st.dir + (off > 0 ? 1 : -1) + st.nv) % st.nv; st.dirT = now;
      return;
    }
    const big = Math.abs(off) > step * 2;   // a real turn, not a wobble: follow it a view per frame
    if (st.wantT < 0) st.wantT = now;
    if (now - st.wantT < (big ? 0 : settle)) return;
    if (now - st.dirT < (big ? 0.02 : 0.06)) return;
    const next = (st.dir + (off > 0 ? 1 : -1) + st.nv) % st.nv;
    if (next === st.prevDir && now - st.dirT < 0.3) return;
    st.prevDir = st.dir; st.dir = next; st.dirT = now;
  }
  private stateOf(u: { id: number; x: number; y: number }, cam: IsoCamera, heading: number, now: number, nv = 8): Anim {
    let st = this.anim.get(u.id);
    if (st && st.nv !== nv) { st.dir = Math.round((st.dir * nv) / st.nv) % nv; st.prevDir = -1; st.nv = nv; }
    if (!st) {
      st = { dir: Math.round(this.compassDeg(cam, heading) / (360 / nv)) % nv, nv, po: NaN, prevDir: -1, dirT: -1, wantT: -1, aimA: heading, aimT: -9, phase: (u.id % 4) * 0.25, lx: u.x, ly: u.y, lt: now, spd: 0, vx: 0, vy: 0, shotT: -9, shotN: (u as Unit).shotN ?? 0, state: "idle", stateT: now, atk: 0, hitT: -9, flip: false, mt: -9, run: false, inst: 0 };
      this.anim.set(u.id, st);
    }
    return st;
  }
  /** measure movement since the last frame: distance covered (returned), smoothed velocity and speed */
  private track(st: Anim, x: number, y: number, now: number, speed?: number): number {
    const dt = now - st.lt;
    let moved = 0;
    if (dt > 0 && dt < 0.5) {
      moved = Math.min(1.5, Math.hypot(x - st.lx, y - st.ly));
      const k = Math.min(1, dt * 4);
      st.spd = st.spd * (1 - k) + (speed ?? moved / dt) * k;
      st.vx = st.vx * (1 - k) + ((x - st.lx) / dt) * k; st.vy = st.vy * (1 - k) + ((y - st.ly) / dt) * k;
      if (moved / dt > 0.3) st.mt = now;
      st.inst = moved / dt;
    }
    st.lx = x; st.ly = y; st.lt = now;
    return moved;
  }
  /** moved within the last 0.15 s: walking (a figure that stops stands at once, not mid-step) */
  private going(st: Anim, now: number) { return now - st.mt < 0.15;
  }
  /**
   * Soldier animation state, by priority firing > walking > idle (dying is drawn from the corpse).
   * `now` is the render clock; movement is measured from the soldier's real position change.
   */
  soldierPose(g: Game, u: Unit, cam: IsoCamera, now: number, human: number): SoldierPose {
    const tgt = g.get(u.target);
    const engaging = !!tgt && !tgt.dead && u.losOk && (u.mag > 0 || u.reserve > 0);
    const V = this.views();
    const st = this.stateOf(u, cam, u.heading, now, V.length);
    const unseen = now - st.lt > 0.25;      // not drawn lately (off screen): no turn to watch
    // ground speed and velocity (smoothed) and distance covered since the last frame
    const moved = this.track(st, u.x, u.y, now, u.moving ? u.speedNow : 0);
    // a shot: the weapon's firing event counts it. The shot frame and flash start on the first frame
    // drawn after it, so no shot is missed at a low frame rate, and nothing is shown without one
    if (u.shotN !== st.shotN) { st.shotN = u.shotN; st.shotT = now; }
    const sinceShot = now - st.shotT;
    const moving = u.moving && st.spd > 0.3;
    // ---- state by priority
    // the view follows the rifle (Unit.aimH), which comes round to the target before the first shot
    if (engaging) { st.aimA = isNaN(u.aimH) ? Math.atan2(tgt.y - u.y, tgt.x - u.x) : u.aimH; st.aimT = now; }
    const aiming = engaging || sinceShot < SHOT_S + RECOIL_S || (now - st.aimT < AIM_HOLD_S && (!moving || canFireWhileMoving(u)));
    // moving and shooting is part of the game for most weapons: those soldiers keep the firing stance
    const firing = aiming && (!moving || canFireWhileMoving(u) || sinceShot < SHOT_S + RECOIL_S);
    const state: SoldierState = firing ? "fire" : moving ? "walk" : "idle";
    if (state !== st.state) {
      if (state === "walk") st.phase = 0;   // a walk starts with a step (stride frame), not mid-cycle
      st.state = state; st.stateT = now;
    }
    // ---- view: the rifle toward the target when firing; walking, the way he really goes (his heading
    // can lag behind or stay on a target he cannot shoot on the move); otherwise the way he faces
    const going = Math.hypot(st.vx, st.vy) > 0.8 ? Math.atan2(st.vy, st.vx) : u.heading;
    // the figure faces where his rifle points (Unit.aimH): the target when firing, otherwise the way he
    // walks or his heading, swinging round smoothly. Shown this way, he turns before the first shot and
    // the view never has to catch up with a rifle pointing elsewhere.
    const faceA = !isNaN(u.aimH) ? u.aimH : firing ? st.aimA : state === "walk" ? going : u.heading;
    if (unseen) { st.dir = Math.round(this.compassDeg(cam, faceA) / (360 / st.nv)) % st.nv; st.prevDir = -1; st.wantT = -1; }
    else this.turnTo(st, cam, faceA, now, firing ? 0.03 : moving ? 0.12 : 0.25, firing);
    const d = V[st.dir];
    if (state === "fire") {
      // shot, recoil, aim. Automatic weapons would cycle these several times a second (shaking): during
      // a burst the rifle stays shouldered on the shot frame (the flash still marks every round) and
      // the recoil frame comes once, when the burst ends.
      const iv = u.weapon ? u.weapon.interval : 1;
      const auto = iv < AUTO_S;
      const i = sinceShot < SHOT_S || (auto && sinceShot < iv * 1.6) ? 1 : sinceShot < (auto ? iv * 1.6 : SHOT_S) + RECOIL_S ? 2 : 0;
      return { state, anim: "fire_" + d, i, bob: 0, dir: d, flash: sinceShot < SHOT_S && u.wid !== "flamer", sy: 1 };
    }
    if (state === "walk") {
      // stride lengthens with speed (2 steps = 1.4 m + 0.25 m per m/s; 2.3 m at 3.6 m/s): no foot sliding
      const cycle = 1.4 + 0.25 * Math.max(0, st.spd);
      st.phase += moved / cycle;
      const n = this.mil!.atlas.anims["walk_" + d].length;
      return { state, anim: "walk_" + d, i: Math.floor(st.phase * n) % n, bob: 0, dir: d, flash: false, sy: 1 };
    }
    // idle: at the ready in line/box/circle/defensive positions and when holding; otherwise at ease, breathing
    const sq = u.order.kind === "formation" ? squadOf(g, u) : null;
    const ready = u.reloadT <= 0 && (u.order.kind === "hold" || u.order.kind === "defend" || (!!sq && sq.halted && KNEEL.has(sq.formation)));
    if (ready) return { state, anim: "fire_" + d, i: 0, bob: 0, dir: d, flash: false, sy: 1 };
    // breathing: the idle clip loops (each soldier at his own phase); a one-frame idle stretches a
    // little from the feet instead (they stay on the ground)
    const ph = (u.id % 7) * 0.9;
    const ni = this.mil!.atlas.anims["idle_" + d].length;
    if (ni > 1) return { state, anim: "idle_" + d, i: Math.floor((now + ph) * IDLE_FPS) % ni, bob: 0, dir: d, flash: false, sy: 1 };
    return { state, anim: "idle_" + d, i: 0, bob: 0, dir: d, flash: false, sy: 1 + Math.sin((now + ph) * 2.1) * 0.006 };
  }
  /** a military survivor (drawn as a soldier): the soldier's walk cycle while moving, standing otherwise */
  civPose(c: Civilian, cam: IsoCamera, now: number): { anim: string; i: number } {
    const V = this.views();
    const st = this.stateOf(c, cam, c.heading, now, V.length);
    const moved = this.track(st, c.x, c.y, now);
    const moving = this.going(st, now);
    this.turnTo(st, cam, moving && Math.hypot(st.vx, st.vy) > 0.3 ? Math.atan2(st.vy, st.vx) : c.heading, now, moving ? 0.12 : 0.25);
    const d = V[st.dir];
    if (!moving) { const ni = this.mil!.atlas.anims["idle_" + d].length; return { anim: "idle_" + d, i: ni > 1 ? Math.floor((now + (c.id % 7) * 0.9) * IDLE_FPS) % ni : 0 }; }
    st.phase += moved / (1.4 + 0.25 * st.spd);
    const n = this.mil!.atlas.anims["walk_" + d].length;
    return { anim: "walk_" + d, i: Math.floor(st.phase * n) % n };
  }
  /** forget the animation state of figures that are gone (every few seconds) */
  private prune(g: Game, now: number) {
    if (now - this.pruneT < 3) return;
    this.pruneT = now;
    const keep = new Set<number>();
    for (const u of g.units) if (u.alive) keep.add(u.id);
    for (const z of g.zombies) if (!z.dead) keep.add(z.id);
    for (const c of g.civs) if (!c.dead) keep.add(c.id);
    for (const c of g.corpses) if (c.uid !== undefined && g.time - c.t < 3) keep.add(c.uid);
    for (const m of [this.anim, this.lastPose, this.occl, this.muzzleOff] as Map<number, unknown>[]) for (const id of m.keys()) if (!keep.has(id)) m.delete(id);
  }
  /**
   * A soldier who turned (8-direction infected soldier sheet). Faces the way he really moves (or his
   * victim), turns one view at a time; the step cycle advances with distance; the grab lands on the
   * frame of the real hit.
   */
  zpose8(g: Game, z: Zombie, cam: IsoCamera, now: number): { anim: string; i: number; view: Dir8 } {
    const st = this.stateOf(z, cam, z.heading, now);
    const moved = this.track(st, z.x, z.y, now);
    const t = g.get(z.target);
    const hit = this.hitEvent(st, z, now);
    const attacking = z.state === "attack" && !!t && !t.dead;
    const moving = this.going(st, now) && !attacking;
    const face = attacking ? Math.atan2(t!.y - z.y, t!.x - z.x) : moving && Math.hypot(st.vx, st.vy) > 0.3 ? Math.atan2(st.vy, st.vx) : z.heading;
    this.turnTo(st, cam, face, now, attacking || moving ? 0.15 : 0.3);
    const d = COMPASS[st.dir];
    if (attacking || now - st.hitT < 0.4) return { anim: "z_attack_" + d, i: this.attackFrame(st, z, now, 2, hit), view: d };
    if (moving) {
      st.phase += moved / ZS_LOOP_M;
      const cyc = st.spd > 1.3 ? ZS_FAST : ZS_SLOW;
      return { anim: "z_walk_" + d, i: cyc[Math.floor(st.phase * cyc.length) % cyc.length], view: d };
    }
    return { anim: "z_walk_" + d, i: 0, view: d };
  }
  /** a hit landed since the last frame? (the infected's attack timer restarts on each hit) */
  private hitEvent(st: Anim, z: Zombie, now: number): boolean {
    const hit = z.attackT > st.atk + 0.05;
    st.atk = z.attackT;
    if (hit) st.hitT = now;
    return hit;
  }
  /**
   * Attack frame, for a clip ordered from the ready pose to the full reach: the full reach on the hit,
   * back to ready over 0.3 s, held, then the wind-up over the last 0.35 s before the next hit is due.
   */
  private attackFrame(st: Anim, z: Zombie, now: number, n: number, _hit: boolean): number {
    const since = now - st.hitT;
    if (since < 0.12) return n - 1;
    if (since < 0.42) return Math.max(0, Math.round((n - 1) * (1 - (since - 0.12) / 0.3)));
    if (z.attackT < 0.35) return Math.min(n - 2, Math.floor((1 - Math.max(0, z.attackT) / 0.35) * (n - 1)));
    return 0;
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
  private blit(ctx: CanvasRenderingContext2D, src: CanvasImageSource, sh: Sheet, f: Frame, sx: number, sy: number, h: number, flip: boolean, wide = 1, tall = 1) {
    const k = (h / sh.atlas.ref) * (f.k || 1), kx = k * wide, ky = k * tall;   // `tall` scales from the feet
    const w = f.w * kx, hh = f.h * ky;
    if (flip) {
      ctx.save(); ctx.translate(sx, 0); ctx.scale(-1, 1);
      ctx.drawImage(src, f.x, f.y, f.w, f.h, -f.ax * kx, sy - f.ay * ky, w, hh);
      ctx.restore();
    } else ctx.drawImage(src, f.x, f.y, f.w, f.h, sx - f.ax * kx, sy - f.ay * ky, w, hh);
  }
  /**
   * A standing frame tipping over about its feet (angle in radians, + = falling to screen-right). The
   * feet slide back as it goes, so that the body ends lying where the lying frame (centred on the
   * same spot) takes over: one body, not two.
   */
  private blitFall(ctx: CanvasRenderingContext2D, src: CanvasImageSource, sh: Sheet, f: Frame, sx: number, sy: number, h: number, flip: boolean, wide: number, ang: number) {
    ctx.save(); ctx.translate(sx - Math.sin(ang) * h * 0.45, sy); ctx.rotate(ang);
    this.blit(ctx, src, sh, f, 0, 0, h, flip, wide);
    ctx.restore();
  }
  /** screen-space direction of a map heading: x>0 screen-right, y>0 up-screen (away from the viewer) */
  facing(cam: IsoCamera, heading: number): [number, number] {
    const fx = Math.cos(heading), fy = Math.sin(heading);
    const [rx, ry] = cam.right, [ux, uy] = cam.forward;
    return [fx * rx + fy * ry, fx * ux + fy * uy];
  }
  /**
   * Infected pose. The sheet has these views: facing the viewer at three-quarters to the left
   * (walk_SW*), side on to the right (walk_E, hunch_E, run_*, charge_E, crawl_E) and from behind
   * (back_N). Eight screen views are steadied as for soldiers, then drawn with the nearest view:
   * S and SW the three-quarter clip, SE that clip mirrored, E and NE the side clip, W and NW mirrored,
   * N from behind (alternately mirrored, which swaps the legs, one step at a time).
   * Moving: the loop advances with the distance covered. Standing: one fixed frame (the frames of a
   * row are different people) with slow breathing. Attacking: ready, wind-up, full reach on the hit.
   */
  zpose(g: Game, z: Zombie, cam: IsoCamera, now: number): { anim: string; i: number; flip: boolean; bob: number; sy: number; view: Dir8 } {
    const st = this.stateOf(z, cam, z.heading, now);
    const moved = this.track(st, z.x, z.y, now);
    const t = g.get(z.target);
    const hit = this.hitEvent(st, z, now);
    const attacking = (z.state === "attack" && !!t && !t.dead) || now - st.hitT < 0.4;
    const moving = this.going(st, now) && !attacking;
    const face = attacking && t ? Math.atan2(t.y - z.y, t.x - z.x) : moving && Math.hypot(st.vx, st.vy) > 0.2 ? Math.atan2(st.vy, st.vx) : z.heading;
    this.turnTo(st, cam, face, now, attacking || moving ? 0.15 : 0.3);
    const d = COMPASS[st.dir];
    const side = d === "E" || d === "NE" || d === "W" || d === "NW";
    const left = d === "W" || d === "NW" || d === "SE";   // drawn mirrored
    const rig = z.id % 2;
    const out = (anim: string, i: number, flip = left, sy = 1) => ({ anim, i, flip, bob: 0, sy, view: d });
    // a mutant's leap: the body flies, the legs hold their pose (no leg flurry at 3x speed)
    const leaping = !!z.def.leap && z.leapT > 3.6;
    const advance = (anim: string) => {
      const run = /^(run|charge)/.test(anim);   // run clips are drawn for running speed already
      if (!leaping) st.phase += moved / ((LOOP_M[anim] || 1.2) * (run ? 1 : strideK(st.inst)));
      return Math.floor(st.phase * this.zombies!.atlas.anims[anim].length);
    };
    if (z.type === "crawler") {
      if (attacking) {          // no attack frames: the crawl frames from the least to the most outstretched arm
        const [sx] = t ? this.facing(cam, Math.atan2(t.y - z.y, t.x - z.x)) : [left ? -1 : 1];
        if (Math.abs(sx) > 0.15) st.flip = sx < 0;
        return out("crawl_attack_E", this.attackFrame(st, z, now, this.zombies!.atlas.anims.crawl_attack_E.length, hit), st.flip);
      }
      if (side || d === "SW" || d === "SE") st.flip = left; // facing views; N and S keep the last side
      return out("crawl_E", moving ? advance("crawl_E") : 0, st.flip);
    }
    if (attacking) {
      const fast = z.def.run > 3;
      const anim = fast ? "attack_E" : rig ? "claw_E" : "lunge_E";
      // the attack frames are side views: mirrored when the victim is to the left on screen
      const [sx] = t ? this.facing(cam, Math.atan2(t.y - z.y, t.x - z.x)) : [left ? -1 : 1];
      if (Math.abs(sx) > 0.15) st.flip = sx < 0;
      return out(anim, this.attackFrame(st, z, now, this.zombies!.atlas.anims[anim].length, hit), st.flip);
    }
    if (!moving) {
      const sy = 1 + Math.sin(now * 1.6 + z.id * 1.7) * 0.012;      // breathing (scaled from the feet: they stay put)
      if (d === "N" || d === "NE" || d === "NW") return out("back_N", z.id % 2, z.id % 3 === 0, sy);
      if (side) return out(rig ? "stand_E2" : "stand_E", 0, left, sy);   // the narrowest stance of that walk
      return out(z.id % 3 ? "idle_S" : "idle_S2", z.id % 6, false, sy);
    }
    if (d === "N") {
      if (!leaping) st.phase += moved / (0.55 * strideK(st.inst));    // one step every 0.55 m (longer when running)
      return out("back_N", z.id % 2, Math.floor(st.phase) % 2 === 1);
    }
    // run clips above 2.6 m/s, walk clips below 2.2: a margin so a pace near the switch doesn't flip clips
    if (st.spd > 2.6) st.run = true; else if (st.spd < 2.2) st.run = false;
    const run = st.run;
    if (side) {
      const anim = z.type === "mutant" && run ? "charge_E" : run ? ["run_E", "run_E2", "run_E3"][z.id % 3] : rig ? "hunch_E" : "walk_E";
      return out(anim, advance(anim));
    }
    const anim = rig ? "walk_SW2" : "walk_SW";
    return out(anim, advance(anim));
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
    const human = Math.max(ppm * HUMAN_M, Math.min(MIN_PX, ppm * FLOOR_M));
    const on = (s: [number, number] | null, pad = 80) => !!s && s[0] > -pad && s[1] > -pad && s[0] < W + pad && s[1] < H + pad;
    ctx.imageSmoothingEnabled = human < 90;
    const M = this.mil, Z = this.zombies, ZS = this.zs, FX = this.fx;
    this.prune(g, now);
    // ---- bodies (piles stack because each corpse lies on top of the ones already there)
    const bodies: { y: number; d: () => void }[] = [];
    for (const c of g.corpses) {
      if (!this.coversCorpse(c)) continue;
      const s = bf.screen(c.x, c.y, c.z);
      if (!on(s)) continue;
      if (c.soldier && ZS) {
        // the fall plays once (6 fps, game time) in the view he was last shown in; the last frame stays
        const lp = c.uid !== undefined ? this.lastPose.get(c.uid) : undefined;
        const view = lp ? lp.view : this.dir8(cam, c.rot);
        const f = this.frame(ZS, "z_die_" + view, Math.min(2, Math.max(0, g.time - c.t) * 6));
        if (f) bodies.push({ y: s![1], d: () => this.blit(ctx, ZS.img, ZS, f, s![0], s![1], human, false) });
      } else if ((c.kind === "soldier" || c.sprite) && M) {
        // dying: the fall plays once from the moment of death, in the view he was last shown in, and
        // its last frame stays (game time, so a pause holds it)
        const p = this.dyingPose(g, c, cam);
        const f = this.frame(M, p.anim, p.i);
        if (f) bodies.push({ y: s![1], d: () => this.blit(ctx, M.img, M, f, s![0], s![1], human, false) });
      } else if (Z) {
        // the infected sheet has no falling frames: the last standing pose tips over and gives way to a
        // lying frame (facing the same side) within FALL_S
        const lp = c.uid !== undefined ? this.lastPose.get(c.uid) : undefined;
        const flip = lp ? lp.flip : !!c.flip;
        const f = this.frame(Z, "dead", (c.id || 0) % 2);
        const tint = TINTS[c.kind || ""] ? this.tinted(Z, c.kind!) : Z.img;
        const size = human * Math.min(1.5, c.s || 1), wide = c.kind === "bloater" ? 1.2 : 1;
        const age = Math.max(0, g.time - c.t);
        const lf = lp && age < FALL_S ? this.frame(Z, lp.anim, lp.i) : null;
        if (f) bodies.push({ y: s![1], d: () => {
          if (lf && lp) {
            const p = age / FALL_S;
            ctx.globalAlpha = 0.92 * (1 - Math.max(0, (p - 0.75) / 0.25));
            this.blitFall(ctx, lp.tint === "" ? Z.img : this.tinted(Z, lp.tint), Z, lf, s![0], s![1], lp.size, lp.flip, lp.wide, (lp.flip ? 1 : -1) * p * p * 1.5);
            ctx.globalAlpha = 0.92 * Math.min(1, Math.max(0, (p - 0.7) / 0.3));
          }
          this.blit(ctx, tint, Z, f, s![0], s![1], size, flip, wide);
          ctx.globalAlpha = 0.92;
        } });
      }
    }
    bodies.sort((a, b) => a.y - b.y);
    ctx.globalAlpha = 0.92;
    for (const b of bodies) b.d();
    ctx.globalAlpha = 1;
    // ---- standing figures, back to front
    const list: { y: number; d: () => void }[] = [];
    const flashes: (() => void)[] = [];
    // screen offsets back to map metres (the view is orthographic): 1 m to the camera's right and 1 m up
    const c0 = bf.screen(cam.x, cam.y, cam.z), cR = bf.screen(cam.x + cam.right[0], cam.y + cam.right[1], cam.z), cU = bf.screen(cam.x, cam.y, cam.z + 1);
    const e1 = c0 && cR ? [cR[0] - c0[0], cR[1] - c0[1]] : null, e2 = c0 && cU ? [cU[0] - c0[0], cU[1] - c0[1]] : null;
    const det = e1 && e2 ? e1[0] * e2[1] - e1[1] * e2[0] : 0;
    if (M) for (const u of g.units) {
      if (!u.alive || u.vehicle || u.inVehicle !== null) continue;
      const s = bf.screen(u.x, u.y, u.z);
      if (!on(s)) continue;
      const p = this.soldierPose(g, u, cam, now, human);
      const f = this.frame(M, p.anim, p.i);
      if (!f) continue;
      // where his bullets leave the rifle: the barrel tip of the shot frame in this view
      const fs = this.frame(M, "fire_" + p.dir, 1);
      if (fs && fs.mx !== undefined && fs.my !== undefined && Math.abs(det) > 1e-6) {
        const k = (human / M.atlas.ref) * (fs.k || 1), tx = (fs.mx - fs.ax) * k, ty = (fs.my - fs.ay) * k;
        const a = (tx * e2![1] - ty * e2![0]) / det, b = (e1![0] * ty - e1![1] * tx) / det;
        this.muzzleOff.set(u.id, { t: g.time, dx: a * cam.right[0], dy: a * cam.right[1], dz: b });
      }
      const occ = this.occluded(bf, cam, u.id, u.x, u.y, u.z, now);
      list.push({ y: s![1], d: () => {
        ctx.globalAlpha = occ ? 0.45 : 1;
        if (u.hitT > 0) ctx.filter = "brightness(1.8)";
        this.blit(ctx, M.img, M, f, s![0], s![1], human, false, 1, p.sy);
        ctx.filter = "none";
      } });
      if (p.flash && f.mx !== undefined && f.my !== undefined) {
        // the barrel tip of this very frame, through the same anchor and scale as the figure
        const k = (human / M.atlas.ref) * (f.k || 1);
        const mx = s![0] + (f.mx - f.ax) * k, my = s![1] + (f.my - f.ay) * k;
        flashes.push(() => { ctx.globalAlpha = occ ? 0.45 : 1; this.muzzleFlash(ctx, mx, my, f, p.dir, human, u.shotN); });
        this.flashes.push({ id: u.id, t: g.time, x: ((f.mx - f.ax) * (f.k || 1)) / M.atlas.ref, y: ((f.my - f.ay) * (f.k || 1)) / M.atlas.ref, dir: p.dir });
        if (this.flashes.length > 400) this.flashes.splice(0, 200);
      }
    }
    if (M) for (const c of g.civs as Civilian[]) {
      if (!c.military || c.dead || c.state === "gone") continue;
      const s = bf.screen(c.x, c.y, c.z);
      if (!on(s)) continue;
      const p = this.civPose(c, cam, now);
      const f = this.frame(M, p.anim, p.i);
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
        this.lastPose.set(z.id, { anim: p.anim, i: p.i, flip: false, size: human, wide: 1, tint: "", sheet: "ZS", view: p.view });
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
      const hz = human * size * (z.type === "crawler" ? 1.15 : 1), wz = z.type === "bloater" ? 1.25 : 1;
      this.lastPose.set(z.id, { anim: p.anim, i: p.i, flip: p.flip, size: hz, wide: wz, tint: TINTS[z.type] ? z.type : "", sheet: "Z", view: p.view });
      const occ = this.occluded(bf, cam, z.id, z.x, z.y, z.z, now);
      list.push({ y: s![1], d: () => {
        ctx.globalAlpha = occ ? 0.4 : 1;
        if (z.hitT > 0) ctx.filter = "brightness(1.7)";
        else if (z.burnT > 0) ctx.filter = "sepia(1) saturate(3) hue-rotate(-20deg)";
        this.blit(ctx, src, sh, f, s![0], s![1] - p.bob, hz, p.flip, wz, p.sy);
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
  dyingPose(g: Game, c: Corpse, cam: IsoCamera): { anim: string; i: number; dir: string } {
    const d = this.dieDir(c, cam), anim = "die_" + d;
    const n = this.mil!.atlas.anims[anim].length;
    return { anim, i: Math.min(n - 1, Math.floor(Math.max(0, g.time - c.t) * DIE_FPS)), dir: d };
  }
  /** the view a fallen soldier dies in: the one he was shown in when he fell (fixed once) */
  private dieDir(c: Corpse, cam: IsoCamera): string {
    const key = c.id ?? -1;
    let d = this.deathDir.get(key);
    if (!d) {
      const V = this.views();
      const a = c.uid !== undefined ? this.anim.get(c.uid) : undefined;
      d = a && a.nv === V.length ? V[a.dir] : this.viewOf(cam, c.rot, V);
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
  private muzzleFlash(ctx: CanvasRenderingContext2D, x: number, y: number, f: Frame, d: string, human: number, seed: number) {
    // the barrel's direction on screen: from the frame (rendered sheets) or by view (drawn sheets)
    const [vx, vy] = f.md ? [f.md[0], f.md[1]] : RIFLE[d as Dir8] || [1, 0];
    const end = f.md ? f.md[2] < 0.45 : d === "S" || d === "N";   // rifle pointing at or away from the viewer: a short star
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

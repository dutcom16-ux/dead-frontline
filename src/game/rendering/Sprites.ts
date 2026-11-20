// Troop sprites from the supplied sprite sheet (public/sprites/troops.png + .json, sliced by
// tools/slice_sprites.py). The sheet has front-facing and right-facing art; left is the mirror of
// right. There is no back view, so soldiers moving away from the camera use the side view.
// Sprites are drawn on the 2D overlay, sorted by depth; soldiers hidden behind buildings are
// drawn faded so they stay visible.
import type { Game } from "../Game";
import type { IsoCamera } from "../camera/IsoCamera";
import type { Battlefield } from "../Battlefield";
import { Unit, Civilian, Corpse } from "../entities";

interface Frame { x: number; y: number; w: number; h: number; ax: number; ay: number }
interface Atlas { size: [number, number]; frames: Frame[]; anims: Record<string, number[]> }

const REF_H = 62;          // source pixel height of a standing soldier
const TROOP_M = 1.85 * 1.3; // drawn a little larger than life for readability
const MOVING_RUN: Record<string, boolean> = { move: true, retreat: true, follow: true, interact: true, board: true };

export class Sprites {
  img: HTMLImageElement | null = null;
  atlas: Atlas | null = null;
  ready = false;
  flip = new Map<number, boolean>();
  occl = new Map<number, { t: number; v: boolean }>();
  async load(base = "sprites/troops") {
    try {
      const [meta, img] = await Promise.all([
        fetch(base + ".json").then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.json(); }),
        new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = base + ".png"; }),
      ]);
      this.atlas = meta; this.img = img; this.ready = true;
    } catch (e) { this.ready = false; /* fall back to the 3D soldier models */ }
  }
  /** true for units the sprite sheet draws (all infantry) */
  covers(u: Unit) { return this.ready && !u.vehicle; }

  private frame(anim: string, i: number): Frame | null {
    const a = this.atlas!, ids = a.anims[anim];
    if (!ids || !ids.length) return null;
    return a.frames[ids[((i % ids.length) + ids.length) % ids.length]];
  }
  private blit(ctx: CanvasRenderingContext2D, f: Frame, sx: number, sy: number, scale: number, flip: boolean) {
    const w = f.w * scale, h = f.h * scale;
    if (flip) {
      ctx.save(); ctx.translate(sx, 0); ctx.scale(-1, 1);
      ctx.drawImage(this.img!, f.x, f.y, f.w, f.h, -f.ax * scale, sy - f.ay * scale, w, h);
      ctx.restore();
    } else ctx.drawImage(this.img!, f.x, f.y, f.w, f.h, sx - f.ax * scale, sy - f.ay * scale, w, h);
  }

  /** screen-space facing of a map heading: x>0 = screen right, y>0 = up-screen (away from the viewer) */
  facing(cam: IsoCamera, heading: number): [number, number] {
    const fx = Math.cos(heading), fy = Math.sin(heading);
    const [rx, ry] = cam.right, [ux, uy] = cam.forward;
    return [fx * rx + fy * ry, fx * ux + fy * uy];
  }
  /** pose and frame for a soldier from what it is doing */
  pose(g: Game, u: Unit, cam: IsoCamera, now: number): { anim: string; i: number; flip: boolean } {
    const [sx, sy] = this.facing(cam, u.heading);
    let flip = this.flip.get(u.id) ?? sx < 0;
    if (Math.abs(sx) > 0.2) flip = sx < 0;
    this.flip.set(u.id, flip);
    const ph = (u.id % 7) * 0.37;
    if (u.reloadT > 0 && u.weapon) {
      const p = 1 - u.reloadT / Math.max(0.1, u.weapon.reload);
      return { anim: "reload_front", i: Math.floor(Math.max(0, Math.min(0.999, p)) * 6), flip };
    }
    if (u.hitT > 0.05 && !u.moving) return { anim: "hurt_front", i: Math.floor((0.15 - u.hitT) * 30), flip };
    const tgt = g.get(u.target);
    if (tgt && !tgt.dead && u.losOk && (u.mag > 0 || u.reserve > 0)) {
      // aim at the target: side view toward it
      const [tx] = this.facing(cam, Math.atan2(tgt.y - u.y, tgt.x - u.x));
      const f = Math.abs(tx) > 0.05 ? tx < 0 : flip;
      this.flip.set(u.id, f);
      if (u.moving) return { anim: "walk_side", i: Math.floor((now + ph) * 9), flip: f };
      if (u.flashT > 0) return { anim: "fire_side", i: Math.floor(now * 30), flip: f };
      return { anim: "aim_side", i: Math.floor((now + ph) * 2), flip: f };
    }
    if (u.moving) {
      const run = MOVING_RUN[u.order.kind] || u.speedNow > 3.9;
      const side = Math.abs(sx) > 0.42 || sy > 0; // moving away: no back view, use the side view
      const anim = (run ? "run_" : "walk_") + (side ? "side" : "front");
      return { anim, i: Math.floor((now + ph) * (run ? 11 : 8)), flip };
    }
    if (u.order.kind === "hold" || u.order.kind === "defend") return { anim: "crouch_front", i: Math.floor((now + ph) * 3), flip };
    return { anim: "idle_front", i: Math.floor((now + ph) * 5), flip };
  }
  /** a building between the soldier and the camera? (cached ~4 times a second) */
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

  /** draw corpses, soldiers and combat effects on the overlay (before health bars and labels) */
  draw(ctx: CanvasRenderingContext2D, g: Game, bf: Battlefield, cam: IsoCamera, W: number, H: number, now: number) {
    if (!this.ready) return;
    const ppm = H / (2 * cam.zoom);
    const scale = Math.max(18 / REF_H, (ppm * TROOP_M) / REF_H);
    const on = (s: [number, number] | null, pad = 80) => !!s && s[0] > -pad && s[1] > -pad && s[0] < W + pad && s[1] < H + pad;
    ctx.imageSmoothingEnabled = scale < 1.6;
    // ---- fallen soldiers: death animation, then they stay down
    for (const c of g.corpses as (Corpse & { sprite?: boolean; flip?: boolean })[]) {
      if (!c.sprite) continue;
      const s = bf.screen(c.x, c.y, c.z);
      if (!on(s)) continue;
      const f = this.frame("die_front", Math.min(6, Math.floor((g.time - c.t) * 9)));
      if (!f) continue;
      ctx.globalAlpha = 0.9;
      this.blit(ctx, f, s![0], s![1], scale, !!c.flip);
    }
    ctx.globalAlpha = 1;
    // ---- soldiers (and soldiers among the survivors), back to front
    const list: { s: [number, number]; d: () => void }[] = [];
    for (const u of g.units) {
      if (!u.alive || u.vehicle || u.inVehicle !== null) continue;
      const s = bf.screen(u.x, u.y, u.z);
      if (!on(s)) continue;
      const p = this.pose(g, u, cam, now);
      const f = this.frame(p.anim, p.i);
      if (!f) continue;
      const occ = this.occluded(bf, cam, u.id, u.x, u.y, u.z, now);
      list.push({ s: s!, d: () => {
        ctx.globalAlpha = occ ? 0.45 : 1;
        if (u.hitT > 0) ctx.filter = "brightness(1.8)";
        this.blit(ctx, f, s![0], s![1], scale, p.flip);
        ctx.filter = "none";
      } });
    }
    for (const c of g.civs as Civilian[]) {
      if (!c.military || c.dead || c.state === "gone") continue;
      const s = bf.screen(c.x, c.y, c.z);
      if (!on(s)) continue;
      const f = this.frame("crouch_front", Math.floor(now * 3 + c.id));
      if (f) list.push({ s: s!, d: () => { ctx.globalAlpha = 0.85; this.blit(ctx, f, s![0], s![1], scale, false); } });
    }
    list.sort((a, b) => a.s[1] - b.s[1]);
    for (const it of list) it.d();
    ctx.globalAlpha = 1;
    // ---- combat effects from the sheet
    for (const e of g.effects) {
      let anim = "", size = 0, comp: GlobalCompositeOperation = "source-over", alpha = 1;
      const fr = e.t / e.life;
      if (e.kind === "blast") { anim = "explosion"; size = e.s * 2.6; }
      else if (e.kind === "smoke") { anim = "smoke"; size = e.s * 2.4 * (0.7 + fr * 0.6); alpha = 0.75 * (1 - fr); }
      else if (e.kind === "hit") { anim = "bloodhit"; size = 1.4; }
      else if (e.kind === "spark") { anim = "sparks"; size = 1.1; comp = "lighter"; }
      else continue;
      const ids = this.atlas!.anims[anim];
      if (!ids) continue;
      const f = this.atlas!.frames[ids[Math.min(ids.length - 1, Math.floor(fr * ids.length))]];
      const s = bf.screen(e.x, e.y, e.z + (e.kind === "smoke" ? fr * 4 : 0));
      if (!on(s, 200)) continue;
      const k = Math.max(12, size * ppm) / Math.max(f.w, f.h);
      ctx.globalAlpha = alpha; ctx.globalCompositeOperation = comp;
      ctx.drawImage(this.img!, f.x, f.y, f.w, f.h, s![0] - (f.w * k) / 2, s![1] - (f.h * k) / 2, f.w * k, f.h * k);
    }
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = "source-over";
  }
}
export { Unit };

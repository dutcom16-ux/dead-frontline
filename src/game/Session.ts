// One play session: campaign state, the running mission, fixed-step timing, save and load.
import { Battlefield } from "./Battlefield";
import { Game, Difficulty } from "./Game";
import { IsoCamera } from "./camera/IsoCamera";
import { Logistics } from "./logistics/Logistics";
import { Fob } from "./fob/Fob";
import { buildOp01, fobWave } from "./missions/op01";
import type { Mission } from "./missions/Mission";
import { CampaignState, newCampaign, completeOp } from "./campaign/Campaign";
import { Saves, Slot } from "./save/Saves";
import { Unit, Zombie, Civilian, Nest, Obstacle, Crate, setNextId } from "./entities";

export const STEP = 1 / 30;

export class Session {
  bf: Battlefield; saves: Saves;
  game: Game | null = null; mission: Mission | null = null; cam!: IsoCamera;
  campaign: CampaignState | null = null; slot: Slot = "auto";
  speed = 1; acc = 0; fobAt = -1; autosaveT = 0; ended = false;
  onGameCreated: (g: Game) => void = () => {};
  constructor(bf: Battlefield, saves: Saves) { this.bf = bf; this.saves = saves; }

  newCampaign(d: Difficulty) { this.campaign = newCampaign(d); this.slot = "auto"; return this.campaign; }

  /** set up Mission 01 (fresh, or from the campaign's saved snapshot) */
  startMission(snapshot: any | null = null) {
    const c = this.campaign!;
    this.teardown();
    const g = new Game(this.bf, snapshot ? snapshot.seed : Math.floor(Math.random() * 65535) + 1);
    g.difficulty = c.difficulty;
    g.logistics = new Logistics(g); g.fob = new Fob(g);
    for (const f of c.flags) g.logistics.campaignFlags.add(f);
    this.game = g;
    this.onGameCreated(g);
    const m = buildOp01(g, !snapshot);
    this.mission = m; g.mission = m;
    this.cam = new IsoCamera(this.bf.playBounds, m.lz[0], m.lz[1]);
    this.cam.zoom = this.cam.tzoom = 34;
    const ev = g.onEvent;
    g.onEvent = (e, d) => { ev(e, d); if (e === "fob_established") this.fobAt = g.time; };
    if (snapshot) this.restore(snapshot); else m.begin();
    this.cam.snap();
    this.ended = false; this.acc = 0; this.speed = 1;
    c.ops.op01 = c.ops.op01 === "complete" ? "complete" : "in_progress";
    if (c.territory.op01 === "red") c.territory.op01 = "yellow";
    return g;
  }
  tick(frameDt: number) {
    const g = this.game;
    if (!g || g.paused || this.ended) return 0;
    this.acc += Math.min(frameDt, 0.25) * this.speed;
    let n = 0;
    const t0 = performance.now();
    while (this.acc >= STEP && n < 12) {
      g.step(STEP); this.acc -= STEP; n++;
      if (performance.now() - t0 > 40) { this.acc = 0; break; }
    }
    const m = this.mission!;
    if (g.fob.established && !m.waveSpawned && this.fobAt >= 0 && g.time - this.fobAt > 75) fobWave(g, m);
    return n;
  }
  // ---------------------------------------------------------------- results
  debrief() {
    const g = this.game!, m = this.mission!;
    const ok = m.state === "complete";
    const objs = m.objectives.map((o) => ({ title: o.title, state: o.state, optional: !!o.optional }));
    const doneOpt = objs.filter((o) => o.optional && o.state === "done").length;
    let score = (ok ? 600 : 0) + g.stats.killed * 2 + g.stats.rescued * 40 - g.stats.lost * 60 - g.stats.civLost * 50 + doneOpt * 100 - Math.floor(g.time / 60) * 3;
    score = Math.max(0, score);
    const rating = !ok ? "Mission failed" : score > 1700 ? "Outstanding" : score > 1200 ? "Excellent" : score > 800 ? "Good" : "Completed";
    return { result: ok ? "victory" : "defeat", mission: m.name, time: g.time, stats: JSON.parse(JSON.stringify(g.stats)), objectives: objs, score, rating,
      survivors: g.units.filter((u) => u.alive).map((u) => ({ name: u.name, type: u.type, kills: u.kills, hp: Math.round(u.hp), max: u.maxHp })),
      fob: g.fob.site ? { ...g.fob.site, latlon: this.bf.map.latlon(g.fob.site.x, g.fob.site.y), facilities: g.fob.facilities.filter((f) => f.built >= 1 && f.type !== "perimeter").length } : null };
  }
  /** close out the mission into the campaign (victory or defeat) */
  async finish() {
    const c = this.campaign!, g = this.game!, m = this.mission!;
    this.ended = true;
    const d = this.debrief();
    c.totals.kills += g.stats.killed; c.totals.lost += g.stats.lost; c.totals.rescued += g.stats.rescued; c.totals.playTime += g.time;
    if (m.state === "complete") {
      completeOp(c, "op01");
      c.totals.missions++;
      c.territory.op01 = g.fob.established ? "blue" : "green";
      if (g.fob.site) { const ll = this.bf.map.latlon(g.fob.site.x, g.fob.site.y); c.fob = { op: "op01", ...g.fob.site, lat: ll[0], lon: ll[1], facilities: d.fob!.facilities }; }
      c.roster = g.units.filter((u) => u.alive && !u.vehicle).map((u) => ({ type: u.type, name: u.name, kills: u.kills, rank: u.rank }));
      if (!c.flags.includes("toledo_port")) c.flags.push("toledo_port");
    } else c.ops.op01 = "available";
    c.mission = null;
    c.lastDebrief = d;
    await this.saves.put("auto", c).catch(() => {});
    if (this.slot !== "auto") await this.saves.put(this.slot, c).catch(() => {});
    return d;
  }
  // ---------------------------------------------------------------- saving
  snapshot() {
    const g = this.game!, m = this.mission!;
    const r2 = (v: number) => Math.round(v * 100) / 100;
    const blds: any[] = [];
    for (const b of this.bf.map.buildings()) {
      if (b.fob) continue;
      if (b.door && (b.door.open || b.door.broken || b.door.hp < b.door.max) || b.hpNow !== undefined && b.hpNow < b.hpMax || b.collapsed)
        blds.push({ id: b.id, hp: b.hpNow, door: b.door ? { open: b.door.open, broken: b.door.broken, hp: b.door.hp } : null, c: !!b.collapsed });
    }
    return {
      version: 1, missionId: m.id, missionName: m.name, time: g.time, seed: g.rng.s, difficulty: g.difficulty,
      units: g.units.filter((u) => u.alive).map((u) => ({ id: u.id, t: u.type, n: u.name, x: r2(u.x), y: r2(u.y), h: r2(u.heading), hp: r2(u.hp), mag: u.mag, res: Math.round(u.reserve), k: u.kills, r: u.rank, mk: r2(u.medkits), iv: u.inVehicle, p: u.passengers, g: u.group,
        o: ["move", "attackMove", "retreat", "defend", "hold"].includes(u.order.kind) ? { kind: u.order.kind, x: u.order.x, y: u.order.y } : { kind: "idle" } })),
      zombies: g.zombies.filter((z) => !z.dead).map((z) => ({ t: z.type, x: r2(z.x), y: r2(z.y), hp: r2(z.hp), s: z.state === "attack" || z.state === "chase" ? "investigate" : z.state, gx: r2(z.goalX), gy: r2(z.goalY), z: z.zone, a: z.awake ? 1 : 0, b: z.def.boss ? 1 : 0 })),
      civs: g.civs.filter((c) => !c.dead && c.state !== "gone").map((c) => ({ x: r2(c.x), y: r2(c.y), o: c.objective, m: c.military, s: c.state === "evac" ? "following" : c.state })),
      nests: g.nests.filter((n) => !n.dead).map((n) => ({ x: r2(n.x), y: r2(n.y), hp: r2(n.hp), z: n.zone, s: n.size })),
      obstacles: g.obstacles.filter((o) => !o.dead && !o.fob).map((o) => ({ k: o.kind, x: r2(o.x), y: r2(o.y), r: r2(o.rot), hp: r2(o.hp), b: o.built })),
      crates: g.crates.filter((c) => !c.dead).map((c) => ({ x: r2(c.x), y: r2(c.y), a: c.ammo, m: c.medical, h: c.heal, d: c.deploy, e: c.engineering, l: c.label })),
      corpses: g.corpses.slice(-150).map((c) => ({ ...c, t: c.t - g.time })),
      stats: g.stats, radio: g.radioLog.slice(-25).map((r) => ({ ...r, t: r.t - g.time })), usedNames: [...g.usedNames],
      logistics: g.logistics.serialize(), fob: g.fob.serialize(), mission: m.serialize(), fobAt: this.fobAt >= 0 ? this.fobAt - g.time : null,
      cam: { x: r2(this.cam.tx), y: r2(this.cam.ty), zoom: r2(this.cam.tzoom), yaw: r2(this.cam.tyaw) }, buildings: blds, speed: this.speed,
    };
  }
  restore(s: any) {
    const g = this.game!, m = this.mission!;
    g.time = s.time; g.rng.s = s.seed; g.difficulty = s.difficulty;
    g.stats = { ...g.stats, ...s.stats };
    for (const n of s.usedNames || []) g.usedNames.add(n);
    const idMap = new Map<number, Unit>();
    for (const q of s.units) {
      const u = new Unit(q.t, q.x, q.y, q.n);
      u.heading = q.h; u.hp = q.hp; u.mag = q.mag; u.reserve = q.res; u.kills = q.k; u.rank = q.r; u.medkits = q.mk; u.group = q.g || 0;
      u.z = this.bf.h(u.x, u.y);
      g.units.push(u); g.byId.set(u.id, u); idMap.set(q.id, u);
      if (q.o && (q.o.kind === "hold" || q.o.kind === "defend")) { u.order = { kind: q.o.kind }; u.defendAt = [u.x, u.y]; }
    }
    for (const q of s.units) {
      const u = idMap.get(q.id)!;
      if (q.iv != null && idMap.get(q.iv)) u.inVehicle = idMap.get(q.iv)!.id;
      u.passengers = (q.p || []).map((pid: number) => idMap.get(pid)?.id).filter((v: any) => v != null);
      if (q.o && ["move", "attackMove", "retreat"].includes(q.o.kind) && q.o.x != null) { u.order = { kind: q.o.kind, x: q.o.x, y: q.o.y }; g.paths.request(u, q.o.x, q.o.y); u.pathGoal = [q.o.x, q.o.y]; }
    }
    for (const q of s.zombies) {
      const z = new Zombie(q.t, q.x, q.y);
      z.hp = q.hp; z.state = q.s; z.goalX = q.gx; z.goalY = q.gy; z.zone = q.z; z.awake = !!q.a; z.z = this.bf.h(z.x, z.y);
      const k = g.difficulty === "low" ? 0.85 : g.difficulty === "high" ? 1.2 : 1; z.maxHp = Math.round(z.def.hp * k);
      g.zombies.push(z); g.byId.set(z.id, z);
      if (q.b) g.bossId = z.id;
    }
    for (const q of s.civs) { const c = new Civilian(q.x, q.y, q.o, q.m); c.state = q.s; c.z = this.bf.h(c.x, c.y); g.civs.push(c); g.byId.set(c.id, c); }
    for (const q of s.nests) { const n = new Nest(q.x, q.y, q.z); n.size = q.s; n.maxHp = Math.round(1600 * q.s); n.hp = q.hp; n.z = this.bf.h(n.x, n.y); g.nests.push(n); g.byId.set(n.id, n); }
    for (const q of s.obstacles) { const o = g.addObstacle(q.k, q.x, q.y, q.r, q.b); o.hp = q.hp; }
    for (const q of s.crates) { const c = new Crate(q.x, q.y, q.l); c.ammo = q.a; c.medical = q.m; c.heal = q.h; c.deploy = q.d; c.engineering = q.e; c.z = this.bf.h(c.x, c.y); g.crates.push(c); g.byId.set(c.id, c); }
    g.corpses = (s.corpses || []).map((c: any) => ({ ...c, t: g.time + c.t }));
    g.radioLog = (s.radio || []).map((r: any) => ({ ...r, t: g.time + r.t }));
    for (const q of s.buildings || []) {
      const b = this.bf.map.getBuilding(q.id);
      if (!b) continue;
      if (q.hp !== undefined && q.hp !== null) { this.bf.phys.hp(b); this.bf.phys.damageBuilding(b, b.hpNow - q.hp); }
      if (q.door) { const d = this.bf.phys.doorState(b); d.open = q.door.open; d.broken = q.door.broken; d.hp = q.door.hp; this.bf.world.setState(b, { door: d.open || d.broken ? 1 : 0 }); }
      if (q.c && !b.collapsed) { b.collapsed = true; this.bf.phys.rebuildBuilding(b); }
    }
    g.logistics.restore(s.logistics);
    g.fob.restore(s.fob);
    m.restore(s.mission);
    if (s.fobAt != null) this.fobAt = g.time + s.fobAt;
    if (s.cam) { this.cam.tx = s.cam.x; this.cam.ty = s.cam.y; this.cam.tzoom = s.cam.zoom; this.cam.tyaw = s.cam.yaw; }
    setNextId(1);
    m.unlock();
  }
  async save(slot: Slot) {
    const c = this.campaign!;
    if (this.game && !this.ended) c.mission = this.snapshot();
    await this.saves.put(slot, c);
    if (slot !== "auto") this.slot = slot;
  }
  async load(slot: Slot): Promise<boolean> {
    const c = await this.saves.get(slot);
    if (!c) return false;
    this.campaign = c; this.slot = slot;
    return true;
  }
  /** remove everything a mission changed on the shared map (FOB buildings, damage, doors) */
  teardown() {
    const map = this.bf.map, ph = this.bf.phys, w = this.bf.world;
    const fob = map.findBuildings((b: any) => b.fob);
    for (const b of fob) map.removeBuilding(b.id);
    for (const b of map.buildings()) {
      let touched = false;
      if (b.door) { b.door = null; touched = true; }
      if (b.hpNow !== undefined) { b.hpNow = b.hpMax; touched = true; }
      if (b.collapsed) { b.collapsed = false; ph.rebuildBuilding(b); }
      if (touched || b.rs) w.setState(b, { dmg: 0, door: 0, roof: 0, sel: 0, hl: 0 });
    }
    this.game = null; this.mission = null;
  }
}

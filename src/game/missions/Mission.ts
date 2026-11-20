// Mission framework: objectives with prerequisites, secure/hold, rescue, destroy, FOB and logistics
// objectives, mission events, victory/defeat, territory status for the minimap and campaign.
import type { Game } from "../Game";
import { dist } from "../core";
import { callEvac } from "../units/Civilians";

export type ObjKind = "secure" | "rescue" | "join" | "destroy" | "fob" | "supply" | "reinforce" | "clear_wrecks" | "repel";
export type ObjState = "locked" | "active" | "done" | "failed";
export interface Objective {
  id: string; title: string; short: string; desc: string; kind: ObjKind; x: number; y: number; r: number;
  requires: string[]; optional?: boolean; phase: "liberate" | "fob"; state: ObjState; holdT: number; progress: string;
  boss?: boolean; evac?: boolean; place?: string;
}
export type MissionState = "active" | "liberated" | "complete" | "failed";

export class Mission {
  g: Game; id: string; name: string; objectives: Objective[] = []; state: MissionState = "active";
  evalT = 0; liberatedAt = -1; completeAt = -1; failedAt = -1; startedAt = 0;
  lz: [number, number] = [0, 0];
  fobSites: { x: number; y: number; rot: number; score: number }[] = [];
  supplyBaseline = 0; reinforceBaseline = 0; waveSpawned = false; waveDone = false;
  onObjective: (o: Objective) => void = () => {};
  constructor(g: Game, id: string, name: string) { this.g = g; this.id = id; this.name = name; }
  objective(id: string) { return this.objectives.find((o) => o.id === id) || null; }
  get active() { return this.objectives.filter((o) => o.state === "active"); }
  add(o: Omit<Objective, "state" | "holdT" | "progress">) { this.objectives.push({ ...o, state: "locked", holdT: 0, progress: "" }); }
  begin() {
    this.startedAt = this.g.time;
    this.unlock();
  }
  liberated() { return this.objectives.filter((o) => o.phase === "liberate" && !o.optional).every((o) => o.state === "done"); }
  unlock() {
    for (const o of this.objectives) {
      if (o.state !== "locked") continue;
      const ok = o.requires.every((r) => r === "liberated" ? this.liberated() : this.objective(r)?.state === "done");
      if (ok) {
        o.state = "active";
        if (o.kind === "supply") this.supplyBaseline = this.g.logistics.delivered;
        if (o.kind === "reinforce") this.reinforceBaseline = this.g.stats.reinforcements;
        this.g.radio(`HQ: new objective — ${o.title}.`, "radio");
        this.onObjective(o);
      }
    }
  }
  complete(o: Objective) {
    o.state = "done"; o.progress = "Complete";
    this.g.radio(`Objective complete: ${o.title}.`, "good");
    this.g.onSound("objective", o.x, o.y, 0.8);
    this.onObjective(o);
    this.g.onEvent("objective", o);
    if (this.state === "active" && this.liberated()) {
      this.state = "liberated"; this.liberatedAt = this.g.time;
      this.g.radio("TOLEDO CITY IS LIBERATED. Establish the task force's Forward Operating Base.", "good");
      this.g.fob.allowed = true;
      this.g.onEvent("liberated");
    }
    this.unlock();
    const needed = this.objectives.filter((q) => !q.optional);
    if (needed.every((q) => q.state === "done") && this.state !== "complete") {
      this.state = "complete"; this.completeAt = this.g.time;
      this.g.radio("Mission accomplished. Operation Reclamation continues.", "good");
      this.g.onEvent("mission_complete");
    }
  }
  /** player units, infected and nests in an objective area */
  census(o: Objective) {
    let units = 0, zombies = 0;
    this.g.uHash.query(o.x, o.y, o.r, () => { units++; });
    for (const u of this.g.units) if (u.alive && u.inVehicle !== null && dist(u.x, u.y, o.x, o.y) < o.r) units++;
    this.g.zHash.query(o.x, o.y, o.r * 1.15, (z) => { if (!z.dead) zombies++; });
    const nests = this.g.nests.filter((n) => !n.dead && n.zone === o.id).length;
    const boss = o.boss ? this.g.zombies.some((z) => !z.dead && z.def.boss && z.zone === o.id) : false;
    return { units, zombies, nests, boss };
  }
  update(dt: number) {
    const g = this.g;
    this.evalT -= dt;
    if (this.evalT > 0) return;
    this.evalT = 0.5;
    if (this.state !== "complete" && this.state !== "failed") {
      const anyone = g.units.some((u) => u.alive);
      const incoming = g.logistics.pending.some((p) => { const d = g.logistics.def(p.item); return !!(d.units || d.vehicle); });
      if (!anyone && !incoming) { this.state = "failed"; this.failedAt = g.time; g.radio("The task force has been wiped out. Mission failed.", "bad"); g.onEvent("mission_failed"); return; }
    }
    for (const o of this.active) this.evaluate(o, 0.5);
  }
  evaluate(o: Objective, dt: number) {
    const g = this.g;
    const c = this.census(o);
    const clearMax = Math.max(2, Math.round(o.r / 20));
    const secure = c.units > 0 && c.zombies <= clearMax && c.nests === 0 && !c.boss;
    const zoneText = () => [c.nests ? `nests ${c.nests}` : "", c.boss ? "Abomination present" : "", `infected ${c.zombies}`].filter(Boolean).join(" · ");
    switch (o.kind) {
      case "secure": case "destroy": {
        o.progress = c.units ? (secure ? `Holding… ${Math.ceil(Math.max(0, 4 - o.holdT))} s` : zoneText()) : `Move units here · ${zoneText()}`;
        if (secure) { o.holdT += dt; if (o.holdT >= 4) this.complete(o); } else o.holdT = 0;
        break;
      }
      case "rescue": case "join": {
        const civs = g.civs.filter((q) => q.objective === o.id);
        const all = civs.length + (o as any).gone || civs.length;
        const found = civs.filter((q) => q.state !== "hiding").length;
        const hiding = civs.filter((q) => q.state === "hiding" && !q.dead).length;
        const alive = civs.filter((q) => !q.dead && q.state !== "gone").length;
        if (o.kind === "join") {
          o.progress = hiding ? `Find the survivors · ${zoneText()}` : secure ? "Done" : `Clear the area · ${zoneText()}`;
          if (!hiding && secure) this.complete(o);
          break;
        }
        if (!o.evac) {
          o.progress = `Survivors found ${found}/${civs.length} · ${zoneText()}`;
          if (!hiding && secure) {
            const follow = civs.filter((q) => q.state === "following" && !q.dead);
            if (follow.length) { callEvac(g, o.x, o.y, follow); o.evac = true; }
            else if (!alive) { if (civs.length === 0 || civs.every((q) => q.dead)) this.g.radio(`No survivors could be saved at ${o.short}.`, "bad"); this.complete(o); }
          }
        } else {
          const waiting = civs.filter((q) => (q.state === "evac" || q.state === "following") && !q.dead).length;
          o.progress = waiting ? `Evacuating ${waiting} survivor${waiting > 1 ? "s" : ""}…` : "Evacuated";
          const stray = civs.filter((q) => q.state === "following" && !q.dead);
          if (stray.length && !g.transports.some((t) => !t.done && t.delivery < 0)) callEvac(g, o.x, o.y, stray);
          if (!waiting) this.complete(o);
        }
        void all;
        break;
      }
      case "clear_wrecks": {
        const left = g.obstacles.filter((w) => w.kind === "wreck" && !w.dead && dist(w.x, w.y, o.x, o.y) < o.r).length;
        o.progress = left ? `${left} wreck${left > 1 ? "s" : ""} left (engineers: right-click a wreck)` : "Road open";
        if (!left) this.complete(o);
        break;
      }
      case "fob": {
        o.progress = !g.fob.site ? "Open the FOB panel and choose open ground" : g.fob.established ? "Established" : `Building Command Center… ${Math.round((g.fob.facilities[0]?.built || 0) * 100)}%`;
        if (g.fob.established) { o.x = g.fob.site!.x; o.y = g.fob.site!.y; this.complete(o); }
        break;
      }
      case "supply": {
        o.progress = g.logistics.pending.length ? "Delivery inbound…" : "Open Logistics (L) and request supplies";
        if (g.fob.site) { o.x = g.fob.site.x; o.y = g.fob.site.y; }
        if (g.logistics.delivered > this.supplyBaseline) this.complete(o);
        break;
      }
      case "reinforce": {
        o.progress = "Logistics (L) → Reinforcements";
        if (g.fob.site) { o.x = g.fob.site.x; o.y = g.fob.site.y; }
        if (g.stats.reinforcements > this.reinforceBaseline) this.complete(o);
        break;
      }
      case "repel": {
        if (!g.fob.site) break;
        o.x = g.fob.site.x; o.y = g.fob.site.y;
        const wave = g.zombies.filter((z) => !z.dead && z.zone === "fob_wave").length;
        if (!this.waveSpawned) o.progress = "Scouts report a horde gathering east of the city";
        else o.progress = wave ? `Attackers remaining: ${wave}` : "Repelled";
        if (this.waveSpawned && !wave) this.complete(o);
        break;
      }
    }
  }
  /** territory colour per objective zone: red infected, yellow contested, green secured, blue military-controlled */
  zoneColor(o: Objective): "red" | "yellow" | "green" | "blue" {
    if (o.phase === "fob") return this.g.fob.established ? "blue" : "yellow";
    if (o.state === "done") return "green";
    let present = false;
    this.g.uHash.query(o.x, o.y, o.r * 1.5, () => { present = true; });
    return present ? "yellow" : "red";
  }
  territory(): "red" | "yellow" | "green" | "blue" {
    if (this.g.fob.established) return "blue";
    if (this.state === "liberated" || this.state === "complete") return "green";
    return "yellow";
  }
  serialize() {
    return { state: this.state, liberatedAt: this.liberatedAt - this.g.time, objectives: this.objectives.map((o) => ({ id: o.id, state: o.state, holdT: o.holdT, evac: !!o.evac, x: o.x, y: o.y })), waveSpawned: this.waveSpawned, supplyBaseline: this.supplyBaseline, reinforceBaseline: this.reinforceBaseline, fobSites: this.fobSites };
  }
  restore(s: any) {
    this.state = s.state; this.liberatedAt = this.g.time + s.liberatedAt; this.waveSpawned = !!s.waveSpawned;
    this.supplyBaseline = s.supplyBaseline || 0; this.reinforceBaseline = s.reinforceBaseline || 0; this.fobSites = s.fobSites || [];
    for (const so of s.objectives) { const o = this.objective(so.id); if (o) { o.state = so.state; o.holdT = so.holdT; o.evac = so.evac; o.x = so.x; o.y = so.y; } }
    if (this.state !== "active") this.g.fob.allowed = true;
  }
}

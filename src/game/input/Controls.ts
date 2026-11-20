// RTS controls. Mouse: left click/drag select, right click command, wheel zoom, middle/right drag pan,
// edge scroll. Keyboard: WASD/arrows pan, Q/E rotate, hotkeys for commands, 1-9 control groups.
// Touch: tap select/command, one-finger drag pan, two-finger pinch zoom, long-press box select.
import type { Session } from "../Session";
import type { Ghost } from "../rendering/SceneRender";
import { Unit, Zombie, Nest, Crate, Civilian, Obstacle, Formation } from "../entities";
import { issue, unload } from "../units/UnitAI";
import { dist } from "../core";
import { STRUCTURES, SUPPLIES } from "../data";

export type Mode = { kind: "attackMove" | "patrol" | "follow" | "build" | "supply" | "fob" | "retreatTo"; item?: string; rot: number } | null;

export class Controls {
  s: Session; canvas: HTMLElement;
  keys = new Set<string>();
  mouse = { x: 0, y: 0, inside: false };
  drag: { x0: number; y0: number; button: number; moved: boolean; t: number; pan: boolean } | null = null;
  box: number[] | null = null;
  hover: number | null = null;
  mode: Mode = null;
  ghost: Ghost | null = null;
  formation: Formation = "spread";
  groups = new Map<number, number[]>();
  lastClick = { t: 0, id: 0 }; lastGroupKey = { k: 0, t: 0 };
  touches = new Map<number, { x: number; y: number }>();
  pinch: { d: number; zoom: number; cx: number; cy: number } | null = null;
  longPress: any = null; touchBox = false;
  edgeScroll = true;
  enabled = false;
  onChange: () => void = () => {};
  onMessage: (t: string) => void = () => {};
  onPause: () => void = () => {};
  onPanel: (p: string) => void = () => {};
  constructor(s: Session, canvas: HTMLElement) {
    this.s = s; this.canvas = canvas;
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    canvas.addEventListener("pointerdown", (e) => this.down(e));
    addEventListener("pointermove", (e) => this.move(e));
    addEventListener("pointerup", (e) => this.up(e));
    addEventListener("pointercancel", (e) => { this.touches.delete(e.pointerId); this.drag = null; this.box = null; this.pinch = null; });
    canvas.addEventListener("pointerleave", () => { this.mouse.inside = false; });
    canvas.addEventListener("pointerenter", () => { this.mouse.inside = true; });
    canvas.addEventListener("wheel", (e) => { e.preventDefault(); if (this.enabled) this.zoomAt(e.offsetX, e.offsetY, Math.exp(e.deltaY * 0.0012)); }, { passive: false });
    addEventListener("keydown", (e) => this.key(e, true));
    addEventListener("keyup", (e) => this.key(e, false));
    addEventListener("blur", () => this.keys.clear());
  }
  get g() { return this.s.game!; }
  get cam() { return this.s.cam; }
  selected(): Unit[] { return this.s.game ? this.g.units.filter((u) => u.selected && u.alive && u.inVehicle === null) : []; }
  setMode(m: Mode) { this.mode = m; this.ghost = null; this.onChange(); }

  // ---------------------------------------------------------------- frame update (camera keys, edge scroll, ghost)
  update(dt: number) {
    if (!this.enabled || !this.s.game) return;
    let ax = 0, ay = 0;
    const k = this.keys;
    if (k.has("KeyA") || k.has("ArrowLeft")) ax -= 1;
    if (k.has("KeyD") || k.has("ArrowRight")) ax += 1;
    if (k.has("KeyW") || k.has("ArrowUp")) ay += 1;
    if (k.has("KeyS") || k.has("ArrowDown")) ay -= 1;
    if (this.edgeScroll && this.mouse.inside && !this.drag && matchMedia("(pointer: fine)").matches) {
      const W = this.canvas.clientWidth, H = this.canvas.clientHeight, m = 10;
      if (this.mouse.x < m) ax -= 1; if (this.mouse.x > W - m) ax += 1;
      if (this.mouse.y < m) ay += 1; if (this.mouse.y > H - m) ay -= 1;
    }
    if (ax || ay) this.cam.move(ax, ay, dt);
    this.updateGhost();
  }
  ground(px: number, py: number) { return this.s.bf.pick(px, py, this.cam.z); }
  updateGhost() {
    const m = this.mode;
    if (!m || !this.mouse.inside) { this.ghost = null; return; }
    const p = this.ground(this.mouse.x, this.mouse.y);
    if (!p) return;
    if (m.kind === "fob") { const why = this.g.fob.check(p[0], p[1], m.rot); this.ghost = { kind: "fob", x: p[0], y: p[1], rot: m.rot, ok: !why, reason: why }; }
    else if (m.kind === "build") { const ok = this.s.bf.walkable(p[0], p[1]) && !this.s.bf.map.buildingAt(p[0], p[1]); this.ghost = { kind: "deploy", x: p[0], y: p[1], rot: m.rot, ok, item: m.item, reason: ok ? "" : "Blocked" }; }
    else if (m.kind === "supply") {
      const d = SUPPLIES[m.item!];
      this.ghost = { kind: d.strike ? "strike" : "drop", x: p[0], y: p[1], rot: m.rot, ok: true, radius: d.strike ? d.strike.radius : 6 };
    } else this.ghost = null;
  }

  // ---------------------------------------------------------------- picking
  pick(px: number, py: number): any {
    const g = this.g, bf = this.s.bf;
    const scale = Math.max(0.6, Math.min(2, 60 / this.cam.zoom));
    let best: any = null, bd = 22 * scale;
    const test = (e: any, z: number, extra = 0) => {
      const s = bf.screen(e.x, e.y, z);
      if (!s) return;
      const d = Math.hypot(s[0] - px, s[1] - py) - extra;
      if (d < bd) { bd = d; best = e; }
    };
    for (const u of g.units) if (u.alive && u.inVehicle === null) test(u, u.z + (u.vehicle ? 1.2 : 0.9), u.vehicle ? 18 * scale : 0);
    for (const z of g.zombies) if (!z.dead) test(z, z.z + 0.9 * z.def.size, z.def.size > 2 ? 20 * scale : 0);
    for (const n of g.nests) if (!n.dead) test(n, n.z + 1, 25 * scale);
    for (const c of g.civs) if (!c.dead && c.state !== "gone") test(c, c.z + 0.9);
    for (const c of g.crates) if (!c.dead) test(c, c.z + 0.4);
    for (const o of g.obstacles) if (!o.dead && o.kind === "wreck") test(o, o.z + 0.8, 10 * scale);
    return best;
  }
  // ---------------------------------------------------------------- pointer
  down(e: PointerEvent) {
    if (!this.enabled) return;
    this.canvas.setPointerCapture?.(e.pointerId);
    this.mouse.x = e.offsetX; this.mouse.y = e.offsetY; this.mouse.inside = true;
    if (e.pointerType === "touch") {
      this.touches.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
      if (this.touches.size === 2) {
        clearTimeout(this.longPress); this.drag = null; this.box = null;
        const [a, b] = [...this.touches.values()];
        this.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), zoom: this.cam.tzoom, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
        return;
      }
      this.drag = { x0: e.offsetX, y0: e.offsetY, button: 0, moved: false, t: performance.now(), pan: !this.touchBox };
      clearTimeout(this.longPress);
      this.longPress = setTimeout(() => { if (this.drag && !this.drag.moved) { this.drag.pan = false; this.box = [this.drag.x0, this.drag.y0, this.drag.x0, this.drag.y0]; navigator.vibrate?.(15); } }, 550);
      return;
    }
    this.drag = { x0: e.offsetX, y0: e.offsetY, button: e.button, moved: false, t: performance.now(), pan: e.button === 1 || e.button === 2 };
  }
  move(e: PointerEvent) {
    const r = this.canvas.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    const dx = x - this.mouse.x, dy = y - this.mouse.y;
    this.mouse.x = x; this.mouse.y = y;
    if (!this.enabled || !this.s.game) return;
    if (e.pointerType === "touch" && this.touches.has(e.pointerId)) {
      this.touches.set(e.pointerId, { x, y });
      if (this.pinch && this.touches.size >= 2) {
        const [a, b] = [...this.touches.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y), cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
        this.cam.tzoom = Math.max(this.cam.minZoom, Math.min(this.cam.maxZoom, this.pinch.zoom * (this.pinch.d / Math.max(20, d))));
        this.cam.pan(cx - this.pinch.cx, cy - this.pinch.cy, this.mpp());
        this.pinch.cx = cx; this.pinch.cy = cy;
        return;
      }
    }
    const d = this.drag;
    if (d) {
      if (!d.moved && Math.hypot(x - d.x0, y - d.y0) > (e.pointerType === "touch" ? 12 : 6)) { d.moved = true; clearTimeout(this.longPress); }
      if (d.moved && d.pan) { this.cam.pan(dx, dy, this.mpp()); return; }
      if (d.moved && d.button === 0 && !this.mode) this.box = [d.x0, d.y0, x, y];
      if (this.box && e.pointerType === "touch") this.box = [d.x0, d.y0, x, y];
    } else if (e.pointerType !== "touch") {
      const p = this.pick(x, y);
      this.hover = p ? p.id : null;
    }
  }
  mpp() { return (this.cam.zoom * 2) / Math.max(1, this.canvas.clientHeight); }
  up(e: PointerEvent) {
    if (e.pointerType === "touch") { this.touches.delete(e.pointerId); clearTimeout(this.longPress); if (this.pinch) { if (this.touches.size < 2) this.pinch = null; this.drag = null; return; } }
    const d = this.drag;
    this.drag = null;
    if (!d || !this.enabled || !this.s.game) { this.box = null; return; }
    const x = this.mouse.x, y = this.mouse.y;
    if (this.box) { this.boxSelect(this.box, e.shiftKey); this.box = null; return; }
    if (d.moved) return;
    if (e.pointerType === "touch") return this.tap(x, y);
    if (d.button === 0) this.leftClick(x, y, e.shiftKey, e.ctrlKey || e.metaKey);
    else if (d.button === 2) this.rightClick(x, y, e.shiftKey, e.ctrlKey || e.altKey);
  }
  tap(x: number, y: number) {
    if (this.mode) return this.leftClick(x, y, false, false);
    const p = this.pick(x, y);
    const sel = this.selected();
    if (p instanceof Unit && (!sel.length || !(p.vehicle && sel.some((u) => !u.vehicle)))) return this.leftClick(x, y, false, false);
    if (sel.length) return this.rightClick(x, y, false, false);
    this.leftClick(x, y, false, false);
  }
  leftClick(x: number, y: number, shift: boolean, ctrl: boolean) {
    const g = this.g;
    if (this.mode) { this.applyMode(x, y, shift); return; }
    const p = this.pick(x, y);
    const now = performance.now();
    if (p instanceof Unit) {
      if (ctrl || (now - this.lastClick.t < 350 && this.lastClick.id === p.id)) {
        // all units of this type on screen
        for (const u of g.units) u.selected = u.alive && u.inVehicle === null && u.type === p.type && this.onScreen(u);
      } else if (shift) p.selected = !p.selected;
      else { for (const u of g.units) u.selected = false; p.selected = true; }
      this.lastClick = { t: now, id: p.id };
      this.s.game!.onSound("select", p.x, p.y, 0.3);
    } else if (!shift) {
      for (const u of g.units) u.selected = false;
      if (p instanceof Civilian) this.onMessage(p.military ? "Soldier from the 3rd Engineer platoon: reach them to bring them into the squad." : p.state === "hiding" ? "Survivor in hiding: move a soldier next to them." : "Survivor following the squad.");
      if (p instanceof Crate) this.onMessage(`${p.label}: right-click with units to collect.`);
    }
    this.onChange();
  }
  onScreen(u: Unit) { const s = this.s.bf.screen(u.x, u.y, u.z); return !!s && s[0] >= 0 && s[1] >= 0 && s[0] <= this.canvas.clientWidth && s[1] <= this.canvas.clientHeight; }
  boxSelect(b: number[], add: boolean) {
    const [x0, y0, x1, y1] = [Math.min(b[0], b[2]), Math.min(b[1], b[3]), Math.max(b[0], b[2]), Math.max(b[1], b[3])];
    const hits: Unit[] = [];
    for (const u of this.g.units) {
      if (!u.alive || u.inVehicle !== null) continue;
      const s = this.s.bf.screen(u.x, u.y, u.z + 0.9);
      if (s && s[0] >= x0 && s[0] <= x1 && s[1] >= y0 && s[1] <= y1) hits.push(u);
    }
    if (!add) for (const u of this.g.units) u.selected = false;
    for (const u of hits) u.selected = true;
    this.onChange();
  }
  rightClick(x: number, y: number, queue: boolean, attackMove: boolean) {
    if (this.mode) { this.setMode(null); return; }
    const sel = this.selected();
    if (!sel.length) return;
    const g = this.g;
    const p = this.pick(x, y);
    const marker = (px: number, py: number, col: number[]) => g.effect("order", px, py, this.s.bf.h(px, py), 0.45, 1, { col: col as any });
    if (p instanceof Zombie || p instanceof Nest) { issue(g, sel, { kind: "attack", target: p.id }, { queue }); marker(p.x, p.y, [1, 0.3, 0.2]); g.onSound("ack", p.x, p.y, 0.4); return; }
    if (p instanceof Unit && p.vehicle && !p.selected && sel.some((u) => !u.vehicle)) { issue(g, sel.filter((u) => !u.vehicle), { kind: "board", target: p.id }, { queue }); marker(p.x, p.y, [0.4, 0.8, 1]); return; }
    if (p instanceof Unit && !p.selected) { issue(g, sel, { kind: "follow", target: p.id }, { queue }); marker(p.x, p.y, [0.4, 0.8, 1]); return; }
    if (p instanceof Crate || p instanceof Civilian) { issue(g, [nearest(sel, p)], { kind: "interact", target: p.id }, { queue }); marker(p.x, p.y, [0.4, 0.8, 1]); return; }
    if (p instanceof Obstacle && p.kind === "wreck") {
      const eng = sel.filter((u) => u.type === "engineer");
      if (eng.length) { issue(g, eng, { kind: "clear", target: p.id }, { queue }); marker(p.x, p.y, [1, 0.8, 0.3]); return; }
    }
    const gp = this.ground(x, y);
    if (!gp) return;
    issue(g, sel, { kind: attackMove ? "attackMove" : "move", x: gp[0], y: gp[1] }, { queue, formation: this.formation });
    marker(gp[0], gp[1], attackMove ? [1, 0.6, 0.2] : [0.35, 1, 0.45]);
    g.onSound("ack", gp[0], gp[1], 0.4);
  }
  applyMode(x: number, y: number, shift: boolean) {
    const m = this.mode!, g = this.g;
    const gp = this.ground(x, y);
    if (!gp) return;
    const sel = this.selected();
    switch (m.kind) {
      case "attackMove": issue(g, sel, { kind: "attackMove", x: gp[0], y: gp[1] }, { queue: shift, formation: this.formation }); g.effect("order", gp[0], gp[1], this.s.bf.h(gp[0], gp[1]), 0.45, 1, { col: [1, 0.6, 0.2] }); break;
      case "patrol": issue(g, sel, { kind: "patrol", x: gp[0], y: gp[1] }, { formation: this.formation }); break;
      case "retreatTo": issue(g, sel, { kind: "retreat", x: gp[0], y: gp[1] }, { formation: "column" }); break;
      case "follow": { const p = this.pick(x, y); if (p instanceof Unit) issue(g, sel.filter((u) => u !== p), { kind: "follow", target: p.id }); break; }
      case "build": {
        const eng = sel.filter((u) => u.type === "engineer");
        if (!eng.length) { this.onMessage("Select a combat engineer to build defences."); break; }
        if ((g.fob.inventory[m.item!] || 0) <= 0) { this.onMessage(`No ${STRUCTURES[m.item!].name} left. Request a defensive kit through logistics.`); this.setMode(null); return; }
        if (!this.ghost || !this.ghost.ok) { this.onMessage("Can't build there."); return; }
        issue(g, [nearest(eng, { x: gp[0], y: gp[1] })], { kind: "build", x: gp[0], y: gp[1], item: m.item, rot: m.rot });
        if (shift && (g.fob.inventory[m.item!] || 0) > 1) return; // keep placing
        break;
      }
      case "supply": {
        const why = g.logistics.request(m.item!, gp[0], gp[1], m.rot);
        if (why) { this.onMessage(why); return; }
        break;
      }
      case "fob": {
        const why = g.fob.establish(gp[0], gp[1], m.rot);
        if (why) { this.onMessage(why); return; }
        break;
      }
    }
    this.setMode(null);
  }
  zoomAt(px: number, py: number, f: number) {
    const before = this.ground(px, py);
    this.cam.zoomBy(f);
    if (before && f < 1) { this.cam.tx += (before[0] - this.cam.tx) * (1 - f) * 0.9; this.cam.ty += (before[1] - this.cam.ty) * (1 - f) * 0.9; this.cam.clampTarget(); }
  }
  // ---------------------------------------------------------------- keyboard
  key(e: KeyboardEvent, down: boolean) {
    const t = e.target as HTMLElement;
    if (t && (t.tagName === "INPUT" || t.tagName === "SELECT" || t.tagName === "TEXTAREA")) return;
    if (down) this.keys.add(e.code); else { this.keys.delete(e.code); return; }
    if (!this.enabled || !this.s.game) return;
    const g = this.g, sel = this.selected();
    const digit = /^Digit([1-9])$/.exec(e.code);
    if (digit) {
      const n = +digit[1];
      if (e.ctrlKey || e.metaKey) { e.preventDefault(); this.groups.set(n, sel.map((u) => u.id)); for (const u of g.units) if (u.group === n) u.group = 0; for (const u of sel) u.group = n; this.onMessage(`Group ${n}: ${sel.length} unit${sel.length === 1 ? "" : "s"}`); }
      else {
        const ids = this.groups.get(n) || g.units.filter((u) => u.group === n).map((u) => u.id);
        if (!ids.length) return;
        if (!e.shiftKey) for (const u of g.units) u.selected = false;
        for (const id of ids) { const u = g.get(id); if (u && u.alive && u.inVehicle === null) u.selected = true; }
        const now = performance.now();
        if (this.lastGroupKey.k === n && now - this.lastGroupKey.t < 400) this.centerOnSelection();
        this.lastGroupKey = { k: n, t: now };
      }
      this.onChange();
      return;
    }
    switch (e.code) {
      case "KeyQ": this.cam.rotate(-1); break;
      case "KeyE": this.cam.rotate(1); break;
      case "Space": e.preventDefault(); this.centerOnSelection(); break;
      case "Escape": if (this.mode) this.setMode(null); else this.onPause(); break;
      case "KeyX": this.command("stop"); break;
      case "KeyH": this.command("hold"); break;
      case "KeyG": this.command("defend"); break;
      case "KeyZ": this.command("attackMove"); break;
      case "KeyP": this.command("patrol"); break;
      case "KeyF": this.command("follow"); break;
      case "KeyR": if (this.mode && (this.mode.kind === "fob" || this.mode.kind === "build" || this.mode.kind === "supply")) { this.mode.rot += Math.PI / 2; } else this.command("retreat"); break;
      case "KeyK": this.command("formation"); break;
      case "KeyU": this.command("unload"); break;
      case "KeyB": this.onPanel("build"); break;
      case "KeyL": this.onPanel("logistics"); break;
      case "KeyO": this.onPanel("fob"); break;
      case "Tab": e.preventDefault(); this.nextIdle(); break;
      case "Equal": case "NumpadAdd": this.s.speed = Math.min(4, this.s.speed + 1); break;
      case "Minus": case "NumpadSubtract": this.s.speed = Math.max(1, this.s.speed - 1); break;
      case "KeyT": if (e.ctrlKey) { e.preventDefault(); for (const u of g.units) u.selected = u.alive && u.inVehicle === null; } break;
      default: return;
    }
    this.onChange();
  }
  command(c: string) {
    const g = this.g, sel = this.selected();
    if (!g) return;
    switch (c) {
      case "stop": for (const u of sel) { u.queue = []; u.order = { kind: "idle" }; u.path = null; u.focus = null; g.paths.cancel(u); } break;
      case "hold": issue(g, sel, { kind: "hold" }); break;
      case "defend": issue(g, sel, { kind: "defend" }); break;
      case "attackMove": if (sel.length) this.setMode({ kind: "attackMove", rot: 0 }); break;
      case "patrol": if (sel.length) this.setMode({ kind: "patrol", rot: 0 }); break;
      case "follow": if (sel.length) this.setMode({ kind: "follow", rot: 0 }); break;
      case "retreat": {
        if (!sel.length) break;
        const fob = g.fob.established && g.fob.site ? [g.fob.site.x, g.fob.site.y] : g.mission ? g.mission.lz : null;
        if (fob) { issue(g, sel, { kind: "retreat", x: fob[0], y: fob[1] }, { formation: "column" }); this.onMessage(g.fob.established ? "Falling back to the FOB." : "Falling back to the landing zone."); }
        break;
      }
      case "formation": {
        const order: Formation[] = ["spread", "line", "column", "wedge"];
        this.formation = order[(order.indexOf(this.formation) + 1) % order.length];
        this.onMessage(`Formation: ${this.formation}`);
        break;
      }
      case "unload": for (const v of sel.filter((u) => u.vehicle && u.passengers.length)) unload(g, v); break;
      case "focus": break;
    }
    this.onChange();
  }
  centerOnSelection() {
    const sel = this.selected();
    if (!sel.length) return;
    let x = 0, y = 0;
    for (const u of sel) { x += u.x; y += u.y; }
    this.cam.lookAt(x / sel.length, y / sel.length);
  }
  nextIdle() {
    const idle = this.g.units.filter((u) => u.alive && u.inVehicle === null && u.order.kind === "idle");
    if (!idle.length) return;
    const cur = this.selected()[0];
    const i = cur ? (idle.indexOf(cur) + 1) % idle.length : 0;
    for (const u of this.g.units) u.selected = false;
    idle[i].selected = true;
    this.cam.lookAt(idle[i].x, idle[i].y);
  }
}
function nearest<T extends { x: number; y: number }>(arr: T[], p: { x: number; y: number }): T {
  let b = arr[0], bd = Infinity;
  for (const a of arr) { const d = dist(a.x, a.y, p.x, p.y); if (d < bd) { bd = d; b = a; } }
  return b;
}

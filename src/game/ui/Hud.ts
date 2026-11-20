// In-game interface: top bar, objectives, radio log, minimap with territory colours, selected-unit
// panel, command buttons, logistics / reinforcement / FOB / engineering panels, boss bar, toasts.
import type { Session } from "../Session";
import type { Controls } from "../input/Controls";
import type { RadioMsg } from "../Game";
import { Unit } from "../entities";
import { issue } from "../units/UnitAI";
import { SUPPLIES, STRUCTURES, WEAPONS } from "../data";
import { fmtTime, escHtml as E, dist } from "../core";

const $ = (id: string) => document.getElementById(id)!;
const ABBR: Record<string, string> = { rifleman: "RF", assault: "AS", sniper: "SN", machine_gunner: "MG", shotgunner: "SG", flamethrower: "FL", rocket: "RL", medic: "MD", engineer: "EN", special_forces: "SF",
  jeep: "JEEP", apc: "APC", ifv: "IFV", tank: "MBT", truck: "TRK", arv: "ARV" };
const ORDER_LABEL: Record<string, string> = { idle: "Idle", move: "Moving", attackMove: "Attack-move", attack: "Attacking", hold: "Holding position", defend: "Defending", patrol: "Patrolling", follow: "Following", retreat: "Retreating", interact: "Interacting", board: "Boarding", build: "Building", clear: "Clearing wreck" };

export class Hud {
  s: Session; c: Controls; t = 0; panel: "" | "logistics" | "fob" | "build" = ""; sig = ""; selSig = ""; cmdSig = ""; panelSig = ""; toastT: any = 0;
  mmBase: HTMLCanvasElement | null = null; mm: HTMLCanvasElement; mmCtx: CanvasRenderingContext2D; mmT = 0;
  onPause: () => void = () => {};
  showFps = false;
  constructor(s: Session, c: Controls) {
    this.s = s; this.c = c;
    this.mm = $("minimap") as HTMLCanvasElement; this.mmCtx = this.mm.getContext("2d")!;
    $("bPause").onclick = () => this.onPause();
    $("bLog").onclick = () => this.toggle("logistics");
    $("bFob").onclick = () => this.toggle("fob");
    $("panelClose").onclick = () => this.toggle(this.panel);
    $("objToggle").onclick = () => $("objectives").classList.toggle("collapsed");
    for (const b of document.querySelectorAll<HTMLButtonElement>(".speed button")) b.onclick = () => { this.s.speed = +b.dataset.speed!; this.sig = ""; };
    $("objList").onclick = (e) => { const li = (e.target as HTMLElement).closest("li"); if (!li) return; const o = this.s.mission?.objective(li.dataset.id!); if (o) this.s.cam.lookAt(o.x, o.y); };
    $("tBox").onclick = () => { this.c.touchBox = !this.c.touchBox; $("tBox").classList.toggle("on", this.c.touchBox); this.toast(this.c.touchBox ? "Drag to box-select units" : "Drag to move the camera"); };
    $("tRotL").onclick = () => this.s.cam.rotate(-1);
    $("tRotR").onclick = () => this.s.cam.rotate(1);
    $("tAll").onclick = () => { for (const u of this.s.game!.units) u.selected = u.alive && u.inVehicle === null; this.selSig = ""; };
    $("commands").onclick = (e) => { const b = (e.target as HTMLElement).closest("button"); if (b) this.cmd(b.dataset.c!); };
    $("selection").onclick = (e) => { const b = (e.target as HTMLElement).closest("[data-id]") as HTMLElement; if (!b) return; const id = +b.dataset.id!; for (const u of this.s.game!.units) u.selected = u.id === id; this.selSig = ""; };
    $("panelBody").onclick = (e) => this.panelClick(e);
    this.minimapInput();
    c.onPanel = (p) => this.toggle(p as any);
    c.onMessage = (m) => this.toast(m);
  }
  attach() {
    const g = this.s.game!;
    $("radio").innerHTML = "";
    for (const m of g.radioLog.slice(-6)) this.radio(m);
    g.onRadio = (m) => this.radio(m);
    $("mname").textContent = "Mission 01 · Retake Toledo City";
    this.sig = this.selSig = this.cmdSig = this.panelSig = "";
    this.panel = ""; $("panel").hidden = true;
    if (!this.mmBase) this.buildMinimapBase();
  }
  radio(m: RadioMsg) {
    const box = $("radio");
    const d = document.createElement("div");
    d.className = m.kind; d.textContent = m.text;
    box.appendChild(d);
    while (box.children.length > 6) box.removeChild(box.firstChild!);
    for (let i = 0; i < box.children.length - 3; i++) box.children[i].classList.add("old");
  }
  toast(msg: string) {
    const t = $("toast"); t.textContent = msg; t.classList.add("show");
    clearTimeout(this.toastT); this.toastT = setTimeout(() => t.classList.remove("show"), 2600);
  }
  toggle(p: "" | "logistics" | "fob" | "build") {
    this.panel = this.panel === p ? "" : p;
    $("panel").hidden = !this.panel;
    this.panelSig = "";
    this.renderPanel();
  }
  cmd(c: string) {
    if (!c) return;
    if (c === "build") return this.toggle("build");
    if (c === "logistics") return this.toggle("logistics");
    if (c === "center") return this.c.centerOnSelection();
    this.c.command(c);
    this.cmdSig = "";
  }
  // ---------------------------------------------------------------- per-frame
  update(dt: number) {
    const g = this.s.game;
    if (!g) return;
    this.t -= dt;
    this.mmT -= dt;
    if (this.mmT <= 0) { this.mmT = 0.25; this.drawMinimap(); }
    // mode hint
    const m = this.c.mode, hint = $("modeHint");
    if (m) {
      hint.hidden = false;
      hint.textContent = m.kind === "fob" ? "Place the FOB compound: click open ground · R rotates · right-click cancels" :
        m.kind === "build" ? `Place ${STRUCTURES[m.item!].name} (${g.fob.inventory[m.item!] || 0} left) · R rotates · Shift keeps placing · right-click cancels` :
        m.kind === "supply" ? `${SUPPLIES[m.item!].name}: click the delivery point · right-click cancels` :
        m.kind === "follow" ? "Click a unit to follow" : m.kind === "patrol" ? "Click the patrol end point" : "Click a point: units advance and engage everything on the way";
    } else hint.hidden = true;
    // boss bar
    const boss = g.get(g.bossId);
    const bb = $("bossbar");
    if (boss && !boss.dead && boss.awake && dist(boss.x, boss.y, this.s.cam.x, this.s.cam.y) < 260) { bb.hidden = false; ($("bossfill") as HTMLElement).style.width = `${(100 * boss.hp) / boss.maxHp}%`; } else bb.hidden = true;
    if (this.t > 0) return;
    this.t = 0.2;
    $("mtime").textContent = fmtTime(g.time) + (this.s.speed > 1 ? `  ▶×${this.s.speed}` : "");
    $("skills").textContent = String(g.stats.killed);
    $("srescued").textContent = String(g.stats.rescued);
    $("sunits").textContent = String(g.units.filter((u) => u.alive).length);
    const terr = this.s.mission!.territory(), te = $("territory");
    te.className = "terr " + terr; te.textContent = { red: "INFECTED", yellow: "CONTESTED", green: "LIBERATED", blue: "FOB · MILITARY CONTROL" }[terr];
    for (const b of document.querySelectorAll<HTMLButtonElement>(".speed button")) b.classList.toggle("on", +b.dataset.speed! === this.s.speed);
    $("bFob").hidden = !g.fob.allowed && !g.fob.site;
    this.renderObjectives();
    this.renderSelection();
    this.renderCommands();
    if (this.panel) this.renderPanel();
  }
  renderObjectives() {
    const m = this.s.mission!;
    const vis = m.objectives.filter((o) => o.state !== "locked");
    const sig = vis.map((o) => o.id + o.state + o.progress).join("|");
    if (sig === this.sig) return;
    this.sig = sig;
    const act = vis.filter((o) => o.state === "active"), done = vis.filter((o) => o.state === "done").slice(-4);
    $("objList").innerHTML = [...act, ...done].map((o) => `<li data-id="${o.id}" class="${o.state}${o.optional ? " opt" : ""}">${E(o.title)}${o.state === "active" ? `<small>${E(o.progress || o.desc)}</small>` : ""}</li>`).join("") +
      (m.state === "liberated" ? `<li class="done" data-id="fob">Toledo City liberated</li>` : "");
  }
  renderSelection() {
    const g = this.s.game!;
    const sel = g.units.filter((u) => u.selected && u.alive);
    const one = sel.length === 1 ? sel[0] : null;
    const sig = sel.map((u) => u.id + ":" + Math.round(u.hp) + ":" + u.mag + ":" + Math.round(u.reserve) + u.order.kind + (u.reloadT > 0) + u.passengers.length + Math.round(u.suppression * 4) + Math.round(u.medkits)).join(",");
    if (sig === this.selSig) return;
    this.selSig = sig;
    const el = $("selection");
    if (!sel.length) {
      const total = g.units.filter((u) => u.alive && u.inVehicle === null).length;
      el.innerHTML = `<div class="empty">No units selected · ${total} in the field.<br>Left-click or drag to select · right-click to move or attack · <kbd>Ctrl</kbd>+<kbd>T</kbd> selects all</div>`;
      return;
    }
    if (one) {
      const u = one, w = u.weapon;
      const hpF = u.hp / u.maxHp;
      const status = [u.reloadT > 0 ? "reloading" : "", u.suppression > 0.35 ? "suppressed" : "", u.mag === 0 && u.reserve === 0 && w ? "OUT OF AMMO" : "", u.burn > 0 ? "burning" : ""].filter(Boolean).join(", ");
      el.innerHTML = `<div class="unitname">${E(u.name)}<small>${E(u.def.name)}${u.group ? " · group " + u.group : ""}</small></div>
      <div class="detail"><span class="k">Health</span><span>${Math.ceil(u.hp)} / ${u.maxHp}<div class="meter"><i style="width:${hpF * 100}%;background:${hpF > 0.6 ? "#5fd36a" : hpF > 0.3 ? "#e8c44a" : "#e5533d"}"></i></div></span>
      ${w ? `<span class="k">Weapon</span><span>${E(w.name)} · ${u.mag}/${w.mag} · reserve ${Math.round(u.reserve)}</span>` : ""}
      <span class="k">Armor</span><span>${Math.round(u.def.armor * 100)}%</span>
      <span class="k">Order</span><span>${ORDER_LABEL[u.order.kind] || u.order.kind}${u.queue.length ? ` (+${u.queue.length} queued)` : ""}${status ? ` · <b style="color:#f2b84b">${status}</b>` : ""}</span>
      <span class="k">Kills</span><span>${u.kills}</span>
      ${u.def.heal ? `<span class="k">Med kits</span><span>${u.medkits.toFixed(1)} / ${u.def.heal.kits}</span>` : ""}
      ${u.vehicle && u.def.capacity ? `<span class="k">Passengers</span><span>${u.passengers.length} / ${u.def.capacity}</span>` : ""}
      ${u.type === "engineer" ? `<span class="k">Equipment</span><span>${Object.entries(g.fob.inventory).filter(([, n]) => n > 0).map(([k, n]) => `${STRUCTURES[k].name} ×${n}`).join(", ") || "none — request a defensive kit"}</span>` : ""}</div>`;
      return;
    }
    el.innerHTML = `<div class="unitname">${sel.length} units<small>formation: ${this.c.formation}</small></div><div class="cards">${sel.map((u) => `<div class="card${u.vehicle ? " veh" : ""}" data-id="${u.id}" title="${E(u.name)}"><b>${ABBR[u.type] || "?"}</b><span>${u.weapon ? Math.round(100 * u.ammoFrac) + "%" : ""}</span><div class="hp"><i style="width:${(100 * u.hp) / u.maxHp}%;background:${u.hp / u.maxHp > 0.5 ? "#5fd36a" : "#e5533d"}"></i></div></div>`).join("")}</div>`;
  }
  renderCommands() {
    const g = this.s.game!;
    const sel = g.units.filter((u) => u.selected && u.alive);
    const eng = sel.some((u) => u.type === "engineer"), veh = sel.some((u) => u.vehicle && u.passengers.length);
    const sig = `${sel.length > 0}${eng}${veh}${this.c.formation}${this.c.mode?.kind || ""}`;
    if (sig === this.cmdSig) return;
    this.cmdSig = sig;
    const dis = sel.length ? "" : " disabled";
    const b = (c: string, icon: string, label: string, key: string, extra = "") => `<button data-c="${c}"${extra} title="${label} (${key})"><i>${icon}</i>${label}<kbd>${key}</kbd></button>`;
    $("commands").innerHTML = [
      b("attackMove", "⚔", "Attack-move", "Z", dis), b("stop", "■", "Stop", "X", dis), b("hold", "⛊", "Hold", "H", dis), b("defend", "⛨", "Defend", "G", dis), b("patrol", "⇄", "Patrol", "P", dis),
      b("follow", "➜", "Follow", "F", dis), b("retreat", "↩", "Retreat", "R", dis), b("formation", "⋮", this.c.formation[0].toUpperCase() + this.c.formation.slice(1), "K", dis),
      b("build", "▤", "Build", "B", eng ? "" : " disabled"), veh ? b("unload", "⇩", "Unload", "U") : b("center", "◎", "Center", "Space", dis),
    ].join("");
  }
  // ---------------------------------------------------------------- side panels
  renderPanel() {
    const g = this.s.game;
    if (!g || !this.panel) return;
    const L = g.logistics;
    let title = "", html = "";
    if (this.panel === "logistics") {
      title = "Logistics & reinforcements";
      const cats: Record<string, string[]> = {};
      for (const [k, d] of Object.entries(SUPPLIES)) (cats[d.category] = cats[d.category] || []).push(k);
      html += L.pending.length ? `<div class="cat">Incoming</div>` + L.pending.map((p) => `<div class="pend">✈ ${E(SUPPLIES[p.item].name)} — ${p.eta === Infinity ? "on target" : "ETA " + Math.max(0, Math.ceil(p.eta - g.time)) + " s"}</div>`).join("") : "";
      html += `<p class="fine">No gathering in this war: everything comes through military logistics. Stock is limited per mission; each request has a delivery time and a cooldown.${g.fob.established ? "" : " Until the FOB exists only air deliveries are possible."}</p>`;
      for (const [cat, items] of Object.entries(cats)) {
        html += `<div class="cat">${E(cat)}</div>`;
        for (const k of items) {
          const d = SUPPLIES[k], why = L.blocked(k);
          const what = d.units ? d.units.map((u) => u.replace(/_/g, " ")).join(", ") : d.vehicle ? "vehicle" : d.crate ? [d.crate.ammo ? "ammunition" : "", d.crate.medical ? "medical" : ""].filter(Boolean).join(" + ") : d.deploy ? Object.entries(d.deploy).map(([s, n]) => `${n}× ${STRUCTURES[s].name.toLowerCase()}`).join(", ") : d.strike ? `${d.strike.shells} rounds, ${d.strike.radius} m` : d.unlocks ? "unlocks " + d.unlocks.join(", ").replace(/_/g, " ") : "";
          html += `<div class="sup"><header><b>${E(d.name)}</b><button data-req="${k}"${why ? " disabled" : ""}>Request</button></header><small>${E(what)} · ${d.via === "air" ? "air" : d.via === "land" ? "land convoy to FOB" : "sea"} · ${d.delivery} s · cooldown ${d.cooldown} s · stock ${L.stock[k]}</small>${why ? `<small class="why">${E(why)}</small>` : ""}</div>`;
        }
      }
    } else if (this.panel === "fob") {
      title = "Forward Operating Base";
      const f = g.fob, m = this.s.mission!;
      if (!f.allowed) html = `<p>The task force has no base yet. The FOB can be established only after <b>Toledo City is liberated</b> — complete the primary objectives first.</p><p class="fine">One permanent FOB for the whole campaign. No mining, farming or gathering: it is supplied by military logistics.</p>`;
      else if (!f.site) {
        html = `<p>Choose open, dry, gently sloping ground near a road. The compound is ${78} × ${60} m with perimeter walls, a gate and four towers.</p><button data-fob="manual" class="primary">Place manually</button>`;
        html += `<div class="cat">Suggested open sites (no buildings in the footprint)</div>`;
        html += m.fobSites.length ? m.fobSites.map((st, i) => { const ll = this.s.bf.map.latlon(st.x, st.y); return `<div class="sup"><header><b>Site ${String.fromCharCode(65 + i)}</b><span><button data-fobview="${i}">View</button> <button data-fobhere="${i}">Establish</button></span></header><small>${ll[0].toFixed(5)}, ${ll[1].toFixed(5)} · ${Math.round(dist(st.x, st.y, m.lz[0], m.lz[1]))} m from the LZ</small></div>`; }).join("") : `<p class="fine">Searching… or no open area large enough was found; place it manually.</p>`;
      } else {
        html = `<p>${f.established ? "<b>FOB established.</b>" : "Under construction — engineers nearby speed it up."} ${Math.round(f.progress * 100)}% complete.</p><button data-fobview="site">View FOB</button>`;
        const seen = new Set<string>();
        for (const fa of f.facilities) {
          if (fa.type === "perimeter" || fa.type === "watchtower") { if (seen.has(fa.type)) continue; seen.add(fa.type); const all = f.facilities.filter((q) => q.type === fa.type); const done = all.filter((q) => q.built >= 1).length; html += `<div class="sup"><header><b>${E(STRUCTURES[fa.type].name)}</b><span>${done}/${all.length}</span></header></div>`; continue; }
          html += `<div class="sup"><header><b>${E(STRUCTURES[fa.type].name)}</b><span>${fa.built >= 1 ? "✔" : Math.round(fa.built * 100) + "%"}</span></header></div>`;
        }
      }
    } else if (this.panel === "build") {
      title = "Engineering — tactical defences";
      const inv = g.fob.inventory;
      html = `<p class="fine">Select a combat engineer, pick a defence, click to place. Defences block the infected (soldiers can pass); the infected attack what stops them. More equipment comes in defensive kits through logistics.</p>`;
      for (const k of ["sandbags", "barbed_wire", "concrete_barrier", "barricade", "mg_emplacement", "watchtower", "bunker", "reinforced_gate", "lighting"]) {
        const d = STRUCTURES[k], n = inv[k] || 0;
        html += `<div class="sup"><header><b>${E(d.name)}</b><button data-build="${k}"${n > 0 ? "" : " disabled"}>Place (${n})</button></header><small>${d.size ? d.size.join(" × ") + " m" : ""}${d.turret ? " · automatic " + WEAPONS[d.turret].name.toLowerCase() : ""}${d.slow ? " · slows and cuts the infected" : ""}${d.gate ? " · blocks the infected, soldiers pass" : ""}</small></div>`;
      }
    }
    if (html === this.panelSig) return;
    this.panelSig = html;
    $("panelTitle").textContent = title;
    $("panelBody").innerHTML = html;
  }
  panelClick(e: Event) {
    const b = (e.target as HTMLElement).closest("button") as HTMLButtonElement;
    if (!b || b.disabled) return;
    const g = this.s.game!, m = this.s.mission!;
    if (b.dataset.req) {
      const k = b.dataset.req, d = SUPPLIES[k];
      if (d.via === "land") { const why = g.logistics.request(k, g.fob.site!.x, g.fob.site!.y); if (why) this.toast(why); }
      else { this.c.setMode({ kind: "supply", item: k, rot: Math.atan2(1, 0) }); this.toast(d.strike ? "Click the target area" : "Click the drop point"); }
    }
    if (b.dataset.build) { this.c.setMode({ kind: "build", item: b.dataset.build, rot: 0 }); }
    if (b.dataset.fob === "manual") { this.c.setMode({ kind: "fob", rot: 0 }); }
    if (b.dataset.fobview) {
      if (b.dataset.fobview === "site" && g.fob.site) this.s.cam.lookAt(g.fob.site.x, g.fob.site.y, 90);
      else { const st = m.fobSites[+b.dataset.fobview]; if (st) this.s.cam.lookAt(st.x, st.y, 90); }
    }
    if (b.dataset.fobhere) { const st = m.fobSites[+b.dataset.fobhere]; if (st) { const why = g.fob.establish(st.x, st.y, st.rot); if (why) this.toast(why); else this.s.cam.lookAt(st.x, st.y, 90); } }
    this.panelSig = ""; this.renderPanel();
  }
  // ---------------------------------------------------------------- minimap
  mmXY(x: number, y: number): [number, number] { const b = this.s.bf.bounds, W = this.mm.width, H = this.mm.height; return [((x - b[0]) / (b[2] - b[0])) * W, ((b[3] - y) / (b[3] - b[1])) * H]; }
  mmMap(px: number, py: number): [number, number] { const b = this.s.bf.bounds, r = this.mm.getBoundingClientRect(); return [b[0] + (px / r.width) * (b[2] - b[0]), b[3] - (py / r.height) * (b[3] - b[1])]; }
  buildMinimapBase() {
    const bf = this.s.bf, L = bf.map.layers;
    const c = document.createElement("canvas"); c.width = this.mm.width * 2; c.height = this.mm.height * 2;
    const x = c.getContext("2d")!; x.scale(2, 2);
    x.fillStyle = bf.world.hasSea ? "#173040" : "#28331f"; x.fillRect(0, 0, this.mm.width, this.mm.height);
    const poly = (f: number[], fill: string) => { x.beginPath(); for (let i = 0; i < f.length; i += 2) { const [px, py] = this.mmXY(f[i], f[i + 1]); i ? x.lineTo(px, py) : x.moveTo(px, py); } x.closePath(); x.fillStyle = fill; x.fill(); };
    if (bf.world.hasSea) for (const r of L.land) poly(r.outer, "#2b3622");
    for (const w of L.water) poly(w.outer, "#1d3c50");
    x.lineCap = "round";
    for (const r of L.roads) {
      const p = r.pts; x.beginPath();
      for (let i = 0; i < p.length; i += 2) { const [px, py] = this.mmXY(p[i], p[i + 1]); i ? x.lineTo(px, py) : x.moveTo(px, py); }
      x.strokeStyle = r.class === "trunk" || r.class === "primary" || r.class === "secondary" ? "#c9b98a" : "#7a7660"; x.lineWidth = r.class === "trunk" ? 1.4 : r.class === "secondary" ? 1 : 0.5; x.stroke();
    }
    x.fillStyle = "rgba(190,180,160,.55)";
    for (const b of bf.map.buildings()) { const [px, py] = this.mmXY(b.ip[0], b.ip[1]); x.fillRect(px - 0.3, py - 0.3, 0.7, 0.7); }
    this.mmBase = c;
  }
  drawMinimap() {
    const g = this.s.game!, x = this.mmCtx, W = this.mm.width, H = this.mm.height;
    if (!this.mmBase) return;
    x.clearRect(0, 0, W, H);
    x.drawImage(this.mmBase, 0, 0, W, H);
    const m = this.s.mission!;
    const sc = W / (this.s.bf.bounds[2] - this.s.bf.bounds[0]);
    const COL = { red: "rgba(210,59,44,.42)", yellow: "rgba(224,183,44,.42)", green: "rgba(76,195,90,.42)", blue: "rgba(75,127,224,.5)" };
    for (const o of m.objectives) {
      if (o.phase === "fob") continue;
      const [px, py] = this.mmXY(o.x, o.y);
      x.beginPath(); x.arc(px, py, Math.max(4, o.r * 1.4 * sc), 0, Math.PI * 2); x.fillStyle = COL[m.zoneColor(o)]; x.fill();
      if (o.state === "active") { x.strokeStyle = "#ffd65a"; x.lineWidth = 1.5; x.stroke(); }
    }
    if (g.fob.site) { const [px, py] = this.mmXY(g.fob.site.x, g.fob.site.y); x.fillStyle = g.fob.established ? "#4b7fe0" : "#e0b72c"; x.fillRect(px - 4, py - 4, 8, 8); x.strokeStyle = "#fff"; x.strokeRect(px - 4, py - 4, 8, 8); }
    // infected near the task force (what the soldiers can see / hear)
    const us = g.liveUnits();
    x.fillStyle = "#ff4a3a";
    for (const z of g.zombies) {
      if (z.dead) continue;
      let seen = false;
      for (const u of us) if (Math.abs(u.x - z.x) < 110 && Math.abs(u.y - z.y) < 110) { seen = true; break; }
      if (!seen) continue;
      const [px, py] = this.mmXY(z.x, z.y); x.fillRect(px - 0.8, py - 0.8, 1.6, 1.6);
    }
    for (const n of g.nests) { if (n.dead) continue; const [px, py] = this.mmXY(n.x, n.y); x.fillStyle = "#ff3aa0"; x.beginPath(); x.arc(px, py, 2.5, 0, 7); x.fill(); }
    for (const c of g.civs) { if (c.dead || c.state === "gone") continue; const [px, py] = this.mmXY(c.x, c.y); x.fillStyle = "#6cc6ff"; x.fillRect(px - 1, py - 1, 2, 2); }
    for (const u of g.units) { if (!u.alive || u.inVehicle !== null) continue; const [px, py] = this.mmXY(u.x, u.y); x.fillStyle = u.selected ? "#bfff9a" : "#3ee05a"; x.fillRect(px - 1.5, py - 1.5, u.vehicle ? 4 : 3, u.vehicle ? 4 : 3); }
    for (const t of g.transports) { if (t.done) continue; const [px, py] = this.mmXY(t.x, t.y); x.fillStyle = "#cde"; x.fillRect(px - 1.5, py - 1.5, 3, 3); }
    // camera footprint
    const bf = this.s.bf, cv = bf.canvas, cam = this.s.cam;
    const pts = [[0, 0], [cv.clientWidth, 0], [cv.clientWidth, cv.clientHeight], [0, cv.clientHeight]].map(([a, b]) => bf.pick(a, b, cam.z));
    if (pts.every(Boolean)) { x.beginPath(); pts.forEach((p, i) => { const [px, py] = this.mmXY(p![0], p![1]); i ? x.lineTo(px, py) : x.moveTo(px, py); }); x.closePath(); x.strokeStyle = "rgba(255,255,255,.8)"; x.lineWidth = 1; x.stroke(); }
  }
  minimapInput() {
    let down = false;
    const go = (e: PointerEvent) => { const r = this.mm.getBoundingClientRect(); const [mx, my] = this.mmMap(e.clientX - r.left, e.clientY - r.top); this.s.cam.lookAt(mx, my); };
    this.mm.addEventListener("contextmenu", (e) => e.preventDefault());
    this.mm.addEventListener("pointerdown", (e) => {
      if (!this.s.game) return;
      e.stopPropagation();
      if (e.button === 2) {
        const r = this.mm.getBoundingClientRect(); const [mx, my] = this.mmMap(e.clientX - r.left, e.clientY - r.top);
        const sel = this.c.selected(); if (sel.length) { issue(this.s.game!, sel, { kind: "move", x: mx, y: my }, { formation: this.c.formation }); this.toast("Moving to the marked point"); }
        return;
      }
      down = true; this.mm.setPointerCapture(e.pointerId); go(e);
    });
    this.mm.addEventListener("pointermove", (e) => { if (down) go(e); });
    this.mm.addEventListener("pointerup", () => { down = false; });
  }
}
export { Unit };

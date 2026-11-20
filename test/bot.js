// Scripted commander used by the automated playthrough: plays Mission 01 through the same game API
// the UI uses (orders, logistics requests, FOB placement). Runs inside the page.
window.__bot = (function () {
  const A = window.__df, s = A.session;
  const M = { fobAuto: true };
  let lastOrder = -99, lastObj = "", log = [];
  const g = () => s.game;
  const live = () => g().units.filter((u) => u.alive && u.inVehicle === null);
  const centroid = (us) => { let x = 0, y = 0; for (const u of us) { x += u.x; y += u.y; } return [x / us.length, y / us.length]; };
  const order = ["lz", "cp_alpha", "city_hall", "engineers", "cp_bravo", "tpc", "cp_charlie", "market", "hospital", "port", "plaza"];
  function issueAll(o) { const G = g(); A.__issue(G, live(), o, { formation: "spread" }); lastOrder = G.time; }
  M.think = function () {
    const G = g(), m = G.mission, L = G.logistics;
    const us = live();
    if (!us.length) return "no units";
    // logistics
    const ammo = us.filter((u) => u.weapon).reduce((a, u) => a + u.ammoFrac, 0) / Math.max(1, us.filter((u) => u.weapon).length);
    const hp = us.reduce((a, u) => a + u.hp / u.maxHp, 0) / us.length;
    const [cx, cy] = centroid(us);
    const req = (k) => { if (!L.blocked(k)) { const why = L.request(k, cx, cy); if (!why) log.push(G.time.toFixed(0) + " request " + k); } };
    if (ammo < 0.45) req(G.fob.established ? "ammo_convoy" : "ammo_drop");
    if (hp < 0.55) req("medical_drop");
    if (us.length < 6) req("fireteam");
    for (const c of G.crates) if (!c.dead && Math.hypot(c.x - cx, c.y - cy) < 80 && !us.some((u) => u.order.kind === "interact")) { A.__issue(G, [us[0]], { kind: "interact", target: c.id }); }
    // liberation objectives in order
    const act = order.map((id) => m.objective(id)).filter((o) => o && o.state === "active");
    if (act.length) {
      const o = act[0];
      if (o.id !== lastObj) { lastObj = o.id; log.push(G.time.toFixed(0) + " -> " + o.id); }
      const inside = us.filter((u) => Math.hypot(u.x - o.x, u.y - o.y) < o.r).length;
      const d = inside >= us.length * 0.5 ? 0 : 1e9;
      // targets inside the zone: nests, boss, hidden survivors
      const nest = G.nests.find((n) => !n.dead && n.zone === o.id);
      const hiding = G.civs.filter((c) => c.objective === o.id && c.state === "hiding" && !c.dead);
      const idle = us.every((u) => !u.path && !u.pathPending);
      // like a player: give an order, let it play out; re-order when idle, or every 45 s if the target changed
      const tgtKey = o.id + ":" + (nest ? nest.id : hiding.length ? "civ" : "zone");
      if (idle || (G.time - lastOrder > 45) || (tgtKey !== M.lastKey && G.time - lastOrder > 8)) {
        M.lastKey = tgtKey;
        if (d > o.r * 0.6) issueAll({ kind: "attackMove", x: o.x, y: o.y });
        else if (nest) issueAll({ kind: "attack", target: nest.id });
        else if (hiding.length) issueAll({ kind: "attackMove", x: hiding[0].x, y: hiding[0].y });
        else {
          // sweep remaining infected in the zone
          let tz = null, bd = 1e9;
          for (const z of G.zombies) { if (z.dead) continue; const dz = Math.hypot(z.x - o.x, z.y - o.y); if (dz < o.r * 1.15) { const dd = Math.hypot(z.x - cx, z.y - cy); if (dd < bd) { bd = dd; tz = z; } } }
          if (tz) issueAll({ kind: "attackMove", x: tz.x, y: tz.y }); else issueAll({ kind: "attackMove", x: o.x + (Math.random() - .5) * 10, y: o.y + (Math.random() - .5) * 10 });
        }
      }
      return o.id + " " + o.progress;
    }
    // FOB phase
    if (!M.fobAuto) return "fob phase (manual)";
    if (m.state === "liberated" || m.state === "complete") {
      if (!G.fob.site) {
        const st = m.fobSites[0];
        if (st) { const why = G.fob.establish(st.x, st.y, st.rot); log.push(G.time.toFixed(0) + " FOB " + (why || "ok")); }
        else return "no fob sites";
      } else if (G.time - lastOrder > 15 && Math.hypot(cx - G.fob.site.x, cy - G.fob.site.y) > 40) issueAll({ kind: "move", x: G.fob.site.x, y: G.fob.site.y - 10 });
      if (G.fob.established) {
        const sup = m.objective("supply"), rf = m.objective("reinforce");
        if (sup && sup.state === "active" && !L.pending.some((p) => p.item === "ammo_convoy")) req("ammo_convoy");
        if (rf && rf.state === "active" && !L.pending.some((p) => L.def(p.item).units)) { req("heavy_team"); req("fireteam"); }
      }
      return "fob " + (m.objective("fob") || {}).progress;
    }
    return m.state;
  };
  M.run = function (seconds) {
    const G = g(), t0 = performance.now(), end = G.time + seconds;
    G.paths.timeCapMs = Infinity; // deterministic test runs
    let think = 0, status = "";
    while (G.time < end && s.mission.state !== "complete" && s.mission.state !== "failed") {
      if (G.time >= think) { status = M.think(); think = G.time + 1; }
      s.tick(1 / 30 + 1e-6);
    }
    const ms = performance.now() - t0;
    const m = s.mission;
    return { t: Math.round(G.time), ms: Math.round(ms), status, state: m.state, units: live().length, killed: G.stats.killed, lost: G.stats.lost, rescued: G.stats.rescued, zombies: G.zombies.length,
      done: m.objectives.filter((o) => o.state === "done").map((o) => o.id).join(","), log: log.splice(0) };
  };
  return M;
})();
window.__bot.dump = function (obj) {
  const s = window.__df.session, g = s.game;
  return { civs: g.civs.filter((c) => !obj || c.objective === obj).map((c) => ({ x: +c.x.toFixed(1), y: +c.y.toFixed(1), st: c.state, inb: (s.bf.map.buildingAt(c.x, c.y) || {}).id || null, path: c.path ? c.path.length : 0, idx: c.pathIdx, pend: c.pathPending, leader: c.leader })),
    tr: g.transports.map((t) => ({ x: +t.x.toFixed(1), y: +t.y.toFixed(1), t: +t.t.toFixed(0), del: t.delivery, done: t.done })),
    units: g.units.filter((u) => u.alive).map((u) => [u.type, +u.x.toFixed(0), +u.y.toFixed(0), u.order.kind, !!u.path, u.pathIdx, u.path ? u.path.length : 0]), paths: g.paths.stats };
};

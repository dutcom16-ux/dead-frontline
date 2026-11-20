// Mission 01 — Operation Reclamation: retake Toledo City. Every objective sits on a real place in the
// map package: OSM landmarks (city hall, market, hospital, port, power plant, plaza), named OSM roads
// and junctions (Naga–Toledo Road, Antonio Y. de Pio Highway, Diosdado Macapagal Highway, Rafols St).
import type { Game } from "../Game";
import { Mission, Objective } from "./Mission";
import { OP01 } from "../data";
import { dist } from "../core";
import { FOB_SIZE } from "../fob/Fob";

type Pt = [number, number];
const MIX = {
  street: { walker: 70, runner: 18, crawler: 10, screamer: 2 },
  heavy: { walker: 55, runner: 18, crawler: 8, brute: 8, bloater: 8, screamer: 3 },
  port: { walker: 55, runner: 30, crawler: 8, bloater: 4, mutant: 3 },
  hospital: { walker: 55, runner: 12, crawler: 18, bloater: 12, screamer: 3 },
};

export function buildOp01(g: Game, spawn = true): Mission {
  const bf = g.bf;
  const m = new Mission(g, "op01", OP01.name);
  const lm = (id: string, fallback: Pt): Pt => { const l = bf.landmark(id); return l && l.center ? [l.center[0], l.center[1]] : fallback; };
  const road = (name: string, near: Pt): Pt => bf.roads.nearestOn(near[0], near[1], name);
  const LZ = road("Naga-Toledo Road", [2321, -190]);
  const ALPHA = road("Naga-Toledo Road", [2378, 205]);
  const CITY_HALL = lm("city_hall", [2350.64, 421.8]);
  const SANGI_ES: Pt = [1750, 1183];
  const BRAVO = road("Antonio Y. de Pio Highway", [1431.53, 1212.06]);
  const TPC = lm("tpc", [749.74, 1218.97]);
  const CHARLIE = road("Rafols Street", [-177.89, -15.14]);
  const MARKET = lm("public_market", [-135.26, 111.33]);
  const HOSPITAL = lm("general_hospital", [159.69, -422.98]);
  const PORT: Pt = (() => { const p = lm("toledo_port", [-329.44, 177.8]); return [(p[0] - 296) / 2, (p[1] + 107) / 2] as Pt; })();
  const PLAZA = lm("city_plaza", [-294.51, -133.44]);
  m.lz = LZ;
  const add = (o: Partial<Objective> & { id: string; title: string; short: string; desc: string; kind: Objective["kind"]; at: Pt; r: number; requires: string[] }) =>
    m.add({ phase: "liberate", x: o.at[0], y: o.at[1], ...o } as any);
  add({ id: "lz", title: "Secure the landing zone on the Naga–Toledo Road", short: "LZ", desc: "Clear the infected around the drop-off point east of the city.", kind: "secure", at: LZ, r: 45, requires: [] });
  add({ id: "cp_alpha", title: "Clear checkpoint Alpha (Naga–Toledo Road)", short: "Checkpoint Alpha", desc: "Abandoned vehicles and infected block the main road into Toledo near Jacinta Larosa Elementary School.", kind: "secure", at: ALPHA, r: 45, requires: ["lz"] });
  add({ id: "city_hall", title: "Secure Toledo City Hall and rescue the city staff", short: "City Hall", desc: "City officials barricaded themselves inside the city hall complex (OSM: Toledo Garden City Hall).", kind: "rescue", at: CITY_HALL, r: 60, requires: ["cp_alpha"] });
  add({ id: "engineers", title: "Find the 3rd Engineer platoon at Sangi Elementary School", short: "Engineers", desc: "Radio silence for 72 hours. Survivors will join the task force.", kind: "join", at: SANGI_ES, r: 50, requires: ["city_hall"] });
  add({ id: "cp_bravo", title: "Clear checkpoint Bravo (Naga–Toledo Road / Antonio Y. de Pio Highway, Sangi)", short: "Checkpoint Bravo", desc: "Key intersection controlling the coastal highway north and south.", kind: "secure", at: BRAVO, r: 50, requires: ["city_hall"] });
  add({ id: "wrecks", title: "Optional: clear the wrecks at checkpoint Bravo", short: "Wrecks", desc: "Combat engineers can drag abandoned vehicles off the junction.", kind: "clear_wrecks", at: BRAVO, r: 40, requires: ["cp_bravo"], optional: true });
  add({ id: "tpc", title: "Secure the Toledo Power Company plant and destroy the nest", short: "Power plant", desc: "Industrial site on the coast. An infected nest has formed inside the compound.", kind: "destroy", at: TPC, r: 75, requires: ["cp_bravo"] });
  add({ id: "cp_charlie", title: "Secure the Poblacion junction (Diosdado Macapagal Highway / Rafols Street)", short: "Poblacion junction", desc: "Gateway to the old town centre, the market and the port.", kind: "secure", at: CHARLIE, r: 50, requires: ["cp_bravo"] });
  add({ id: "market", title: "Rescue survivors at Toledo Public Market", short: "Market", desc: "Vendors are hiding in the market halls. A nest has formed nearby.", kind: "rescue", at: MARKET, r: 55, requires: ["cp_charlie"] });
  add({ id: "hospital", title: "Secure Toledo City General Hospital", short: "Hospital", desc: "Medical staff are trapped inside. Expect bloaters and crawlers in the wards.", kind: "rescue", at: HOSPITAL, r: 60, requires: ["cp_charlie"] });
  add({ id: "port", title: "Secure the Port of Toledo", short: "Port", desc: "Needed for sea supply and the naval phase of the campaign.", kind: "secure", at: PORT, r: 75, requires: ["market"] });
  add({ id: "plaza", title: "Destroy the main infected concentration at Toledo City Plaza", short: "City Plaza", desc: "The ABOMINATION and the largest nest are around the plaza and the Sahagun shrine.", kind: "destroy", at: PLAZA, r: 65, requires: ["port", "hospital", "tpc"], boss: true });
  m.add({ id: "fob", phase: "fob", title: "Establish the Forward Operating Base", short: "FOB", desc: "Choose open ground near a road. Only one FOB is allowed for the whole campaign.", kind: "fob", x: PLAZA[0], y: PLAZA[1], r: 60, requires: ["liberated"] });
  m.add({ id: "supply", phase: "fob", title: "Request supplies through FOB logistics", short: "Supplies", desc: "Order ammunition, medical supplies or equipment and receive the delivery.", kind: "supply", x: PLAZA[0], y: PLAZA[1], r: 60, requires: ["fob"] });
  m.add({ id: "reinforce", phase: "fob", title: "Deploy reinforcements", short: "Reinforcements", desc: "Bring a reinforcement team into Toledo through logistics.", kind: "reinforce", x: PLAZA[0], y: PLAZA[1], r: 60, requires: ["fob"] });
  m.add({ id: "repel", phase: "fob", title: "Optional: repel the first attack on the FOB", short: "Defend FOB", desc: "Build sandbags, wire and barriers; keep the gate shut.", kind: "repel", x: PLAZA[0], y: PLAZA[1], r: 90, requires: ["fob"], optional: true });

  m.fobSites = [];
  g.onEvent = chain(g.onEvent, (ev) => {
    if (ev === "liberated") {
      const near: Pt[] = [PLAZA, PORT, MARKET, CHARLIE];
      m.fobSites = bf.findOpenSites(FOB_SIZE.W + 4, FOB_SIZE.D + 4, near, 6);
    }
  });
  if (!spawn) return m;
  // ---- infected populations (counts for "medium"; scaled to the difficulty budget)
  const budget = OP01.zombies[g.difficulty] as number;
  const zones: [string, Pt, number, number, any][] = [
    ["lz", LZ, 12, 55, MIX.street], ["cp_alpha", ALPHA, 22, 40, MIX.street], ["city_hall", CITY_HALL, 30, 55, { ...MIX.heavy, screamer: 4 }],
    ["engineers", SANGI_ES, 16, 45, MIX.street], ["cp_bravo", BRAVO, 24, 45, MIX.street], ["tpc", TPC, 34, 70, MIX.heavy],
    ["cp_charlie", CHARLIE, 26, 45, MIX.street], ["market", MARKET, 30, 50, MIX.heavy], ["hospital", HOSPITAL, 28, 55, MIX.hospital],
    ["port", PORT, 30, 70, MIX.port], ["plaza", PLAZA, 38, 55, { ...MIX.heavy, mutant: 4 }],
  ];
  const wanderers = 50;
  const total = zones.reduce((s, z) => s + z[2], 0) + wanderers;
  const k = budget / total;
  for (const [id, at, n, r, mix] of zones) g.spawnGroup(at[0], at[1], Math.max(3, Math.round(n * k)), r, id, mix);
  // wanderers along real streets, away from the landing zone
  const nodes = bf.roads.nodes.filter((nd) => dist(nd.x, nd.y, LZ[0], LZ[1]) > 300 && nd.x > bf.playBounds[0] && nd.x < bf.playBounds[2] && nd.y > bf.playBounds[1] && nd.y < bf.playBounds[3]);
  for (let i = 0; i < Math.round(wanderers * k) && nodes.length; i++) {
    const nd = nodes[g.rng.int(nodes.length)];
    g.spawnGroup(nd.x, nd.y, 1 + g.rng.int(3), 6, "street", MIX.street);
  }
  // nests and the boss, on ground the squad can actually reach from the road network
  const nT = reachableNear(g, [TPC[0] - 25, TPC[1] + 10]), nM = reachableNear(g, [MARKET[0] + 18, MARKET[1] + 22]), nP = reachableNear(g, [PLAZA[0] + 8, PLAZA[1] - 6]);
  g.addNest(nT[0], nT[1], "tpc");
  g.addNest(nM[0], nM[1], "market", 0.8);
  g.addNest(nP[0], nP[1], "plaza", 1.5);
  const bp = reachableNear(g, [PLAZA[0] - 10, PLAZA[1] + 12]);
  const boss = g.addZombie("abomination", bp[0], bp[1], "plaza");
  if (boss) { g.bossId = boss.id; }
  for (const [id, at] of [["plaza", PLAZA], ["market", MARKET]] as [string, Pt][]) g.spawnGroup(at[0], at[1], 2, 20, id, { brute: 1 });
  // abandoned vehicles at the checkpoints (leave a lane open)
  wrecks(g, ALPHA, 3); wrecks(g, BRAVO, 4); wrecks(g, CHARLIE, 2);
  // survivors inside real buildings
  civilians(g, m, "city_hall", CITY_HALL, 6, bf.landmark("city_hall")?.main_building || null);
  civilians(g, m, "market", MARKET, 7, bf.landmark("public_market")?.main_building || null);
  civilians(g, m, "hospital", HOSPITAL, 6, bf.landmark("general_hospital")?.main_building || null);
  for (const t of ["engineer", "rifleman", "machine_gunner"]) {
    const p = bf.freeNear(SANGI_ES[0] + g.rng.range(-8, 8), SANGI_ES[1] + g.rng.range(-8, 8), 30) || SANGI_ES;
    g.addCivilian(p[0], p[1], "engineers", t);
  }
  // the squad lands at the LZ
  const dir = Math.atan2(ALPHA[1] - LZ[1], ALPHA[0] - LZ[0]);
  (OP01.squad as string[]).forEach((t, i) => {
    const row = Math.floor(i / 3), col = (i % 3) - 1;
    const x = LZ[0] - Math.cos(dir) * row * 3 + Math.sin(dir) * col * 3, y = LZ[1] - Math.sin(dir) * row * 3 - Math.cos(dir) * col * 3;
    const u = g.addUnit(t, x, y); u.heading = dir;
  });
  return m;
}

function chain(a: (ev: string, d?: any) => void, b: (ev: string, d?: any) => void) { return (ev: string, d?: any) => { a(ev, d); b(ev, d); }; }

/** a point near `want` with a walkable route from the main road network (falls back to the road itself) */
export function reachableNear(g: Game, want: Pt): Pt {
  const G = g.bf.roads, ph = g.bf.phys;
  const rn = G.near(want[0], want[1], 300, 1, true)[0];
  if (rn === undefined) return want;
  const r: Pt = [G.nodes[rn].x, G.nodes[rn].y];
  for (let rad = 0; rad <= 40; rad += 10) {
    for (let k = 0; k < (rad ? 8 : 1); k++) {
      const a = (k / 8) * Math.PI * 2;
      const p = g.bf.freeNear(want[0] + Math.cos(a) * rad, want[1] + Math.sin(a) * rad, 8);
      if (!p) continue;
      if (dist(p[0], p[1], r[0], r[1]) < 2 || ph.findPath(r[0], r[1], p[0], p[1], { margin: 30, maxCells: 600, maxExpand: 150000, who: "plan" })) return p as Pt;
    }
  }
  return g.bf.freeNear(r[0], r[1], 15) as Pt || r;
}

function wrecks(g: Game, at: Pt, n: number) {
  const ns = g.bf.roads.near(at[0], at[1], 40, 6);
  for (let i = 0; i < n; i++) {
    const nd = g.bf.roads.nodes[ns[i % Math.max(1, ns.length)]] || { x: at[0], y: at[1], e: [] as number[] };
    const nb = g.bf.roads.nodes[nd.e[0]] || nd;
    const a = Math.atan2(nb.y - nd.y, nb.x - nd.x);
    const off = (i % 2 ? 1 : -1) * 2.6;
    const x = nd.x + Math.cos(a + Math.PI / 2) * off + g.rng.range(-3, 3), y = nd.y + Math.sin(a + Math.PI / 2) * off + g.rng.range(-3, 3);
    if (!g.bf.walkable(x, y)) continue;
    g.addObstacle("wreck", x, y, a + Math.PI / 2 + g.rng.range(-0.5, 0.5));
  }
}

function civilians(g: Game, m: Mission, obj: string, at: Pt, n: number, bid: string | null) {
  const b = bid ? g.bf.map.getBuilding(bid) : null;
  const ein = b && b.enter && b.ent ? g.bf.map.entrancePoint(b, -0.8) : null;
  for (let i = 0; i < n; i++) {
    let p: Pt | null = null;
    if (b && b.enter && ein) {
      // inside the real building: points within the footprint that can be reached from its door
      const bb = b.bb;
      for (let t = 0; t < 40 && !p; t++) {
        const x = bb[0] + Math.random() * (bb[2] - bb[0]), y = bb[1] + Math.random() * (bb[3] - bb[1]);
        if (dist(x, y, ein.x, ein.y) > 45) continue;
        if (g.bf.phys.isInside(b, x, y) && g.bf.walkable(x, y) && g.bf.phys.findPath(ein.x, ein.y, x, y, { margin: 6, maxCells: 260, maxExpand: 30000, who: "plan" })) p = [x, y];
      }
    }
    if (!p && b) { const e = g.bf.map.entrancePoint(b, 2.5); p = g.bf.freeNear(e.x + g.rng.range(-3, 3), e.y + g.rng.range(-3, 3), 10) as Pt; }
    if (!p) p = g.bf.freeNear(at[0] + g.rng.range(-12, 12), at[1] + g.rng.range(-12, 12), 30) as Pt;
    if (p) g.addCivilian(p[0], p[1], obj);
  }
  void m;
}

/** horde that tests the FOB defences, sent once the FOB is established */
export function fobWave(g: Game, m: Mission) {
  if (m.waveSpawned || !g.fob.site) return;
  m.waveSpawned = true;
  const s = g.fob.site;
  const a = g.rng.next() * Math.PI * 2;
  const p = g.bf.freeNear(s.x + Math.cos(a) * 170, s.y + Math.sin(a) * 170, 60) || [s.x + 170, s.y];
  const n = g.difficulty === "high" ? 45 : g.difficulty === "low" ? 18 : 30;
  const zs = g.spawnGroup(p[0], p[1], n, 25, "fob_wave", { walker: 60, runner: 25, brute: 5, bloater: 5, screamer: 5 });
  for (const z of zs) { z.awake = true; z.state = "investigate"; z.goalX = s.x + g.rng.range(-10, 10); z.goalY = s.y + g.rng.range(-10, 10); }
  g.radio("Scouts: a horde is moving on the FOB! Man the defences.", "warn");
}

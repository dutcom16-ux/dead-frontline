# DEAD FRONTLINE: FOB WARFARE

A browser-based 2.5D isometric real-time strategy game. A military task force retakes the
Philippines from a zombie outbreak, one city at a time. The first battlefield is the **real street
plan of Toledo City, Cebu**: OpenStreetMap roads, coastline, landmarks and buildings.

**Map in use:** `public/maps/toledo_poblacion.mapz` is the package taken from the single-file
Toledo map you built (`toledo_poblacion.html`). It has the OSM-mapped buildings only: 422 buildings,
542 roads, 11 landmarks, no corrections. The fuller package with ~10,000 AI-detected footprints
(Overture/Microsoft) and the Barba sports-complex fix is kept in
`maps-archive/toledo_poblacion_overture.mapz`. To use it instead, copy it over
`public/maps/toledo_poblacion.mapz` and rebuild. Any map package from the toledo-map pipeline works
the same way.

* **No gathering economy.** No mining, farming, wood or gold, and no expansion. Everything arrives
  through military logistics: limited stock per mission, delivery times, cooldowns and restrictions.
* **One permanent FOB.** You can build it only after Toledo is liberated, and only once per campaign.

## Run it

```bash
npm install            # esbuild + typescript (dev only; the game has no runtime dependencies)
npm install -D playwright && npx playwright install chromium   # only for the automated tests
npm run dev            # http://localhost:5173, rebuilds on save
npm run build          # dist/ — static files for any HTTPS host (vercel.json is set up: build "npm run build", output "dist")
npm run typecheck
npm run build && npm test   # headless playthrough of the 16 acceptance criteria (Playwright + Chromium)
```

To play, open `dist/index.html` from a web server. Opening it as `file://` won't work, because the
service worker and module loading need http(s). After the first visit the game works offline, and you
can install it as an app from Chrome, Edge or Brave.

## What is implemented (vertical slice: Mission 01 + FOB)

| Area | State |
|---|---|
| Real Toledo City battlefield | ✔ your map package: the OSM road network, coast, landmarks, buildings. Chunk streaming, LOD, frustum culling |
| Isometric 2.5D camera | ✔ orthographic, 90° rotation (Q/E), WASD/arrows, edge scroll, wheel/pinch zoom, drag pan, bounds, smoothing |
| RTS controls | ✔ click/box/shift select, double-click selects a squad, squad chips, control groups, right-click move/attack/board/collect, queued orders (Shift) |
| Squads & formations | ✔ every soldier belongs to a squad with one leader (Alpha at the start; each reinforcement team arrives as its own squad; rescued soldiers join the nearest squad). Six formations: wedge, line, column, box, circle, defensive. Members hold slots that swing round with the squad on curved paths, plan their own path when the way is blocked, and fall into file in narrow streets. The leader sets the pace and waits for stragglers. Several squads move side by side without mixing |
| Formation combat | ✔ on attack-move the squad stops to fight; line, wedge and column turn to face the threat (also from behind); in a halted formation each soldier covers his own arc; fire spreads across targets; reloads in lulls; medics and engineers go in the middle of a box or circle; the radio warns when the squad is surrounded; too many infected at close range break the formation (soldiers fall back on their own, still shooting) and the squad regroups when the pressure drops |
| Command | ✔ if the leader is killed or infected, the best remaining soldier takes command and the squad carries on with its order; you can name a new leader |
| Infection | ✔ a bite can infect a soldier (5 % per bite on medium, less with armour; ×0.5 on low, ×1.5 on high). He turns 22–36 s later (countdown over his head), and the new infected goes for his own squad. A soldier killed while infected rises 4 s later |
| Corpse piles | ✔ bodies stack where they fall (1.5 m cells, about 0.17 m per body, up to 1.7 m). Piles slow anyone crossing them, lift whoever stands on them, and once a pile reaches the top of sandbags, a barricade, a concrete barrier, an MG nest or a wreck, the infected climb over it |
| Commands | ✔ move, attack-move, attack (focus fire), stop, hold, defend, patrol, follow, retreat, interact, board/unload, build, clear wreck |
| Infantry (10) | ✔ rifleman, assault, sniper, machine gunner, shotgun, flamethrower, rocket, medic (heals), engineer (builds, clears), special forces. The starting squad has 9: two riflemen, assault, MG, sniper, shotgun, rocket, medic, engineer. Drawn from your military personnel sprite sheet in 8 directions: walking, firing toward the target (dedicated north and south stances, a small muzzle flash at the barrel on every shot) and dying (plays once, the body stays) |
| Vehicles (6) | ✔ jeep, APC, IFV, tank, transport truck (ammo for nearby infantry), recovery vehicle (repairs). You get them through logistics once the FOB motor pool is built, and they arrive at the FOB gate. They crush infected, carry passengers (right-click a vehicle to board, U to unload) and draw as simple box models |
| Infected (8) | ✔ walker, runner, crawler, brute (knockback, breaks doors), bloater (explodes), screamer (calls hordes), mutant (leaps), Abomination (boss, ground slam). Drawn from your sprite sheets in steadied 8-direction views: walk, run and crawl cycles follow the distance moved, attacks land on the real hit, and the dead fall over before lying still (the Abomination stays a 3D model) |
| Infected AI | ✔ sight with line of sight, hearing (gunfire, explosions, screams), pursuit with shared flow fields, swarming, losing targets, investigating noise, breaking doors and defences, attacking vehicles |
| Combat | ✔ per-weapon damage, range, rate, magazine, reserve, reload, accuracy (range, movement, suppression, rank), armor, suppression, pellets, piercing, rockets and shells, explosions with friendly fire, fire and burning, building damage, line of sight |
| Mission 01 | ✔ 11 objectives at real places, survivors and helicopter evacuation, military survivors who join you, nests, boss, wrecks, victory/defeat, debrief |
| FOB | ✔ site check (open, dry, gentle slope, near a road, area secure), suggested sites, timed construction of 8 facilities plus walls, gate and towers. Facilities are added to the live map as real buildings. Hospital, depot, ammo and repair services |
| Logistics | ✔ 16 request types in 7 categories, with stock, delivery time, cooldown and requirements. Helicopter drops and road convoys. Reinforcements, vehicles, defence kits, artillery, helicopter gun run |
| Defences | ✔ sandbags, barbed wire, concrete barrier, barricade, MG emplacement (automatic), watchtower, bunker, reinforced gate, lighting. Engineers build them; infected attack and break them |
| Campaign | ✔ persistent campaign (Operation Reclamation), 4 phases and 20 operations on a strategic map, territory colours red/yellow/green/blue, FOB location kept, veteran roster |
| UI | ✔ main menu, difficulty, strategic map, briefing, objectives, radio, minimap with territory, unit panel, commands, logistics/reinforcement/FOB/build panels, pause, settings, save/load (3 slots + autosave), debrief, about |
| Audio | ✔ synthesised WebAudio effects (weapons, explosions, infected, radio, helicopters). No audio files needed |
| Offline / PWA | ✔ service worker precache, IndexedDB saves (falls back to localStorage, then memory), installable, Brave Shields handled |
| Touch | ✔ tap select/command, drag pan, pinch zoom, long-press or ▭ box select, on-screen buttons |

## Squad and formation controls

| Do this | How |
|---|---|
| Select one soldier / a whole squad | click / double-click a soldier, or tap a squad chip (bottom left); tap a chip twice to centre on it |
| Choose a formation | **K** cycles (Shift+K back), or the formation button opens a menu: Wedge, Line, Column, Box, Circle, Defensive |
| Move / attack-move | right-click / **Z**. Select the whole squad to move it in formation; picking out some soldiers sends them on their own (they show as *detached*) |
| Hold position | **H**: every soldier stays exactly where he is |
| Defend a position | **G**, then click the spot: soldiers spread round it and man nearby sandbags, barriers and MG nests first. **G** twice defends where the squad stands |
| Face a direction | **V**, then click: the formation turns that way |
| Regroup | **Y**: detached soldiers rejoin and the squad forms up on its leader |
| Make leader | select one soldier, **J** |
| New squad | select soldiers, **N**: they leave their squads and form a new one |
| Retreat | **R**: back to the FOB (or the landing zone) |

## Tested

`npm test` runs `test/playthrough.test.mjs`, a headless Chromium playthrough of the 16 acceptance
criteria. It uses the real menus, mouse and keyboard for the parts a player does by hand: start the
operation, pan/zoom/rotate the camera, box-select, right-click move, order an ammo drop through the
Logistics panel, choose the FOB site in the FOB panel, order a convoy and reinforcements, then save
from the pause menu, reload the page and load the slot. A scripted commander (`test/bot.js`) plays
the long middle of the mission through the same order and logistics calls the UI uses. The
simulation is seeded and stepped by the test (`?manualtick`), so runs repeat exactly.

Results on the current map (your `toledo_poblacion.html` package, 422 OSM buildings):

| Run | Result |
|---|---|
| Low infection | **16/16 criteria pass, 0 page errors** (squads moving in formation, infection on). Toledo liberated after ~61 game minutes, 255 infected killed, 1 loss, 19 survivors evacuated, FOB established, convoy + heavy weapons team delivered, save → reload → load restores the same state including squads (IndexedDB) |
| Medium infection | **16/16 criteria pass, 0 page errors** (squads, infection on). Toledo liberated after ~67 game minutes (389 infected killed, 16 losses), all 19 survivors evacuated |
| Systems check (`npm run test:systems`) | vehicles drive and carry passengers; engineer-built sandbags + MG emplacement stop a horde; artillery strike; debrief → strategic map with Toledo green and the next operation unlocked; 0 errors |
| Phones (`npm run test:mobile`) | Android-sized landscape and portrait layouts with the squad chips and 14 commands; tap select works; 0 errors |
| Soldier animation (`npm run test:anim`) | **35/35 checks pass.** Runs the real sprite drawing at 30 fps while a squad marches a square, turns about and fights; one soldier fires and walks in all 8 directions; each of the 10 classes fires at a target and moves past it; 8 soldiers die in 8 views. Checked: walk/idle/fire/dying frames in every direction at one standing height; barrel tips on the rifle (north stance above the helmet, south at the chest); views change one step at a time without flicker; the walk cycle follows distance and starts with a step; every shot shows the shot frame and its flash, never a flash without a shot; automatic weapons stay steady through a burst, single shots kick once; classes that fire on the move keep the firing stance, the others walk; dying plays once and holds; no pose for a dead soldier |
| Unit animation (`npm run test:units`) | **82/82 checks pass.** Every infected type walks out in 8 directions, stands, sprints in from 30 m, attacks a soldier and dies; turned soldiers, survivors (sprite and 3D) and the abomination likewise; then a crowd of 200. Checked per type: views step one at a time without flicker and match the direction of travel; each view uses its own drawn clip; cycles follow distance at a cadence that suits the pace (at most 12.4 frame changes a second when sprinting); standing keeps one frame, side-on with the feet together; every hit shows the full reach; deaths play once and the body stays; the abomination and 3D survivors alternate their steps with their feet on the ground; animation state is freed for the dead |
| Game-wide animation (`npm run test:battle`) | **10/10 checks pass.** 20 move orders in 8 s then a halt; selection and deselection while moving; 22 units (with a jeep and a tank) against 132 infected of every type from all sides, the squad advancing mid-fight. No skipped views or flicker across 151 animated figures, nobody walking on the spot, selection rings follow, deaths in combat play once and hold, no missing frames; sprite drawing 0.5 ms a frame on average |
| Formations (`npm run test:formations`) | **20/20 checks pass, 0 page errors** — the 10 scenarios of the spec plus corpse-pile climbing, defensive positions, player commands and all six shapes (details below) |

Formation scenarios (`test/formations.mjs`, each on a fresh squad at the landing zone):

| # | Scenario | Measured |
|---|---|---|
| 1 | Line moves without overlapping | closest two soldiers 2.5 m apart all the way; line gaps exactly 3.0 m on arrival |
| 2 | Line → column | 20 m file, nobody more than 1.1 m off the centre line |
| 3 | Wedge turns 90° | formation swings at ≤ 1.3 rad/s (no snapping); soldiers 0.5 m off their slots on average after the turn |
| 4 | A member dies | 8 soldiers re-spaced, no hole in the line |
| 5 | Leader dies on the move | the next soldier takes command, the squad keeps moving and arrives |
| 6 | Fire while holding positions | 12/12 infected killed, 6 of 9 soldiers firing, nobody more than 0.6 m from his slot |
| 7 | Infected from four sides (circle) | 20/20 killed, kills in all four directions, outward-facing slots |
| 7b | Infected from behind (line) | the line swings round in 1.2 s and ends facing them |
| 8 | Overwhelmed | 26 infected on a 5-man squad: the formation breaks after ~2 s and soldiers fall back |
| 9 | Infected leader | command passes on the bite; he turns and goes for his own squad |
| 10 | After the turn | the squad kills him and re-forms 8 soldiers in 8 slots |
| 11 | Corpse pile at a sandbag wall | 3 riflemen vs. waves of 40: bodies pile ~1 m high, the infected climb the 0.9 m sandbags and overrun the line |
| 12 | Defend a position | one soldier mans the MG nest, two take the sandbags, the rest spread round the point |
| 13 | Player commands | set leader, face, two soldiers detached and regrouped, hold, two squads moving independently |

Running the mission with squads found three problems, all fixed:

* A leader sent off on a job (picking up a crate) kept taking command back as he returned, and the
  squad restarted its route every time. Now a stand-in leads until the leader has caught up and stayed
  with the squad for 3 s, and whoever leads carries on along the same route.
* Squads attacking a nest in dense streets trailed behind the leader and never got a line of fire.
  An attack on a nest or a structure is now an assault: each soldier finds his own firing position,
  and the squad re-forms on its leader when the target is destroyed.
* On medium the task force was wiped out at the Plaza: a broken formation fell back without
  shooting. Falling back is now a fighting withdrawal (soldiers shoot on the move).

Playing on this map earlier found two real problems, both fixed:

* Paths round very large buildings (the market hall) fell back to a straight line through the
  walls. A wider second search now goes round them.
* Units with an attack order stopped to fire at every infected spawning from a nest and ran dry
  before reaching it. Now they advance and shoot on the move, and stop only for the target or a
  threat within 8 m.

Earlier, on the ~10,000-building map, low infection also passed 16/16. High infection has not been
run by the automated test.

## Not implemented yet (honest list)

* **Operations after Mission 01.** The strategic map shows all 20 operations of Phases 1–4 and
  unlocks them, but only Mission 01 has a battlefield. The others say "not built yet".
* **Naval operations (Stage 7).** There are no ships or naval combat. The landing craft is listed in
  logistics with stock 0 and is locked behind a campaign flag.
* **Strategic map coastlines.** Operation markers sit at real coordinates, but island outlines are not
  drawn. Natural Earth data could be added.
* **Art.** Every infantry class uses your soldier collection sheet (walk, run, idle, firing standing and
  on the move; see `docs/ASSETS.md`). Deaths use the 8-direction rifleman sheet, soldiers who turn into
  infected the 8-direction infected-soldier sheet, other infected the earlier infected sheet.
* **What the soldier sheet doesn't have.** Its direction labels don't match the drawings, so frames
  were re-sorted by the way they really face. What is truly drawn: walk front / front-right /
  back-right / back, run front-right / back-right / back, firing front-right and back-right (standing
  and moving), idle front / front-right / back-right / back; left-facing views are mirrors. So:
  right and left use the three-quarter front view (no profile), a soldier firing straight at or away
  from the camera uses the nearest three-quarter view, running toward the camera uses the front walk
  frames at running pace. Cycles are as drawn: 4 frames for walk, run and firing (3 for walking
  back-right), 2 for idle — fewer than the 8–12 your spec asks for. There are no death, reload or
  kneeling frames (reload shows idle, kneeling positions show the aim pose). Frames are about 67 px
  tall, so close zoom looks soft. The Abomination,
  living civilians, vehicles and defences are still code-generated low-poly models. Buildings use the
  procedural Philippine archetypes from the Toledo map engine.
* **Infected directions are approximate.** The infected sheet has front, three-quarter front, side
  and back views, so the game draws eight directions from those (west = east mirrored); there is no
  walk cycle from behind.
  All infantry classes share one soldier look; bloater, brute, screamer and mutant are the walker art
  tinted and scaled.
* **Infection has no cure.** Medics heal wounds, not bites. Once infected, a soldier will turn.
* **Corpse piles don't block shots.** Piles slow movement and let the infected climb defences, but
  bullets and line of sight pass over them. The infected cannot climb walls, gates, bunkers or towers.
* **Surrounded squads don't switch formation by themselves.** The radio tells you to form a circle or
  box; the switch is your order (as the spec asks). Breaking under pressure and regrouping are automatic.
* **Infected vs. FOB buildings.** Infected attack defences, gates and doors. They do not damage the
  FOB facility buildings themselves.
* **Vehicles in tight alleys.** Vehicles plan on the same 0.5 m grid as infantry. They back up and
  retry when blocked, but in narrow yards they can still get stuck. Keep them on main roads, where
  logistics delivers them (the FOB gate).
* **Pathing on this map.** Units now detour, sidestep corners and, as a last resort, step out to
  the street after about 12 s without progress. That last step is visible as a short hop. The causes
  are AI-detected footprints that overlap roads or each other, and OSM bridges that end at the bank.
* **Soldier sprites.** The military sheet has no running, moving-while-firing, reloading or kneeling
  frames. Soldiers who fire on the move keep the firing stance while moving (their feet don't step);
  there is no reload animation; formation soldiers stand at the ready instead of kneeling. Walking and
  firing have 3 drawn frames per direction, so the walk cycle is stride, pass, stride, pass. The
  sheet's south-east groups are drawn facing east, so a soldier going south-east is shown side-on
  (as drawn, rifle in the right hand) until there is south-east art. All ten classes share the rifleman
  sprite. Tracers start at the 3D rifle height, slightly below the
  sprite's barrel.
* **Infected sprites.** The infected sheet is a collection of loosely related frames: rows mix
  different people and facings and are not in leg order. Clips are rebuilt from frames of one person
  and one facing (`docs/ASSETS.md`), but there is no front (south) walk, no NE/NW view and no falling
  frames: south uses the south-west view, NE/NW the side view, and the fall is the last pose tipping
  over. Standing infected keep one frame (the idle rows change face every frame). The turned soldier's
  walk has a single stride played back and forth, so his legs don't alternate. A dark background
  shading drawn next to some infected figures can't be told apart from their dark clothes, so it stays.
  New art for these would remove the fallbacks.
* **Asset loader.** Sprite sheets load (`public/sprites/`). There is no glTF model import yet (see
  `docs/ASSETS.md`).
* **Day/night, weather and music.** Not done. There is ambient wind only.
* **Engine choice.** The spec prefers Phaser 3 + Vite. Network installs are blocked in the build
  environment, so the game runs on the project's own zero-dependency WebGL2 engine, the same one that
  renders the real Toledo map, with an esbuild dev server and build. The layout is Vite-style
  (`index.html` → `/src/main.ts`), so `vite` can replace `tools/dev.mjs` and `tools/build.mjs` without
  code changes. Phaser was not used.

## Map data and accuracy

* Roads, coast, landmarks and names: © OpenStreetMap contributors (ODbL).
* Building footprints: OSM where mapped. Elsewhere they are AI-detected footprints from Overture Maps /
  Microsoft (ODbL).
* Heights, roofs and facades are **estimates**, not measurements. Landmark matches (city hall,
  hospital, market, port, power plant, plaza) come from OSM names and tags. Check them on the ground.
  In particular, the city-hall objective uses the OSM feature "Toledo Garden City Hall".
* No Google Maps imagery, tiles, Street View or 3D models were used or traced.

The pipeline that builds the map package is in the separate `toledo-map` project. Its output is
`public/maps/toledo_poblacion.mapz`.

## Project structure

```
index.html                 entry (Vite-style)       styles/main.css   UI
src/main.ts                boot, menus, loop        src/engine/       WebGL2 renderer, streamed world, physics/nav (JS)
src/game/Battlefield.ts    map, road graph, picking, open-site search
src/game/Game.ts           simulation state, damage, explosions
src/game/Session.ts        mission lifecycle, timing, save/load snapshot
src/game/camera/           IsoCamera
src/game/input/            Controls (mouse, keyboard, touch)
src/game/units/            UnitAI (orders, movement, firing, medics, engineers, vehicles), Civilians
src/game/zombies/          ZombieAI + flow fields
src/game/combat/           weapons, projectiles, fire, nests, turrets, strikes
src/game/pathfinding/      PathService (grid A* + road-graph routing, time-budgeted queue)
src/game/missions/         Mission framework, op01 (Toledo)
src/game/fob/              the single FOB
src/game/logistics/        supply requests and transports
src/game/campaign/         campaign state      src/game/save/   save slots
src/game/rendering/        Models (placeholder art), SceneRender, Sprites (soldier, infected and effect sprite sheets)
src/game/units/Squads.ts   squads, leaders, formations, formation movement and combat
src/game/zombies/Infection.ts  bites, turning, rising
src/game/ui/               Hud, Menus          src/game/audio/  Sfx
data/                      units, weapons, vehicles, infected, structures, supplies, campaign, missions (JSON)
public/                    map package, sprite atlases, icons, manifest
tools/slice_sprites.py     cuts the sheets in assets/source/ into public/sprites/
tools/                     build, dev server, service-worker template
test/                      headless playthrough
```

To tune balance, edit the JSON in `data/`. To replace the art, swap the model functions in
`src/game/rendering/Models.ts`. Each model is a mesh whose nose points to +Z, and white vertex
colours take the per-unit tint.

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
| RTS controls | ✔ click/box/shift/double-click select, control groups, right-click move/attack/board/collect, queued orders (Shift), formations |
| Commands | ✔ move, attack-move, attack (focus fire), stop, hold, defend, patrol, follow, retreat, interact, board/unload, build, clear wreck |
| Infantry (10) | ✔ rifleman, assault, sniper, machine gunner, shotgun, flamethrower, rocket, medic (heals), engineer (builds, clears), special forces. The starting squad has 9: two riflemen, assault, MG, sniper, shotgun, rocket, medic, engineer |
| Vehicles (6) | ✔ jeep, APC, IFV, tank, transport truck (ammo for nearby infantry), recovery vehicle (repairs). You get them through logistics once the FOB motor pool is built, and they arrive at the FOB gate. They crush infected, carry passengers (right-click a vehicle to board, U to unload) and draw as simple box models |
| Infected (8) | ✔ walker, runner, crawler, brute (knockback, breaks doors), bloater (explodes), screamer (calls hordes), mutant (leaps), Abomination (boss, ground slam) |
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
| Low infection | **16/16 criteria pass, 0 page errors.** Toledo liberated after ~45 game minutes, 19 survivors evacuated, FOB established, convoy + heavy weapons team delivered, save → reload → load restores the same state (IndexedDB) |
| Medium infection | **16/16 criteria pass, 0 page errors.** Toledo liberated after ~73 game minutes (525 infected killed, 15 losses), all 19 survivors evacuated |
| Systems check (`npm run test:systems`) | vehicles drive and carry passengers; engineer-built sandbags + MG emplacement stop a horde; artillery strike; debrief → strategic map with Toledo green and the next operation unlocked; 0 errors |
| Phones (`npm run test:mobile`) | Android-sized landscape and portrait layouts; tap select works; 0 errors |

Playing on this map found two real problems, both fixed:

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
* **Art.** Infantry now use your troop sprite sheet (see below). Infected, vehicles and defences are
  still code-generated low-poly placeholders. Buildings use the procedural Philippine archetypes from
  the Toledo map engine.
* **Troop sprites: no back view, one look for all classes.** The sheet's art has front-facing and
  right-facing poses only (its direction labels don't match the drawings). Left is the right view
  mirrored, and soldiers walking away from the camera use the side view. Every infantry class (rifleman,
  medic, sniper, ...) uses the same soldier art; tell them apart by the labels and the selection panel.
* **Infected vs. FOB buildings.** Infected attack defences, gates and doors. They do not damage the
  FOB facility buildings themselves.
* **Vehicles in tight alleys.** Vehicles plan on the same 0.5 m grid as infantry. They back up and
  retry when blocked, but in narrow yards they can still get stuck. Keep them on main roads, where
  logistics delivers them (the FOB gate).
* **Pathing on this map.** Units now detour, sidestep corners and, as a last resort, step out to
  the street after about 12 s without progress. That last step is visible as a short hop. The causes
  are AI-detected footprints that overlap roads or each other, and OSM bridges that end at the bank.
* **Asset loader.** Sprite sheets load (troops). There is no glTF model import yet (see `docs/ASSETS.md`).
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
src/game/rendering/        Models (placeholder art), SceneRender, Sprites (troop sprite sheet)
src/game/ui/               Hud, Menus          src/game/audio/  Sfx
data/                      units, weapons, vehicles, infected, structures, supplies, campaign, missions (JSON)
public/                    map package, troop sprite sheet, icons, manifest
tools/slice_sprites.py     cuts assets/source/troops_sheet.png into public/sprites/
tools/                     build, dev server, service-worker template
test/                      headless playthrough
```

To tune balance, edit the JSON in `data/`. To replace the art, swap the model functions in
`src/game/rendering/Models.ts`. Each model is a mesh whose nose points to +Z, and white vertex
colours take the per-unit tint.

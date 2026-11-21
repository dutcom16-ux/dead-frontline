# Art and audio assets

Soldiers, infected and combat effects come from the sprite sheets below. Every other visual and every
sound is generated in code. When you have more art, this is where it plugs in.

The infantry soldier is rendered from a 3D rig by `python3 tools/soldier3d/game_atlas.py`. The other
sheets are cut by `python3 tools/slice_sprites.py`. Both write packed atlases to `public/sprites/`
(256-colour PNG with alpha plus a JSON frame list). Each frame stores its feet anchor (`ax`, `ay`), an
optional scale (`k`) and, for firing frames, the barrel tip (`mx`, `my`). Record each source sheet's
licence here: the Vercel site is public, so the sheets must be ones you may redistribute.

| Atlas | Source | Used for |
|---|---|---|
| `soldier16.*` | the soldier rig in `tools/soldier3d/` (made for this project, free to redistribute) | every infantry soldier, all classes; military civilians |
| `infected_soldier8.*` | `assets/source/zombie_soldier_8dir.png` (8089.png) | soldiers who turned into infected |
| `zombies.*` | `assets/source/squad_zombie_sheet.png` (8086.png) | the infected |
| `effects.*` | `assets/source/troops_sheet.png` (8085.png) | explosion, smoke, blood, sparks |

`assets/source/desert_soldier/` holds the same soldier as stand-alone sheets with a preview (see its
README). `assets/source/military_soldier_sheet.png` (Military_Soldier_Sprite_Sheet.png) was the
previous soldier sheet. It is no longer used and nothing cuts it.

## Infantry soldier (`public/sprites/soldier16.*`)

* **Source:** a rifleman built from 3D shapes and rendered from a 3/4 camera
  (`tools/soldier3d/soldier3d.py` for the rig and kit, `anims.py` for the poses). Every frame comes from the
  same rig at the same scale, so the figure doesn't change between frames, clips or views.
* **Kit** (current US Army issue, simplified so it reads at about 90 px tall):
  * uniform in an OCP / MultiCam-style pattern (tan, khaki, olive, brown, dark-brown branches);
  * coyote plate carrier with a cummerbund, three ranger-green magazine pouches, an admin pouch and
    a tourniquet; a battle belt with a first-aid pouch and a dump pouch; knee pads;
  * high-cut helmet in OCP with side rails, a night-vision mount and binocular night-vision goggles
    flipped up, a battery pack at the back, and a comms headset under it; ballistic glasses;
  * assault pack with a radio and whip antenna;
  * M7-style rifle in flat dark earth with a suppressor, a fire-control optic and a laser module.
  The palette and every item are in `build()` in `tools/soldier3d/soldier3d.py`.
* **Views:** 16, every 22.5°: N, NNE, NE, ENE, E, ESE, SE, SSE, S, SSW, SW, WSW, W, WNW, NW, NNW
  (N = back to the viewer, S = facing the viewer, clockwise). They are listed in the JSON's `views`.
* **Building it:** `cd tools/soldier3d && python3 game_atlas.py` (about 5 minutes on 2 cores, needs
  numpy and Pillow). The frames have no ground shadow and no muzzle flash (the game draws the flash on
  real shots). Each frame is trimmed to the figure.
* **Anchors:** every frame is anchored at the same ground point between the feet, standing or lying,
  so switching clips never shifts the figure. Standing height (`ref`) is 94 px in every view.
* **Barrel:** each firing frame has the muzzle's exact position (`mx`, `my`, projected from the rig)
  and `md` = [dx, dy, length]: the barrel's direction on screen and how much of it shows (1 = side on,
  under 0.45 = pointing at or away from the viewer).
* **Clips** (`<V>` = one of the 16 views):

  | Clip | Frames |
  |---|---|
  | `walk_<V>` | 12: two steps with the rifle at the low ready, starting on the left heel strike |
  | `idle_<V>` | 8: breathing at the low ready |
  | `fire_<V>` | 3: aim, shot (recoil starting), recoil (casing ejected), from a shouldered aim |
  | `die_<V>` | 12: hit, knees buckle, rifle dropped, falls face down, lies still |

* **In the game** (`src/game/rendering/Sprites.ts`, `soldierPose` and `dyingPose`):
  * State by priority: dying (from the soldier's corpse) > firing > walking > idle.
  * Firing faces the target. Each real shot (`Unit.shotN`, counted in `Combat.fire`) shows the shot
    frame for 0.06 s with the muzzle flash, then the recoil frame for 0.08 s, then aim. Automatic
    weapons (under 0.25 s between rounds: carbine, SMG, special-forces rifle, machine gun,
    flamethrower) hold the shot frame through a burst, with the flash on every round, and recoil once
    when the burst ends. Soldiers whose weapon fires on the move keep the firing stance while moving;
    machine gunners, snipers and rocket troops walk and fire only when stopped.
  * Bullets leave the rifle as drawn: each tracer starts at the barrel tip of the shooter's shot frame
    in the view he is shown in (`Sprites.muzzleOf`, used by `SceneRender`), and follows him if he moves.
    Without a drawn figure (off screen, or the sheet failed to load) it starts at `gunTip`.
  * A walk starts on its first frame (a step), never mid-cycle; stopping shows the idle clip.
  * Walking faces the way the soldier really goes. The cycle (two steps, 12 frames) advances with the
    distance covered: 1.4 m plus 0.25 m per m/s of speed, about 2.3 m at a rifleman's 3.6 m/s and
    shorter at a slow formation pace. The feet don't slide.
  * Idle plays the breathing clip at 6 fps, each soldier at his own phase. In a halted line, box,
    circle or defensive formation or on hold/defend orders, the soldier stands at the ready (aim frame).
  * Turning: one view at a time through the views in between; a view is kept until the heading is
    clearly past it (15° either side of a 22.5° view); a turn is never undone within 0.3 s; aim is held
    for 0.8 s after a target drops.
  * Dying plays the 12 frames once at 10 fps (1.2 s) from the moment of death (game time), in the view
    the soldier was last shown in. The last frame stays.
  * Muzzle flash: drawn in code at the barrel tip of the frame shown, along the barrel's direction on
    screen (`md`). A small yellow-orange flame with a white-hot centre and a faint glow, about 15 % of
    the figure's height (a short star when the rifle points at or away from the viewer). Only on the
    shot frame, so nothing stays lit between shots.
  * `test/anim.mjs` checks all of this.

## Infected soldier sheet (`public/sprites/infected_soldier8.*`)

* **Source:** `assets/source/zombie_soldier_8dir.png` (8089.png), transparent background. 8 rows ×
  10 columns. Rows, clockwise from facing away from the viewer: N, NE, E, SE, S, SW, W, NW.
  * Columns 1–5: one stride, from standing to a full lunge (there is no second, alternating stride).
  * Columns 6–7: reach and grab.
  * Columns 8–10: falling and lying dead.
* **Slicing:** by grid cell (some frames touch). Each row is scaled so the standing figure is 100 px
  tall, because the sheet's rows are not drawn at one size. Standing frames are anchored at the hips
  (the stride doesn't shift the body); kneeling and lying ones at the body's middle. Reach frames are
  ordered by how far the arm reaches along the view (ready, grab). The sheet's tan desert
  camouflage is kept as drawn, which is close to the soldier's OCP pattern. (It used to be re-dyed
  olive to match the previous soldier sheet.)
* **Clips:** `z_walk_<D>`, `z_attack_<D>`, `z_die_<D>`.
* **In the game** (`zpose8`): steadied 8-direction views as for soldiers, facing the way he really
  moves or his victim. The step cycle (stride frames 1-2-3-4-3-2 when hurrying, 0-1-2-3-2-1 slower)
  advances 1.4 m per loop; the grab frame is shown on each real hit. Dying plays once in his last
  view (6 fps) and the last frame stays.

## Infected sheet (`public/sprites/zombies.*`) and effects (`public/sprites/effects.*`)

* **Sources:**
  * `assets/source/squad_zombie_sheet.png` (8086.png): all infected frames.
  * `assets/source/troops_sheet.png` (8085.png): explosion, smoke, blood and sparks.
* **Slicing:** black backgrounds are removed by a flood fill from the cell border, with thin dark seams
  kept inside the figure.
* **What the infected sheet holds** (checked frame by frame): rows of loosely related frames, not
  animation cycles. A row can mix different people (faces and hair change from frame to frame), mix
  facings (front, three-quarter, side) and is not in leg order. The rows labelled as front walks are
  mostly three-quarter views facing **left** (SW). There is no front (S) walk, no NE/NW view, no
  falling frames, and only two back views (two different people).
* **Clips** (each built from frames of one person and one facing):

  | Clip | Source frames (block, row, columns) | Facing |
  |---|---|---|
  | `idle_S`, `idle_S2` | left block rows 1 and 5 | front (six different faces each) |
  | `back_N` | left block rows 2 and 3, column 5 | back |
  | `walk_SW` | middle row 1 (all) | three-quarter front, left |
  | `walk_SW2` | middle rows 2–3, the long-haired, left-facing frames | three-quarter front, left |
  | `walk_E`, `lunge_E` | middle row 4: walking, then attacking | side, right |
  | `hunch_E`, `claw_E` | middle row 5: walking, then reaching | side, right |
  | `attack_E` | left block row 4 | side, right |
  | `run_E`, `run_E2`, `run_E3`, `charge_E` | right block rows 2, 1 (first 5), 3 (last 4), 4 | side, right |
  | `crawl_E`, `crawl_attack_E` | right block row 5, crawling frames | side, right |
  | `dead` | right block row 5, the two lying frames | lying |

  * Walk, run and crawl loops are put in the order that changes the silhouette least from frame to
    frame (the sheet order jumps), so each loop runs smoothly.
  * Attack clips are ordered from the ready pose to the full reach.
  * Standing figures are anchored at the hips, lying ones at their middle. Before this, anchors were
    between the feet, which made running bodies jump back and forth by up to a quarter of their height.
  * Removed: a "dead" frame that also contained a crouching infected; the face-changing middle rows
    as walk cycles.
* **In the game** (`zpose`):
  * Eight screen views, steadied as for soldiers, facing the way the infected really moves (or its
    victim). Drawn with the nearest view: S and SW the three-quarter clip, SE that clip mirrored, E
    and NE the side clip, W and NW mirrored, N from behind (mirrored on alternate steps, which swaps
    the legs). The infected carry nothing, so mirroring them puts nothing in the wrong hand.
  * Walk, run and crawl loops advance with the distance covered (`LOOP_M` in Sprites.ts). Walking
    clips used faster than a walking pace (1.7 m/s) take longer strides rather than playing faster.
    Runners switch to a run clip above 2.6 m/s and back below 2.2; mutants charge, and hold their leg
    pose during a leap.
  * Standing: one fixed frame per infected (front, back, or side-on with its feet together:
    `stand_E`, `stand_E2`) with slow breathing, no cycling through the row's different faces.
  * Attacking: the full-reach frame on each real hit (the attack timer restarting), back to ready
    over 0.3 s, wind-up over the last 0.35 s before the next hit. Crawlers use their most
    outstretched crawl frame.
  * Death: the last pose tips over about the feet and gives way to a lying frame on the same side
    within 0.45 s; the body then stays.
  * Bloater, brute, screamer and mutant are tinted and scaled walkers.
* **Effect clips:** `explosion`, `smoke`, `blood`, `bloodhit`, `sparks`.
* `test/units.mjs` checks every infected type, turned soldiers and survivors.

## Survivors and 3D figures

* Military survivors are drawn from the soldier sheet (`soldier16`): walk cycle while moving, the
  breathing idle clip otherwise.
* Other survivors are 3D figures: three poses (feet together, left foot forward, right foot forward)
  alternate with the distance walked, and arms swing against the legs.
* The abomination steps: three 3D poses (feet together, left foot forward, right foot forward, arms
  swinging against the legs) alternate with the distance walked, its feet on the ground. (Infected
  drawn in 3D only because their sheet failed to load bob with each step instead.)
* Vehicles, helicopters and boats are rigid 3D models: no wheel, track or rotor animation.

## Drawing and fallback

* All sprites are drawn on the 2D overlay, sorted by screen depth, sized to about 2.3 m (never below
  20 px). A figure behind a building is drawn faded.
* If a sheet fails to load, the game draws the 3D figures (and 3D effects) for what it covered.
* To swap in different sheets, keep the clip names, edit the picks in the slicer, run it, and rebuild.

## Units, infected, vehicles, defences (`src/game/rendering/Models.ts`)

* Each model is a function that returns a mesh `{ v, c, n, idx }`: positions, vertex colours,
  normals and triangle indices, in metres.
* Model space: +Y is up and the model's nose points to **+Z**.
* Vertex colour `[1, 1, 1]` means "take the per-instance tint". The tint is the unit's colour from
  `data/units/*.json`, the infected type's colour, or the hit flash.
* Index buffers are 16-bit, so keep each model under 65,535 vertices.
* `UNIT_MODEL` maps unit and infected types to model names.
* Defences use the structure id as their model name (`sandbags`, `mg_emplacement`, ...).

To use real models, convert them (glTF → positions, normals, colours) at build time into the same
`{ v, c, n, idx }` shape and return them from these functions. Everything else stays the same:
instancing, culling and per-instance tint. **A glTF loader is not implemented yet.** Infantry are
drawn from the military sprite sheet instead of these models when it loads.

## Buildings

Buildings come from the Toledo map package. The engine's procedural Philippine archetypes
(`src/engine/archetypes.js`) generate them from footprint, storeys, roof type and materials. Facade
and roof textures live in `src/engine/atlas.js`, which is a code-drawn texture atlas.

## Audio (`src/game/audio/Sfx.ts`)

All sounds are synthesised with WebAudio. To use recorded sounds, decode them into `AudioBuffer`s at
startup and play them from `Sfx.play(kind, x, y, vol)`. That function already handles distance
falloff, stereo pan and rate limiting.

## Licensing

Only add assets you are allowed to redistribute. Record each one's source and licence in this file.
Never take imagery, models or tiles from Google Maps or other proprietary map services.

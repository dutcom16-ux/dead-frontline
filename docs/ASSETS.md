# Art and audio assets

Soldiers, infected and combat effects come from two sprite sheets. Every other visual and every sound
is generated in code. When you have more art, this is where it plugs in.

## Sprite sheets (`public/sprites/troops.*` and `zombies.*`)

* **Sources:** the two sheets you supplied:
  * `assets/source/squad_zombie_sheet.png` (8086.png): soldier movement, aim and death frames and all
    infected frames.
  * `assets/source/troops_sheet.png` (8085.png): reload and crouch frames, plus the effects
    (muzzle flash, explosion, smoke, blood, sparks).

  Record their licence here. The Vercel site is public, so the sheets must be ones you may redistribute.
* **Slicing:** `python3 tools/slice_sprites.py` cuts both sheets into two packed atlases (256-colour
  PNG with alpha):
  * Black backgrounds are removed by a flood fill from the cell border, with thin dark seams kept
    inside the figure.
  * The old sheet's soldiers are recoloured and scaled to match the new sheet.
  * Each frame stores its feet anchor (`ax`, `ay`), a scale (`k`) and, for aiming frames, the muzzle
    point (`mx`, `my`).
* **Directions:** the sheets' direction labels don't match the drawings, so clips are named by what
  the art shows:
  * `S` = facing the viewer, `SE` = three-quarter front-right, `E` = facing screen-right,
    `N` = back to the viewer.
  * West-facing views are mirrored at draw time.
* **Soldier clips:** `idle_S`, `idle_S2`, `ready_S`, `aim_SE`, `back_N`, `walk_S`, `walk_SE`,
  `walk_SE2`, `walk_E`, `kneel_E`, `run_SE`, `run_SE2`, `run_E`, `advance_E` (walking while
  aiming), `die_E`, `reload_S`, `crouch_S`.
* **Infected clips:** `idle_S`, `idle_S2`, `back_N`, `attack_E`, `walk_S`, `walk_S2`, `walk_S3`,
  `walk_E`, `hunch_E`, `lunge_E`, `run_E`, `run_E2`, `run_E3`, `charge_E`, `crawl_E`, `dead`.
* **Drawing:** `src/game/rendering/Sprites.ts` draws them on the 2D overlay:
  * Sorted by screen depth, sized to about 2.3 m (never below 20 px).
  * A figure behind a building is drawn faded.
  * Bloater, brute, screamer and mutant are tinted and scaled walkers; turned soldiers are the soldier
    art tinted green.
* **Fallback:** if a sheet fails to load, the game draws the 3D figures for what it covered.

## Infantry sheet (`public/sprites/infantry8.*`)

* **Source:** `assets/source/infantry_8dir_collection.png` (Military_Soldier_Sprite_Sheet_Collection_1.png).
  It has five labelled panels (walk, run, firing standing, firing moving, idle) on a dark textured
  background. Record its licence here.
* **The labels don't match the drawings.**
  * Run and firing frames almost all face right.
  * Several walk columns turn from facing the camera to facing away half way down.

  The slicer assigns frames by their real facing:

  | Clip | Panel, column (row numbers from 0) |
  |---|---|
  | `walk_S` | walk "0° Front" |
  | `walk_SE` | walk "90° Right" |
  | `walk_NE` | walk "225° Back-Left", rows 1–3 |
  | `walk_N` | walk "180° Back" |
  | `run_SE` | run "45° Front-Right" |
  | `run_NE` | run "225° Back-Left" |
  | `run_N` | run "180° Back" |
  | `fire_SE` / `firemove_SE` | firing "0° Front" |
  | `fire_NE` / `firemove_NE` | firing "315° Front-Left" |
  | `idle_S` / `idle_SE` / `idle_NE` / `idle_N` | idle "Front" / "Right" / "Back-Left" / "Back" |

  `_SW` and `_NW` clips are the `_SE` and `_NE` ones mirrored.
* **Clean-up:**
  * Background removal keeps the near-black rifle in the upper body and drops the foot shadows.
  * Each clip is scaled to one height: the sheet's bottom rows are drawn about 8 % taller, its idle
    figures about 14 % smaller.
  * Every frame is anchored between head and hips, so a step doesn't shift the figure.
  * `aim_*` / `movaim_*` are the firing frames with the muzzle flash removed, for aiming between shots.
* **In the game** (`src/game/rendering/Sprites.ts`):
  * A soldier turns one view at a time through the views in between, holds a view until the heading
    is clearly past it, and never undoes a turn within 0.3 s.
  * Walk and run cycles advance with the distance covered: one cycle per 1.6 m walking, 2.6 m running.
  * Walk and run switch with a speed margin.
  * Each shot plays the four firing frames, then the soldier holds aim without a flash.
  * Idle alternates its two frames slowly, with a slight breathing rise and fall.
  * `test/anim.mjs` measures all of this.

## 8-direction sheets (`public/sprites/soldier8.*`)

* **Sources:**
  * `assets/source/rifleman_8dir.png` (8088.png): riflemen.
  * `assets/source/zombie_soldier_8dir.png` (8089.png): soldiers who turned into infected.

  Both have transparent backgrounds. Record their licence here too.
* **Layout:** 8 rows × 10 columns.
  * Rows, clockwise from facing away from the viewer: N, NE, E, SE, S, SW, W, NW.
  * Columns 1–5: walk cycle, from standing to a full stride (played back and forth: 2-3-4-5-4-3).
  * Columns 6–7: aim and fire for the rifleman (the muzzle flash is drawn in); reach and grab for the
    infected soldier.
  * Columns 8–10: falling and lying dead.
* **Slicing:** the same script cuts each row by grid cell (some frames touch).
  * Each row is scaled so the standing figure is 100 px tall, because the sheet's rows are not drawn at
    one size.
  * Output is one 256-colour atlas, about 0.5 MB.
* **Clips:** `r_walk_<dir>`, `r_aim_<dir>`, `r_fire_<dir>`, `r_die_<dir>`, `z_walk_<dir>`,
  `z_attack_<dir>`, `z_die_<dir>`, where `<dir>` is one of the eight directions. No mirroring is used.
* **Use:** deaths of every infantry soldier (`r_die_*`), and every soldier who turns or rises infected
  (`z_*`), whatever his class. The rifleman walk/aim/fire clips are the fallback if `infantry8` is
  missing.

To swap in different sheets, keep the clip names, edit the cell picks in the slicer, run it, and rebuild.

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
drawn from the troop sprite sheet instead of these models when it loads.

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

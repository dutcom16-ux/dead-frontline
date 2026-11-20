# Art and audio assets

Soldiers, infected and combat effects come from the sprite sheets below. Every other visual and every
sound is generated in code. When you have more art, this is where it plugs in.

All sheets are cut by `python3 tools/slice_sprites.py` into packed atlases in `public/sprites/`
(256-colour PNG with alpha plus a JSON frame list). Each frame stores its feet anchor (`ax`, `ay`), an
optional scale (`k`) and, for firing frames, the barrel tip (`mx`, `my`). Record each source sheet's
licence here: the Vercel site is public, so the sheets must be ones you may redistribute.

| Atlas | Source (`assets/source/`) | Used for |
|---|---|---|
| `military8.*` | `military_soldier_sheet.png` (Military_Soldier_Sprite_Sheet.png) | every infantry soldier, all classes; military civilians |
| `infected_soldier8.*` | `zombie_soldier_8dir.png` (8089.png) | soldiers who turned into infected |
| `zombies.*` | `squad_zombie_sheet.png` (8086.png) | the infected |
| `effects.*` | `troops_sheet.png` (8085.png) | explosion, smoke, blood, sparks |

## Military personnel sheet (`public/sprites/military8.*`)

* **Source layout** (1536 × 1024, transparent background): three labelled sections, WALKING,
  FIRING and DYING. Each has eight direction groups, left to right: N, NE, E, SE, S, SW, W, NW
  (N = back to the viewer, S = facing the viewer, then clockwise).
  * Walking: 3 frames per direction (two strides and a passing step).
  * Firing: 3 frames per direction.
  * Dying: 6 frames per direction (three staggering frames, a fourth below them, two lying frames).
* **Slicing** (found from the image, not from guessed coordinates):
  * Figures are found as connected shapes in the alpha channel within each section and direction
    group. Every group must give exactly 3 + 3 + 6 frames, or the slicer stops.
  * Some firing frames touch their neighbour (a rifle crosses the gap): such a shape is split at the
    narrowest column between the figures.
  * Each crop keeps only its own figure (no piece of a neighbour's rifle) and drops the faint
    background alpha and the ground shadow under the boots.
* **Corrections:**
  * The SE groups are drawn facing east (backpack to the viewer, rifle level to the right). A
    south-east soldier would look as if walking away, so **`*_SE` is the SW art mirrored** (front
    three-quarter view, rifle down-right). The sheet's SE frames are cut but not used.
  * The dying section is drawn about 11–20 % smaller than the walking one. Each direction's dying
    frames are scaled so the standing ones match that direction's walking height.
  * Frame-to-frame size noise within a clip is evened out (at most ±6 %).
  * Standing frames are anchored at the feet, between head and hips, so a step doesn't shift the
    figure. Lying frames are anchored at the body's middle.
* **Clips** (`<D>` = N, NE, E, SE, S, SW, W, NW):

  | Clip | Frames |
  |---|---|
  | `walk_<D>` | stride, passing step, other stride, passing step (the passing step is the frame with the narrowest stance) |
  | `idle_<D>` | the passing step (standing) |
  | `fire_<D>` | aim, shot, recoil (ordered by how far the barrel is pushed out); each has its barrel tip `mx`, `my` |
  | `die_<D>` | the six dying frames, in order |

  The barrel tip is the dark rifle pixel furthest along the view's aim direction, in the upper half of
  the figure. For N the rifle points up past the helmet; for S it points at the viewer from the chest.
* **In the game** (`src/game/rendering/Sprites.ts`, `soldierPose` and `dyingPose`):
  * State by priority: dying (from the soldier's corpse) > firing > walking > idle.
  * Firing faces the target. Each real shot (`Unit.shotN`, counted in `Combat.fire`) shows the shot
    frame for 0.06 s with the muzzle flash, then the recoil frame for 0.08 s, then aim. Soldiers whose
    weapon fires on the move keep the firing stance while moving; machine gunners, snipers and
    rocket troops walk and fire only when stopped.
  * Walking faces the way the soldier really goes. The cycle (two steps) advances with the distance
    covered: 1.4 m plus 0.25 m per m/s of speed, about 2.3 m at a rifleman's 3.6 m/s and shorter at a
    slow formation pace. The feet don't slide.
  * Idle stands with a slight breathing movement; in a halted line, box, circle or defensive formation
    or on hold/defend orders, the soldier stands at the ready (aim frame).
  * Turning: one view at a time through the views in between; a view is kept until the heading is
    clearly past it; a turn is never undone within 0.3 s; aim is held for 0.8 s after a target drops.
  * Dying plays the six frames once at 10 fps from the moment of death (game time), in the view the
    soldier was last shown in. The last frame stays.
  * Muzzle flash: drawn in code at the barrel tip of the frame shown, pointing along the rifle. A small
    yellow-orange flame with a white-hot centre and a faint glow, about 15 % of the figure's height (a
    short star for N and S). Only on the shot frame, so nothing stays lit between shots.
  * `test/anim.mjs` checks all of this.

## Infected soldier sheet (`public/sprites/infected_soldier8.*`)

* **Source:** `assets/source/zombie_soldier_8dir.png` (8089.png), transparent background. 8 rows ×
  10 columns. Rows, clockwise from facing away from the viewer: N, NE, E, SE, S, SW, W, NW.
  * Columns 1–5: walk cycle, from standing to a full stride (played back and forth: 2-3-4-5-4-3).
  * Columns 6–7: reach and grab.
  * Columns 8–10: falling and lying dead.
* **Slicing:** by grid cell (some frames touch). Each row is scaled so the standing figure is 100 px
  tall, because the sheet's rows are not drawn at one size. Tan cloth is re-dyed olive to match the
  soldiers' uniform.
* **Clips:** `z_walk_<D>`, `z_attack_<D>`, `z_die_<D>`.

## Infected sheet (`public/sprites/zombies.*`) and effects (`public/sprites/effects.*`)

* **Sources:**
  * `assets/source/squad_zombie_sheet.png` (8086.png): all infected frames.
  * `assets/source/troops_sheet.png` (8085.png): explosion, smoke, blood and sparks.
* **Slicing:** black backgrounds are removed by a flood fill from the cell border, with thin dark seams
  kept inside the figure.
* **Directions:** the sheet's direction labels don't match the drawings, so clips are named by what the
  art shows: `S` = facing the viewer, `SE` = three-quarter front-right, `E` = facing screen-right,
  `N` = back to the viewer. West-facing views are mirrored at draw time.
* **Infected clips:** `idle_S`, `idle_S2`, `back_N`, `attack_E`, `walk_S`, `walk_S2`, `walk_S3`,
  `walk_E`, `hunch_E`, `lunge_E`, `run_E`, `run_E2`, `run_E3`, `charge_E`, `crawl_E`, `dead`.
  Bloater, brute, screamer and mutant are tinted and scaled walkers.
* **Effect clips:** `explosion`, `smoke`, `blood`, `bloodhit`, `sparks`.

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

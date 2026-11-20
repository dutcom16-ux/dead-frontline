# Art and audio assets

Infantry and combat effects come from a sprite sheet. Every other visual and every sound is generated
in code. When you have more art, this is where it plugs in.

## Troop sprite sheet (`public/sprites/troops.png` + `troops.json`)

* **Source:** the sprite sheet you supplied (`assets/source/troops_sheet.png`, 1536×1024). Record its
  licence here. The Vercel site is public, so the sheet must be one you may redistribute.
* **Slicing:** `python3 tools/slice_sprites.py` cuts the sheet into a packed atlas. Soldiers: the black
  background is removed by a flood fill from the cell border. Effects: brightness becomes alpha. Each
  frame stores its feet anchor (`ax`, `ay`).
* **Clips in use:** `idle_front`, `walk_front`, `walk_side`, `run_front`, `run_side`, `aim_side`,
  `fire_side`, `reload_front`, `hurt_front`, `die_front` (last frame = lying), `crouch_front`, and the
  effects `explosion`, `smoke`, `bloodhit`, `sparks`. `muzzle` and `blood` are sliced but not used yet.
* **Directions:** front clips face the viewer and side clips face screen-right. The renderer mirrors the
  side clips for left. The sheet has no back view.
* **Drawing:** `src/game/rendering/Sprites.ts` draws them on the 2D overlay, sorted by screen depth,
  sized to about 2.4 m (never below 18 px). A soldier behind a building is drawn at 45 % opacity.
* **Fallback:** if `troops.png` or `troops.json` fails to load, the game draws the old 3D soldiers.

To swap in a different sheet, keep the clip names, rerun the slicer with new cell boxes, and rebuild.

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

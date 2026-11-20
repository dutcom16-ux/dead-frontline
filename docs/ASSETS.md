# Art and audio assets

Right now every visual and sound in the game is generated in code, so the game has no asset files to
download. When you have real art, this is where it plugs in.

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
instancing, culling and per-instance tint. **A glTF or sprite-sheet loader is not implemented yet.**

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

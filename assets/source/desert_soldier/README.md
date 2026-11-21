# Desert soldier sheets (16 directions)

Rendered in code from one 3D soldier rig (`tools/soldier3d/`), so the figure, gear and camo are the
same in every frame and every direction. Made for this project; free to redistribute with it.

`soldier_preview.gif` shows 8 of the 16 directions playing every clip.

## Frames

* 160 × 160 px, transparent background, soft ground shadow included.
* Feet at x = 50 %, y = 73 % of every frame (same point in every frame, standing or lying).
* One **row per direction**, clips side by side in **columns**:

  | Clip | Frames | fps | Plays |
  |---|---|---|---|
  | `idle` | 8 | 8 | loop (breathing, rifle at the low ready) |
  | `walk` | 12 | 14 | loop (rifle at the low ready) |
  | `fire` | 6 | 16 | loop (shouldered aim; flash on frames 1–2, casing ejects, recoil) |
  | `death` | 12 | 12 | once, hold the last frame (hit, knees buckle, drops the rifle, falls prone) |

## Directions

Row = facing angle / 22.5°. 0° faces right (east) and angles increase clockwise on screen (y down):

| Row | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Facing | E | ESE | SE | SSE | S (to viewer) | SSW | SW | WSW | W | WNW | NW | NNW | N (back to viewer) | NNE | NE | ENE |

`row = round(angle_deg / 22.5) % 16`. The 8-direction sheet keeps the even rows (E, SE, S, SW, W,
NW, N, NE).

Note that this is not the order of the existing sheets in this folder (those start at N).

## Files

| File | Contents |
|---|---|
| `soldier_16dir_all.png` / `.json` | every clip in one sheet, 6080 × 2560 |
| `soldier_8dir_all.png` / `.json` | 8 directions only, 6080 × 1280 |
| `soldier_16dir_<clip>.png` / `.json` | one sheet per clip, each under 4096 px |
| `soldier_preview.gif` | animated preview |

The JSON files use the TexturePacker "JSON Hash" layout: frames are named like `walk_SE_03`, and
`meta.frameTags` lists every clip × direction with its frames, fps and loop flag.

The game uses the same soldier through its own atlas, `public/sprites/soldier16.*`, built by
`tools/soldier3d/game_atlas.py`. That atlas has the same 16 views and frames, without the ground
shadow or the baked muzzle flash, and with the barrel tip of every firing frame (see
`docs/ASSETS.md`).

## Regenerating

```
cd tools/soldier3d
python3 render_all.py   # ~10 min on 2 cores, frames go to out/frames/
python3 assemble.py     # sheets, JSON and preview go to out/final/
python3 game_atlas.py   # the game's atlas, public/sprites/soldier16.* (~5 min)
```

Needs Python 3 with numpy and Pillow. Proportions, gear and colours are in `soldier3d.py`, and the
poses and timing of each clip are in `anims.py`.

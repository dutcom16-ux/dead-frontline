# Unit animation QA: inventory, audit and progress checklist

This file is the working record of the unit-by-unit animation repair. Update the checklist as each
step finishes, so the work can be resumed without repeating anything.

* **Checkpoint before any change:** commit `958b29f`, kept as the branch
  `checkpoint-anim-audit-baseline` on GitHub (and the local tag `anim-audit-baseline`). To undo the
  whole repair: `git checkout checkpoint-anim-audit-baseline -- src public tools test`. Each unit's
  repair is its own commit, so one unit can be reverted alone.
* **Shared systems** (a change here affects several units):
  * `src/game/rendering/Sprites.ts`: view steadying (`turnTo`), movement tracking (`track`,
    `going`), frame lookup and drawing (`frame`, `blit`, `blitFall`), corpse drawing, pruning.
  * `tools/slice_sprites.py`: builds every sprite atlas in `public/sprites/`.
  * `src/game/rendering/SceneRender.ts`: 3D figures, and which units the sprites cover.

## Inventory

| # | Unit | Drawn by | Asset | Animation code | Animations available |
|---|---|---|---|---|---|
| 1–10 | Soldiers: rifleman, assault, sniper, machine gunner, shotgunner, flamethrower, rocket, medic, engineer, special forces | sprite | `military8` (Military_Soldier_Sprite_Sheet.png) | `Sprites.soldierPose`, `dyingPose`, `muzzleFlash` | walk 8 dirs (3 frames), idle, fire (aim, shot, recoil), dying (6 frames) |
| 11–17 | Infected: walker, runner, crawler, brute, bloater, screamer, mutant | sprite | `zombies` (8086.png) | `Sprites.zpose`, fall in `draw` | front idle, back, three-quarter left walk ×2, side walk ×2, side run ×3, charge, crawl, attacks ×3, crawl grab, dead ×2 |
| 18 | Abomination (boss) | 3D | `abominationGeo` | `SceneRender` | none (rigid model, step bob) |
| 19 | Turned soldier | sprite | `infected_soldier8` (8089.png) | `Sprites.zpose8` | walk 8 dirs (one stride), reach + grab, dying (3 frames) |
| 20 | Military survivor | sprite | `military8` | `Sprites.civPose` | soldier walk and idle |
| 21 | Civilian survivor | 3D | `civilianGeo` (feet together, left, right) | `SceneRender` stride | step poses |
| 22–27 | Vehicles: jeep, APC, IFV, tank, truck, ARV | 3D | `Models.ts` | `SceneRender` | none (rigid) |
| 28–30 | Transports: helicopter, supply truck, boat | 3D | `Models.ts` | `SceneRender` | none (rigid) |

## Audit (state at `anim-audit-baseline`, before this repair)

### Soldiers (units 1–10: one sheet, one animation controller)

Working: 8-direction walk following distance, standing, firing toward the target with a flash on each
shot, dying once and holding, steadied turning, one standing height in every direction, walks start
with a step.

| Id | Problem | Cause |
|---|---|---|
| S1 | **Shaking during automatic fire.** Carbine (0.13 s between shots), SMG (0.11), flamethrower (0.10) and machine gun (0.085) fire faster than the shot and recoil frames last (0.14 s), so the rifle jumps between its out and back positions 7–12 times a second. | code |
| S2 | **South-east is south-west mirrored**, so in that one view the rifle is in the left hand, and the hands swap when the soldier turns through it. | code (fallback for art) |
| S3 | **Breathing lifts the feet:** standing soldiers breathe by moving the whole sprite up and down (0.5 px at the default zoom, more zoomed in). | code |
| S4 | Moving while firing: the firing stance slides (no moving-fire frames). | art |
| S5 | One sprite for all ten classes: the machine gun, rocket launcher, flamethrower and shotgun are drawn as a rifle. | art |
| S6 | No running, reloading or kneeling frames. | art |
| S7 | Dying frames 1–3 (the sheet's top dying row, checked against the source) are standing poses, so a shot soldier stays upright for 0.3 s before he collapses. | art |
| S8 | The lying frames are the same pose (head to the left) in every direction. | art |
| S9 | The sheet's south-east groups are drawn facing east (backpack visible): there is no south-east art. | art |

### Infected (units 11–17: one sheet, one controller; types differ in tint, size and speed)

Working: steadied 8 views facing the way they move, cycles following distance, one fixed standing
frame with breathing, full reach on each hit, fall then lying body, crawler grab.

| Id | Problem | Cause |
|---|---|---|
| Z1 | **Standing side views use a mid-stride frame:** an infected standing side-on has its legs apart (walk_E first frame: feet 32 px apart; hunch_E: 44 px; the narrowest walk_E frame has 10 px). | code |
| Z2 | **Front, back and side walks play too fast at running speed:** their loop length is set for walking pace, so a runner (4.6 m/s) runs the walk loops at 23–26 frames/s and swaps its back view 8 times a second. | code |
| Z3 | North view: the back frame is mirrored on alternate steps (no back walk art). | art (fallback) |
| Z4 | No front (south) walk, no NE/NW views, no falling frames; rows mix different people and facings; dark shading drawn beside some figures. | art |

### Abomination (unit 18)

| Id | Problem | Cause |
|---|---|---|
| A1 | **Glides:** a rigid 3D model; only a step bob shows that it walks, its legs never move. | code |

### Turned soldier (unit 19)

Working: steadied 8 views, step cycle following distance, grab on each hit, dying once in its last
view. T1 (art): the walk is a single stride played back and forth, so the legs don't alternate.

### Survivors (units 20–21)

Working: military survivors use the soldier walk and stand; civilians step with their 3D poses.

### Vehicles and transports (units 22–30)

Rigid models with no separate wheels, tracks or rotors; nothing to animate without new models. They
move and turn with the game's own steering (no feet, so no sliding to fix). Not changed.

## Baseline (before the repair)

| Test | Result |
|---|---|
| `test/anim.mjs` (soldiers) | 18/18 (35 checks after the per-class tests were added) |
| `test/units.mjs` (other units) | 65/65; crowd of 200 infected: 1.5 ms per drawn frame |
| `test/formations.mjs` | 20/20 |
| Playthrough low | 16/16; liberated at 61 min, 255 killed, 1 loss |
| Playthrough medium | 16/16; liberated at 67 min, 389 killed, 16 losses |
| `test/systems.mjs`, `test/mobile.mjs` | pass |

## Progress checklist

- [x] Phase 1: audit and inventory (this file)
- [x] Phase 2: checkpoint tag, baseline recorded
- [x] Soldiers: S1 automatic fire, S2 south-east fallback, S3 breathing; test every class
  * S1: weapons firing faster than every 0.25 s (carbine, SMG, special-forces rifle, machine gun,
    flamethrower) hold the shot frame through a burst, with the flash on every round, and recoil
    once when the burst ends: 0 pose changes a second while firing (were 7–12). Rifle, sniper rifle,
    shotgun and rocket kick once per shot (shot, recoil, aim).
  * S2: south-east uses the sheet's own south-east groups as drawn (facing east, rifle tilted down,
    right hand) instead of south-west mirrored; muzzle flash direction set to that rifle.
  * S3: breathing stretches the figure from the feet by 0.6 %; the feet no longer move.
  * Tested (`test/anim.mjs` 35/35): all 10 classes fire at a target (flash rules, steadiness) and move
    past it (firing stance for classes that fire on the move, walk for machine gun, sniper and rocket);
    8-direction firing and walking; dying in 8 views; march and fight.
- [ ] Infected: Z1 standing frame, Z2 speed of loops; test every type
- [ ] Abomination: A1 walking legs; test
- [ ] Turned soldier: retest
- [ ] Survivors: retest
- [ ] Vehicles and transports: confirmed unchanged
- [ ] Game-wide QA: mixed battle, rapid commands, selection, stops and turns, deaths in combat, performance
- [ ] Regression: formations, playthroughs, systems, mobile

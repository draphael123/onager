# ONAGER

*Pick your face, then throw a knight at it.*

3D Angry Birds, siege edition. Slice 0. Name is provisional.

```bash
python onager/serve.py 5833
```

Then open **http://localhost:5833**. No build step — three.js r170 and Rapier
0.14 are vendored, and `rapier.es.js` carries its own wasm inline.

## Controls

| | |
|---|---|
| `A` / `D` | circle the fortress (this is the third axis) |
| `Shift` + `A`/`D` | fine trim — line up on one pier, not one face |
| drag | slingshot. The drag's **angle** sets elevation, its **length** sets power |
| `SPACE` | lance dive, once per shot, mid-flight |
| `R` | restart |

Five knights. Three standards. Put all three down.

## Why it is built this way

3D Angry Birds barely exists because of aiming: add a third axis and the camera
can no longer show you where the shot lands. So the third axis isn't part of the
throw. The slingshot is exactly 2-DOF like the 2D original, and choosing which
face to attack is a separate decision you make before you draw back.

That only works if the faces are different problems, so they are — a gatehouse
arch you undercut, a thin curtain you punch through, a keep whose top storey
sits on timber joists, and one face that is solid all the way through and cannot
be beaten at all. See [DESIGN.md](DESIGN.md).

## Harness

Everything runs headless (`renderer = null`). In the browser console:

```js
ONAGER.sim()                      // 20 assertions, T1-T8
ONAGER.audit(new ONAGER.Game())   // spawn overlaps + unsupported blocks
ONAGER.sweep(ONAGER.FACE_ANGLE.east, { elevs: [6,8,10], powers: [0.9,1], reps: 3 })
ONAGER.pause(true)                // stop the live world; sweeps starve without this
ONAGER.state()                    // snapshot
```

`ONAGER.audit()` is the one to run after touching any number in `fortress.js`.
Two construction faults are invisible in a screenshot and catastrophic in the
solver — blocks interpenetrating at spawn (Rapier detonates the fortress on
frame 1) and blocks with nothing under them (they fall, and it reads as the
castle collapsing before you fired). Both cost real time to find by eye; the
audit finds them instantly.

If you change `fortress.js`, **re-sweep** — the shot numbers in `BEST` are
measured, and a fortress edit silently invalidates them along with T6 and T7.

## Layout

```
index.html        HUD, boot watchdog
src/main.js       boot, input, loop + throttle watchdog
src/game.js       state machine, camera, aiming, scoring
src/physics.js    Rapier wrapper: damage, debris, settle detection
src/fortress.js   the level
src/render.js     scene, materials, models, FX
src/audio.js      WebAudio synthesis (no assets)
src/sim.js        headless assertions, audit, parameter sweep
src/rand.js       seeded stream for anything that affects the simulation
```

## Measured

- **19+1 assertions green** (`ONAGER.sim()`)
- Fortress is fully at rest after 4s: 0.20m worst drift, 0 blocks broken, world asleep
- Trajectory preview matches actual flight to within **0.7cm**
- Every shot resolves in under **4.6s**
- **7.25ms** average frame, **15.5ms** worst, during a live collapse at 393 bodies
- A competent run clears in 4 of the 5 knights

## Not in slice 0

One fortress. No progression, no meta, no menus, no knight variety beyond the
dive. The only question this slice answers is whether the destruction carries it
and whether picking a face is a real decision.

# ONAGER

*Pick your face, then throw a knight at it.*

3D Angry Birds, siege edition. Name is provisional.

**Play: https://onager-two.vercel.app**

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
| `Esc` | settings |

On a phone: drag to aim, the two arrows at the bottom circle the fortress,
and DIVE is the second tap.

Nine knights. A garrison of nine. Put every soldier down — ride them down in
person, or drop the building on them. Standards are a bonus, not a requirement.

## Why it is built this way

3D Angry Birds barely exists because of aiming: add a third axis and the camera
can no longer show you where the shot lands. So the third axis isn't part of the
throw. The slingshot is exactly 2-DOF like the 2D original, and choosing which
face to attack is a separate decision you make before you draw back.

That only works if the faces are different problems, so they are — a gatehouse
arch you undercut, a thin curtain you punch through, a keep whose top storey
sits on timber joists, and one face with nobody posted behind it that is the
worst place to stand. See [DESIGN.md](DESIGN.md).

## Harness

Everything runs headless (`renderer = null`). In the browser console:

```js
ONAGER.sim()                      // 27 assertions, T1-T10
ONAGER.bot(seed)                  // plays a whole game with a ballistic solver
ONAGER.reachability()             // can every post be aimed at?
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
src/main.js       boot, input, menus, loop + throttle watchdog
src/settings.js   persisted settings + quality tiers
src/game.js       state machine, camera, aiming, scoring
src/physics.js    Rapier wrapper: damage, debris, settle detection
src/fortress.js   the level
src/render.js     scene, materials, models, FX
src/audio.js      WebAudio synthesis (no assets)
src/sim.js        headless assertions, audit, parameter sweep
src/rand.js       seeded stream for anything that affects the simulation
```

## Measured

- **27 assertions green** (`ONAGER.sim()`)
- Fortress at rest after 5s: 0.29m worst drift, 0 blocks broken, nobody knocked
  out, world asleep
- Trajectory preview matches actual flight to within **0.7cm**
- Every shot resolves in under **5s**
- **7.25ms** average frame (desktop) / **7.8ms** (emulated phone), during a live
  collapse at ~380 bodies
- The aiming bot clears **4 of 5** runs, averaging 8.8 of 9 soldiers
- Soldiers die to falling masonry as well as direct hits: 5 crushed / 11 struck
  across a measured three-shot opening

## Known balance note

East's best single shot takes two soldiers — the same as a high blind lob from
the west, which crosses the whole castle and can clip two on the far wall. West
is still strictly worse than north and south and has no garrison of its own, and
the assertion says exactly that rather than the stronger claim I wanted. Worth a
human eye at playtest.

## Not here yet

One fortress. No progression or level select, no music, no knight variety beyond
the lance dive.

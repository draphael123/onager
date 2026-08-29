# ONAGER — slice 0

*Pick your face, then throw a knight at it.*

3D Angry Birds, siege edition. You are the besieger; your ammunition is knights;
the fortress is the puzzle. Name is provisional.

---

## The one decision this slice exists to test

3D Angry Birds barely exists, and the reason is aiming. In 2D you aim with two
numbers — angle and power — and the screen shows you the whole parabola
honestly. Add a third axis and the camera can no longer show you where the shot
lands: a parabola coming toward you or going away from you reads as a vertical
line.

**So the third axis is not part of the throw.** The slingshot is exactly 2-DOF,
like the original. The third axis is a *separate, deliberate, pre-shot
decision*: you walk the siege camp around the fortress and choose which face to
attack. `A`/`D` orbit; `Shift` fine-trims; the drag is only ever elevation and
power.

That only works if the faces are genuinely different problems. They are:

| Face | The problem | The answer |
|---|---|---|
| **North Gate** | A stone lintel carried on two piers, standard on top. A barbican wall stands in front of it. | Arc over the barbican and take out a pier. The arch and its standard come down together. |
| **East Curtain** | One block thick, pierced by arrow slits. Courtyard standard on a dais just inside. | A flat, fast shot punches clean through and carries into the standard. |
| **South Keep** | Nearest face. The keep's top storey rests on **timber joists**. | A shallow arc onto the roof, or through the upper wall into the joists — burn those out and the top of the keep drops. |
| **West Buttress** | Two walls thick, stone, backed by nothing at all. | There isn't one. This face is the wrong answer, and the compass says so. |

West existing is the point. If every face works, orbiting is a camera control.
A face that can lose you the run is what makes it a decision.

## Verbs

- **Orbit** — `A`/`D`, `Shift` to trim. The compass names the face and tells you
  what it is, so a bad choice is informed rather than blind.
- **Slingshot** — drag. The drag's *angle* sets elevation (6°–66°), its *length*
  sets power (22–46 m/s). Fully decoupled, two degrees of freedom.
- **Lance dive** — `SPACE`, once per shot, mid-flight. Trade the rest of your arc
  for a steep fast drop. This is the "second tap": it turns a shot that would
  sail over into one that lands on a roof.

Five knights. Three standards. Win by putting all three down.

## What makes it feel like anything

The trajectory preview is **exactly** the flight path: the knight has zero
linear damping, so the drawn parabola is the one it flies. A preview that lies
by even a little makes every miss feel unfair. Asserted by `T3` in the harness.

Blocks have hit points and shatter into short-lived debris. Damage is gated on
**impact speed**, never on contact force alone — see below. Big hits give
hitstop, screen kick, dust and sparks; the knight punches *through* a block it
destroys instead of stopping dead in the hole it just made.

---

## Measured

Every face has an answer, the answers differ, and one face has none. Swept over
three seeds:

| Face | Shot | Result |
|---|---|---|
| North | 20 deg, 85% | gate standard, 3/3 |
| South | 22 deg, 85% | keep standard, 3/3 |
| East | 8 deg, 90% | courtyard standard, 2/3 |
| West | anything | **nothing, at any elevation or power** |

- 20/20 assertions green (`ONAGER.sim()`)
- Idle fortress after 4s: 0.20m worst drift, 0 blocks broken, world asleep
- Preview matches actual flight to 0.7cm
- Every shot resolves inside 4.6s
- 7.25ms average frame / 15.5ms worst during a live collapse at 393 bodies
- A competent run clears in 4 of 5 knights

## Hard-won physics notes

Everything here was measured, not guessed. `ONAGER.sim()` and `ONAGER.audit()`
re-check all of it.

**Resting load is the same order as a light impact.** The first damage model
gated on contact force alone. The bottom course of a seven-course wall carries
enough weight to clear any threshold low enough to be useful, so the fortress
quietly chewed itself to rubble under its own weight — 181 blocks gone in two
seconds, before anyone fired. Damage is now gated on `IMPACT_V`: the relative
speed of the two bodies **in the tick before the contact resolved**, snapshotted
manually. Contact events fire after the solver has already killed the impact, so
post-step velocity cannot tell a smash from a settle.

**Spawn overlap detonates the fortress.** Two blocks interpenetrating by 8cm at
build time make Rapier shove them apart violently on frame 1. Six separate
places had it: keep faces sized to overrun their own corners, joists driven
through walls, roof merlons buried in roof planks, a banner spawned inside a
crenel, buttress piers biting the wall behind them. None of it is visible in a
screenshot. `ONAGER.audit()` reports overlaps and unsupported blocks; run it
after touching any number in `fortress.js`.

**A running bond needs half-blocks at the ends.** Offsetting alternate courses by
half a block and dropping one block from the short course leaves the end block
of every full course cantilevered past its own centre of mass. The walls peeled
themselves apart from the ends inward. Real masonry solves this with a queen
closer — a half block at each end — and so does `wall()` now. This single change
took idle drift from 11.7m to 0.03m and put the whole world to sleep.

**Never stack arrow slits vertically.** A hole directly above a hole leaves the
block above it balanced on nothing. Slits are one course each.

**One tick function, shared.** The RAF loop and the throttle watchdog drifted
apart: the watchdog painted the scene but skipped the HUD and the orbit keys, so
a throttled pane showed a live-looking picture of a game that would not turn,
with a HUD quietly lying about the score. Both now call the same `tickGame(dt)`.

**Hold the horizontal FOV, not the vertical.** On a narrow or portrait window a
fixed vertical FOV crops the fortress to a featureless wall of masonry with no
silhouette left to read. Horizontal-plus keeps the whole castle in shot.

**Settle must watch the fortress, not the projectile.** The knight has no linear
damping (so the preview stays truthful) and will roll across the field for many
seconds. Including it in the settle test made *every* shot — including one that
hit nothing — take the full seven-second cap before the player got control back.

**A standard on a pole is a skittle.** Free-standing banners meant one flat pass
over the top at ~10m clipped two of them in a line, breaking nothing — which
made choosing a face irrelevant, the exact thing this slice exists to test. Each
standard is now welded to the block it stands on with a fixed joint, cannot be
destroyed directly (cloth doesn't shatter), and falls when its HOST is destroyed,
shifts more than 1.6m, or tips past 35 degrees. A blow landing on a standard
passes 60% of its force into the socket, so ramming one still does something.

**A standard must sit on its face's bearing.** Shots travel radially toward the
centre, so a target is only on a face's line if its bearing from the centre
matches that face. The courtyard standard sat at a bearing of 61 degrees — the
north-east corner — and the east shot, the one it exists to reward, sailed two
metres past it every single time. Geometry, not tuning.

**A knight that breaks one brick wedges in the hole.** Without splash damage the
knight destroyed exactly the block it touched and then jammed between the
courses above and below, so the punch-through shot the east curtain is designed
around simply did not work. Knight strikes above 12 m/s now splash within a
speed-scaled radius, which blows a hole rather than chipping one.

**Test the thing you think you're testing.** A measurement that reported zero
contact events turned out to be reading a buffer that `Game._drain()` had
already cleared. The physics was fine; the instrument was broken. When a brand
new system reports exactly zero, suspect the measurement first.

---

## Harness

Everything runs headless (`renderer = null`), in the browser console:

```
ONAGER.sim()                        assertions T1-T8
ONAGER.pause(true)                  stop the live world; sweeps starve without it
ONAGER.audit(new ONAGER.Game())     spawn overlaps + unsupported blocks
ONAGER.sweep(angle, opts)           elevation x power grid for one face
ONAGER.state()                      snapshot of the live game
```

`rand.js` is a seeded stream for everything that affects the simulation.
Renderer scatter deliberately stays on `Math.random` — if it drew from the same
stream, a headless run and a rendered run would diverge.

## Running it

```bash
python onager/serve.py 5833
```

Port **5833**. No build step: three.js r170 and Rapier 0.14 are vendored, and
`rapier.es.js` carries its own wasm inline.

## What slice 0 deliberately does not have

One fortress. No progression, no scoring meta, no knight variety beyond the
lance dive, no menus. The question this slice answers is only: *does the
destruction carry it, and is picking a face a real decision?*

# ONAGER — design notes

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

## The targets

The fortress is garrisoned. **Nine soldiers**, posted by face, and putting all of
them down is the win condition. There are exactly two ways:

- **Ride them down.** A knight arriving in person at 40 m/s.
- **Drop the building on them.** A soldier under a collapsing arch, under a floor
  whose joists you burned out, or at the foot of a wall you punched through.
  Crushing scores more than striking, and the game says which happened.

Both are measured, not hoped for: `T7` asserts that soldiers die to falling
masonry and not only to direct hits (5 crushed to 11 struck across a measured
three-shot opening).

Two posts exist purely so crushing has somewhere to happen — a sentry in the
gateway under the arch, and one on the keep floor directly beneath the timber.
Undercut a gate pier and you take three at once: the pair on the walk ride the
arch down and the sentry below wears it.

The **standards** survive from the first pass as a bonus objective. They are
welded to the block they stand on and can only be felled by destroying or tipping
that block, never by a knight brushing the cloth. Making them the primary
objective turned the level into skittles; see below.

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

## Presentation

All of this is in service of one question: did that hit feel like anything?

- **Damage tiers.** Every block carries a procedural stone surface with mortar
  joints, and swaps to a cracked variant at two thirds and one third health. A
  block that just vanishes reads as a glitch; a block that cracks, cracks badly,
  then bursts reads as masonry losing a fight.
- **The drag band.** The slingshot had no visual anchor at all — you dragged in
  empty space and the only feedback was an arm winding back thirty metres away.
  Now: an anchor ring, a taut cord, a power gauge that shifts green to gold to
  red, a live angle and power readout at the pointer, and a tick plus a haptic
  tap every ten percent of draw.
- **Impact.** Speed-scaled splash, punch-through, hitstop that scales with the
  moment, expanding shockwave rings, dust, sparks, and a helm that outlives its
  owner and bounces once.
- **Target markers** drawn with depth testing off, because two of the garrison
  stand inside the fortress where you cannot see them, and a puzzle whose targets
  are invisible is not a puzzle.
- **A siege camp** parented to the machine so it travels round the ring with you:
  tents, a campfire carrying the only warm light in the scene, stores, and the
  knights who have not been fired yet standing in a row — the ammunition counter,
  in the world.

## Measured

Every face has an answer, the answers differ, and one face has none. Swept over
three seeds:

| Face | Shot | Best result |
|---|---|---|
| North | 20 deg, 85% | 4 soldiers — the gatehouse comes down together |
| South | 22 deg, 85% | 3 soldiers — the top storey of the keep drops |
| East | 8 deg, 90% | 2 soldiers — punched clean through the curtain |
| West | 36 deg, 60% | 2 soldiers, and only by shooting clean *past* it |

- 27 assertions green (`ONAGER.sim()`)
- Idle fortress after 5s: 0.29m worst drift, 0 blocks broken, nobody knocked out,
  world asleep
- Preview matches actual flight to 0.7cm
- Every shot resolves inside 5s
- 7.25ms average frame on desktop, 7.8ms on an emulated phone, at ~380 bodies
- The aiming bot clears 4 of 5 runs, averaging 8.8 of 9

**Honest note on West.** The original claim was that west could not be beaten at
all. That was true while standards were the objective and false once soldiers
were, because a high lob from the west crosses the whole castle and can clip two
on the far wall. That is shooting *past* the west face rather than beating it,
and west still has no garrison of its own and stays strictly worse than both
structural faces — so the assertion now says that, instead of the stronger thing
I wanted it to say.

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

**A capsule cannot stand up.** Soldiers built on capsule colliders balance on a
single rounded contact point and tip over on their own: five of nine knocked
themselves out while the fortress stood there perfectly still. A cylinder has a
flat base, stands, and still goes over the moment anything touches it.

**A wrong half-extent blinds the audit.** Those same soldiers then spawned 30cm
above their posts, because a cylinder's half-height is `hh` and I used the capsule
formula `hh + r`. The audit could not catch it: the same wrong figure went into
the half-extents the audit checks, so the AABB looked perfectly supported. An
audit is only ever as good as the geometry it is handed.

**A target must sit on its face's bearing.** Shots travel radially toward the
centre, so a target is only on a face's line if its bearing from the centre
matches that face. Both the courtyard standard and later the courtyard soldier
sat off-bearing, and the east shot — the one they exist to reward — sailed past
them every single time. Geometry, not tuning.

**One placement error, five failed assertions.** A soldier spawned inside a dais
step got shoved out every frame, toppled on its own, and then died to every shot
from every face including the one that is supposed to be unwinnable. Before
chasing five failures, check whether they share a cause.

**A comparison is only as fair as its grid.** The sweep that compares faces has
to contain each face's *designed* shot. East's answer is 8 degrees at 90% power,
and a grid of {8,14,20,...} x {0.6,0.8,1.0} does not contain it — so east looked
no better than a blind lob over the west wall, and I nearly "fixed" a level that
was fine.

**A meshless removal is an invisible destruction.** `Physics.remove` freed the
rigid body but nothing removed the mesh, so every destroyed block and every dead
soldier stayed in the scene exactly where it died, and debris created during play
never got a mesh at all — the wall you had just blown a hole in still looked
solid. Bodies and meshes need one owner: `onAdd`/`onRemove` hooks, set after the
initial build so they only fire during play.

**Near-frontal light flattens everything; extreme rake kills it.** The key light
rides the orbit so the face you are attacking is always lit. At 1.35 radians off
the attack line the entire attacked face fell into shadow and the castle rendered
near black while the field around it was lit. 0.9 gives form shadows and keeps
the face readable.

**Hold the horizontal FOV, not the vertical.** On a narrow or portrait window a
fixed vertical FOV crops the fortress to a featureless wall of masonry with no
silhouette left to read.

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

## What is not here yet

One fortress. No progression or level select, no music, no knight variety beyond
the lance dive.

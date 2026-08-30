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
| drag | aim. **Sideways** swings the machine ±24°, **down** raises the arm |
| wheel / `W` `S` | range (persists between shots) |
| `1` &ndash; `4` | choose the man on the arm |
| `&uarr;` / `&darr;` | angle (`Shift` for fine) |
| `SPACE` | the second tap, once per shot, mid-flight |
| `C` | change the view |
| `R` | restart |
| `Esc` | settings |

On a phone: drag to aim, the two arrows at the bottom circle the fortress, the
+/&minus; buttons set range, and DIVE is the second tap.

Put every soldier down — ride them down in person, or drop the building on them.
Standards are a bonus, not a requirement.

## The four men

Each castle issues a mixed loadout, and the mix is half the puzzle. Every number
below is read straight off `src/knights.js` by the physics; nothing about a type
is hardcoded anywhere else.

| | what it is for | what it is bad at | second tap |
|---|---|---|---|
| **Lance** | the all-rounder; keeps 72% of its speed through a block it breaks | thick stone | a steep drop out of the arc |
| **Maul** | masonry — **3x the Lance** over the same shot grid | range, and it stops where it lands | ground pound |
| **Sapper** | men standing together — the best killer in the game | walls; the blast barely marks them | burst in the air |
| **Brothers** | one becomes three, spread across a wall | anything, individually | split |

Measured, not asserted. Over a twenty-aim grid on Blackmere the Maul breaks 22
blocks to the Lance's 9, the Sapper kills more men than anything else while
breaking a third of what the Maul does, and the Brothers go from 8 kills unsplit
to 19 split — the gap that makes the second tap the type rather than a bonus.

A fifth type, the **Hook**, was built and cut. It hauled a block out of a wall
instead of breaking it. Over a two-shot grid on three faces, opening with a Hook
was worse than opening with a plain Lance every single time. It was tuned twice.
A type that is never the right answer is a slot the player has to learn to
ignore.

## The garrison

Five kinds of defender, each designed against one of your four verbs — see
`src/foes.js`, and the animated roster in-game under **The garrison**.

| | |
|---|---|
| **Levy** | the baseline. If a shot arrives, he goes down. |
| **Rabble** | three to a post, huddled. A Lance takes one; a burst takes all three. |
| **Watch** | three strung out along a wall walk. No burst reaches two of them. |
| **Serjeant** | 70% off a direct strike, and nothing off being crushed. You do not shoot him off the wall — you bring the wall down. |
| **Warden** | masonry within eight metres takes 45% less damage while he lives. He does not defend himself; he changes the ORDER you attack in. |

## The views

`C` cycles four. **Siege** is over the shoulder. **Low** rides down at the arm.
**Wide** looks from above with the whole arc in frame. **Wall** parks at the
castle and watches the shot arrive at you — it cuts rather than pans, because
swinging the camera across the field took two seconds and you missed the impact.

## The castles

| | | | |
|---|---|---|---|
| 1 | **Millbrook Tower** | a watchtower and a garden wall | 4 soldiers, 8 knights |
| 2 | **Harrowgate** | a gatehouse, a thin curtain and a keep | 6 soldiers, 9 knights |
| 3 | **Blackmere Keep** | the whole enceinte | 9 soldiers, 10 knights |
| 4 | **Stonefall Priory** | an arcade under a stone roof | 12 soldiers, 10 knights |
| 5 | **Vantwick on the Sound** | four faces, four answers | 11 soldiers, 10 knights |

Each has its own weather and countryside — high summer, harvest gold, dusk
marsh, hard winter, a storm off the sound. Not decoration: three castles of the same grey blocks on the same green
field is the definition of drab.

Orbit radius and launch speed both scale with the castle. Range goes with the
SQUARE of speed, so a small level fired at the big castle's speeds cannot reach
anything close in — the sentry standing in the open on level one had no firing
solution at all between the 6 and 66 degree limits until speeds were scaled.

## Aiming

Three things tell you where a shot goes, and all three are measured rather than
guessed:

* the **dotted arc** is a swept ball cast through the real collision world, not
  a parabola drawn on top of it &mdash; it stops where the knight stops
* the **gold brackets on the Range bar** are the range settings that reach
  *anything* from where you are standing. If they vanish, the row says
  "nothing in reach" and the answer is to move, not to keep sweeping the dial
* the **gold brackets on the Angle bar** are the angles that reach something at
  the range you have set

The **gold bracket in the world** marks a keystone: one block per face,
computed from a static load analysis of the whole castle. It is the block that
is carrying the most of the building above it relative to its own weight, so
taking it brings the bay down rather than chipping it.

Blocks darken as they take damage and glow hot when one more hit will do it.

## The workshop

**Build a castle** on the title screen opens a top-down plan editor. Every
castle here is laid out on a plan and then given a height, so that is what the
editor is; a 3D gizmo editor would be weeks of work to make a job harder than
it is on paper.

Nine pieces &mdash; wall, tower, pier, slab, soldier, pack, picket, standard,
crates &mdash; and they are exactly the vocabulary the built-in castles are
written in. A player's running bond staggers its joints and closes its ends the
same way Blackmere's does, because it goes through the same code.

Heights snap. A six-course tower's roof is at 8.14 metres and nobody should
have to know that, so anything that takes a height sits on whatever was placed
before it and lies underneath. Type a height and it stays where you put it.

**Build and check it** builds the castle in a headless Rapier world and runs
the same audit the built-in levels are held to: interpenetration at spawn,
floating masonry, whether it stands up on its own for five seconds, whether the
garrison keeps its feet. That is the check that catches a fortress which will
blow itself apart on frame one, and no amount of looking at the plan finds it.

### Sharing

There is no server. A castle is a few hundred bytes of numbers, so it travels
two ways that need nobody's permission:

* **a link** &mdash; the whole castle deflated into the URL fragment, which
  never leaves the browser. A thirteen-piece castle is a 280-character link; a
  ninety-piece one is under 800, and a four-castle pack under 1000.
* **a file** &mdash; readable JSON you can open in a text editor before you run
  it, which is also how packs are kept.

A **pack** is a set of castles that play in order, shared as one link. Opening
somebody's link offers you the castle rather than launching it: it came from a
stranger, and you should see what you are opening.

Everything arriving from outside goes through one door (`normaliseDef`), which
fills in what is missing and clamps what is present. It never throws &mdash; a
malformed document becomes a buildable castle, because somebody following a
link would rather see a plain castle than an error page. Twelve deliberately
broken documents are asserted to still build a world.

## Why it is built this way

3D Angry Birds barely exists because of aiming: add a third axis and the camera
can no longer show you where the shot lands. So the third axis isn't part of the
throw. The slingshot is exactly 2-DOF like the 2D original, and choosing which
face to attack is a separate decision you make before you draw back.

That only works if the faces are different problems, so they are — a gatehouse
arch you undercut, a thin curtain you punch through, a keep whose top storey
sits on timber joists, and one face with nobody posted behind it that is the
worst place to stand. See [DESIGN.md](DESIGN.md).

## Sound

Recorded impacts over synthesis. The samples carry the physical hits — stone,
timber, armour, bodies — panned by where the event happened relative to the line
you are aiming down. Synthesis carries everything tonal (the torsion release,
the rumble of a collapse, the knockout sting) and remains the fallback if the
bank does not load, so the game is never silent.

Kenney's "Impact Sounds", CC0. See [CREDITS.md](CREDITS.md).

## Harness

Everything runs headless (`renderer = null`). In the browser console:

```js
ONAGER.sim()                      // assertions T1-T10, run against Blackmere
ONAGER.setSimLevel(0)             // point the harness at another castle
ONAGER.level(1)                   // jump straight into a castle
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
src/audio.js      recorded impacts (Kenney, CC0) layered over WebAudio synthesis
src/models.js     KayKit characters (CC0), merged and cloned; procedural fallback
assets/audio/     80 impact samples, 646KB
assets/models/    Knight, Barbarian and 25 animation clips, 2.5MB
src/sim.js        headless assertions, audit, parameter sweep
src/rand.js       seeded stream for anything that affects the simulation
```

## Measured

- **27 assertions green** (`ONAGER.sim()`)
- Fortress at rest after 5s: 0.29m worst drift, 0 blocks broken, nobody knocked
  out, world asleep
- Trajectory preview matches actual flight to within **0.7cm**, and the impact
  marker lands within **0.44m** of the knight's real first contact
- Every shot resolves in under **5s**
- **3.0ms** average frame at ~380 bodies plus **4,170** instanced scenery pieces
  in 590 draw calls
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

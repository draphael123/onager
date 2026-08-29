# Credits

## Audio

**Impact sounds** — [Kenney](https://kenney.nl/assets/impact-sounds), "Impact
Sounds" v1.0. Licensed **CC0** (public domain): free for personal, educational
and commercial use, with no attribution required. Credited here anyway, because
it costs nothing and Kenney has given an enormous amount away.

Sixteen families of five variants are bundled in `assets/audio/`:

| In game | Kenney family |
|---|---|
| stone struck, light / medium / heavy | `impactPlate_light` / `_medium` / `_heavy` |
| stone block bursting | `impactMining` |
| timber struck, light / medium / heavy | `impactWood_light` / `_medium` / `_heavy` |
| timber splintering | `impactPlank_medium` |
| a soldier going down, struck / crushed | `impactSoft_medium` / `_heavy` |
| the knight's armour landing | `impactMetal_light` / `_medium` / `_heavy` |
| the body under the armour | `impactPunch_medium` / `_heavy` |
| debris chips | `impactGeneric_light` |

Everything else you hear is synthesised in `src/audio.js` with WebAudio — the
torsion release, the low rumble of a collapse, the knockout sting, the fanfares,
the winding ticks. The samples carry the physical hits; synthesis carries
anything tonal, and remains the fallback if the bank fails to load.

## Characters

**KayKit — Character Pack : Adventurers 2.0** by
[Kay Lousberg](https://www.kaylousberg.com) ([itch.io](https://kaylousberg.itch.io/kaykit-adventurers)).
Licensed **CC0**: free for personal, educational and commercial use, credit
optional. Credited here anyway.

Bundled in `assets/models/`:

| File | Used for |
|---|---|
| `Knight.glb` | your knights — waiting, in flight, and on the machine |
| `Barbarian.glb` | the garrison, tinted red so they read as targets |
| `Anims_General.glb`, `Anims_Movement.glb` | 25 clips on the shared Rig_Medium |

The knight's cape is its own mesh, which is what lets every knight in the
company wear his own colours while the armour underneath stays the same.

Original licence text: `assets/models/KAYKIT_LICENSE.txt`.

## Code and art

Everything else is original to this project.

- **three.js** r170 — MIT — vendored in `vendor/`
- **Rapier** 0.14 (`@dimforge/rapier3d-compat`) — Apache 2.0 — vendored in `vendor/`

Castles, the siege camp, the machine and the whole countryside are generated
procedurally at runtime. The only bought meshes are the characters above, and
the procedural knight and soldier rigs remain in the code as the fallback if
those files fail to load.

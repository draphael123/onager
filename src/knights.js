// knights.js — the ammunition.
//
// The game had one projectile, which meant the only decisions were where to
// stand and how to aim. This genre's actual engine is that DIFFERENT
// AMMUNITION MAKES DIFFERENT PUZZLES: a face that was wrong for the last man
// is right for this one, so the orbit and the material system suddenly have
// something to bite on.
//
// Every type here has to answer three questions or it does not earn its slot:
//   * what is it FOR — a face or a problem it beats better than anything else
//   * what is it BAD at — or it is strictly better than something and nobody
//     ever chooses that thing again
//   * what does its SECOND TAP do — the mid-flight decision that makes the
//     shot yours rather than the machine's
//
// The physics reads these fields directly; nothing about a type is hardcoded
// anywhere else.

export const TYPES = {
  lance: {
    id: 'lance',
    name: 'Lance',
    blurb: 'Punches through. Bad against thick stone.',
    model: 'knight',
    colour: 0x2f5f8c,
    radius: 0.56,
    density: 9.5,
    // Keeps most of its speed through a block it destroys — this is the shot
    // that goes THROUGH a curtain wall and carries on into the yard.
    punchThrough: 0.72,
    damage: 1.0,
    matBonus: {},
    splashRadius: 1.0,
    splashDamage: 1.0,
    burst: false,
    dive: 'dive',
    diveHint: 'lance dive — trade the arc for a steep drop',
  },

  maul: {
    id: 'maul',
    name: 'Maul',
    blurb: 'Shatters stone. Drops like a stone too.',
    model: 'brute',
    tint: 0x9fb6d8,        // a barbarian in OUR colours, not the garrison's red
    colour: 0x6b5a3a,
    radius: 0.62,
    density: 22,                 // heavy: short range at the same power
    punchThrough: 0.18,          // stops where it lands, and stays there
    damage: 1.35,
    matBonus: { stone: 2.6, block: 1.7 },   // the answer to a thick wall
    splashRadius: 1.35,
    splashDamage: 1.5,
    burst: false,
    dive: 'pound',
    diveHint: 'ground pound — slam down and shake the foundations',
  },

  sapper: {
    id: 'sapper',
    name: 'Sapper',
    blurb: 'Bursts. For men standing together.',
    model: 'rogue',
    tint: 0xd08a5a,
    colour: 0x8a4a2a,
    radius: 0.5,
    density: 5.0,
    punchThrough: 0,
    damage: 0.55,                // poor against any single block
    matBonus: {},
    splashRadius: 3.4,           // but it reaches everything nearby
    splashDamage: 1.9,
    splashSoft: 0.1,             // the blast ruins men, not walls
    burst: true,                 // dies where it lands, in a ball of fire
    dive: 'burst',
    diveHint: 'touch it off — burst in the air, over a wall walk',
  },

  brothers: {
    id: 'brothers',
    name: 'Brothers',
    blurb: 'Three of them. Split them wide.',
    model: 'rogue',
    tint: 0x7fc79a,
    colour: 0x2b6b52,
    radius: 0.42,
    // Measured, over a 20-aim grid on Blackmere. At density 15 one Brother was
    // nearly as good as three (17 kills against 22) and the split was a bonus
    // rather than a decision. At 8 it is 8 against 19: a single Brother is the
    // weakest thing you can load, and three of them out-kill a Lance. That gap
    // IS the type.
    density: 8,
    punchThrough: 0.5,
    damage: 0.85,
    matBonus: {},
    splashRadius: 0.8,
    splashDamage: 0.7,
    burst: false,
    dive: 'split',               // one becomes three, spread across the wall
    diveHint: 'split — three of them, spread wide',
  },

};

export const TYPE_ORDER = ['lance', 'maul', 'sapper', 'brothers'];

// A fifth type, the Hook, was built and cut. It grabbed a block and hauled it
// toward the machine instead of breaking it — undercutting a pier rather than
// smashing one. It read well and it did not survive measurement: over a
// two-shot grid on three faces, opening with a Hook was worse than opening
// with a plain Lance every single time (11/7/7 blocks against 13/13/12), and
// worse at killing on one of them. It was tuned twice. A type that is never
// the right answer is a slot the player has to learn to ignore, so it is gone
// rather than nerfed into the corner.

// What each castle issues you. A loadout is a hand: the mix is the puzzle, and
// running out of the obvious answer is what makes you look at the other faces.
export const LOADOUTS = {
  1: { lance: 4, maul: 2 },
  2: { lance: 3, maul: 2, sapper: 2 },
  3: { lance: 3, maul: 2, sapper: 2, brothers: 2 },
  // Stonefall is the arcade: Mauls take the piers, and the two packs in the
  // bays are what the Sappers are for.
  4: { lance: 3, maul: 3, sapper: 2, brothers: 2 },
  // Vantwick asks for one of everything and does not give you a spare, which
  // is the point: four faces, four answers, twelve men.
  5: { lance: 3, maul: 3, sapper: 2, brothers: 2 },
};

export function loadoutList(counts) {
  const out = [];
  for (const id of TYPE_ORDER) {
    for (let i = 0; i < (counts[id] || 0); i++) out.push(id);
  }
  return out;
}

export function loadoutTotal(counts) {
  return TYPE_ORDER.reduce((n, id) => n + (counts[id] || 0), 0);
}

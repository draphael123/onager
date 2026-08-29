// foes.js — the garrison roster.
//
// One kind of soldier meant every castle asked the same question: can you get
// something to this spot. With four kinds of ammunition on your side, the
// garrison has to have answers, or the choice of man never matters.
//
// The rule these were designed against: a foe type earns its slot by taking a
// DEFENSIVE VERB the player's list does not already beat. Not by having more
// hit points, and not by looking different. So the roster is built backwards
// from the four things you can do —
//
//   hit him directly        the Lance
//   drop the wall on him    the Maul
//   catch a group at once   the Sapper
//   reach men stood apart   the Brothers
//
// — and every type is the answer to exactly one of them being wrong.

export const FOES = {
  levy: {
    id: 'levy',
    name: 'Levy',
    blurb: 'Village muster. Dies to whatever reaches him.',
    role: 'The baseline. If a shot arrives, he goes down.',
    model: 'foe',                 // Barbarian
    tint: 0xff7a5e,
    scale: 1.0,
    hp: 26,
    armour: 1,                    // multiplier on damage from a direct strike
    score: 500,
    idle: 'Idle_A',
  },

  serjeant: {
    id: 'serjeant',
    name: 'Serjeant',
    blurb: 'Plate and a shield. Shrug off a direct hit.',
    role: 'Takes a third of the damage from a strike, and full damage from '
      + 'masonry. You do not shoot him off the wall — you bring the wall down.',
    model: 'knight',
    tint: 0x7d8794,
    scale: 1.1,
    hp: 95,
    armour: 0.3,
    score: 800,
    idle: 'Idle_B',
    counter: 'maul',
  },

  rabble: {
    id: 'rabble',
    name: 'Rabble',
    blurb: 'Press-ganged, and they huddle. Three to a post.',
    role: 'Weak on his own and never on his own. A Lance takes one of the '
      + 'three; a burst takes all of them.',
    model: 'hooded',
    tint: 0xc08a4a,
    scale: 0.9,
    hp: 16,
    armour: 1,
    score: 350,
    idle: 'Idle_A',
    pack: 3,                      // posted as a cluster; see fortress.js pack()
    counter: 'sapper',
  },

  watch: {
    id: 'watch',
    name: 'Watch',
    blurb: 'Strung out along the wall walk, well apart.',
    role: 'Never bunched, so a burst only ever catches one. Three men split '
      + 'wide across a wall is what the Brothers are for.',
    model: 'ranger',
    tint: 0x5f7f9c,
    scale: 1.0,
    hp: 24,
    armour: 1,
    score: 450,
    idle: 'Idle_B',
    picket: 3,                    // posted spread along a run; see picket()
    counter: 'brothers',
  },

  warden: {
    id: 'warden',
    name: 'Warden',
    blurb: 'Shores the walls. Nothing near him breaks easily.',
    role: 'While he lives, masonry within eight metres takes 45% less damage. '
      + 'He does not defend himself — he defends the castle, so he changes the '
      + 'ORDER you do things in rather than the shot you use.',
    model: 'mage',
    tint: 0x6f5aa8,
    scale: 1.0,
    hp: 34,
    armour: 1,
    score: 900,
    idle: 'Idle_A',
    shore: { radius: 8, factor: 0.55 },
  },
};

export const FOE_ORDER = ['levy', 'rabble', 'watch', 'serjeant', 'warden'];

// Which castle first fields each type, so the roster screen can say where you
// will meet him and the campaign has a legible ramp.
export const FOE_DEBUT = { levy: 1, rabble: 2, watch: 2, serjeant: 3, warden: 3 };

export function foe(id) { return FOES[id] || FOES.levy; }

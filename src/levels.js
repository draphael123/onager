// levels.js — the campaign.
//
// Each level owns its castle, its knight budget, its orbit radius, and its
// LOOK. The look is not decoration: three castles built from the same grey
// blocks on the same green field is the definition of drab, and the fastest way
// to make a small castle feel like a different place is to change the weather
// and what grows around it.
//
// orbitR scales with the castle. A small keep sat at radius 38 reads as a model
// on a table and every shot is a long blind lob.

import {
  buildLevel1, buildLevel2, buildLevel3, buildLevel4, buildLevel5,
  FACES1, FACES2, FACES3, FACES4, FACES5,
} from './fortress.js';

export const THEMES = {
  // High summer. Bright, green, busy with life — the friendliest thing in the
  // game, because it is the first thing you see after the title.
  meadow: {
    sky: [[0.00, '#3d74c4'], [0.40, '#8db6e2'], [0.62, '#cfe0ec'], [0.80, '#e8dcc2'], [1.00, '#cbb891']],
    fogColour: 0xcfdce8, fogNear: 150, fogFar: 540,
    sunColour: 0xfff0cf, sunPower: 3.3, sunHeight: 56, rake: 0.9,
    hemiSky: 0xa9c6ea, hemiGround: 0x77874f, hemiPower: 1.28, fillPower: 0.6,
    exposure: 1.12,
    ground: 0x6f8a46, patchA: 0x86994f, patchB: 0x5d7440,
    hills: [0x5f7a4a, 0x74886e, 0x8ba0ad],
    canopy: [0x4f7c34, 0x5d8a3a, 0x44702e, 0x6b9440],
    trunk: 0x5b432c, rock: 0x8a877c, tuft: 0x7d9450,
    flowers: [0xf2d24b, 0xe8e0d0, 0xd9607a, 0xb98fd6],
    scorch: 0x6b6144, water: 0x3f6f88, plinth: 0x6a6c40,
    mix: { broadleaf: 0.44, conifer: 0.2, dead: 0.0, bush: 0.16, rock: 0.1, tuft: 0.1 },
    props: { fences: 5, hay: 4, cart: 1, pond: 1, reeds: 10, ruin: 0, stones: 0, birds: 4,
      flocks: 3, woodpile: 2, graves: 0, windmill: true, chapel: true, jetty: false },
  },

  // Late autumn, low sun, stubble and stooks. Warm and gold, and the long
  // shadows do most of the work.
  harvest: {
    sky: [[0.00, '#4a6fa8'], [0.38, '#9db3cd'], [0.58, '#e0cfae'], [0.78, '#e8b478'], [1.00, '#c98a52']],
    fogColour: 0xdcc9a8, fogNear: 120, fogFar: 460,
    sunColour: 0xffd79a, sunPower: 3.6, sunHeight: 34, rake: 1.0,
    hemiSky: 0xc3bfa8, hemiGround: 0x8a7642, hemiPower: 1.05, fillPower: 0.48,
    exposure: 1.14,
    ground: 0x9a8a4e, patchA: 0xb0994f, patchB: 0x7d6f3c,
    hills: [0x7d7245, 0x8f8460, 0xa39d8c],
    canopy: [0xc07a2c, 0xd9a13c, 0xa8542a, 0x8f6b26],
    trunk: 0x4e3a26, rock: 0x8d8375, tuft: 0xa89552,
    flowers: [0xe0a83c, 0xc4622c, 0xe8ddc0],
    scorch: 0x5c4f34, water: 0x4b6a72, plinth: 0x7a6a3e,
    mix: { broadleaf: 0.42, conifer: 0.1, dead: 0.1, bush: 0.14, rock: 0.12, tuft: 0.12 },
    props: { fences: 6, hay: 11, cart: 3, pond: 1, reeds: 4, ruin: 2, stones: 0, birds: 6,
      flocks: 2, woodpile: 3, graves: 1, windmill: true, chapel: true, jetty: false },
  },

  // Cold marsh at dusk. Blue-grey, standing water, dead timber and ruins. The
  // hardest castle should feel like the least hospitable place.
  marsh: {
    sky: [[0.00, '#22345c'], [0.36, '#4c6386'], [0.58, '#8496a8'], [0.78, '#b39a8c'], [1.00, '#8a7566']],
    fogColour: 0x8fa0ae, fogNear: 80, fogFar: 380,
    sunColour: 0xffc9a0, sunPower: 2.9, sunHeight: 26, rake: 1.05,
    hemiSky: 0x8ea6c4, hemiGround: 0x4b5545, hemiPower: 1.06, fillPower: 0.55,
    exposure: 1.06,
    ground: 0x5a6247, patchA: 0x666d4e, patchB: 0x474e3b,
    hills: [0x4a5450, 0x5c6668, 0x76828e],
    canopy: [0x3f5238, 0x47593c, 0x36462f],
    trunk: 0x40382e, rock: 0x6e7076, tuft: 0x69704e,
    flowers: [0xc8ccd2, 0x9aa4b0],
    scorch: 0x3c382c, water: 0x39505c, plinth: 0x4a4e3a,
    mix: { broadleaf: 0.12, conifer: 0.16, dead: 0.34, bush: 0.1, rock: 0.16, tuft: 0.12 },
    props: { fences: 2, hay: 0, cart: 1, pond: 4, reeds: 30, ruin: 4, stones: 4, birds: 5,
      flocks: 0, woodpile: 1, graves: 3, windmill: false, chapel: true, jetty: true },
  },

  // Hard winter. Almost no colour left in the ground, so the garrison's red and
  // the fire of a burst are the only warm things on screen — which is exactly
  // where you want the eye on the castle that first mixes the roster.
  frost: {
    sky: [[0.00, '#2c4a78'], [0.36, '#6d8cb4'], [0.58, '#adc0d2'], [0.80, '#dfe4e8'], [1.00, '#c9ccd2']],
    fogColour: 0xd4dce4, fogNear: 100, fogFar: 430,
    sunColour: 0xdfe8ff, sunPower: 3.0, sunHeight: 32, rake: 0.88,
    hemiSky: 0xb9cde4, hemiGround: 0x9aa2a6, hemiPower: 1.32, fillPower: 0.66,
    exposure: 1.10,
    ground: 0xa8b0b4, patchA: 0xbcc4c6, patchB: 0x8f9a9e,
    hills: [0x9aa6ae, 0xb0bac2, 0xc6ced6],
    canopy: [0x3d5548, 0x476052, 0x35483d, 0x8f9c96],
    trunk: 0x4a4038, rock: 0x8e9298, tuft: 0x8d9689,
    flowers: [0xe8edf2, 0xc9d4dc],
    scorch: 0x50554e, water: 0x53707e, plinth: 0x7e858a,
    mix: { broadleaf: 0.1, conifer: 0.42, dead: 0.22, bush: 0.06, rock: 0.14, tuft: 0.06 },
    props: { fences: 3, hay: 1, cart: 1, pond: 2, reeds: 4, ruin: 3, stones: 3, birds: 3,
      flocks: 1, woodpile: 4, graves: 2, windmill: false, chapel: true, jetty: false },
  },

  // A storm coming in off the sound. The darkest, wettest, loudest weather in
  // the game, on the castle that asks the most of you.
  sound: {
    sky: [[0.00, '#1b2a44'], [0.34, '#3f5470'], [0.56, '#6d7d8c'], [0.76, '#9a9a90'], [1.00, '#6f6a62']],
    fogColour: 0x8b959c, fogNear: 90, fogFar: 380,
    sunColour: 0xffd8b4, sunPower: 3.5, sunHeight: 24, rake: 0.92,
    hemiSky: 0x7d90a6, hemiGround: 0x4a5348, hemiPower: 1.16, fillPower: 0.68,
    exposure: 1.10,
    ground: 0x5d6a52, patchA: 0x6b7758, patchB: 0x4a5544,
    hills: [0x475448, 0x59635c, 0x74808a],
    canopy: [0x39503a, 0x415a40, 0x2f4030],
    trunk: 0x3c352d, rock: 0x6a6f74, tuft: 0x6b7554,
    flowers: [0xd6d2c4, 0x8f9aa4],
    scorch: 0x3a382f, water: 0x2f4a5a, plinth: 0x4e564a,
    mix: { broadleaf: 0.1, conifer: 0.2, dead: 0.3, bush: 0.12, rock: 0.2, tuft: 0.08 },
    props: { fences: 2, hay: 0, cart: 1, pond: 5, reeds: 22, ruin: 5, stones: 5, birds: 6,
      flocks: 0, woodpile: 2, graves: 4, windmill: false, chapel: false, jetty: true },
  },
};

export const LEVELS = [
  {
    id: 1,
    name: 'Millbrook Tower',
    sub: 'A watchtower and a garden wall',
    blurb: 'Four of them, and eight of you. Start with the one stood in the open.',
    build: buildLevel1,
    faces: FACES1,
    // Deliberately generous. The bot clears this in five tries out of five,
    // but the bot has a ballistic solver and a first-time player has a feel
    // for nothing yet — the early castles are where you are learning what the
    // controls even do, so they get spare men and soft mortar.
    knights: 8,
    masonry: 0.62,
    orbitR: 20,
    theme: 'meadow',
  },
  {
    id: 2,
    name: 'Harrowgate',
    sub: 'A gatehouse, a thin curtain, and a keep',
    blurb: 'Nine of you. The arch carries three of them at once.',
    build: buildLevel2,
    faces: FACES2,
    knights: 9,
    masonry: 0.78,
    orbitR: 27,
    theme: 'harvest',
  },
  {
    id: 3,
    name: 'Blackmere Keep',
    sub: 'The whole enceinte, and nine to put down',
    blurb: 'Nine of them. One face is the wrong place to stand.',
    build: buildLevel3,
    faces: FACES3,
    knights: 10,
    masonry: 0.92,
    orbitR: 38,
    theme: 'marsh',
  },
  {
    id: 4,
    name: 'Stonefall Priory',
    sub: 'An arcade, a bell tower, and a mixed garrison',
    blurb: 'Ten. The roof is held up by four thin piers — take one.',
    build: buildLevel4,
    faces: FACES4,
    knights: 10,
    orbitR: 34,
    theme: 'frost',
  },
  {
    id: 5,
    name: 'Vantwick on the Sound',
    sub: 'Four faces, four different answers',
    blurb: 'Ten men, eleven of them. No two sides want the same man.',
    build: buildLevel5,
    faces: FACES5,
    knights: 10,
    orbitR: 40,
    theme: 'sound',
  },
];

const PROG_KEY = 'onager_progress_v1';

export function loadProgress() {
  try {
    const raw = localStorage.getItem(PROG_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) { /* private mode — start fresh */ }
  return { unlocked: 1, best: {} };
}

export function saveProgress(p) {
  try { localStorage.setItem(PROG_KEY, JSON.stringify(p)); } catch (e) { /* ignore */ }
}

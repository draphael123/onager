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

import { buildLevel1, buildLevel2, buildLevel3, FACES1, FACES2, FACES3 } from './fortress.js';

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
    props: { fences: 3, hay: 4, cart: 1, pond: 1, reeds: 10, ruin: 0, stones: 0, birds: 3 },
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
    props: { fences: 4, hay: 7, cart: 2, pond: 0, reeds: 0, ruin: 1, stones: 0, birds: 5 },
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
    props: { fences: 1, hay: 0, cart: 1, pond: 3, reeds: 26, ruin: 3, stones: 4, birds: 4 },
  },
};

export const LEVELS = [
  {
    id: 1,
    name: 'Millbrook Tower',
    sub: 'A watchtower and a garden wall',
    blurb: 'Four of them. Start with the one stood in the open.',
    build: buildLevel1,
    faces: FACES1,
    knights: 6,
    orbitR: 20,
    theme: 'meadow',
  },
  {
    id: 2,
    name: 'Harrowgate',
    sub: 'A gatehouse, a thin curtain, and a keep',
    blurb: 'Seven. The arch carries three of them at once.',
    build: buildLevel2,
    faces: FACES2,
    knights: 7,
    orbitR: 27,
    theme: 'harvest',
  },
  {
    id: 3,
    name: 'Blackmere Keep',
    sub: 'The whole enceinte, and nine to put down',
    blurb: 'Nine. One face is the wrong place to stand.',
    build: buildLevel3,
    faces: FACES3,
    knights: 9,
    orbitR: 38,
    theme: 'marsh',
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

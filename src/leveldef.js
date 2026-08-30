// leveldef.js — the level document.
//
// The five built-in castles are JavaScript: they call the builder directly and
// they can do anything. A player-made castle cannot be JavaScript, because it
// arrives from a stranger over a URL, so it is DATA — a list of pieces with
// numbers — and this module is the only thing that turns that data into a
// world. Nothing here evaluates anything.
//
// The pieces are exactly the builder's vocabulary. That is deliberate: the
// editor cannot express a castle the game does not already know how to build,
// and every piece placed in the editor goes through the same wall/tower/pier
// code that the hand-written castles use, so a player's running bond staggers
// its joints and closes its ends the same way Blackmere's does.

import { makeBuilder, F, CH } from './fortress.js';
import { FOES } from './foes.js';
import { TYPE_ORDER } from './knights.js';
import { THEMES } from './levels.js';

export const DEF_VERSION = 1;

// Every piece type the editor can place, with the parameters it takes and the
// limits it is held to. The limits are not decoration: a wall 400 courses high
// is a hang, and a level arriving from a URL is untrusted input.
export const PIECES = {
  wall: {
    name: 'Wall',
    hint: 'A course-built wall. Joints stagger, ends close with half blocks.',
    fields: {
      len: { min: 2, max: 40, step: 0.5, def: 12, label: 'Length' },
      thick: { min: 0.4, max: 3, step: 0.05, def: 0.8, label: 'Thickness' },
      courses: { min: 1, max: 12, step: 1, def: 4, label: 'Courses' },
      axis: { opts: ['x', 'z'], def: 'x', label: 'Runs along' },
      mat: { opts: ['block', 'stone', 'timber'], def: 'block', label: 'Material' },
      merlons: { bool: true, def: true, label: 'Battlements' },
    },
    footprint: (p) => (p.axis === 'x'
      ? { hx: p.len / 2, hz: p.thick }
      : { hx: p.thick, hz: p.len / 2 }),
  },
  tower: {
    name: 'Tower',
    hint: 'Four walls, a floor of timber joists, and a roof you can stand on.',
    fields: {
      r: { min: 1.6, max: 8, step: 0.1, def: 3.2, label: 'Radius' },
      thick: { min: 0.4, max: 1.6, step: 0.05, def: 0.6, label: 'Thickness' },
      courses: { min: 2, max: 12, step: 1, def: 6, label: 'Courses' },
      joistAt: { min: -1, max: 10, step: 1, def: 4, label: 'Floor at course' },
      mat: { opts: ['block', 'stone'], def: 'block', label: 'Material' },
    },
    footprint: (p) => ({ hx: p.r + p.thick, hz: p.r + p.thick }),
  },
  pier: {
    name: 'Pier',
    hint: 'A single column. Put a lintel across two of them and you have a gate.',
    fields: {
      courses: { min: 1, max: 12, step: 1, def: 5, label: 'Courses' },
      hw: { min: 0.3, max: 3, step: 0.05, def: 0.8, label: 'Half width' },
      hd: { min: 0.3, max: 3, step: 0.05, def: 1.0, label: 'Half depth' },
      mat: { opts: ['stone', 'block'], def: 'stone', label: 'Material' },
    },
    footprint: (p) => ({ hx: p.hw, hz: p.hd }),
  },
  slab: {
    name: 'Slab',
    hint: 'One block, placed at a height. Lintels, roofs, walkways.',
    fields: {
      y: { min: 1, max: 24, step: 0.1, def: 6, label: 'Height' },
      hx: { min: 0.2, max: 8, step: 0.1, def: 2.5, label: 'Half width' },
      hy: { min: 0.15, max: 2, step: 0.05, def: 0.45, label: 'Half height' },
      hz: { min: 0.2, max: 8, step: 0.1, def: 1.0, label: 'Half depth' },
      mat: { opts: ['stone', 'block', 'timber'], def: 'stone', label: 'Material' },
    },
    footprint: (p) => ({ hx: p.hx, hz: p.hz }),
  },
  soldier: {
    name: 'Soldier',
    hint: 'One of the garrison. Stands ON the surface you give as the height.',
    fields: {
      y: { min: 1, max: 24, step: 0.1, def: F, label: 'Stands at' },
      foe: { opts: ['levy', 'rabble', 'watch', 'serjeant', 'warden'], def: 'levy', label: 'Type' },
    },
    footprint: () => ({ hx: 0.35, hz: 0.35 }),
    target: true,
  },
  pack: {
    name: 'Pack',
    hint: 'Three men huddled together. One burst takes the lot.',
    fields: { y: { min: 1, max: 24, step: 0.1, def: F, label: 'Stands at' } },
    footprint: () => ({ hx: 1.0, hz: 1.0 }),
    target: true,
  },
  picket: {
    name: 'Picket',
    hint: 'Three men strung out. No single burst reaches two of them.',
    fields: {
      y: { min: 1, max: 24, step: 0.1, def: F, label: 'Stands at' },
      dx: { min: 0, max: 24, step: 0.5, def: 0, label: 'Spread in X' },
      dz: { min: 0, max: 24, step: 0.5, def: 8, label: 'Spread in Z' },
    },
    footprint: (p) => ({ hx: Math.max(0.4, p.dx / 2), hz: Math.max(0.4, p.dz / 2) }),
    target: true,
  },
  banner: {
    name: 'Standard',
    hint: 'A bonus, not a requirement. Fells when what it stands on goes.',
    fields: { y: { min: 1, max: 24, step: 0.1, def: F, label: 'Stands at' } },
    footprint: () => ({ hx: 0.3, hz: 0.3 }),
  },
  crate: {
    name: 'Crates',
    hint: 'Stores. They scatter well and they get in the way.',
    fields: { n: { min: 1, max: 6, step: 1, def: 3, label: 'How many' } },
    footprint: () => ({ hx: 0.9, hz: 0.9 }),
  },
};

export const PIECE_ORDER = ['wall', 'tower', 'pier', 'slab', 'soldier', 'pack',
  'picket', 'banner', 'crate'];

export const LIMITS = {
  pieces: 90,            // a castle, not a city — and a bound on build time
  nameLen: 44,
  authorLen: 28,
  orbitR: { min: 14, max: 52 },
  masonry: { min: 0.4, max: 1.6 },
  plinth: { min: 5, max: 26 },
  knights: { min: 1, max: 20 },
  coord: 30,             // pieces must sit inside the plinth's world
};

export function blankDef() {
  return {
    v: DEF_VERSION,
    name: 'New castle',
    author: '',
    theme: 'meadow',
    orbitR: 26,
    masonry: 1,
    plinth: [12, 12],
    loadout: { lance: 4, maul: 2 },
    pieces: [],
  };
}

const clampN = (v, lo, hi, d) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
};

// Fill in every missing field and clamp every present one. This is the trust
// boundary: everything downstream may assume a def that has been through here
// is complete and in range. It never throws — a broken document becomes a
// buildable one, because a player who was sent a bad link would rather see a
// slightly wrong castle than an error page.
export function normaliseDef(raw) {
  const d = blankDef();
  if (!raw || typeof raw !== 'object') return d;
  d.name = String(raw.name || d.name).slice(0, LIMITS.nameLen);
  d.author = String(raw.author || '').slice(0, LIMITS.authorLen);
  d.theme = THEMES[raw.theme] ? raw.theme : 'meadow';
  d.orbitR = clampN(raw.orbitR, LIMITS.orbitR.min, LIMITS.orbitR.max, d.orbitR);
  d.masonry = clampN(raw.masonry, LIMITS.masonry.min, LIMITS.masonry.max, 1);
  const px = clampN(raw.plinth && raw.plinth[0], LIMITS.plinth.min, LIMITS.plinth.max, 12);
  const pz = clampN(raw.plinth && raw.plinth[1], LIMITS.plinth.min, LIMITS.plinth.max, 12);
  d.plinth = [px, pz];

  d.loadout = {};
  let total = 0;
  for (const id of TYPE_ORDER) {
    const n = Math.round(clampN(raw.loadout && raw.loadout[id], 0, LIMITS.knights.max, 0));
    if (n > 0) { d.loadout[id] = n; total += n; }
  }
  if (!total) d.loadout = { lance: 4, maul: 2 };

  d.pieces = [];
  const list = Array.isArray(raw.pieces) ? raw.pieces.slice(0, LIMITS.pieces) : [];
  for (const p of list) {
    const spec = PIECES[p && p.t];
    if (!spec) continue;
    const out = {
      t: p.t,
      x: clampN(p.x, -LIMITS.coord, LIMITS.coord, 0),
      z: clampN(p.z, -LIMITS.coord, LIMITS.coord, 0),
    };
    // The author typed this height themselves, so the editor must not re-snap
    // it. Carried through normalisation and through the share codec, or a
    // deliberately floating walkway is silently dropped to the ground the
    // first time anything near it is nudged.
    if (p.pinY) out.pinY = true;
    for (const [k, f] of Object.entries(spec.fields)) {
      if (f.opts) out[k] = f.opts.includes(p[k]) ? p[k] : f.def;
      else if (f.bool) out[k] = p[k] == null ? f.def : !!p[k];
      else out[k] = clampN(p[k], f.min, f.max, f.def);
    }
    d.pieces.push(out);
  }
  return d;
}

// The top surface of a piece, in world Y. This is the single most useful thing
// the editor can know: the author is asked for the height a soldier stands at,
// and without this they have no way to find out that a six-course tower's roof
// is at 8.14 rather than 7.6 — every one of my own worked examples had men
// hovering above their posts before this existed.
export function topOf(p) {
  switch (p.t) {
    case 'wall': {
      const top = F + p.courses * CH * 2;
      return p.merlons ? top + 0.7 : top;      // merlons.js adds 0.35 half-height
    }
    case 'pier': return F + p.courses * CH * 2;
    case 'tower': {
      // Mirrors tower() exactly: courses of CH*2, plus 0.30 for the joist
      // course when there is one, then 0.44 to the top of the roof slab.
      let y = F;
      for (let c = 0; c < p.courses; c++) {
        if (c === p.joistAt) y += 0.30;
        y += CH * 2;
      }
      return y + 0.44;
    }
    case 'slab': return p.y + p.hy;
    default: return F;
  }
}

// Do two plan footprints meet? A man is a point and a lintel is an area, and
// the difference matters: a lintel's CENTRE is over the gap between the two
// piers that carry it, so a point test finds nothing under it and drops the
// whole gate to the ground.
function meets(p, x, z, hx, hz) {
  const f = PIECES[p.t].footprint(p);
  return Math.abs(x - p.x) <= f.hx + hx + 0.05
    && Math.abs(z - p.z) <= f.hz + hz + 0.05;
}

// The height something at (x, z) should stand at: the top of the highest solid
// piece under it, or the plinth. `hx`/`hz` give the thing's own footprint, so a
// slab finds the supports at its ENDS.
// Support follows PLACEMENT ORDER: a piece rests on what was already there,
// never on something added after it. Without that rule a second course of
// slabs stacked on the first (their footprints touch, so each one snapped onto
// the last) and an arcade roof climbed to nine metres in three steps. It is
// also the model an author already has — you build from the bottom up.
export function groundAt(def, x, z, ignore, hx = 0, hz = 0) {
  let y = F;
  const stop = ignore ? def.pieces.indexOf(ignore) : -1;
  for (let i = 0; i < def.pieces.length; i++) {
    if (stop >= 0 && i >= stop) break;
    const p = def.pieces[i];
    if (p === ignore) continue;
    if (p.t === 'soldier' || p.t === 'pack' || p.t === 'picket'
      || p.t === 'banner' || p.t === 'crate') continue;
    if (!meets(p, x, z, hx, hz)) continue;
    // A tower's interior is a floor, not a roof — standing "on" a tower at its
    // centre means the roof, which is what an author placing a lookout means.
    y = Math.max(y, topOf(p));
  }
  return Math.round(y * 100) / 100;
}

export function defaultsFor(t) {
  const spec = PIECES[t];
  const out = { t, x: 0, z: 0 };
  for (const [k, f] of Object.entries(spec.fields)) out[k] = f.def;
  return out;
}

// How many men are in this castle, without building it. The editor needs the
// number live and building a Rapier world per keystroke is not an option.
export function garrisonCount(def) {
  let n = 0;
  for (const p of def.pieces) {
    if (p.t === 'soldier') n += 1;
    else if (p.t === 'pack') n += (FOES.rabble.pack || 3);
    else if (p.t === 'picket') n += (FOES.watch.picket || 3);
  }
  return n;
}

export function knightCount(def) {
  return TYPE_ORDER.reduce((n, id) => n + (def.loadout[id] || 0), 0);
}

// ---------------------------------------------------------------------------
// building
// ---------------------------------------------------------------------------

// Turn a def into a world, using the same builder the hand-written castles use.
export function buildFromDef(phys, def) {
  const d = normaliseDef(def);
  const b = makeBuilder(phys);
  b.ground();
  b.plinth(d.plinth[0], d.plinth[1]);

  // Towers first, because a banner or a soldier placed on a tower roof needs
  // the roof to exist to be welded to. Everything else is order-independent.
  const towers = [];
  for (const p of d.pieces) {
    if (p.t !== 'tower') continue;
    const t = b.tower({ x: p.x, z: p.z, r: p.r, t: p.thick, courses: p.courses,
      joistAt: p.joistAt, doorFace: 1, spanBlocks: 3, mat: p.mat });
    towers.push({ p, t });
  }

  for (const p of d.pieces) {
    switch (p.t) {
      case 'tower': break;                       // already built
      case 'wall':
        b.wall({ x: p.x, z: p.z, axis: p.axis, len: p.len, thick: p.thick,
          courses: p.courses, mat: p.mat, merlons: p.merlons });
        break;
      case 'pier':
        b.pier(p.x, p.z, p.courses, p.hw, p.hd, p.mat);
        break;
      case 'slab':
        phys.addBox(p.x, p.y, p.z, p.hx, p.hy, p.hz, { mat: p.mat, kind: 'slab' });
        break;
      case 'soldier':
        b.soldier(p.x, p.y, p.z, 'post', p.foe);
        break;
      case 'pack':
        b.pack(p.x, p.y, p.z, 'post');
        break;
      case 'picket':
        b.picket(p.x, p.y, p.z, p.dx, p.dz, 'post');
        break;
      case 'banner': {
        // Welded to whatever solid thing is directly beneath it, the way the
        // built-in castles do it — an unhosted standard is a skittle.
        const host = nearestHost(phys, p.x, p.y, p.z);
        b.banner(p.x, p.y, p.z, 'standard', host);
        break;
      }
      case 'crate':
        for (let i = 0; i < p.n; i++) {
          b.crate(p.x + (i % 2) * 0.9 - 0.45, p.z + ((i / 2) | 0) * 0.9 - 0.45);
        }
        break;
    }
  }
  return b.done({ custom: true });
}

// The solid block a standard is planted in. Without a host the weld has nothing
// to hold and the pole falls over the first time anything brushes it.
function nearestHost(phys, x, y, z) {
  let best = null, bd = 1e9;
  for (const q of phys.list) {
    if (q.fixed || q.kind === 'soldier' || q.kind === 'banner' || !q.half) continue;
    const t = q.body.translation();
    if (t.y > y + 0.1) continue;
    const d = Math.hypot(t.x - x, t.z - z) + (y - t.y) * 0.6;
    if (d < bd) { bd = d; best = q; }
  }
  return bd < 2.4 ? best : null;
}

// The four faces of a custom castle. A player does not write prose for their
// walls, so the names are the compass and the sub-line is generated from what
// is actually posted on that bearing — which is the only thing the built-in
// sub-lines were ever telling you anyway.
export function facesFor(def) {
  const d = normaliseDef(def);
  const dirs = [
    { name: 'North', a: 0 }, { name: 'East', a: Math.PI / 2 },
    { name: 'South', a: Math.PI }, { name: 'West', a: -Math.PI / 2 },
  ];
  return dirs.map((dir) => {
    let men = 0, walls = 0;
    for (const p of d.pieces) {
      const bearing = Math.atan2(p.x, -p.z);
      const off = Math.abs(Math.atan2(Math.sin(bearing - dir.a), Math.cos(bearing - dir.a)));
      if (off > 0.78 && Math.hypot(p.x, p.z) > 1.5) continue;
      if (p.t === 'soldier') men += 1;
      else if (p.t === 'pack' || p.t === 'picket') men += 3;
      else if (p.t === 'wall' || p.t === 'tower' || p.t === 'pier') walls += 1;
    }
    const sub = men === 0
      ? (walls ? 'nobody posted behind it' : 'open ground')
      : `${men} posted${walls ? '' : ', and no wall in the way'}`;
    return { name: dir.name, sub, a: dir.a };
  });
}

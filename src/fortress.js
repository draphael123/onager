// fortress.js — the castles.
//
// Coordinates: -Z is north, +X is east. Ground plane at y = 0, and every wall
// starts at F, the top of the plinth.
//
// EVERY dimension here is checked by ONAGER.audit(): blocks must not
// interpenetrate at spawn (Rapier detonates the castle on frame 1) and must not
// float (they land, and the player reads it as the castle collapsing before they
// fired). Both faults are invisible in a screenshot. Re-run the audit after
// touching any number in this file.
//
// Two geometry rules earned the hard way and never to be broken:
//   * Interlocked corners. The X-running faces of a tower stop at the INNER
//     face of the Z-running faces, which run the full depth. Sizing both to the
//     full span makes them overrun each other and the tower detonates.
//   * A running bond needs HALF blocks at the ends, not one block fewer.
//     Dropping the end block leaves the course above cantilevered past its own
//     centre of mass and the wall peels itself apart from the ends inward.

import { rnd01 } from './rand.js';

export const F = 1.0;    // top of the plinth
export const CH = 0.55;  // course half-height, so a course is 1.1 tall

export function faceAt(angle, faces) {
  const a = Math.atan2(Math.sin(angle), Math.cos(angle));
  let best = faces[0], bd = 9;
  for (const f of faces) {
    const d = Math.abs(Math.atan2(Math.sin(a - f.a), Math.cos(a - f.a)));
    if (d < bd) { bd = d; best = f; }
  }
  // Between two faces the compass should say so — a corner is a legitimately
  // different (and often better) shot than either flat face.
  if (bd > 0.62) return { name: best.name.split(' ')[0] + ' Corner',
    sub: 'oblique — you can see two faces', corner: true };
  return best;
}

// ---------------------------------------------------------------------------
// builder
// ---------------------------------------------------------------------------

export function makeBuilder(phys) {
  const banners = [], soldiers = [];
  const jitter = () => (rnd01() - 0.5) * 0.03;

  function ground() {
    phys.addBox(0, -1.0, 0, 200, 1.0, 200, { fixed: true, mat: 'stone', kind: 'ground' });
  }

  function plinth(hx, hz, x = 0, z = 0) {
    phys.addBox(x, 0.5, z, hx, 0.5, hz, { fixed: true, mat: 'stone', kind: 'plinth' });
  }

  // A course-built wall. Alternate courses shift by half a block so the joints
  // stagger, with half blocks closing both ends.
  function wall(o) {
    const { x, z, axis, len, thick, courses, mat = 'block', slits = [], merlons = false,
      hpScale = 1 } = o;
    const bh = o.blockH || CH;
    const n = Math.max(1, Math.round(len / (o.blockW || 3.1)));
    const step = len / n;
    for (let c = 0; c < courses; c++) {
      const y = F + bh + c * bh * 2;
      const odd = c % 2;
      const cells = [];
      if (odd) {
        cells.push([-len / 2 + step * 0.25, step * 0.21]);
        for (let i = 1; i < n; i++) cells.push([-len / 2 + step * i, step * 0.46]);
        cells.push([len / 2 - step * 0.25, step * 0.21]);
      } else {
        for (let i = 0; i < n; i++) cells.push([-len / 2 + step * (i + 0.5), step * 0.46]);
      }
      for (const [t, half] of cells) {
        if (slits.some(s => c >= s.c0 && c <= s.c1 && Math.abs(t - s.t) < step * 0.5)) continue;
        const px = axis === 'x' ? x + t : x;
        const pz = axis === 'x' ? z : z + t;
        phys.addBox(px + jitter(), y, pz + jitter(),
          axis === 'x' ? half : thick, bh, axis === 'x' ? thick : half,
          { mat, kind: 'block', hpScale });
      }
    }
    if (merlons) {
      const y = F + courses * bh * 2 + bh * 0.8;
      for (let i = 0; i < n; i += 2) {
        const t = -len / 2 + step * (i + 0.5);
        const px = axis === 'x' ? x + t : x;
        const pz = axis === 'x' ? z : z + t;
        phys.addBox(px, y, pz,
          axis === 'x' ? step * 0.3 : thick * 0.86, bh * 0.8,
          axis === 'x' ? thick * 0.86 : step * 0.3, { mat, kind: 'merlon', hpScale });
      }
    }
    return F + courses * bh * 2;
  }

  function pier(x, z, courses, hw, hd, mat = 'stone') {
    let y = F;
    for (let c = 0; c < courses; c++) {
      phys.addBox(x + jitter(), y + CH, z + jitter(), hw, CH, hd, { mat, kind: 'block' });
      y += CH * 2;
    }
    return y;
  }

  // A run of blocks sized FROM the span they must occupy, so they never overrun
  // whatever meets them at the corner.
  function run(axis, fixedA, t0, t1, y, thick, count, mat, kind = 'block') {
    const step = (t1 - t0) / count;
    const half = step * 0.47;
    for (let i = 0; i < count; i++) {
      const t = t0 + step * (i + 0.5);
      const px = axis === 'x' ? t : fixedA;
      const pz = axis === 'x' ? fixedA : t;
      phys.addBox(px + jitter(), y, pz + jitter(),
        axis === 'x' ? half : thick, CH, axis === 'x' ? thick : half, { mat, kind });
    }
  }

  // A hollow tower with interlocked corners and, optionally, a timber floor
  // partway up that genuinely carries the courses above it — break the joists
  // and everything above loses its footing.
  function tower(o) {
    const { x = 0, z = 0, r = 3.9, t = 0.62, courses = 6, joistAt = -1,
      doorFace = 1, spanBlocks = 3, mat = 'block' } = o;
    // Clearances are ABSOLUTE, not proportional. The X-running faces used to end
    // 2% short of the corner, which is 6.6cm on a big keep but only 3.5cm on a
    // small tower — less than the masonry jitter, so shrinking a tower quietly
    // reintroduced spawn overlaps at the corners and under the joists.
    const GAP = 0.05;
    const xIn = r - t, zOut = r + t;
    const xSpan = xIn - GAP;
    let y = F;
    let joistY = 0;
    for (let c = 0; c < courses; c++) {
      if (c === joistAt) {
        // Every joist spans the full width and lands on the two Z-running
        // faces. The two END joists sit directly under the X-running faces and
        // carry them; without those, the courses above float and drop.
        joistY = y + 0.15;
        const inner = [];
        const half = Math.floor(spanBlocks / 2);
        const step = (r * 2) / (spanBlocks + 2);
        for (let k = -half; k <= half; k++) inner.push([k * step, 0.42]);
        for (const [jz, jh] of [[-r, t - GAP], ...inner, [r, t - GAP]]) {
          phys.addBox(x, joistY, z + jz, zOut - GAP, 0.15, jh, { mat: 'timber', kind: 'beam' });
        }
        y += 0.30;
      }
      const cy = y + CH;
      for (const sign of [-1, 1]) {
        const zf = z + sign * r;
        const step = (xSpan * 2) / spanBlocks;
        // The course over the doorway is a single lintel spanning the opening;
        // three separate blocks would leave the middle one hanging.
        if (sign === doorFace && c === 2) {
          // 6cm shy of xIn. At exactly xIn the lintel ends where the side wall
          // begins, and the +-1.5cm masonry jitter on those blocks closes the
          // gap — an intermittent spawn overlap that only shows on some seeds.
          phys.addBox(x, cy, zf, xSpan - 0.02, CH, t, { mat: 'stone', kind: 'lintel' });
          continue;
        }
        for (let i = 0; i < spanBlocks; i++) {
          const mid = (spanBlocks - 1) / 2;
          if (sign === doorFace && Math.abs(i - mid) < 0.6 && c < 2) continue;
          const tt = -xSpan + step * (i + 0.5);
          phys.addBox(x + tt + jitter(), cy, zf + jitter(), step * 0.47, CH, t,
            { mat, kind: 'block' });
        }
      }
      for (const sign of [-1, 1]) {
        run('z', x + sign * r, z - zOut + GAP, z + zOut - GAP, cy, t, spanBlocks + 1, mat);
      }
      y += CH * 2;
    }
    const top = y;

    // Roof planks, each spanning the full width and landing on both Z faces.
    let roofMid = null;
    const planks = Math.max(1, Math.round((zOut * 2) / 2.9));
    const pStep = (zOut * 2) / planks;
    for (let j = 0; j < planks; j++) {
      const pz = z - zOut + pStep * (j + 0.5);
      const pl = phys.addBox(x, top + 0.22, pz, zOut, 0.22, pStep * 0.48, { mat, kind: 'roof' });
      if (Math.abs(pz - z) < pStep * 0.6) roofMid = pl;
    }
    const roofTop = top + 0.44;
    for (const mx of [-1, 1]) for (const mz of [-1, 1]) {
      phys.addBox(x + mx * r, roofTop + 0.45, z + mz * (r - 0.2), 0.45, 0.45, 0.45,
        { mat, kind: 'merlon' });
    }
    return { top, roofTop, roofMid, joistY, xIn, zOut };
  }

  // A standard is welded to its host block, so it comes down when that block is
  // destroyed or tips — never from a knight brushing the cloth.
  function banner(x, y, z, tag, host) {
    const p = phys.addBox(x, y + 1.15, z, 0.16, 1.15, 0.16, { mat: 'banner', kind: 'banner' });
    p.tag = tag;
    if (host) phys.weld(p, host);
    banners.push(p);
    return p;
  }

  // A soldier stands ON something; y is the surface. Placement is per FACE, so
  // each face has its own garrison and the orbit keeps meaning something.
  //
  // Bearing matters more than it looks: shots travel RADIALLY toward the centre,
  // so a soldier only sits on a face's line if their bearing from the centre
  // matches that face.
  function soldier(x, y, z, post) {
    const p = phys.addSoldier(x, y, z, { post });
    soldiers.push(p);
    return p;
  }

  function crate(x, z, n = 3, mat = 'timber') {
    for (let k = 0; k < n; k++) {
      phys.addBox(x + (k % 2) * 0.16, F + 0.42 + k * 0.84, z + (k % 2) * 0.12,
        0.4, 0.4, 0.4, { mat, kind: 'crate' });
    }
  }

  return { phys, banners, soldiers, jitter, ground, plinth, wall, pier, run,
    tower, banner, soldier, crate,
    done: (extra = {}) => ({ banners, soldiers, ...extra }) };
}

// ---------------------------------------------------------------------------
// LEVEL 1 — Millbrook Tower
// ---------------------------------------------------------------------------
//
// Small and forgiving on purpose. One tower, one low wall, four soldiers, and
// each thing the game asks of you gets its own target:
//   * the sentry in the yard is a plain direct hit
//   * the lookout on the wall walk needs a shot that tops the wall
//   * the roof watch and the sentry UNDER the timber floor are the same
//     problem — break the joists and the top of the tower comes down on him

export function buildLevel1(phys) {
  const b = makeBuilder(phys);
  b.ground();
  b.plinth(7.4, 7.4);

  // Narrow and tall: at r 2.6 x 5 courses it read as a squat block rather than
  // a watchtower, and the silhouette against the garden wall was flat.
  const t = b.tower({ x: 0, z: 1.6, r: 2.25, t: 0.5, courses: 7, joistAt: 4,
    doorFace: 1, spanBlocks: 3 });
  b.banner(0, t.roofTop, 1.6, 'tower', t.roofMid);
  b.soldier(1.35, t.roofTop, 1.6, 'roof watch');
  b.soldier(0, F, 1.6, 'under the floor');

  // A low wall to the north with a walk on top. From the north you have to
  // clear it; from the south the tower is wide open.
  b.wall({ x: 0, z: -5.4, axis: 'x', len: 11, thick: 0.7, courses: 3,
    mat: 'block', merlons: true, blockW: 2.8 });
  b.soldier(-1.9, F + 3 * CH * 2, -5.4, 'wall walk');

  // The easy one, stood in the open on the east side.
  b.soldier(5.6, F, 0.2, 'yard');

  b.crate(-4.6, 2.8, 2);
  b.crate(4.2, -3.2, 3);
  for (const [bx, bz] of [[-5.2, -1.4], [5.0, 4.4]]) {
    phys.addBox(bx, F + 0.42, bz, 0.36, 0.42, 0.36, { mat: 'timber', kind: 'crate' });
  }
  return b.done({ keepTop: t.roofTop });
}

export const FACES1 = [
  { name: 'North Wall', sub: 'a low wall with a lookout on it', a: 0 },
  { name: 'East Yard',  sub: 'open ground — a sentry in the clear', a: Math.PI / 2 },
  { name: 'South Door', sub: 'the tower door, and the timber above it', a: Math.PI },
  { name: 'West Flank', sub: 'nothing posted this side', a: -Math.PI / 2 },
];

// ---------------------------------------------------------------------------
// LEVEL 2 — Harrowgate
// ---------------------------------------------------------------------------

export function buildLevel2(phys) {
  const b = makeBuilder(phys);
  b.ground();
  b.plinth(12, 12);

  // Gatehouse: two piers under a lintel, with a sentry in the passage beneath.
  const pierTop = b.pier(-3.4, -8.4, 5, 1.2, 1.15);
  b.pier(3.4, -8.4, 5, 1.2, 1.15);
  const lintelY = pierTop + 0.5;
  phys.addBox(0, lintelY, -8.4, 4.9, 0.5, 1.1, { mat: 'stone', kind: 'lintel' });
  const walk = phys.addBox(0, lintelY + 0.85, -8.4, 2.7, 0.35, 1.0,
    { mat: 'block', kind: 'walk' });
  for (const dx of [-2.2, 2.2])
    phys.addBox(dx, lintelY + 1.55, -8.4, 0.5, 0.35, 0.9, { mat: 'block', kind: 'merlon' });
  b.banner(0, lintelY + 1.2, -8.4, 'gate', walk);
  b.soldier(-1.4, lintelY + 1.2, -8.4, 'gate walk');
  b.soldier(1.4, lintelY + 1.2, -8.4, 'gate walk');
  b.soldier(0, F, -8.4, 'gateway');

  // Thin east curtain, deliberately weak masonry.
  b.wall({ x: 9.4, z: 0, axis: 'z', len: 13, thick: 0.58, courses: 5, mat: 'block',
    merlons: true, hpScale: 0.66,
    slits: [{ t: -2.2, c0: 2, c1: 2 }, { t: 2.2, c0: 3, c1: 3 }] });
  // In a GAP between merlons. This wall's merlons land at z -4.88 and 1.63, and
  // at z 0.4 the soldier spawned inside one.
  b.soldier(9.4, F + 5 * CH * 2, -1.7, 'curtain walk');

  // West side: thick and unmanned.
  // 1.35 apart for two 1.2-wide walls. At exactly 1.2 they touch, and the
  // masonry jitter alone is enough to interpenetrate them at spawn.
  b.wall({ x: -9.5, z: 0, axis: 'z', len: 13, thick: 0.6, courses: 5, mat: 'stone' });
  b.wall({ x: -8.15, z: 0, axis: 'z', len: 13, thick: 0.6, courses: 5, mat: 'stone',
    merlons: true });

  const t = b.tower({ x: 0, z: 4.2, r: 3.0, t: 0.58, courses: 5, joistAt: 3,
    doorFace: 1, spanBlocks: 3 });
  b.banner(0, t.roofTop, 4.2, 'keep', t.roofMid);
  b.soldier(1.6, t.roofTop, 4.2, 'keep roof');
  b.soldier(6.9, F, 0.1, 'courtyard');

  b.crate(-5.4, 3.0);
  b.crate(5.6, -4.6, 2);
  return b.done({ keepTop: t.roofTop, lintelY });
}

export const FACES2 = [
  { name: 'North Gate',   sub: 'a lintel on two piers — take a pier', a: 0 },
  { name: 'East Curtain', sub: 'one block thick, and slitted', a: Math.PI / 2 },
  { name: 'South Keep',   sub: 'timber floors inside the tower', a: Math.PI },
  { name: 'West Wall',    sub: 'two walls thick, and nobody behind it', a: -Math.PI / 2 },
];

// ---------------------------------------------------------------------------
// LEVEL 3 — Blackmere Keep
// ---------------------------------------------------------------------------

export function buildLevel3(phys) {
  const b = makeBuilder(phys);
  b.ground();
  b.plinth(15.5, 16.5);

  // ---- NORTH: the gatehouse ----------------------------------------------
  const pierTop = b.pier(-4.3, -11.4, 6, 1.45, 1.35);
  b.pier(4.3, -11.4, 6, 1.45, 1.35);
  const lintelY = pierTop + 0.5;
  phys.addBox(0, lintelY, -11.4, 6.1, 0.5, 1.3, { mat: 'stone', kind: 'lintel' });
  const gateWalk = phys.addBox(0, lintelY + 0.85, -11.4, 3.3, 0.35, 1.15,
    { mat: 'block', kind: 'walk' });
  // Crenels flank the standard — nothing at x=0, or the pole spawns inside one.
  for (const dx of [-2.7, 2.7])
    phys.addBox(dx, lintelY + 1.55, -11.4, 0.55, 0.35, 1.0, { mat: 'block', kind: 'merlon' });
  b.banner(0, lintelY + 1.2, -11.4, 'gate', gateWalk);
  // Undercut a pier and all three go at once: the pair ride the arch down, the
  // sentry below wears it.
  b.soldier(-1.75, lintelY + 1.2, -11.4, 'gate walk');
  b.soldier(1.75, lintelY + 1.2, -11.4, 'gate walk');
  b.soldier(0, F, -11.4, 'gateway');

  b.wall({ x: 0, z: -15.6, axis: 'x', len: 15, thick: 0.75, courses: 3, mat: 'block', merlons: true });
  b.soldier(-4.4, F + 3 * CH * 2, -15.6, 'barbican');

  b.wall({ x: -9.6, z: -11.4, axis: 'x', len: 7.6, thick: 1.0, courses: 5, mat: 'block', merlons: true });
  b.wall({ x: 9.6, z: -11.4, axis: 'x', len: 7.6, thick: 1.0, courses: 5, mat: 'block', merlons: true });

  // ---- EAST: the thin curtain --------------------------------------------
  // Deliberately weak masonry, not just thin masonry: at full strength the
  // courses above a punch-through simply bridged the hole.
  b.wall({
    x: 12.6, z: -1.0, axis: 'z', len: 18, thick: 0.62, courses: 7, mat: 'block', merlons: true,
    hpScale: 0.66,
    slits: [{ t: -3.0, c0: 3, c1: 3 }, { t: 3.0, c0: 4, c1: 4 }, { t: 0.0, c0: 5, c1: 5 }],
  });
  b.soldier(12.6, F + 7 * CH * 2, 0.5, 'curtain walk');

  // ---- WEST: the buttress ------------------------------------------------
  for (const dx of [-12.9, -11.5]) {
    b.wall({ x: dx, z: -1.0, axis: 'z', len: 18, thick: 0.62, courses: 7, mat: 'stone',
      merlons: dx === -11.5 });
  }
  for (const bz of [-7.5, -1.0, 5.5]) b.pier(-14.15, bz, 4, 0.5, 1.1, 'stone');

  // ---- SOUTH: outer wall in front of the keep ----------------------------
  b.wall({ x: 0, z: 14.2, axis: 'x', len: 20, thick: 0.7, courses: 4, mat: 'block',
    merlons: true, slits: [{ t: 0, c0: 2, c1: 2 }] });

  // ---- the keep -----------------------------------------------------------
  const t = b.tower({ x: 0, z: 5.5, r: 3.9, t: 0.62, courses: 6, joistAt: 4,
    doorFace: 1, spanBlocks: 3 });
  b.banner(0, t.roofTop, 5.5, 'keep', t.roofMid);
  b.soldier(2.3, t.roofTop, 5.2, 'keep roof');
  b.soldier(-0.4, F, 5.5, 'keep floor');

  // ---- courtyard ----------------------------------------------------------
  // One socket block, not a nine-block dais: pinned by eight neighbours the
  // middle stone could neither break nor shove, and the east shot did nothing.
  const daisMid = phys.addBox(6.8, F + 0.3, -0.6, 0.85, 0.3, 0.85,
    { mat: 'block', kind: 'dais', hp: 105 });
  for (const [dx, dz] of [[-1.5, 0], [1.5, 0], [0, -1.5], [0, 1.5]]) {
    phys.addBox(6.8 + dx, F + 0.22, -0.6 + dz, 0.55, 0.22, 0.55, { mat: 'stone', kind: 'step' });
  }
  b.banner(6.8, F + 0.6, -0.6, 'court', daisMid);
  // Clear of the step ring, which reaches x 8.85.
  b.soldier(9.9, F, -0.1, 'courtyard');
  b.soldier(10.6, F, -3.4, 'wall foot');

  for (const [cx, cz] of [[-6.5, -4], [-7.2, 2], [8.8, 5.5], [-3, -6.5], [9.0, -7.8]]) b.crate(cx, cz);
  return b.done({ keepTop: t.roofTop, lintelY });
}

export const FACES3 = [
  { name: 'North Gate',    sub: 'a lintel on two piers — take a pier', a: 0 },
  { name: 'East Curtain',  sub: 'one block thick, and slitted', a: Math.PI / 2 },
  { name: 'South Keep',    sub: 'nearest face — timber floors inside', a: Math.PI },
  { name: 'West Buttress', sub: 'two walls thick, and nobody posted behind it', a: -Math.PI / 2 },
];

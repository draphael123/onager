// fortress.js — the level.
//
// The whole point of slice 0 is that the four faces are DIFFERENT problems, so
// that orbiting before you shoot is a decision instead of a camera control:
//
//   NORTH  gatehouse  — two piers holding a lintel. Kill a pier, the arch and
//                       the banner on it come down. But a barbican wall sits in
//                       front, so the shot has to arc over it and still be fast.
//   EAST   curtain    — one block thick and full of arrow slits. A flat heavy
//                       shot punches straight through into the courtyard banner.
//   SOUTH  keep       — nearest face, so a shallow arc reaches the roof. Inside
//                       are TIMBER joists carrying the top storey; break them
//                       and everything above comes down.
//   WEST   buttress   — two walls thick, stone, backed by nothing. This face is
//                       the wrong answer, and the compass says so.
//
// Coordinates: -Z is north, +X is east. Ground plane at y = 0.
//
// EVERY dimension here is checked by ONAGER.audit(): blocks must not
// interpenetrate at spawn (Rapier detonates the fortress on frame 1) and must
// not float (they land, and the player reads it as the castle collapsing before
// they fired). Both faults are invisible in a screenshot. Re-run the audit
// after touching any number in this file.

import { rnd01 } from './rand.js';

export const FACES = [
  { name: 'North Gate',    sub: 'a lintel on two piers — take a pier',       a: 0 },
  { name: 'East Curtain',  sub: 'one block thick, and slitted',              a: Math.PI / 2 },
  { name: 'South Keep',    sub: 'nearest face — timber floors inside',       a: Math.PI },
  { name: 'West Buttress', sub: 'two walls thick, and nobody posted behind it', a: -Math.PI / 2 },
];

export function faceAt(angle) {
  let a = Math.atan2(Math.sin(angle), Math.cos(angle));
  let best = FACES[0], bd = 9;
  for (const f of FACES) {
    const d = Math.abs(Math.atan2(Math.sin(a - f.a), Math.cos(a - f.a)));
    if (d < bd) { bd = d; best = f; }
  }
  // Between two faces the compass should say so — a corner is a legitimately
  // different (and often better) shot than either flat face.
  if (bd > 0.62) return { name: best.name.split(' ')[0] + ' Corner',
    sub: 'oblique — you can see two faces', corner: true };
  return best;
}

const F = 1.0;          // top of the plinth: every wall starts here
const CH = 0.55;        // course half-height, so a course is 1.1 tall

export function build(phys) {
  const banners = [];
  const soldiers = [];
  const jitter = () => (rnd01() - 0.5) * 0.03;

  // ---- ground + plinth ----------------------------------------------------
  phys.addBox(0, -1.0, 0, 200, 1.0, 200, { fixed: true, mat: 'stone', kind: 'ground' });
  phys.addBox(0, 0.5, 0, 15.5, 0.5, 16.5, { fixed: true, mat: 'stone', kind: 'plinth' });

  // ---- helpers ------------------------------------------------------------

  // A course-built wall. Alternate courses shift by half a block so the joints
  // stagger: it looks like masonry, and the toothed ends read as unfinished
  // stonework rather than a slab.
  //   x,z    centre of the run        axis  'x' or 'z'
  //   len    length along the run     thick HALF thickness across the run
  //   slits  {t, c0, c1} gaps         merlons  crenellate the top
  function wall(o) {
    const { x, z, axis, len, thick, courses, mat = 'block', slits = [], merlons = false,
      hpScale = 1 } = o;
    const bh = o.blockH || CH;
    const n = Math.max(1, Math.round(len / ((o.blockW || 3.1))));
    const step = len / n;
    for (let c = 0; c < courses; c++) {
      const y = F + bh + c * bh * 2;
      const odd = c % 2;
      // Offset courses get HALF blocks at both ends (a queen closer) rather
      // than one block fewer. Dropping the end block instead leaves the course
      // above cantilevered past its own centre of mass, and the wall peels
      // itself apart from the ends inward while you watch.
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
        const t = -len / 2 + step * 0.5 + i * step;
        const px = axis === 'x' ? x + t : x;
        const pz = axis === 'x' ? z : z + t;
        phys.addBox(px, y, pz,
          axis === 'x' ? step * 0.3 : thick * 0.86, bh * 0.8,
          axis === 'x' ? thick * 0.86 : step * 0.3, { mat, kind: 'merlon' });
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

  // A run of blocks along one axis, given the SPAN it must occupy. Blocks are
  // sized from the span so they never overrun into whatever meets them at the
  // corner — that overrun is what makes a keep explode on spawn.
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

  // A standard is welded to its host block, so it comes down when that block is
  // destroyed or tips — never from a knight brushing past the cloth.
  // A soldier stands ON something; y is the surface they stand on. Placement is
  // per FACE, so each face has its own garrison and the orbit keeps meaning
  // something. The west wall is deliberately UNMANNED — a face with nothing to
  // win on it stays the wrong answer.
  function soldier(x, y, z, post) {
    const p = phys.addSoldier(x, y, z, { post });
    soldiers.push(p);
    return p;
  }

  function banner(x, y, z, tag, host) {
    const p = phys.addBox(x, y + 1.15, z, 0.16, 1.15, 0.16, { mat: 'banner', kind: 'banner' });
    p.tag = tag;
    if (host) phys.weld(p, host);
    banners.push(p);
    return p;
  }

  // ---- NORTH: the gatehouse ----------------------------------------------
  const pierTop = pier(-4.3, -11.4, 6, 1.45, 1.35);
  pier(4.3, -11.4, 6, 1.45, 1.35);
  const lintelY = pierTop + 0.5;
  phys.addBox(0, lintelY, -11.4, 6.1, 0.5, 1.3, { mat: 'stone', kind: 'lintel' });
  const gateWalk = phys.addBox(0, lintelY + 0.85, -11.4, 3.3, 0.35, 1.15,
    { mat: 'block', kind: 'walk' });
  // Crenels flank the standard — nothing at x=0, or the pole spawns inside one.
  for (const dx of [-2.7, 2.7]) {
    phys.addBox(dx, lintelY + 1.55, -11.4, 0.55, 0.35, 1.0, { mat: 'block', kind: 'merlon' });
  }
  banner(0, lintelY + 1.2, -11.4, 'gate', gateWalk);
  // Two on the gate walk, one in the gateway underneath. Undercut a pier and
  // all three go at once: the pair ride the arch down, the sentry below wears
  // it. This is the multi-kill the north face exists to sell.
  soldier(-1.75, lintelY + 1.2, -11.4, 'gate walk');
  soldier(1.75, lintelY + 1.2, -11.4, 'gate walk');
  soldier(0, F, -11.4, 'gateway');

  // Barbican — the low outer wall that punishes a shot with no arc on it.
  wall({ x: 0, z: -15.6, axis: 'x', len: 15, thick: 0.75, courses: 3, mat: 'block', merlons: true });
  // The exposed one, off-centre so it wants a little trim rather than none.
  soldier(-4.4, F + 3 * CH * 2, -15.6, 'barbican');

  // Flanking stubs, so the gatehouse reads as part of an enceinte.
  wall({ x: -9.6, z: -11.4, axis: 'x', len: 7.6, thick: 1.0, courses: 5, mat: 'block', merlons: true });
  wall({ x: 9.6, z: -11.4, axis: 'x', len: 7.6, thick: 1.0, courses: 5, mat: 'block', merlons: true });

  // ---- EAST: the thin curtain --------------------------------------------
  // Deliberately weak masonry, not just thin masonry. At full strength a
  // punch-through knocked out two or three blocks and the courses above simply
  // bridged the hole, so the east face's whole payoff was one soldier — no
  // better than a blind lob over the west wall, which made two of the four
  // faces pointless. At 0.66 the hole runs up the wall and takes the walk and
  // whoever is standing under it.
  wall({
    x: 12.6, z: -1.0, axis: 'z', len: 18, thick: 0.62, courses: 7, mat: 'block', merlons: true,
    hpScale: 0.66,
    // One course per slit, never two stacked: a hole over a hole leaves the
    // block above balanced on nothing and the curtain sheds itself.
    slits: [{ t: -3.0, c0: 3, c1: 3 }, { t: 3.0, c0: 4, c1: 4 }, { t: 0.0, c0: 5, c1: 5 }],
  });

  // On the curtain walk, in a gap between merlons: a flat shot that tops the
  // wall takes them, and breaking the courses underneath drops them too.
  soldier(12.6, F + 7 * CH * 2, 0.5, 'curtain walk');

  // ---- WEST: the buttress ------------------------------------------------
  for (const dx of [-12.9, -11.5]) {
    wall({ x: dx, z: -1.0, axis: 'z', len: 18, thick: 0.62, courses: 7, mat: 'stone',
      merlons: dx === -11.5 });
  }
  // Clear of the wall face at x = -13.52 by 8cm.
  for (const bz of [-7.5, -1.0, 5.5]) pier(-14.15, bz, 4, 0.5, 1.1, 'stone');

  // ---- SOUTH: outer wall in front of the keep ----------------------------
  wall({ x: 0, z: 14.2, axis: 'x', len: 20, thick: 0.7, courses: 4, mat: 'block', merlons: true,
    slits: [{ t: 0, c0: 2, c1: 2 }] });        // single course — see the east curtain

  // ---- the keep -----------------------------------------------------------
  // Hollow square with INTERLOCKED corners: the two X-running faces stop at the
  // inner face of the Z-running faces, which run the full depth. Halfway up,
  // timber joists span between the Z faces and the courses above rest on them —
  // so the timber is genuinely load bearing, and burning through it drops the
  // top of the keep.
  const KX = 0, KZ = 5.5, KR = 3.9, KT = 0.62;
  const xIn = KR - KT, zOut = KR + KT;      // 3.28 and 4.52
  let y = F;
  let floorY = 0;
  for (let c = 0; c < 6; c++) {
    if (c === 4) {
      // Joist layer. Every joist spans the full width and lands on the tops of
      // the two Z-running faces. The two END joists sit directly under the
      // X-running faces and carry them: without those, courses 4-5 of the north
      // and south faces float 30cm in the air and drop the moment you press go.
      // Because every block above rests on timber, burning the joists out
      // genuinely drops the top of the keep — the fuse is real, not scripted.
      floorY = y + 0.15;
      for (const [jz, jh] of [[-KR, KT], [-2.6, 0.42], [-1.3, 0.42], [0, 0.42],
                              [1.3, 0.42], [2.6, 0.42], [KR, KT]]) {
        phys.addBox(KX, floorY, KZ + jz, zOut, 0.15, jh,
          { mat: 'timber', kind: 'beam' });
      }
      y += 0.30;
    }
    const cy = y + CH;
    // X-running faces (north and south of the keep), inset to the corner.
    for (const sign of [-1, 1]) {
      const zf = KZ + sign * KR;
      const step = (xIn * 2) / 3;
      // The course directly over the doorway is a single lintel spanning the
      // opening — three separate blocks would leave the middle one hanging.
      if (sign === 1 && c === 2) {
        phys.addBox(KX, cy, zf, xIn, CH, KT, { mat: 'stone', kind: 'lintel' });
        continue;
      }
      for (let i = 0; i < 3; i++) {
        // Doorway on the south face, bottom two courses.
        if (sign === 1 && i === 1 && c < 2) continue;
        const t = -xIn + step * (i + 0.5);
        phys.addBox(KX + t + jitter(), cy, zf + jitter(), step * 0.47, CH, KT,
          { mat: 'block', kind: 'block' });
      }
    }
    // Z-running faces (east and west), running the full depth.
    for (const sign of [-1, 1]) {
      run('z', KX + sign * KR, KZ - zOut, KZ + zOut, cy, KT, 4, 'block');
    }
    y += CH * 2;
  }
  const keepTop = y;

  // Roof planks, each spanning the full width and landing on both Z faces.
  let roofMid = null;
  for (let j = -1; j <= 1; j++) {
    const pl = phys.addBox(KX, keepTop + 0.22, KZ + j * 2.9, zOut, 0.22, 1.4,
      { mat: 'block', kind: 'roof' });
    if (j === 0) roofMid = pl;
  }
  const roofTop = keepTop + 0.44;
  for (const mx of [-1, 1]) for (const mz of [-1, 1]) {
    phys.addBox(KX + mx * 3.9, roofTop + 0.45, KZ + mz * 3.7, 0.45, 0.45, 0.45,
      { mat: 'block', kind: 'merlon' });
  }
  banner(KX, roofTop, KZ, 'keep', roofMid);
  soldier(KX + 2.3, roofTop, KZ - 0.3, 'keep roof');
  // Under the joists, on the keep floor. Break the timber from the south and
  // the whole top storey comes down on them — crushing as a designed answer
  // rather than something that happens by luck.
  soldier(KX - 0.4, F, KZ, 'keep floor');

  // ---- courtyard banner ---------------------------------------------------
  // On a low dais just inside the east curtain: punching through the thin wall
  // on a flat trajectory carries you straight into it.
  //
  // Position matters more than it looks. Shots travel RADIALLY toward the
  // centre, so a standard only sits on a face's line if its bearing from the
  // centre matches that face. At (6.4, -3.6) its bearing was 61 degrees — the
  // north-east corner — and the east shot, which is the whole point of this
  // standard, sailed two metres past it every time.
  // ONE socket block, not a 3x3 of them. As a nine-block dais the middle stone
  // was pinned by its eight neighbours, so a knight arriving with 60% of its
  // speed left (having just punched the curtain) could neither break it nor
  // shove it — the east shot landed dead on target and nothing happened. A
  // single socket can be knocked out or knocked over, and either fells the
  // standard. hp is well under a wall block's: a flag socket is not a wall.
  const daisMid = phys.addBox(6.8, F + 0.3, -0.6, 0.85, 0.3, 0.85,
    { mat: 'block', kind: 'dais', hp: 105 });
  for (const [dx, dz] of [[-1.5, 0], [1.5, 0], [0, -1.5], [0, 1.5]]) {
    phys.addBox(6.8 + dx, F + 0.22, -0.6 + dz, 0.55, 0.22, 0.55,
      { mat: 'stone', kind: 'step' });
  }
  banner(6.8, F + 0.6, -0.6, 'court', daisMid);
  // Courtyard guard, ON the east bearing (z ~ 0) so the punch-through shot
  // actually reaches them — shots travel radially, and the previous placement
  // sat on the north-east diagonal where the east shot sailed past.
  // Clear of the dais step ring (which reaches x 8.85) — spawned inside it,
  // this one was shoved out every frame, toppled on its own, and then died to
  // every shot from every face including the one that is supposed to be
  // unwinnable. One placement error, five failed assertions.
  soldier(9.9, F, -0.1, 'courtyard');
  // And one tight against the curtain's inner face, where the wall lands when
  // it comes down.
  soldier(10.6, F, -3.4, 'wall foot');

  // ---- courtyard clutter (light, breakable, pure feel) --------------------
  for (const [cx, cz] of [[-6.5, -4], [-7.2, 2], [8.8, 5.5], [-3, -6.5], [9.0, -7.8]]) {
    for (let k = 0; k < 3; k++) {
      phys.addBox(cx + (k % 2) * 0.16, F + 0.42 + k * 0.84, cz + (k % 2) * 0.12,
        0.4, 0.4, 0.4, { mat: 'timber', kind: 'crate' });
    }
  }

  return { banners, soldiers, keepTop: roofTop, lintelY, floorY };
}

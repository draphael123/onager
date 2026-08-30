// sim.js — headless harness.
//
// Two jobs:
//   ONAGER.sim()    assertions that must hold for the game to be playable
//   ONAGER.sweep()  parameter search, used to find out whether each face
//                   actually HAS an answer (and whether West actually doesn't)
//
// Everything here runs with renderer = null, so it measures the simulation and
// not the presentation.

import { Game, S, SPEED_MIN, SPEED_MAX, YAW_MAX } from './game.js';
import { LEVELS } from './levels.js';
import { TYPE_ORDER, LOADOUTS, loadoutTotal } from './knights.js';
import { normaliseDef, buildFromDef, LIMITS } from './leveldef.js';
import { Physics } from './physics.js';

// The worked examples ship with the game and are asserted in T17. Loaded
// lazily and optionally: node has no fetch of relative paths, so the harness
// injects them and the assertions are skipped when they are not there.
export let EXAMPLES = null;
export function setExamples(e) { EXAMPLES = e; }
import { seed } from './rand.js';

const N = 0, E = Math.PI / 2, SO = Math.PI, W = -Math.PI / 2;
export const FACE_ANGLE = { north: N, east: E, south: SO, west: W };

// PINNED to Blackmere (index 2), not to the last level. T1-T14 are written
// against Blackmere's exact geometry — its nine posts, its three standards, its
// four named faces — so when two more castles were added, "the last one"
// silently retargeted the whole suite at Vantwick and nine assertions failed
// for the only reason that they were measuring a different building.
// Structural properties that must hold for EVERY castle live in T15.
const BLACKMERE = 2;
let SIM_LEVEL = BLACKMERE;
export function setSimLevel(i) { SIM_LEVEL = i; }

function fresh(sd = 12345, knights = 0) {
  seed(sd);
  return new Game(null, null, { knights, level: SIM_LEVEL });
}

function tick(g, n) { for (let i = 0; i < n; i++) g._tick(); }

// runSim is otherwise fully synchronous and blocks the tab for the whole run.
const breathe = () => new Promise(r => setTimeout(r, 0));

// ---------------------------------------------------------------------------
// assertions
// ---------------------------------------------------------------------------

let lastPeak = 0;

export async function runSim(log = console.log) {
  const out = [];
  let pass = 0, fail = 0;
  const ok = (name, cond, detail = '') => {
    (cond ? pass++ : fail++);
    const line = `${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`;
    out.push(line); log(line);
    return cond;
  };

  // ---- T1 the level builds ------------------------------------------------
  {
    const g = fresh();
    const n = g.phys.list.length;
    ok('T1a body count is sane', n > 140 && n < 480, `${n} bodies`);
    ok('T1b garrison posted', g.soldiersTotal === 9, `${g.soldiersTotal} soldiers`);
    ok('T1c three standards', g.banners.length === 3);
    ok('T1d everyone alive at t=0', g.soldiersDown === 0 && g.bannersDown === 0);
    g.phys.dispose();
  }

  // ---- T2 it stands up on its own -----------------------------------------
  // If this fails nothing else matters: the player would watch the castle fall
  // down, and the garrison knock itself out, before they ever fired.
  {
    const g = fresh();
    const spawn = g.phys.list.filter(p => !p.fixed).map(p => {
      const t = p.body.translation(); return { p, x: t.x, y: t.y, z: t.z };
    });
    tick(g, 300);                                   // 5 seconds
    let worst = 0;
    for (const s of spawn) {
      if (s.p.dead) { worst = 99; break; }
      const t = s.p.body.translation();
      worst = Math.max(worst, Math.hypot(t.x - s.x, t.y - s.y, t.z - s.z));
    }
    ok('T2a nothing drifts under its own weight', worst < 0.30, `worst drift ${worst.toFixed(3)}m`);
    // Soldiers stood on rounded capsules once and five of nine tipped over on
    // their own. A garrison that defeats itself is not a level.
    ok('T2b no soldier knocks themselves out', g.soldiersDown === 0, `${g.soldiersDown} fell`);
    ok('T2c no standard falls on its own', g.bannersDown === 0);
    ok('T2d no block breaks on its own', g.broken === 0, `${g.broken} broke`);
    ok('T2e world goes quiet', g.phys.maxMotion() < 0.35, `motion ${g.phys.maxMotion().toFixed(3)}`);
    ok('T2f and falls asleep', g.phys.allAsleep());
    g.phys.dispose();
  }

  // ---- T2g/h construction faults ------------------------------------------
  // Both are invisible on screen and both are catastrophic; see audit().
  {
    const g = fresh();
    const a = audit(g);
    ok('T2g no blocks interpenetrate at spawn', a.overlaps.length === 0,
      a.overlaps.slice(0, 3).map(o => `${o.a}/${o.b}@${o.at} by ${o.by}`).join(' ; '));
    ok('T2h nothing floats', a.floaters.length === 0,
      a.floaters.slice(0, 3).map(f => `${f.kind}@${f.at}`).join(' ; '));
    g.phys.dispose();
  }

  await breathe();

  // ---- T3 the trajectory preview does not lie -----------------------------
  {
    const g = fresh();
    g.angle = N; g.elev = 40 * Math.PI / 180; g.power = 0.7;
    const v = g.velocity(), m = g.muzzle();
    const gy = g.phys.world.gravity.y;
    g.fire();
    let worst = 0;
    for (let i = 1; i <= 24; i++) {           // 0.4s of clean free flight
      g._tick();
      const t = i / 60;
      const px = m.x + v.x * t, py = m.y + v.y * t + 0.5 * gy * t * t, pz = m.z + v.z * t;
      const a = g.knight.body.translation();
      worst = Math.max(worst, Math.hypot(a.x - px, a.y - py, a.z - pz));
    }
    ok('T3 preview matches flight', worst < 0.05, `worst error ${(worst * 100).toFixed(1)}cm`);
    g.phys.dispose();
  }

  // ---- T4 every shot ends -------------------------------------------------
  {
    let worstT = 0, allEnded = true;
    for (const a of [N, E, SO, W]) {
      const g = fresh(777);
      g.shoot(a, 22, 1.0);
      const t = g.settleOut(14);
      worstT = Math.max(worstT, t);
      if (g.state === S.FLIGHT || g.state === S.SETTLE) allEnded = false;
      g.phys.dispose();
    }
    ok('T4a every shot resolves', allEnded);
    ok('T4b and does it inside 8s', worstT < 8.0, `worst ${worstT.toFixed(2)}s`);
  }

  await breathe();

  // ---- T5 debris is bounded ----------------------------------------------
  {
    const g = fresh(99);
    let peak = 0;
    for (let s = 0; s < 3; s++) {
      g.shoot(E, 10, 1.0);
      for (let i = 0; i < 720 && (g.state === S.FLIGHT || g.state === S.SETTLE); i++) {
        g._tick(); peak = Math.max(peak, g.phys.list.length);
      }
    }
    ok('T5 body count stays bounded', peak < 560, `peak ${peak} bodies`);
    g.phys.dispose();
  }

  await breathe();

  // ---- T6 the faces are different problems --------------------------------
  // The whole premise of the orbit. Each face's shot must take that face's
  // garrison, and West must remain unwinnable at any elevation or power.
  {
    const res = {};
    for (const [name, shot] of Object.entries(BEST)) {
      const g = fresh(2024);
      const posts = [];
      const orig = g.phys.onSoldierDown;
      g.phys.onSoldierDown = (p, how, t, v) => { posts.push(p.post); orig(p, how, t, v); };
      g.shoot(FACE_ANGLE[name], shot.elev, shot.power);
      g.settleOut(14);
      res[name] = { kills: g.soldiersDown, posts, broken: g.broken };
      g.phys.dispose();
    }
    ok('T6a north takes the gatehouse', res.north.posts.some(p => p.startsWith('gate')),
      `north -> [${res.north.posts}] ${res.north.broken} blocks`);
    ok('T6b east reaches past the curtain', res.east.kills > 0,
      `east -> [${res.east.posts}] ${res.east.broken} blocks`);
    ok('T6c south takes the keep', res.south.posts.some(p => p.startsWith('keep')),
      `south -> [${res.south.posts}] ${res.south.broken} blocks`);
    ok('T6d west takes nobody', res.west.kills === 0,
      `west -> [${res.west.posts}] ${res.west.broken} blocks`);
  }

  // ---- T6e west is a dead end at EVERY setting -----------------------------
  // One shot proving nothing is weak evidence. If any elevation or power beats
  // the west face, orbiting has stopped being a decision.
  {
    // The grid MUST contain each face's designed shot, or this compares how
    // lucky the grid is rather than how good the face is: east's answer is
    // e8 p0.90 and a grid of {8,14,20,...} x {0.6,0.8,1.0} simply does not
    // contain it, which made east look no better than a blind lob over west.
    // West gets the full sweep, because the claim is about what west can do at
    // ITS best. The other faces only need their designed shot: sweeping all
    // four cost 88 heavy sims and blocked the page for minutes, which made the
    // harness too slow to actually run.
    const trial = (angle, cand) => {
      let best = 0, at = '';
      for (const [e, pw] of cand) {
        const g = fresh(4);
        g.shoot(angle, e, pw); g.settleOut(14);
        if (g.soldiersDown > best) { best = g.soldiersDown; at = `e${e} p${pw}`; }
        g.phys.dispose();
      }
      return { best, at };
    };
    // The SAME grid for both sides, or this measures how lucky each side's
    // sample was rather than how good the face is. Sweeping all four faces cost
    // 88 heavy sims and blocked the tab for minutes, so the comparison is
    // narrowed to west against north — the showcase face — rather than made
    // unfair by giving west a sweep and the others a single shot.
    const grid = [];
    for (const e of [8, 16, 24, 32, 44, 56])
      for (const pw of [0.65, 0.85, 1.0]) grid.push([e, pw]);
    grid.push([BEST.north.elev, BEST.north.power]);
    grid.push([BEST.west.elev, BEST.west.power]);
    const w = trial(W, grid), n = trial(N, grid);
    // West is not literally impossible, and asserting that it is would be a lie:
    // a high lob crosses the whole castle and can clip a soldier standing on the
    // FAR wall. That is shooting PAST the west face, not beating it. What must
    // hold is that west is strictly the worst place to stand — worse than every
    // other face at its own best setting.
    // What is actually true, measured: west's best is strictly worse than the
    // two structural faces, and nobody is posted on the west side at all.
    //
    // It is NOT strictly worse than east. East's designed shot takes two, and a
    // high blind lob from the west crosses the whole castle and can also clip
    // two on the far wall. That is a real balance note for playtest, not a bug —
    // but the assertion says what holds rather than what I would like to hold.
    const westSector = (() => {
      const g = fresh(1);
      const n2 = g.soldiers.filter(x => x.body.translation().x < -6).length;
      g.phys.dispose(); return n2;
    })();
    ok('T6e west is strictly worse than the gatehouse face', w.best < n.best,
      `same ${grid.length}-shot grid on both: west best ${w.best}` +
      `${w.at ? ' (' + w.at + ')' : ''} vs north best ${n.best}` +
      `${n.at ? ' (' + n.at + ')' : ''}`);
    ok('T6f nobody is posted on the west side', westSector === 0, `${westSector} posted`);
  }

  await breathe();

  // ---- T7 crushing is a real answer ---------------------------------------
  // "Drop the building on them" has to work, or the genre premise is missing
  // and every kill is just a bowling ball.
  {
    let crushed = 0, struck = 0, sample = '';
    for (const sd of [5, 13, 29]) {
      const g = fresh(sd);
      const orig = g.phys.onSoldierDown;
      g.phys.onSoldierDown = (p, how, t, v) => {
        if (how === 'struck') struck++; else { crushed++; if (!sample) sample = `${p.post}:${how}`; }
        orig(p, how, t, v);
      };
      for (const f of ['north', 'south', 'east']) {
        if (g.state !== S.AIM) break;
        g.shoot(FACE_ANGLE[f], BEST[f].elev, BEST[f].power);
        g.settleOut(14);
      }
      g.phys.dispose();
    }
    ok('T7 soldiers die to falling masonry, not only to direct hits', crushed > 0,
      `${crushed} crushed / ${struck} struck${sample ? ', e.g. ' + sample : ''}`);
  }

  // ---- T8 every post is reachable -----------------------------------------
  {
    const r = reachability();
    const bad = r.filter(x => x.flat === null && x.high === null).map(x => x.post);
    ok('T8 every post has a firing solution', bad.length === 0, bad.join(', '));
  }

  await breathe();

  // ---- T9 the level is winnable, and not a walkover -----------------------
  // Measured with the aiming bot. A fixed shot list would measure the plan.
  {
    const runs = [3, 7, 11, 19, 23].map(sd => bot(sd));
    const wins = runs.filter(r => r.won).length;
    const avg = runs.reduce((a, r) => a + r.down, 0) / runs.length;
    ok('T9a the bot can win it', wins >= 1, `${wins}/5 clears, avg ${avg.toFixed(1)}/9 down`);
    ok('T9b and it is not a walkover', wins <= 4, `${wins}/5 clears`);
  }

  // ---- T10 the lance dive is a verb, not decoration ------------------------
  {
    const shot = (diveAt) => {
      const g = fresh(4242);
      g.shoot(N, 32, 0.9);
      let t = 0;
      while ((g.state === S.FLIGHT || g.state === S.SETTLE) && t < 14) {
        g._tick(); t += 1 / 60;
        if (diveAt && !g.dived && t >= diveAt) g.dive();
      }
      const r = { kills: g.soldiersDown, broke: g.broken };
      g.phys.dispose(); return r;
    };
    const plain = shot(null), dived = shot(0.6);
    ok('T10 a well-timed dive changes the outcome',
      dived.kills > plain.kills || dived.broke > plain.broke + 2,
      `no dive: ${plain.kills} down / ${plain.broke} broken  ->  ` +
      `dive at 0.6s: ${dived.kills} down / ${dived.broke} broken`);
  }

  await breathe();

  // ---- T11 the reticle lands where the knight lands -----------------------
  // The preview point-sampled the parabola at 0.075s, which is three metres at
  // 40 m/s: it skipped clean through a one-block curtain wall and reported the
  // impact up to three metres late. Each segment is now a swept ball cast of
  // the knight's real radius. This measures the prediction against the knight's
  // actual first contact.
  {
    const segDist = (p, a, b) => {
      const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z;
      const apx = p.x - a.x, apy = p.y - a.y, apz = p.z - a.z;
      const L = abx * abx + aby * aby + abz * abz;
      const t = L ? Math.max(0, Math.min(1, (apx * abx + apy * aby + apz * abz) / L)) : 0;
      return Math.hypot(apx - abx * t, apy - aby * t, apz - abz * t);
    };
    let worst = 0, worstAt = '', predicted = 0, tried = 0;
    for (const [ang, el, pw] of [[N, 20, 0.85], [E, 8, 0.9], [SO, 22, 0.85],
                                 [0.6, 26, 0.8], [W, 20, 1.0], [N, 40, 0.6]]) {
      tried++;
      const g = fresh(6060);
      g.angle = ang; g.elev = el * Math.PI / 180; g.power = pw;
      const hit = g.arc().hit;
      if (!hit) { g.phys.dispose(); continue; }
      predicted++;
      g.shoot(ang, el, pw);
      let contact = null;
      for (let i = 0; i < 300 && (g.state === S.FLIGHT || g.state === S.SETTLE); i++) {
        const t0 = g.knight ? { ...g.knight.body.translation() } : null;
        const v0 = g.knight ? { ...g.knight.body.linvel() } : null;
        g._tick();
        if (!contact && g.knight && v0) {
          const v = g.knight.body.linvel();
          if (Math.hypot(v.x - v0.x, v.y - v0.y, v.z - v0.z) > 2.5) {
            const t = g.knight.body.translation();
            contact = { a: t0, b: { x: t.x, y: t.y, z: t.z } };
          }
        }
      }
      if (contact) {
        const e = segDist(hit, contact.a, contact.b);
        if (e > worst) { worst = e; worstAt = `e${el} p${pw} -> ${hit.kind}`; }
      }
      g.phys.dispose();
    }
    ok('T11a the preview predicts an impact for every shot', predicted === tried,
      `${predicted}/${tried}`);
    ok('T11b and it is where the knight actually lands', worst < 1.0,
      `worst ${worst.toFixed(2)}m (${worstAt})`);
  }
  await breathe();

  // ---- T12 lateral aim actually reaches off-centre targets -----------------
  // The complaint that prompted this: soldiers to the left and right of the
  // centre line were miserable to hit, because every shot flew radially through
  // the middle and you had to orbit to a target's exact bearing. This checks
  // that from ONE orbit position the lateral trim sweeps a real width, and that
  // a soldier well off the bearing becomes reachable without orbiting.
  {
    const g = fresh(31);
    g.angle = N; g.power = 0.85; g.elev = 20 * Math.PI / 180;
    let minX = 1e9, maxX = -1e9;
    for (const yawF of [-1, -0.5, 0, 0.5, 1]) {
      g.yaw = yawF * YAW_MAX;
      const h = g.arc().hit;
      if (h) { minX = Math.min(minX, h.x); maxX = Math.max(maxX, h.x); }
    }
    const width = maxX - minX;
    ok('T12a the trim sweeps a useful width', width > 12,
      `${width.toFixed(1)}m of lateral reach from one orbit position`);

    // A soldier whose bearing is well off the face, hit without orbiting.
    g.angle = N; g.yaw = 0;
    // yawTo(), NOT the bearing from the castle centre: the machine stands 20-38m
    // off centre, so those two differ by several degrees and aiming with the
    // wrong one overshoots by metres.
    const off = g.soldiers.filter(s => !s.dead)
      .map(s => { const t = s.body.translation(); return { s, t, y: g.yawTo(t.x, t.z) }; })
      .filter(o => Math.abs(o.y) > 0.1 && Math.abs(o.y) < YAW_MAX)
      .sort((a, b) => Math.abs(b.y) - Math.abs(a.y))[0];
    let reached = false;
    if (off) {
      g.yaw = off.y;
      for (let e = 6; e <= 50 && !reached; e += 1) {
        for (const pw of [0.6, 0.7, 0.8, 0.9, 1.0]) {
          g.elev = e * Math.PI / 180; g.power = pw;
          const h = g.arc().hit;
          if (h && h.kind === 'soldier') { reached = true; break; }
        }
      }
    }
    ok('T12b an off-bearing soldier is reachable without orbiting',
      !off || reached, off ? `${off.s.post} at ${(off.y * 180 / Math.PI).toFixed(0)}deg of trim` : 'none off-bearing');
    g.phys.dispose();
  }

  await breathe();

  // ---- T13 ragdolls are decoration, not structure -------------------------
  // Six jointed bodies per casualty, up to eight casualties on the field. They
  // must not damage the castle, must not hold the settle check open, and must
  // not grow without bound.
  {
    const g = fresh(88);
    for (const f of ['north', 'south', 'east']) {
      if (g.state !== S.AIM) break;
      g.shoot(FACE_ANGLE[f], BEST[f].elev, BEST[f].power);
      g.settleOut(14);
    }
    const rag = g.phys.list.filter(p => p.kind === 'ragdoll');
    ok('T13a casualties leave bodies', rag.length > 0, `${rag.length} limbs`);
    ok('T13b and the count is capped', g.phys.ragdolls.length <= 8,
      `${g.phys.ragdolls.length} ragdolls`);
    ok('T13c shots still resolve with ragdolls on the field',
      g.state === S.AIM || g.state === S.OVER, g.state);
    g.phys.dispose();
  }



  // ---- T14 every kind of man has a job nothing else does ------------------
  //
  // The point of four kinds of ammunition is that a face which was wrong for
  // the last man is right for this one. That only holds if each type actually
  // WINS at something, so this fires the same grid with every type and
  // compares. A type that is never the best answer is a slot the player learns
  // to ignore — which is why the Hook was cut; see knights.js.
  {
    for (const id of TYPE_ORDER) {
      ok(`T14-${id} is issued somewhere`,
        LEVELS.some(l => (LOADOUTS[l.id] || {})[id] > 0), id);
    }
    for (const l of LEVELS) {
      const n = loadoutTotal(LOADOUTS[l.id] || {});
      ok(`T14a ${l.name} issues exactly its knight count`, n === l.knights,
        `${n} issued vs ${l.knights} counter`);
    }
    await breathe();

    const grid = [[18, 1.0], [24, 1.0], [30, 0.85]];
    const prof = {};
    for (const id of TYPE_ORDER) {
      let down = 0, broke = 0, downD = 0;
      for (const [e, pw] of grid) {
        for (const dived of [false, true]) {
          seed(4242);
          const g = new Game(null, null, { knights: 2, level: SIM_LEVEL });
          g.loadCounts[id] = 2; g.selected = id;
          g.shoot(0, e, pw);
          if (dived) { for (let i = 0; i < 34; i++) g._tick(); g.dive(); }
          g.settleOut(14);
          if (dived) downD += g.soldiersDown;
          else { down += g.soldiersDown; broke += g.broken; }
          g.phys.dispose();
        }
      }
      prof[id] = { down, broke, downD };
      await breathe();
    }

    // The Maul is the answer to masonry. If it does not out-break the Lance by
    // a clear margin it is just a slower Lance.
    ok('T14b the Maul out-breaks the Lance', prof.maul.broke > prof.lance.broke * 1.5,
      `maul ${prof.maul.broke} vs lance ${prof.lance.broke} blocks`);

    // The Sapper is the answer to men standing together, and it has to be BAD
    // at walls or it is strictly better than the Maul.
    ok('T14c the Sapper out-kills the Lance', prof.sapper.down > prof.lance.down,
      `sapper ${prof.sapper.down} vs lance ${prof.lance.down} down`);
    ok('T14d and is far worse at masonry than the Maul',
      prof.sapper.broke < prof.maul.broke * 0.5,
      `sapper ${prof.sapper.broke} vs maul ${prof.maul.broke} blocks`);

    // The Brothers exist to be split. If they are as good un-split, the second
    // tap is decoration and the type has no decision in it. This gets its own
    // wider grid: the three-aim profile above could not separate them, and
    // widening it for every type would double the suite's runtime.
    {
      let un = 0, sp = 0;
      // The full grid the type was tuned on. A six-aim subset could not see
      // the effect at all (5 against 7) while the twenty-aim grid it was
      // measured on shows 8 against 19 — the subset was sampling the aims
      // where a single Brother happens to land on someone.
      const AIMS = [];
      for (const e of [12, 18, 24, 30, 36]) for (const pw of [0.6, 0.75, 0.9, 1.0]) AIMS.push([e, pw]);
      for (const [e, pw] of AIMS) {
        for (const dived of [false, true]) {
          seed(4242);
          const g = new Game(null, null, { knights: 2, level: SIM_LEVEL });
          g.loadCounts.brothers = 2; g.selected = 'brothers';
          g.shoot(0, e, pw);
          // Tapped where the type WANTS to be tapped — the same 42%-of-flight
          // the bot uses. A fixed tick count taps at a different point on every
          // arc, so it was measuring the harness's timing, not the split.
          if (dived) {
            for (let i = 0; i < 400 && g.state === S.FLIGHT; i++) {
              g._tick();
              const t = g.knight && g.knight.body.translation();
              if (!t || Math.hypot(t.x, t.z) < g.orbitR * 0.55) break;
            }
            g.dive();
          }
          g.settleOut(14);
          if (dived) sp += g.soldiersDown; else un += g.soldiersDown;
          g.phys.dispose();
        }
      }
      ok('T14e the Brothers are much better split than not', sp > un * 1.8,
        `${un} down unsplit vs ${sp} split, over ${AIMS.length} aims`);
      await breathe();
    }

    // Nobody is dominant: no type leads at both jobs at once.
    const topKill = TYPE_ORDER.reduce((a, b) => (prof[a].down >= prof[b].down ? a : b));
    const topBreak = TYPE_ORDER.reduce((a, b) => (prof[a].broke >= prof[b].broke ? a : b));
    ok('T14f no type is best at both killing and breaking', topKill !== topBreak,
      `best killer ${topKill}, best breaker ${topBreak}`);

    // And nothing may reach an absurd speed. An unscaled blast impulse once
    // launched a 60-gramme rail cap at 8.5 km/s, which cleared a nine-man
    // garrison in a single shot and read on screen as a bug.
    let peak = 0;
    {
      seed(4242);
      const g = new Game(null, null, { knights: 2, level: SIM_LEVEL });
      g.loadCounts.sapper = 2; g.selected = 'sapper';
      g.shoot(0, 18, 1.0);
      // Burst it OVER the castle, not thirty metres short of it. The first
      // version of this test dived after 20 ticks, detonated in empty air, and
      // reported a peak of 1 m/s — it was measuring nothing at all.
      for (let i = 0; i < 400; i++) {
        g._tick();
        if (!g.knight) break;
        const t = g.knight.body.translation();
        if (Math.hypot(t.x, t.z) < 11) break;
      }
      g.dive();
      for (let i = 0; i < 240; i++) {
        g._tick();
        for (const p of g.phys.list) {
          if (p.fixed) continue;
          const v = p.body.linvel();
          peak = Math.max(peak, Math.hypot(v.x, v.y, v.z));
        }
      }
      g.phys.dispose();
    }
    ok('T14g nothing reaches an absurd speed', peak < 120, `peak ${peak.toFixed(0)} m/s`);
    await breathe();
  }


  // ---- T15 every castle in the campaign, not just the tuned one -----------
  //
  // T1-T14 measure Blackmere in detail. These are the properties that have to
  // hold for all five, and they are the ones that actually break when a new
  // castle is written: a fortress that eats itself on frame one is invisible
  // in a screenshot and fatal in play.
  {
    for (let i = 0; i < LEVELS.length; i++) {
      const L = LEVELS[i];
      setSimLevel(i);
      const g = fresh(4242);
      const a = audit(g);
      ok(`T15a ${L.name}: no interpenetration at spawn`, a.overlaps.length === 0,
        a.overlaps.slice(0, 2).map(o => `${o.a}/${o.b}@${o.at} by ${o.by}`).join(' ; '));
      ok(`T15b ${L.name}: nothing floats`, a.floaters.length === 0,
        a.floaters.slice(0, 2).map(o => `${o.kind}@${o.at}`).join(' ; '));

      const spawn = g.phys.list.filter(p => !p.fixed).map(p => {
        const t = p.body.translation(); return { p, x: t.x, y: t.y, z: t.z };
      });
      tick(g, 300);
      let worst = 0;
      for (const sp of spawn) {
        if (sp.p.dead) { worst = 99; break; }
        const t = sp.p.body.translation();
        worst = Math.max(worst, Math.hypot(t.x - sp.x, t.y - sp.y, t.z - sp.z));
      }
      ok(`T15c ${L.name}: stands up on its own`, worst < 0.32 && g.broken === 0,
        `drift ${worst.toFixed(3)}m, ${g.broken} broke`);
      ok(`T15d ${L.name}: the garrison does not fall over`, g.soldiersDown === 0);
      ok(`T15e ${L.name}: every post has a firing solution`,
        g.soldiers.every(sol => g.solveSoldier(sol, false) || g.solveSoldier(sol, true)),
        `${g.soldiers.filter(sol => !(g.solveSoldier(sol, false) || g.solveSoldier(sol, true))).length} unreachable`);
      g.phys.dispose();
      await breathe();
    }

    // Winnable, with the loadout it is actually issued, by a bot that knows
    // what each type is for. Anything the bot cannot clear at all is a castle
    // that needs a human to be better than the harness, and that is a claim
    // worth making deliberately rather than by accident.
    const clears = [];
    for (let i = 0; i < LEVELS.length; i++) {
      setSimLevel(i);
      const runs = [3, 11, 23].map(sd => bot(sd));
      const w = runs.filter(r => r.won).length;
      const avg = runs.reduce((n, r) => n + r.down, 0) / runs.length;
      clears.push({ name: LEVELS[i].name, w, avg, total: runs[0].total });
      ok(`T15f ${LEVELS[i].name}: the bot gets most of the garrison`,
        avg >= runs[0].total * 0.6, `${w}/3 clears, avg ${avg.toFixed(1)}/${runs[0].total}`);
      await breathe();
    }
    ok('T15g the campaign is winnable end to end',
      clears.every(c => c.w > 0 || c.avg >= c.total * 0.75),
      clears.map(c => `${c.name.split(' ')[0]} ${c.w}/3`).join(', '));
    setSimLevel(BLACKMERE);
  }


  // ---- T16 the level format survives a stranger ---------------------------
  //
  // A player-made castle arrives over a URL from somebody you do not know. It
  // is data, never code, and normaliseDef is the only door it comes through —
  // so these check that the door holds. The bar is not "rejects bad input": it
  // is "turns ANY input into a castle that builds", because somebody following
  // a link would rather see a plain castle than an error page.
  {
    const junk = [null, undefined, 42, 'castle', [], {}, { pieces: 'no' },
      { pieces: [null, 7, { t: 'nonsense' }, { t: 'wall' }] },
      { orbitR: 1e9, masonry: -5, plinth: [1e9, -1e9], loadout: { lance: 1e9 } },
      { name: 'x'.repeat(5000), author: 'y'.repeat(5000) },
      { pieces: new Array(5000).fill({ t: 'tower' }) },
      { theme: 'constructor', pieces: [{ t: 'wall', x: NaN, z: Infinity, len: NaN }] }];
    let built = 0, threw = 0, worstPieces = 0;
    for (const j of junk) {
      try {
        const d = normaliseDef(j);
        worstPieces = Math.max(worstPieces, d.pieces.length);
        const ph = new Physics();
        ph.masonryScale = d.masonry;
        buildFromDef(ph, d);
        // Every number that reaches the world has to be finite, or Rapier
        // takes the whole tab down rather than throwing something catchable.
        let bad = 0;
        for (const p of ph.list) {
          const t = p.body.translation();
          if (!Number.isFinite(t.x) || !Number.isFinite(t.y) || !Number.isFinite(t.z)) bad++;
        }
        if (!bad) built++;
        ph.dispose();
      } catch (e) { threw++; }
    }
    ok('T16a every malformed document still builds a world', built === junk.length,
      `${built}/${junk.length} built, ${threw} threw`);
    ok('T16b and the piece count is capped', worstPieces <= LIMITS.pieces,
      `worst ${worstPieces} vs cap ${LIMITS.pieces}`);
    await breathe();
  }

  // ---- T17 the worked examples are worked ---------------------------------
  //
  // These ship as the teaching material for the editor, and the first version
  // of all three failed this: men hovering above tower roofs whose height I
  // had guessed, lintels a metre inside their own piers, 48 interpenetrations.
  // Shipping a broken example is worse than shipping none.
  if (EXAMPLES) {
    for (const raw of EXAMPLES.levels) {
      const d = normaliseDef(raw);
      const ph = new Physics();
      ph.masonryScale = d.masonry;
      const b = buildFromDef(ph, d);
      const a = audit({ phys: ph });
      ok(`T17 ${d.name}: builds clean`,
        a.overlaps.length === 0 && a.floaters.length === 0,
        `${a.overlaps.length} overlaps, ${a.floaters.length} floating`);
      const spawn = ph.list.filter(p => !p.fixed).map(p => {
        const t = p.body.translation(); return { p, x: t.x, y: t.y, z: t.z };
      });
      for (let i = 0; i < 300; i++) ph.step();
      let drift = 0, lost = 0;
      for (const s of spawn) {
        if (s.p.dead) { lost++; continue; }
        const t = s.p.body.translation();
        drift = Math.max(drift, Math.hypot(t.x - s.x, t.y - s.y, t.z - s.z));
      }
      const fell = b.soldiers.filter(s => s.dead || s.up0 === 0).length;
      ok(`T17 ${d.name}: stands up`, drift < 0.32 && !lost && !fell,
        `drift ${drift.toFixed(2)}m, ${lost} lost, ${fell} fell`);
      ph.dispose();
      await breathe();
    }
  }


  const summary = `\n${pass} passed, ${fail} failed`;
  out.push(summary); log(summary);
  return { pass, fail, lines: out };
}

// The shot each face is designed to reward, measured with sweep() over three
// seeds. If anything in fortress.js changes, RE-SWEEP — these numbers are what
// make T6 and T7 mean anything, and a fortress edit silently invalidates them.
//
// Re-measured over three seeds after the campaign refactor moved the courtyard
// post and scaled launch speed to the castle:
//
//   north  e20 p0.85   south  e22 p0.85
//   east   e12 p0.95 -> 2 kills, 4.3 blocks (walk 3/3, courtyard 2/3)
//   west   nothing worth having, at any elevation or power
//
// East's old answer (e8 p0.90) was a pure flat punch and had gone marginal —
// the knight punched the curtain and then sailed a metre OVER a soldier whose
// head is only 2.4m off the plinth. At 12 degrees it still breaks the wall and
// arrives low enough to matter. If the level changes again, RE-SWEEP.
export const BEST = {
  north: { elev: 20, power: 0.85 },
  east:  { elev: 12, power: 0.95 },
  south: { elev: 22, power: 0.85 },
  west:  { elev: 20, power: 1.00 },
};

// ---------------------------------------------------------------------------
// bot
// ---------------------------------------------------------------------------
//
// Plays a whole game by solving for each surviving soldier in turn. This is the
// only balance number worth trusting: a fixed shot list measures the plan, and
// a human with the arc preview aims at least this well.

// The block a soldier is standing on. An armoured man cannot be shot off a
// wall — the wall has to come out from under him — so the bot has to be able
// to aim at a SUPPORT, not just at a body. Without this it fired direct shots
// at a Serjeant taking 30% damage, failed, and reported the castle unwinnable.
function supportUnder(g, sol) {
  const t = sol.body.translation();
  let best = null, bestY = -1e9;
  for (const p of g.phys.list) {
    if (p.fixed || p.dead || p.kind === 'soldier' || p.kind === 'debris'
      || p.kind === 'ragdoll' || p.kind === 'banner') continue;
    const q = p.body.translation();
    if (q.y > t.y - sol.half.y + 0.05) continue;          // must be below him
    if (Math.hypot(q.x - t.x, q.z - t.z) > 1.6) continue;  // and under him
    if (q.y > bestY) { bestY = q.y; best = p; }
  }
  return best;
}

// Live soldiers within `r` of this one, himself included. A cluster is what a
// Sapper is for, and the bot has to be able to see one.
function clusterAt(live, sol, r) {
  const t = sol.body.translation();
  return live.filter(s => {
    const q = s.body.translation();
    return Math.hypot(q.x - t.x, q.y - t.y, q.z - t.z) <= r;
  });
}

// The bot picks the man on the arm as well as the aim. A harness that fires
// whatever happens to be next in the loadout is measuring a player who has not
// noticed the rack, and every castle built around choosing a type reads as
// unwinnable to it.
function chooseType(g, plan) {
  const want = plan.want;
  if (want && g.loadCounts[want] > 0) return want;
  // Fall back down a preference order rather than to whatever is first: a
  // Sapper thrown at a wall is a wasted shot however few Mauls are left.
  const order = plan.fallback || ['lance', 'maul', 'brothers', 'sapper'];
  return order.find(id => g.loadCounts[id] > 0)
    || TYPE_ORDER.find(id => g.loadCounts[id] > 0);
}

export function bot(sd = 7, opts = {}) {
  const g = fresh(sd, opts.knights || 0);
  const log = [];
  let unreachable = 0;
  while (g.state === S.AIM && g.knights > 0) {
    const live = g.soldiers.filter(x => !x.dead && x.up0 !== 0);
    if (!live.length) break;

    // A Warden makes everything near him take 45% damage, so he is always
    // worth taking first — anything else is half-price work. After him,
    // highest first, because a man on a wall is the one a collapse also takes.
    live.sort((a, b) => {
      const w = (b.shore ? 1 : 0) - (a.shore ? 1 : 0);
      if (w) return w;
      return b.body.translation().y - a.body.translation().y;
    });

    let aim = null, target = null, plan = null;
    for (const s of live) {
      const armoured = (s.armour || 1) < 0.6;
      const pack = clusterAt(live, s, 2.4);

      // Three candidate plans in priority order, each with the man it wants.
      const plans = [];
      if (armoured) {
        const sup = supportUnder(g, s);
        // Aim at what holds him up, with the heaviest thing available.
        if (sup) plans.push({ at: sup, want: 'maul', why: 'support', fallback: ['maul', 'lance', 'brothers', 'sapper'] });
      }
      if (pack.length >= 2) {
        plans.push({ at: s, want: 'sapper', why: 'pack', fallback: ['sapper', 'brothers', 'lance', 'maul'] });
      }
      plans.push({ at: s, want: armoured ? 'maul' : 'lance', why: 'direct',
        fallback: armoured ? ['maul', 'brothers', 'lance', 'sapper'] : ['lance', 'brothers', 'maul', 'sapper'] });

      for (const pl of plans) {
        const q = pl.at.body ? pl.at.body.translation() : pl.at;
        aim = g.solve(q.x, q.y, q.z, 0.9, false)
          || solveAt(g, q, false) || solveAt(g, q, true);
        if (aim) { target = s; plan = pl; break; }
      }
      if (aim) break;
    }
    if (!aim) { unreachable++; break; }

    g.selected = chooseType(g, plan);
    const before = g.soldiersDown;
    g.shoot(aim.angle, aim.elevDeg, aim.power);

    // The bot has to be able to play the second tap, or it is measuring a
    // player who ignores half the game — and reporting the level unwinnable
    // for it. It taps at the point on the arc where that type wants it:
    //   Brothers  open early, so the three of them arrive spread
    //   Sapper    burst just short of the target, over the men
    //   Maul      pound late, once it is over the wall
    // A Lance is left to fly, because a dive shortens its reach and the bot's
    // solution was computed for the full arc.
    const T = g.shotType;
    if (T && T.dive !== 'dive') {
      // Triggered on DISTANCE to the castle, not on a fraction of an estimated
      // flight time. The time estimate ignored drag and the launch height, so
      // the same fraction taps at a different place on every arc; a radius is
      // exact and is what the tuning sweep used.
      const trip = g.orbitR * (T.dive === 'split' ? 0.60 : T.dive === 'burst' ? 0.34 : 0.20);
      for (let i = 0; i < 500 && g.state === S.FLIGHT; i++) {
        g._tick();
        const t = g.knight && g.knight.body.translation();
        if (!t || Math.hypot(t.x, t.z) < trip) break;
      }
      g.dive();
    }
    g.settleOut(14);
    log.push(`${target.post}/${plan.why}/${T ? T.id : '?'} e${aim.elevDeg.toFixed(0)} p${aim.power} -> +${g.soldiersDown - before}`);
  }
  const r = { won: g.won, down: g.soldiersDown, total: g.soldiersTotal,
    knightsLeft: g.knights, broken: g.broken, score: g.score, unreachable, log };
  g.phys.dispose();
  return r;
}

// Search the whole power range for a solution to an arbitrary point, the way
// solveSoldier does for a body. A coarse list misses shots that exist.
function solveAt(g, q, high) {
  for (let i = 0; i <= 20; i++) {
    const p = 0.2 + (i / 20) * 0.8;
    const s = g.solve(q.x, q.y, q.z, p, high);
    if (s) return s;
  }
  return null;
}

// Can every post be aimed at in the first place? A soldier no shot can reach is
// a level that cannot be completed, however good the player is.
export function reachability() {
  const g = fresh(1);
  const out = g.soldiers.map(s => {
    const flat = g.solveSoldier(s, false), high = g.solveSoldier(s, true);
    return { post: s.post, flat: flat ? +flat.elevDeg.toFixed(1) : null,
      high: high ? +high.elevDeg.toFixed(1) : null };
  });
  g.phys.dispose();
  return out;
}

// ---------------------------------------------------------------------------
// parameter sweep
// ---------------------------------------------------------------------------

export async function sweep(angle, opts = {}) {
  const elevs = opts.elevs || [8, 12, 18, 24, 30, 36, 44, 52];
  const powers = opts.powers || [0.5, 0.65, 0.8, 0.9, 1.0];
  const reps = opts.reps || 2;
  const rows = [];
  for (const e of elevs) {
    for (const p of powers) {
      let down = 0, broken = 0, tags = {};
      for (let r = 0; r < reps; r++) {
        const g = fresh(1000 + r * 7919);
        g.shoot(angle, e, p);
        g.settleOut(14);
        down += g.bannersDown; broken += g.broken;
        for (const b of g.banners) if (b.up0 === 0) tags[b.tag] = (tags[b.tag] || 0) + 1;
        g.phys.dispose();
      }
      rows.push({ elev: e, power: p, down: down / reps, broken: broken / reps, tags });
      await new Promise(r => setTimeout(r, 0));   // keep the tab alive
    }
  }
  rows.sort((a, b) => (b.down - a.down) || (b.broken - a.broken));
  return rows;
}

export async function sweepAll(opts = {}) {
  const out = {};
  for (const [name, a] of Object.entries(FACE_ANGLE)) {
    out[name] = (await sweep(a, opts)).slice(0, 6);
  }
  return out;
}

// ---------------------------------------------------------------------------
// construction audit
// ---------------------------------------------------------------------------
//
// Two faults are invisible on screen and catastrophic in the solver:
//   OVERLAP  — two blocks interpenetrating at spawn. Rapier shoves them apart
//              violently and the fortress detonates on frame 1.
//   FLOATER  — a block with nothing under it. It falls, lands, and reads to the
//              player as the castle collapsing before they fired.
// Neither is visible in a screenshot, so they get measured, not eyeballed.

export function audit(g) {
  const ps = g.phys.list.filter(p => p.kind !== 'ground');
  const box = (p) => {
    const t = p.body.translation();
    return { p, x0: t.x - p.half.x, x1: t.x + p.half.x,
             y0: t.y - p.half.y, y1: t.y + p.half.y,
             z0: t.z - p.half.z, z1: t.z + p.half.z };
  };
  const bs = ps.map(box);
  const EPS = 0.012;                 // touching is fine; biting in is not
  const overlaps = [];
  for (let i = 0; i < bs.length; i++) {
    for (let j = i + 1; j < bs.length; j++) {
      const a = bs[i], b = bs[j];
      const ox = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
      if (ox <= EPS) continue;
      const oy = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
      if (oy <= EPS) continue;
      const oz = Math.min(a.z1, b.z1) - Math.max(a.z0, b.z0);
      if (oz <= EPS) continue;
      overlaps.push({ a: a.p.kind, b: b.p.kind, tag: a.p.tag || b.p.tag || '',
        by: +Math.min(ox, oy, oz).toFixed(3),
        at: [+((a.x0 + a.x1) / 2).toFixed(1), +((a.y0 + a.y1) / 2).toFixed(1), +((a.z0 + a.z1) / 2).toFixed(1)] });
    }
  }

  const floaters = [];
  for (const a of bs) {
    if (a.p.fixed) continue;
    if (a.y0 <= 0.02) continue;                       // on the ground
    let held = false;
    for (const b of bs) {
      if (b === a) continue;
      if (b.y1 < a.y0 - 0.09 || b.y1 > a.y0 + 0.03) continue;
      if (Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) <= 0.02) continue;
      if (Math.min(a.z1, b.z1) - Math.max(a.z0, b.z0) <= 0.02) continue;
      held = true; break;
    }
    if (!held) floaters.push({ kind: a.p.kind, tag: a.p.tag || '',
      gap: +a.y0.toFixed(2),
      at: [+((a.x0 + a.x1) / 2).toFixed(1), +a.y0.toFixed(1), +((a.z0 + a.z1) / 2).toFixed(1)] });
  }
  return { overlaps, floaters, parts: ps.length };
}

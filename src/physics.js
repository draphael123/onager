// physics.js — Rapier wrapper.
//
// Everything the game knows about "is it standing / did it fall / did that hurt"
// comes from here. Three jobs:
//   1. build bodies with tuning that makes 3D box stacks stand still
//   2. turn contact forces into damage, and damage into debris
//   3. decide when a shot is OVER (settle detection) — without this the round
//      never ends, because 3D rubble jitters forever.

import * as RAPIER from '../vendor/rapier.es.js';
import { foe } from './foes.js';
import { rnd } from './rand.js';
import { activeQuality } from './settings.js';

export const MAT = {
  stone:  { hp: 300, density: 2.6, friction: 0.92, restitution: 0.02, color: 0x9d9689, chip: 0x8a8377 },
  block:  { hp: 150, density: 2.4, friction: 0.90, restitution: 0.02, color: 0xa79f90, chip: 0x938c7f },
  timber: { hp: 55,  density: 0.7, friction: 0.72, restitution: 0.06, color: 0x7d5a38, chip: 0x6a4b2e },
  soldier:{ hp: 26,  density: 1.0, friction: 0.95, restitution: 0.02, color: 0xb8443a, chip: 0x8e3630 },
  banner: { hp: 60,  density: 1.5, friction: 0.80, restitution: 0.05, color: 0xc8443a, chip: 0xa33830 },
};

// FORCE_FLOOR only filters which contacts raise an event at all. It must NOT
// be the damage gate: the resting load at the bottom of a seven-course wall is
// the same order as a light impact, so a force-only rule quietly chews the
// fortress down under its own weight. Damage is gated on IMPACT_V, the
// relative speed of the two bodies in the tick BEFORE the contact resolved —
// a stack that is merely standing there has a relative speed of zero.
const FORCE_FLOOR = 500;
const IMPACT_V = 2.6;
// Calibrated against measurement, not taste: a direct knight hit at full power
// reports a contact force around 8800, and that shot must destroy one `block`
// (hp 150) outright. Block-on-block during a collapse reports 500-900, which at
// this rate chips rather than shatters — so rubble damages, but only a real
// strike breaks through.
const DAMAGE_PER_FORCE = 0.026;
let MAX_DEBRIS = 130;
export function setDebrisCap(n) { MAX_DEBRIS = n; }

// A strike this fast blows a HOLE, not a chip. Without splash the knight broke
// exactly the one brick it touched, then lodged in the gap with the courses
// above and below still pinning it — so the one shot the east curtain is
// designed around simply did not work.
const SPLASH_V = 12;

export class Physics {
  constructor() {
    this.R = RAPIER;
    this.world = new RAPIER.World({ x: 0, y: -21.5, z: 0 });
    this.world.timestep = 1 / 60;

    const ip = this.world.integrationParameters;
    // Box stacks in 3D slide and jitter with the default iteration counts.
    // These are the numbers that made a 9-course wall stand still.
    if ('numSolverIterations' in ip) ip.numSolverIterations = 10;
    if ('numInternalPgsIterations' in ip) ip.numInternalPgsIterations = 2;
    if ('numAdditionalFrictionIterations' in ip) ip.numAdditionalFrictionIterations = 6;

    this.events = new RAPIER.EventQueue(true);
    this.parts = new Map();   // collider handle -> part record
    this.list = [];           // every live part, in creation order
    this.debris = [];
    this.ragdolls = [];      // groups of jointed parts, oldest culled first
    this.masonryScale = 1;   // per-level difficulty; see levels.js masonry
    this.bursts = [];        // sapper detonations, drained by the renderer
    this.time = 0;

    // Filled each step, drained by the renderer. Kept as plain data so the
    // headless sim can assert on it without a scene.
    this.impacts = [];
    this.breaks = [];

    // Set by the Game AFTER build(), so the initial fortress is added to the
    // scene in one pass and these only fire for things created or destroyed
    // during play — debris appearing, blocks and soldiers leaving.
    MAX_DEBRIS = activeQuality().debris;
    this.onAdd = null;
    this.onRemove = null;
    this.onBannerDown = null;
    this.onSoldierDown = null;
    this.soldiers = [];
  }

  // ---- construction -------------------------------------------------------

  _mat(name) { return MAT[name] || MAT.block; }

  addBox(x, y, z, hx, hy, hz, opts = {}) {
    const m = this._mat(opts.mat);
    const fixed = !!opts.fixed;
    const bd = (fixed ? RAPIER.RigidBodyDesc.fixed() : RAPIER.RigidBodyDesc.dynamic())
      .setTranslation(x, y, z);
    if (opts.rotY) bd.setRotation(quatY(opts.rotY));
    if (!fixed) {
      bd.setLinearDamping(0.06).setAngularDamping(0.14);
      // Let stacks fall asleep quickly — this is most of the settle time.
      bd.setSleeping(false);
    }
    const body = this.world.createRigidBody(bd);

    const cd = RAPIER.ColliderDesc.cuboid(hx, hy, hz)
      .setDensity(m.density)
      .setFriction(m.friction)
      .setRestitution(m.restitution);
    if (!fixed) {
      cd.setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS);
      cd.setContactForceEventThreshold(FORCE_FLOOR);
    }
    const col = this.world.createCollider(cd, body);

    const part = {
      body, col, fixed,
      kind: opts.kind || 'block',
      mat: opts.mat || 'block',
      // masonryScale is the level's difficulty dial: it makes every block on
      // the early castles softer without changing a single dimension, so the
      // geometry stays exactly as audited and only the resistance moves.
      hp: (opts.hp != null ? opts.hp : m.hp) * (opts.hpScale || 1) * this.masonryScale,
      maxHp: (opts.hp != null ? opts.hp : m.hp) * (opts.hpScale || 1),
      half: { x: hx, y: hy, z: hz },
      spawnX: x, spawnY: y, spawnZ: z,
      up0: null,
      dead: false,
      mesh: null,
      debris: !!opts.debris,
      born: this.time,
    };
    if (part.kind === 'banner') part.up0 = 1;
    this.parts.set(col.handle, part);
    this.list.push(part);
    if (this.onAdd) this.onAdd(part);
    return part;
  }

  addBall(x, y, z, r, opts = {}) {
    const bd = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(x, y, z)
      .setLinearDamping(0)          // the trajectory preview must be TRUTHFUL
      .setAngularDamping(0.25)
      .setCcdEnabled(true);
    const body = this.world.createRigidBody(bd);
    const cd = RAPIER.ColliderDesc.ball(r)
      .setDensity(opts.density || 9.5)
      .setFriction(0.55)
      .setRestitution(0.16)
      .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS)
      .setContactForceEventThreshold(FORCE_FLOOR * 0.5);
    const col = this.world.createCollider(cd, body);
    const part = {
      body, col, fixed: false, kind: opts.kind || 'knight', mat: 'knight',
      hp: 1e9, maxHp: 1e9, half: { x: r, y: r, z: r },
      spawnX: x, spawnY: y, spawnZ: z, type: opts.type || null,
      up0: null, dead: false, mesh: null, debris: false, born: this.time,
    };
    this.parts.set(col.handle, part);
    this.list.push(part);
    if (this.onAdd) this.onAdd(part);
    return part;
  }

  // Weld a standard to the thing it stands on.
  //
  // Free-standing poles turned the level into skittles: one flat pass over the
  // top at ~10m clipped every standard in a line without breaking a single
  // block, which made choosing a face irrelevant — the exact thing this slice
  // exists to test. Welded, a standard can only come down when its HOST is
  // destroyed or tips over, so "collapse the thing it stands on" is the only
  // way to take one. Rapier drops the joint automatically when the host body is
  // removed, and the standard then falls on its own.
  weld(part, host) {
    const a = part.body.translation(), b = host.body.translation();
    const p1 = { x: 0, y: -part.half.y, z: 0 };
    const p2 = { x: a.x - b.x, y: a.y - part.half.y - b.y, z: a.z - b.z };
    const q = { x: 0, y: 0, z: 0, w: 1 };
    const jd = RAPIER.JointData.fixed(p1, q, p2, q);
    this.world.createImpulseJoint(jd, part.body, host.body, true);
    part.host = host;
    return part;
  }

  // A soldier: a capsule that stands on the fortress and must be knocked out of
  // it. Deliberately fragile — any real knock kills, whether that is the knight
  // arriving in person or a course of masonry arriving on top of them.
  addSoldier(x, y, z, opts = {}) {
    const m = MAT.soldier;
    const F = foe(opts.foe || 'levy');
    // A bigger man is a bigger target, and the collider has to agree with the
    // mesh or you get hits that visibly miss.
    const r = 0.3 * F.scale, hh = 0.42 * F.scale;
    // A CYLINDER's half-height is hh, not hh + r — that is the capsule formula.
    // Using it here spawned every soldier 30cm above their post, so the whole
    // garrison dropped on the first frame and the stability test read 0.43m of
    // drift with nothing actually wrong. The audit could not catch it either,
    // because the same wrong figure went into the half-extents it checks.
    const bd = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(x, y + hh, z)
      .setLinearDamping(0.05).setAngularDamping(0.5);
    const body = this.world.createRigidBody(bd);
    // CYLINDER, not capsule. A capsule stands on a single rounded contact point
    // and tips over on its own — five of seven soldiers knocked themselves out
    // while the fortress just stood there. A flat base stands, and still goes
    // over the moment anything hits it.
    const cd = RAPIER.ColliderDesc.cylinder(hh, r)
      .setDensity(m.density).setFriction(m.friction).setRestitution(m.restitution)
      .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS)
      .setContactForceEventThreshold(FORCE_FLOOR * 0.35);
    const col = this.world.createCollider(cd, body);
    const part = {
      body, col, fixed: false, kind: 'soldier', mat: 'soldier',
      hp: F.hp, maxHp: F.hp, half: { x: r, y: hh, z: r },
      foe: F.id, armour: F.armour, score: F.score, shore: F.shore || null,
      spawnX: x, spawnY: y + hh, spawnZ: z,
      up0: 1, dead: false, mesh: null, debris: false, born: this.time,
      post: opts.post || '', tilt: 0,
    };
    this.parts.set(col.handle, part);
    this.list.push(part);
    this.soldiers.push(part);
    if (this.onAdd) this.onAdd(part);
    return part;
  }

  // A Sapper going off: a wide, shallow blast that ruins a group of men and
  // barely scratches a wall. The knight is consumed by it.
  burstAt(kn, at) {
    if (!kn || kn.dead) return;
    const T = kn.type;
    const r = (T && T.splashRadius ? T.splashRadius : 3) * 1.15;
    const power = 240 * (T ? T.splashDamage : 1);
    this._splash(at, power, r, kn, T ? (T.splashSoft || 0.12) : 1);
    // Shove everything loose outward, so the blast reads as force and not just
    // as damage numbers happening quietly.
    for (const p of this.list) {
      if (p.fixed || p.dead || p === kn) continue;
      const t = p.body.translation();
      const dx = t.x - at.x, dy = t.y - at.y, dz = t.z - at.z;
      const d = Math.hypot(dx, dy, dz);
      if (d > r * 1.4 || d < 0.001) continue;
      // Same rule as the Hook: a speed the blast imparts, scaled by mass.
      const dv = (1 - d / (r * 1.4)) * 7.5 * (p.body.mass() || 1);
      p.body.applyImpulse({ x: (dx / d) * dv, y: (dy / d) * dv + dv * 0.4, z: (dz / d) * dv }, true);
    }
    this.bursts.push({ x: at.x, y: at.y, z: at.z, r });
    this.remove(kn);
  }

  // A jointed ragdoll: torso, head, two arms, two legs, spherical joints.
  //
  // Six bodies and five joints is enough to read as a body going limp, and
  // cheap enough that eight of them can be on the field at once. The parts are
  // marked 'ragdoll' so they are invisible to damage, to settle detection and
  // to the audit — they are decoration with physics, not structure.
  spawnRagdoll(x, y, z, vel, opts = {}) {
    const tint = opts.tint || 'foe';
    const pal = opts.pal || null;
    const grp = { parts: [], born: this.time, tint };
    const V = vel || { x: 0, y: 0, z: 0 };
    const jitter = () => (rnd(0, 1) - 0.5) * 3.2;

    const piece = (px, py, pz, hx, hy, hz, rdKind, density) => {
      const bd = RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(x + px, y + py, z + pz)
        .setLinearDamping(0.14).setAngularDamping(0.28)
        .setLinvel(V.x * 0.55 + jitter(), V.y * 0.55 + jitter(), V.z * 0.55 + jitter())
        .setAngvel({ x: jitter() * 2, y: jitter() * 2, z: jitter() * 2 });
      const body = this.world.createRigidBody(bd);
      const cd = RAPIER.ColliderDesc.cuboid(hx, hy, hz)
        .setDensity(density).setFriction(0.85).setRestitution(0.04);
      // No contact events: a flailing ragdoll would otherwise spam the damage
      // system and chew the castle down from the inside.
      const col = this.world.createCollider(cd, body);
      const part = {
        body, col, fixed: false, kind: 'ragdoll', rdKind, mat: 'soldier', tint, pal,
        hp: 1e9, maxHp: 1e9, half: { x: hx, y: hy, z: hz },
        spawnX: x + px, spawnY: y + py, spawnZ: z + pz,
        up0: null, dead: false, mesh: null, debris: true, born: this.time,
      };
      this.parts.set(col.handle, part);
      this.list.push(part);
      grp.parts.push(part);
      if (this.onAdd) this.onAdd(part);
      return part;
    };

    const torso = piece(0, 0.06, 0, 0.2, 0.28, 0.14, 'torso', 1.0);
    const head = piece(0, 0.5, 0, 0.15, 0.15, 0.15, 'head', 0.8);
    const armL = piece(-0.3, 0.1, 0, 0.08, 0.22, 0.08, 'arm', 0.6);
    const armR = piece(0.3, 0.1, 0, 0.08, 0.22, 0.08, 'arm', 0.6);
    const legL = piece(-0.12, -0.42, 0, 0.09, 0.26, 0.09, 'leg', 0.9);
    const legR = piece(0.12, -0.42, 0, 0.09, 0.26, 0.09, 'leg', 0.9);

    const join = (a, b, pa, pb) => {
      try {
        const jd = RAPIER.JointData.spherical(pa, pb);
        this.world.createImpulseJoint(jd, a.body, b.body, true);
      } catch (e) { /* a joint that will not build is better skipped than fatal */ }
    };
    join(torso, head, { x: 0, y: 0.3, z: 0 }, { x: 0, y: -0.16, z: 0 });
    join(torso, armL, { x: -0.2, y: 0.2, z: 0 }, { x: 0, y: 0.22, z: 0 });
    join(torso, armR, { x: 0.2, y: 0.2, z: 0 }, { x: 0, y: 0.22, z: 0 });
    join(torso, legL, { x: -0.12, y: -0.28, z: 0 }, { x: 0, y: 0.26, z: 0 });
    join(torso, legR, { x: 0.12, y: -0.28, z: 0 }, { x: 0, y: 0.26, z: 0 });

    this.ragdolls.push(grp);
    while (this.ragdolls.length > 8) {
      const old = this.ragdolls.shift();
      for (const q of old.parts) this.remove(q);
    }
    return grp;
  }

  _cullRagdolls() {
    for (let i = this.ragdolls.length - 1; i >= 0; i--) {
      const g = this.ragdolls[i];
      if (this.time - g.born < 26) continue;
      for (const q of g.parts) this.remove(q);
      this.ragdolls.splice(i, 1);
    }
  }

  remove(part) {
    if (part.dead) return;
    part.dead = true;
    // Without this the mesh of every destroyed block and every dead soldier
    // stays in the scene, frozen where it died — the wall you just blew a hole
    // in still looks solid, and the destruction is invisible.
    if (this.onRemove) this.onRemove(part);
    this.parts.delete(part.col.handle);
    this.world.removeRigidBody(part.body);
    const i = this.list.indexOf(part);
    if (i >= 0) this.list.splice(i, 1);
    const d = this.debris.indexOf(part);
    if (d >= 0) this.debris.splice(d, 1);
  }

  // Sweeps build dozens of worlds; without this the WASM heap just grows.
  dispose() {
    try { this.events.free(); } catch (e) {}
    try { this.world.free(); } catch (e) {}
    this.parts.clear(); this.list.length = 0; this.debris.length = 0;
  }

  // ---- stepping -----------------------------------------------------------

  step() {
    // Pre-step velocities. Contact events fire AFTER the solver has already
    // killed the impact, so post-step velocity cannot tell a smash from a
    // settle — this snapshot is the only honest measure of impact speed.
    for (const p of this.list) {
      if (p.fixed) { p.pvx = p.pvy = p.pvz = 0; continue; }
      const v = p.body.linvel();
      p.pvx = v.x; p.pvy = v.y; p.pvz = v.z;
    }

    this.world.step(this.events);
    this.time += this.world.timestep;

    this.events.drainContactForceEvents((ev) => {
      const mag = ev.totalForceMagnitude();
      if (mag < FORCE_FLOOR) return;
      const a = this.parts.get(ev.collider1());
      const b = this.parts.get(ev.collider2());
      const at = a ? a.body.translation() : (b ? b.body.translation() : null);
      if (!at) return;

      const ax = a ? a.pvx || 0 : 0, ay = a ? a.pvy || 0 : 0, az = a ? a.pvz || 0 : 0;
      const bx = b ? b.pvx || 0 : 0, by = b ? b.pvy || 0 : 0, bz = b ? b.pvz || 0 : 0;
      const relV = Math.hypot(ax - bx, ay - by, az - bz);
      if (relV < IMPACT_V) return;             // settling, not smashing

      const kn0 = (a && a.kind === 'knight') || (b && b.kind === 'knight');
      this.impacts.push({ x: at.x, y: at.y, z: at.z, mag, relV, knight: kn0,
        mat: (a && a.kind !== 'knight' ? a.mat : (b ? b.mat : 'block')) });

      const bite = Math.min(1, (relV - IMPACT_V) / 6);
      const kn = (a && a.kind === 'knight') ? a : (b && b.kind === 'knight') ? b : null;
      const other = kn === a ? b : a;
      // Every number below comes off the knight's TYPE, so a new kind of
      // ammunition is a row in knights.js and nothing else.
      const T = (kn && kn.type) || null;
      const matMul = T && other && T.matBonus ? (T.matBonus[other.mat] || 1) : 1;
      const dmg = mag * DAMAGE_PER_FORCE * bite * (T ? T.damage : 1) * matMul;

      if (a) this._hurt(a, dmg);
      if (b) this._hurt(b, dmg);

      // Splash. Knight strikes only, once per tick, radius scaled by speed and
      // by type — the Sapper reaches three metres and the Lance barely one.
      if (kn && relV > SPLASH_V && this._splashTick !== this.time) {
        this._splashTick = this.time;
        const r = (1.2 + relV * 0.045) * (T ? T.splashRadius : 1);
        this._splash(at, dmg * (T ? T.splashDamage : 1), r, kn);
      }

      // A Sapper is spent where it lands. Deferred out of this callback:
      // detonating inside the drain removes the very body whose contact event
      // is being read, and Rapier traps on the next event that names it.
      if (T && T.burst && kn && !kn.dead && relV > SPLASH_V) {
        this._pendingBurst = { kn, at: { x: at.x, y: at.y, z: at.z } };
        return;
      }

      // Punch-through. The solver stops the knight dead in the same tick it
      // shatters a block, so without this a knight that destroys a wall still
      // drops out of the hole it just made — or wedges in it. Restoring a
      // fraction of the PRE-impact velocity is what turns a hit into breaking
      // through. A Maul keeps almost none of it: it stops where it lands.
      const keep = T ? T.punchThrough : 0.72;
      if (keep > 0 && kn && !kn.dead && other && other.dead) {
        kn.body.setLinvel({ x: kn.pvx * keep, y: kn.pvy * keep, z: kn.pvz * keep }, true);
      }
    });

    if (this._pendingBurst) {
      const b = this._pendingBurst;
      this._pendingBurst = null;
      this.burstAt(b.kn, b.at);
    }

    this._checkBanners();
    this._checkSoldiers();
    this._cullRagdolls();
    this._cullDebris();
  }

  // `soft` scales what the blast does to MASONRY without touching what it does
  // to men. A Sapper that clears a wall walk of soldiers and also demolishes
  // the wall is just a better Lance, and then nobody ever loads a Lance.
  // The Warden shores up what is near him. It is the one garrison trait that
  // does not defend the man carrying it: it changes the ORDER you attack in,
  // because breaking his wall before you have dealt with him is wasted work.
  //
  // The live warden list is rebuilt only when the garrison changes, not per
  // block per hit — a naive scan here is O(blocks x wardens) every contact.
  _shoring(p) {
    if (!this._wardens || !this._wardens.length) return 1;
    const t = p.body.translation();
    let f = 1;
    for (const w of this._wardens) {
      if (w.dead) continue;
      const wt = w.body.translation();
      const d2 = (t.x - wt.x) ** 2 + (t.y - wt.y) ** 2 + (t.z - wt.z) ** 2;
      if (d2 < w.shore.radius * w.shore.radius) f = Math.min(f, w.shore.factor);
    }
    return f;
  }

  // ---- what is holding this building up ------------------------------------
  //
  // The castles are built around "take a pier, and the bay comes down", but
  // nothing on screen said WHICH block was the pier. This is a static load
  // analysis run once per level: for every block, how much of the building
  // above it does it carry, relative to its own weight.
  //
  // It is a heuristic, not a solver — a real one would need the contact graph
  // and a linear program. What it gets right is the only thing that matters
  // here: a thin pier under a stone roof scores enormously, and a merlon
  // sitting on top of a wall scores nothing.
  analyseStructure(faces) {
    const ps = this.list.filter(p => !p.fixed && !p.debris
      && p.kind !== 'soldier' && p.kind !== 'ragdoll' && p.kind !== 'banner'
      && p.kind !== 'knight' && p.half);
    const box = (p) => {
      const t = p.body.translation();
      return { p, x0: t.x - p.half.x, x1: t.x + p.half.x,
        y0: t.y - p.half.y, y1: t.y + p.half.y,
        z0: t.z - p.half.z, z1: t.z + p.half.z,
        m: p.body.mass() || 0.001 };
    };
    const bs = ps.map(box).sort((a, b) => b.y0 - a.y0);      // highest first
    const TOL = 0.16;                                         // a mortar joint

    // Who holds up whom. Two boxes touch vertically and overlap in plan.
    for (const b of bs) {
      b.on = [];
      for (const c of bs) {
        if (c === b) continue;
        if (Math.abs(c.y1 - b.y0) > TOL) continue;
        if (Math.min(b.x1, c.x1) - Math.max(b.x0, c.x0) <= 0.02) continue;
        if (Math.min(b.z1, c.z1) - Math.max(b.z0, c.z0) <= 0.02) continue;
        b.on.push(c);
      }
      b.load = b.m;
    }
    // Top down, so a block's own load is final before it is passed downward.
    // A block resting on three supporters gives each a third of what it holds.
    for (const b of bs) {
      if (!b.on.length) continue;
      const share = b.load / b.on.length;
      for (const c of b.on) c.load += share;
    }

    let worst = 0;
    for (const b of bs) {
      b.p.load = b.load;
      // Carrying twenty times your own weight is what a pier does; a wall
      // block in the middle of a course carries two or three.
      b.p.carries = b.load / b.m;
      worst = Math.max(worst, b.p.carries);
    }

    // ONE keystone per FACE, not the global top eight. Ranking globally gave
    // Millbrook two markers, both on internal floor joists, and nothing at all
    // on the three walls you can actually shoot — the analysis was right and
    // the presentation was useless. Per-face means circling the castle reveals
    // exactly one weak point per wall, which is the premise of the game stated
    // as a marker.
    for (const b of bs) b.p.keystone = false;
    const chosen = [];
    for (const F of (faces && faces.length ? faces : [{ a: 0 }, { a: Math.PI / 2 },
      { a: Math.PI }, { a: -Math.PI / 2 }])) {
      let best = null;
      for (const b of bs) {
        if (b.p.carries < 3) continue;                 // carrying nothing much
        const t = b.p.body.translation();
        const bearing = Math.atan2(t.x, -t.z);
        const d = Math.abs(Math.atan2(Math.sin(bearing - F.a), Math.cos(bearing - F.a)));
        if (d > 0.72) continue;                        // not on this face
        // Prefer what is carrying most, but a block buried at the very centre
        // of the castle is not a shot — weight by how far out it stands.
        const reach = Math.hypot(t.x, t.z);
        const score = b.p.carries * (0.45 + Math.min(1, reach / 9) * 0.55);
        if (!best || score > best.score) best = { p: b.p, score };
      }
      if (!best) continue;
      const t = best.p.body.translation();
      if (chosen.some(c => {
        const q = c.body.translation();
        return Math.hypot(q.x - t.x, q.z - t.z) < 1.6;
      })) continue;
      best.p.keystone = true;
      chosen.push(best.p);
    }
    this.keystones = chosen;
    return { analysed: bs.length, keystones: chosen.length, worstCarries: worst };
  }

  refreshWardens() {
    this._wardens = this.soldiers.filter(s => s.shore && !s.dead);
  }

  _splash(at, dmg, r, skip, soft = 1) {
    const r2 = r * r;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      if (p === skip || p.fixed || p.dead || p.kind === 'debris' || p.kind === 'ragdoll') continue;
      const t = p.body.translation();
      const dx = t.x - at.x, dy = t.y - at.y, dz = t.z - at.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > r2) continue;
      const scale = p.kind === 'soldier' ? 1 : soft;
      this._hurt(p, dmg * 0.8 * scale * (1 - Math.sqrt(d2) / r));
    }
  }

  _hurt(p, dmg) {
    if (p.dead || p.fixed || p.kind === 'knight' || p.kind === 'ragdoll' || dmg <= 0) return;
    // A standard cannot be destroyed, only felled — cloth does not shatter, and
    // letting a direct hit break one put the skittles line straight back. But
    // ramming a standard has to DO something, or the east curtain shot lands on
    // the pole and simply stops. The blow passes into the socket it stands in,
    // which is a solid block that needs a real strike to break. A graze still
    // does nothing, because a graze carries almost no force.
    if (p.kind === 'banner') {
      if (p.host && !p.host.dead) this._hurt(p.host, dmg * 0.6);
      return;
    }
    if (p.kind === 'soldier') {
      // Armour is a multiplier on a STRIKE only. Being crushed is handled in
      // _checkSoldiers, and no amount of plate helps a man under a wall — which
      // is the whole reason the Serjeant exists.
      p.hp -= dmg * (p.armour || 1);
      if (p.hp <= 0) this._soldierDown(p, 'struck');
      return;
    }
    p.hp -= dmg * this._shoring(p);
    if (p.hp <= 0) this._break(p);
  }

  _break(p) {
    if (p.dead) return;
    const t = p.body.translation();
    const v = p.body.linvel();
    this.breaks.push({ x: t.x, y: t.y, z: t.z, mat: p.mat, kind: p.kind,
      half: { ...p.half } });
    if (p.kind === 'banner') this._bannerDown(p, 'shattered');
    this.remove(p);
    if (!p.debris) this._spawnDebris(t, v, p);
  }

  _spawnDebris(t, v, from) {
    if (this.debris.length > MAX_DEBRIS) return;
    const n = from.kind === 'banner' ? 3 : 4;
    const s = Math.min(from.half.x, from.half.y, from.half.z) * 0.55 + 0.06;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + this.time;
      const d = this.addBox(
        t.x + Math.cos(a) * s * 1.4, t.y + (i - n / 2) * s * 0.9, t.z + Math.sin(a) * s * 1.4,
        s * rnd(0.6, 1.25), s * rnd(0.6, 1.25), s * rnd(0.6, 1.25),
        { mat: from.mat, kind: 'debris', debris: true, hp: 1e9 });
      d.body.setLinvel({
        x: v.x * 0.42 + Math.cos(a) * rnd(1.6, 4.4),
        y: v.y * 0.3 + rnd(1.4, 5.2),
        z: v.z * 0.42 + Math.sin(a) * rnd(1.6, 4.4),
      }, true);
      d.body.setAngvel({ x: rnd(-9, 9), y: rnd(-9, 9), z: rnd(-9, 9) }, true);
      this.debris.push(d);
    }
  }

  _cullDebris() {
    for (let i = this.debris.length - 1; i >= 0; i--) {
      const d = this.debris[i];
      if (d.dead) { this.debris.splice(i, 1); continue; }
      const t = d.body.translation();
      if (t.y < -14 || this.time - d.born > 11) this.remove(d);
    }
    // Hard cap: oldest first, so a big collapse never tanks the frame.
    while (this.debris.length > MAX_DEBRIS) this.remove(this.debris[0]);
  }

  // A standard is down when the thing it stands on is gone, has shifted, or has
  // tipped — or when the standard itself falls or lies over.
  //
  // The HOST clauses are load bearing. Destroying the dais under the courtyard
  // standard used to drop the pole sixty centimetres onto the plinth, where it
  // stood there perfectly upright: host destroyed, fortress broken open, and
  // the game still said the standard was flying. "Collapse what it stands on"
  // has to be the rule, not a hoped-for consequence of one.
  _checkBanners() {
    for (const p of this.list) {
      if (p.kind !== 'banner' || p.dead || p.up0 === 0) continue;
      const h = p.host;
      if (h) {
        if (h.dead) { this._bannerDown(p, 'unseated'); continue; }
        const ht = h.body.translation();
        if (Math.hypot(ht.x - h.spawnX, ht.y - h.spawnY, ht.z - h.spawnZ) > 1.6) {
          this._bannerDown(p, 'undermined'); continue;
        }
        if (localUp(h.body.rotation()) < 0.82) {      // host tipped past ~35 deg
          this._bannerDown(p, 'undermined'); continue;
        }
      }
      const t = p.body.translation();
      if (t.y < p.spawnY - 1.4) { this._bannerDown(p, 'fell'); continue; }
      if (localUp(p.body.rotation()) < Math.cos(0.907)) this._bannerDown(p, 'toppled');
    }
  }

  // Knocked flat counts. A soldier lying on their back has left the fight, and
  // "the tower fell on him" has to read as a win or crushing is not a verb.
  _checkSoldiers() {
    for (const p of this.soldiers) {
      if (p.dead || p.up0 === 0) continue;
      const t = p.body.translation();
      if (t.y < p.spawnY - 3.0) { this._soldierDown(p, 'fell'); continue; }
      if (localUp(p.body.rotation()) < 0.5) {          // past 60 degrees
        p.tilt += this.world.timestep;
        if (p.tilt > 0.28) this._soldierDown(p, 'floored');
      } else p.tilt = 0;
    }
  }

  _soldierDown(p, how) {
    if (p.up0 === 0) return;
    p.up0 = 0;
    const t = p.body.translation(), v = p.body.linvel();
    if (this.onSoldierDown) this.onSoldierDown(p, how, t, v);
    this.remove(p);
    // A dead Warden stops shoring, and every wall he was holding up becomes
    // breakable in the same instant. Rebuilding the list here is what makes
    // that the player's decision rather than a shared cache going stale.
    if (p.shore) this.refreshWardens();
    const i = this.soldiers.indexOf(p);
    if (i >= 0) this.soldiers.splice(i, 1);
  }

  _bannerDown(p, how) {
    if (p.up0 === 0) return;
    p.up0 = 0;
    if (this.onBannerDown) this.onBannerDown(p, how);
  }

  // ---- settle -------------------------------------------------------------

  // Settle asks "is the FORTRESS still?", never "has the knight stopped
  // rolling?". The knight has no linear damping (so the trajectory preview
  // stays truthful) and will roll across the field for many seconds — waiting
  // on it made every shot, including one that hit nothing, take the full
  // seven-second cap before the player got control back.
  maxMotion() {
    let m = 0;
    for (const p of this.list) {
      if (p.fixed || p.dead || p.kind === 'debris' || p.kind === 'knight' ||
          p.kind === 'soldier' || p.kind === 'ragdoll') continue;
      const v = p.body.linvel(), w = p.body.angvel();
      m = Math.max(m, Math.hypot(v.x, v.y, v.z) + 0.22 * Math.hypot(w.x, w.y, w.z));
    }
    return m;
  }

  allAsleep() {
    for (const p of this.list) {
      if (p.fixed || p.dead || p.kind === 'debris' || p.kind === 'knight' ||
          p.kind === 'soldier' || p.kind === 'ragdoll') continue;
      if (!p.body.isSleeping()) return false;
    }
    return true;
  }
}

// ---- helpers --------------------------------------------------------------

function quatY(a) {
  return { x: 0, y: Math.sin(a / 2), z: 0, w: Math.cos(a / 2) };
}

// Dot of the body's local +Y with world +Y, straight from the quaternion.
function localUp(q) {
  return 1 - 2 * (q.x * q.x + q.z * q.z);
}

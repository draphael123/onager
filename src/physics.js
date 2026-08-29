// physics.js — Rapier wrapper.
//
// Everything the game knows about "is it standing / did it fall / did that hurt"
// comes from here. Three jobs:
//   1. build bodies with tuning that makes 3D box stacks stand still
//   2. turn contact forces into damage, and damage into debris
//   3. decide when a shot is OVER (settle detection) — without this the round
//      never ends, because 3D rubble jitters forever.

import * as RAPIER from '../vendor/rapier.es.js';
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
      hp: (opts.hp != null ? opts.hp : m.hp) * (opts.hpScale || 1),
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
      spawnX: x, spawnY: y, spawnZ: z,
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
    const r = 0.3, hh = 0.42;
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
      hp: m.hp, maxHp: m.hp, half: { x: r, y: hh, z: r },
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

      this.impacts.push({ x: at.x, y: at.y, z: at.z, mag, relV,
        mat: (a && a.kind !== 'knight' ? a.mat : (b ? b.mat : 'block')) });

      const bite = Math.min(1, (relV - IMPACT_V) / 6);
      const dmg = mag * DAMAGE_PER_FORCE * bite;
      const kn = (a && a.kind === 'knight') ? a : (b && b.kind === 'knight') ? b : null;
      if (a) this._hurt(a, dmg);
      if (b) this._hurt(b, dmg);

      // Splash. Knight strikes only, once per tick, radius scaled by speed.
      if (kn && relV > SPLASH_V && this._splashTick !== this.time) {
        this._splashTick = this.time;
        this._splash(at, dmg, 1.2 + relV * 0.045, kn);
      }

      // Punch-through. The solver stops the knight dead in the same tick it
      // shatters a block, so without this a knight that destroys a wall still
      // drops out of the hole it just made — or wedges in it. Restoring a
      // fraction of the PRE-impact velocity is what turns a hit into breaking
      // through.
      const other = kn === a ? b : a;
      if (kn && !kn.dead && other && other.dead) {
        kn.body.setLinvel({ x: kn.pvx * 0.72, y: kn.pvy * 0.72, z: kn.pvz * 0.72 }, true);
      }
    });

    this._checkBanners();
    this._checkSoldiers();
    this._cullDebris();
  }

  _splash(at, dmg, r, skip) {
    const r2 = r * r;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      if (p === skip || p.fixed || p.dead || p.kind === 'debris') continue;
      const t = p.body.translation();
      const dx = t.x - at.x, dy = t.y - at.y, dz = t.z - at.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > r2) continue;
      this._hurt(p, dmg * 0.8 * (1 - Math.sqrt(d2) / r));
    }
  }

  _hurt(p, dmg) {
    if (p.dead || p.fixed || p.kind === 'knight' || dmg <= 0) return;
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
      p.hp -= dmg;
      if (p.hp <= 0) this._soldierDown(p, 'struck');
      return;
    }
    p.hp -= dmg;
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
          p.kind === 'soldier') continue;
      const v = p.body.linvel(), w = p.body.angvel();
      m = Math.max(m, Math.hypot(v.x, v.y, v.z) + 0.22 * Math.hypot(w.x, w.y, w.z));
    }
    return m;
  }

  allAsleep() {
    for (const p of this.list) {
      if (p.fixed || p.dead || p.kind === 'debris' || p.kind === 'knight' ||
          p.kind === 'soldier') continue;
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

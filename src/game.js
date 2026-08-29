// game.js — state machine, camera, aiming, scoring.
//
// Runs headless: pass renderer = null and everything still steps, breaks and
// scores. That is what sim.js drives.

import * as THREE from '../vendor/three.module.js';
import { Physics } from './physics.js';
import { faceAt } from './fortress.js';
import { LEVELS, THEMES } from './levels.js';
import { SET } from './settings.js';

// Orbit radius is per LEVEL now: a small keep sat at 38 reads as a model on a
// table and every shot becomes a long blind lob.
export const ORBIT_R = 38;               // level 3's radius, kept for reference
export const LAUNCH_H = 3.2;
// Reference speeds, for the reference orbit radius of 38. Each level scales
// them by sqrt(orbitR / 38), because range goes with the SQUARE of speed: at
// the big castle's speeds a small level cannot reach anything close in, and the
// sentry standing in the open on level one — the easiest target in the game —
// had no firing solution at all between the 6 and 66 degree limits.
export const SPEED_MIN = 22, SPEED_MAX = 46;
export const SPEED_REF_R = 38;
export const ELEV_MIN = 6 * Math.PI / 180, ELEV_MAX = 66 * Math.PI / 180;
// Lateral aim. Originally the drag was strictly 2-DOF and the third axis was
// the orbit alone, because a 3D arc you cannot read makes lateral aim useless.
// The preview is a swept cast now and tells you exactly where the shot lands,
// so that reason is gone — and orbiting to a soldier's exact bearing to hit
// anything off the centre line was, in practice, miserable.
export const YAW_MAX = 24 * Math.PI / 180;
const CENTRE = new THREE.Vector3(0, 6, 0);
const KNIGHT_R = 0.56;
const SETTLE_SPEED = 0.42, SETTLE_HOLD = 0.5, SETTLE_MAX = 7.0;

export const S = { AIM: 'aim', FLIGHT: 'flight', SETTLE: 'settle', OVER: 'over' };

export class Game {
  constructor(renderer, sfx, opts = {}) {
    this.rd = renderer || null;
    this.sfx = sfx || null;
    this.levelIdx = Math.max(0, Math.min(LEVELS.length - 1, opts.level || 0));
    this.knightOverride = opts.knights || 0;
    this.reset();
  }

  setLevel(i) {
    this.levelIdx = Math.max(0, Math.min(LEVELS.length - 1, i));
    this.reset();
  }

  reset() {
    if (this.rd) {
      // dropPart, not scene.remove — target markers live outside `meshes` and
      // leak a handful of sprites per restart otherwise.
      for (const p of [...this.rd.meshes.keys()]) this.rd.dropPart(p);
      this.rd.meshes.clear();
      if (this.knightMesh) { this.rd.scene.remove(this.knightMesh); this.knightMesh = null; }
      this.rd.hideArc();
    }
    const L = LEVELS[this.levelIdx];
    this.level = L;
    this.faces = L.faces;
    this.orbitR = L.orbitR;
    const k = Math.sqrt(this.orbitR / SPEED_REF_R);
    this.speedMin = SPEED_MIN * k;
    this.speedMax = SPEED_MAX * k;
    this.knightsTotal = this.knightOverride || L.knights;
    this.phys = new Physics();
    const b = L.build(this.phys);
    this.banners = b.banners;
    this.bannersDown = 0;
    this.soldiers = b.soldiers;
    this.soldiersTotal = b.soldiers.length;
    this.soldiersDown = 0;
    this.phys.onBannerDown = (p, how) => this._bannerDown(p, how);
    this.phys.onSoldierDown = (p, how, t, v) => this._soldierDown(p, how, t, v);

    this.knights = this.knightsTotal;
    this.knight = null;
    this.state = S.AIM;
    this.angle = 0;                // orbit angle: 0 = north, +PI/2 = east
    this.elev = 34 * Math.PI / 180;
    this.yaw = 0;
    // Power persists between shots: you set it once for a face and then aim.
    if (this.power == null) this.power = 0.8;
    this.dragging = false;
    this.dived = false;
    this.score = 0;
    this.broken = 0;
    this.settleT = 0;
    this.shotT = 0;
    this.hitstop = 0;
    this.won = false;
    this.result = null;
    this.acc = 0;
    this.msg = '';

    // One step before anything reads the world. Rapier builds its query
    // pipeline during step(), so on a freshly built level castShape returns
    // null for everything and the trajectory preview comes up blank until the
    // first frame has run.
    this.phys.step();
    this.phys.impacts.length = 0;
    this.phys.breaks.length = 0;

    if (this.rd) {
      this.rd.orbitR = this.orbitR;
      this.rd.buildEnvironment(THEMES[L.theme]);
      for (const p of this.phys.list) this.rd.addPart(p);
      // Hook AFTER the initial build, so these only fire during play.
      this.phys.onAdd = (p) => this.rd.addPart(p);
      this.phys.onRemove = (p) => this.rd.dropPart(p);
      this._placeCameraInstant();
    }
    this._lastFace = null;
  }

  // ---- geometry -----------------------------------------------------------

  launchPos() {
    const R = this.orbitR;
    return new THREE.Vector3(Math.sin(this.angle) * R, 0, -Math.cos(this.angle) * R);
  }

  // The radial direction: where the machine SITS on the ring, used for camera
  // framing. Not necessarily where it is pointing.
  forward() {
    return new THREE.Vector3(-Math.sin(this.angle), 0, Math.cos(this.angle));
  }

  // Where it is actually pointing, once the lateral trim is applied.
  aimDir() {
    const a = this.angle + this.yaw;
    return new THREE.Vector3(-Math.sin(a), 0, Math.cos(a));
  }

  muzzle() {
    return this.launchPos().addScaledVector(this.aimDir(), 0.9).setY(LAUNCH_H);
  }

  velocity() {
    const f = this.aimDir();
    const speed = this.speedMin + (this.speedMax - this.speedMin) * this.power;
    return new THREE.Vector3(
      f.x * Math.cos(this.elev), Math.sin(this.elev), f.z * Math.cos(this.elev)
    ).multiplyScalar(speed);
  }

  face() { return faceAt(this.angle, this.faces); }

  // ---- aiming -------------------------------------------------------------

  orbit(d) {
    if (this.state !== S.AIM) return;
    this.angle += d;
    const f = this.face();
    if (this.sfx && this._lastFace !== f.name) this.sfx.tick();
    this._lastFace = f.name;
  }

  // The drag is now pure AIM, and the two axes are independent: sideways swings
  // the machine, down raises the arm. Power came off the drag because three
  // values cannot come out of two axes without one of them fighting the others
  // — and range is the thing you set once per face and then leave alone.
  setDrag(dx, dy) {
    this.yaw = clamp(dx / 300, -1, 1) * YAW_MAX;
    this.elev = ELEV_MIN + (ELEV_MAX - ELEV_MIN) * clamp(dy / 280, 0, 1);
  }

  addPower(d) {
    this.power = clamp(this.power + d, 0, 1);
    return this.power;
  }

  // Ballistic preview, swept properly.
  //
  // The knight has zero linear damping, so the parabola is exactly the path it
  // flies. Finding where that path FIRST meets the castle is the other half,
  // and point-sampling could not do it: at 40 m/s a 0.075s step is three
  // metres, so the old preview skipped clean through a one-block curtain wall
  // and reported the landing spot up to three metres late.
  //
  // Each segment is now a swept ball cast of the knight's actual radius, which
  // is exact — it cannot miss thin geometry, and it hands back the surface
  // normal so the marker can lie ON the wall it hits instead of flat inside it.
  arc(maxPts = 64) {
    const p = this.muzzle(), v = this.velocity();
    const g = this.phys.world.gravity.y;
    const w = this.phys.world, R = this.phys.R;
    const dt = 0.045;
    const pts = [];
    let hit = null;
    let x = p.x, y = p.y, z = p.z, vx = v.x, vy = v.y, vz = v.z;
    if (!this._probeBall) this._probeBall = new R.Ball(KNIGHT_R);
    const IDQ = { x: 0, y: 0, z: 0, w: 1 };

    for (let i = 0; i < maxPts; i++) {
      const nx = x + vx * dt, ny = y + vy * dt + 0.5 * g * dt * dt, nz = z + vz * dt;
      const seg = { x: nx - x, y: ny - y, z: nz - z };
      let h = null;
      if (w.castShape) {
        try {
          h = w.castShape({ x, y, z }, IDQ, seg, this._probeBall, 0, 1, true);
        } catch (e) { h = null; }
      }
      if (h) {
        const t = h.time_of_impact != null ? h.time_of_impact : (h.toi || 0);
        const cx = x + seg.x * t, cy = y + seg.y * t, cz = z + seg.z * t;
        const n = h.normal1 || { x: 0, y: 1, z: 0 };
        // castShape hands back a Collider OBJECT; the parts map is keyed by
        // handle. Without this every predicted hit reported as bare ground and
        // the marker never turned red on a soldier.
        const ch = h.collider && h.collider.handle != null ? h.collider.handle : h.collider;
        const part = this.phys.parts.get(ch);
        pts.push(new THREE.Vector3(cx, cy, cz));
        hit = { x: cx, y: cy, z: cz, nx: n.x, ny: n.y, nz: n.z,
          kind: part ? part.kind : 'ground', post: part ? part.post : '' };
        break;
      }
      x = nx; y = ny; z = nz; vy += g * dt;
      pts.push(new THREE.Vector3(x, y, z));
      if (y < -6) break;
    }
    return { pts, hit };
  }

  // ---- firing -------------------------------------------------------------

  fire() {
    if (this.state !== S.AIM || this.knights <= 0) return false;
    const m = this.muzzle(), v = this.velocity();
    this.knight = this.phys.addBall(m.x, m.y, m.z, KNIGHT_R, { kind: 'knight' });
    this.knight.body.setLinvel({ x: v.x, y: v.y, z: v.z }, true);
    this.knight.body.setAngvel({ x: -v.z * 0.35, y: 0, z: v.x * 0.35 }, true);
    this.knights--;
    this.state = S.FLIGHT;
    this.dived = false;
    this.shotT = 0;
    this.settleT = 0;
    this.breaksThisShot = 0;
    this.killsThisShot = 0;
    this.knightLimp = false;
    if (this.rd) {
      if (!this.knightMesh) this.knightMesh = this.rd.knightMesh();
      this.knightMesh.visible = true;
      this.rd.hideArc();
      this.rd.armAngle = 1.6;
      this.rd.kick(0.16);
      this.rd.puff(m.x, m.y - 1, m.z, 1.2, 7);
    }
    if (this.sfx) { this.sfx.launch(); this.sfx.whoosh(v.length()); }
    return true;
  }

  // The second tap. One per shot: trade your arc for a steep, fast drop.
  dive() {
    if (this.state !== S.FLIGHT || this.dived || !this.knight) return false;
    this.dived = true;
    const v = this.knight.body.linvel();
    this.knight.body.setLinvel({ x: v.x * 0.72, y: Math.min(v.y, 0) - 26, z: v.z * 0.72 }, true);
    this.knight.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    if (this.sfx) this.sfx.dive();
    if (this.rd) {
      const t = this.knight.body.translation();
      this.rd.spark(t.x, t.y, t.z, 0.7, 9);
      this.rd.kick(0.1);
    }
    return true;
  }

  // ---- simulation ---------------------------------------------------------

  step(dt) {
    if (this.hitstop > 0) { this.hitstop -= dt; return; }
    this.acc += Math.min(dt, 0.1);
    const h = this.phys.world.timestep;
    let n = 0;
    while (this.acc >= h && n < 6) { this._tick(); this.acc -= h; n++; }
  }

  _tick() {
    this.phys.step();
    if (this.state === S.FLIGHT || this.state === S.SETTLE) this.shotT += this.phys.world.timestep;
    this._drain();

    if (this.state === S.FLIGHT && this.knight) {
      const t = this.knight.body.translation();
      const v = this.knight.body.linvel();
      const slow = Math.hypot(v.x, v.y, v.z) < 5.5;
      const grounded = t.y < KNIGHT_R + 0.35;
      if ((slow && grounded) || this.shotT > 3.4 || t.y < -18 ||
          Math.hypot(t.x, t.z) > 140) {
        this.state = S.SETTLE;
        this.settleT = 0;
      }
    }

    if (this.state === S.SETTLE) {
      const still = this.phys.maxMotion() < SETTLE_SPEED || this.phys.allAsleep();
      this.settleT = still ? this.settleT + this.phys.world.timestep : 0;
      if (this.settleT > SETTLE_HOLD || this.shotT > SETTLE_MAX) this._endShot();
    }
  }

  _drain() {
    const P = this.phys;
    if (P.impacts.length) {
      for (const im of P.impacts) {
        const s = Math.min(1.4, im.mag / 5200);
        if (this.rd) {
          this.rd.puff(im.x, im.y, im.z, 0.5 + s, 2 + (s * 5 | 0));
          if (s > 0.55) this.rd.spark(im.x, im.y, im.z, 0.5 + s * 0.6, 3 + (s * 5 | 0));
          this.rd.kick(Math.min(0.5, s * 0.34));
        }
        if (this.sfx) (im.mat === 'timber' ? this.sfx.wood(s) : this.sfx.stone(s));
        // Hitstop on a genuinely big hit — it sells the mass of the knight.
        if (s > 0.95) this.hitstop = Math.max(this.hitstop, 0.055);
        // The knight goes limp the moment he arrives. The ball keeps doing the
        // physics (it is what punches through and carries the damage); the rig
        // is swapped for a ragdoll so what you SEE is a man hitting a wall.
        if (!this.knightLimp && this.knight && im.relV > 13) {
          this.knightLimp = true;
          const kv = this.knight.body.linvel();
          const kt = this.knight.body.translation();
          this.phys.spawnRagdoll(kt.x, kt.y, kt.z, kv, { tint: 'friend' });
          if (this.knightMesh) this.knightMesh.visible = false;
        }
      }
      P.impacts.length = 0;
    }
    if (P.breaks.length) {
      for (const b of P.breaks) {
        if (b.kind === 'debris') continue;
        this.broken++;
        this.breaksThisShot = (this.breaksThisShot || 0) + 1;
        this.score += 8;
        if (this.rd) {
          this.rd.puff(b.x, b.y, b.z, 1.3, 8);
          this.rd.spark(b.x, b.y, b.z, 0.8, 5);
        }
      }
      if (this.sfx && P.breaks.length > 2) this.sfx.rubble(P.breaks.length);
      P.breaks.length = 0;
    }
  }

  // Soldiers are the objective. Two ways down, and the game says which — being
  // hit is satisfying, but being CRUSHED is the one the genre is built on, so it
  // gets its own callout.
  _soldierDown(p, how, t, v) {
    this.soldiersDown++;
    this.killsThisShot = (this.killsThisShot || 0) + 1;
    const crushed = how !== 'struck';
    this.score += 500 + (crushed ? 150 : 0);
    if (this.rd) this.rd.popSoldier(t.x, t.y, t.z, v);
    this.phys.spawnRagdoll(t.x, t.y, t.z, v, { tint: 'foe' });
    if (this.sfx) this.sfx.soldierDown(this.killsThisShot, crushed);
    // A multi-kill is the best thing that can happen; say so.
    if (this.killsThisShot >= 2) {
      this.msg = `${this.killsThisShot} AT ONCE`;
      this.score += 250 * (this.killsThisShot - 1);
      if (this.rd) this.rd.kick(0.3);
    } else {
      this.msg = crushed ? 'Crushed under the rubble.' : 'Ridden down.';
    }
    // Hitstop scaled to the moment — a knockout should stop the world briefly.
    this.hitstop = Math.max(this.hitstop, this.killsThisShot >= 2 ? 0.12 : 0.075);
  }

  _bannerDown(p, how) {
    this.bannersDown++;
    this.score += 250;                     // bonus, not the objective
    if (this.sfx) this.sfx.bannerDown(this.bannersDown - 1);
    if (this.rd) {
      this.rd.markBannerDown(p);
      const t = p.body.translation();
      this.rd.spark(t.x, t.y, t.z, 1.2, 14);
      this.rd.kick(0.32);
    }
    if (!this.killsThisShot) {
      this.msg = { gate: 'The gate arch is down.', court: 'The courtyard standard falls.',
        keep: 'The keep loses its colours.' }[p.tag] || 'A standard falls.';
    }
  }

  _endShot() {
    if (this.knight) {
      this.phys.remove(this.knight);
      this.knight = null;
      if (this.knightMesh) this.knightMesh.visible = false;
    }
    if (this.soldiersDown >= this.soldiersTotal) {
      this.won = true;
      this.score += this.knights * 300;
      this.result = { win: true, score: this.score, knightsLeft: this.knights,
        broken: this.broken, standards: this.bannersDown };
      this.state = S.OVER;
      if (this.sfx) this.sfx.cleared();
    } else if (this.knights <= 0) {
      this.result = { win: false, score: this.score, knightsLeft: 0, broken: this.broken,
        standing: this.soldiersTotal - this.soldiersDown, standards: this.bannersDown };
      this.state = S.OVER;
      if (this.sfx) this.sfx.failed();
    } else {
      this.state = S.AIM;
    }
  }

  // ---- camera -------------------------------------------------------------

  // Over-the-shoulder, offset to one side: the machine sits in the bottom of
  // frame and the arc reads across the picture instead of straight up the
  // middle. Same framing logic as the 2D original's slingshot in the corner.
  // Over-the-shoulder, offset to one side: the machine sits in the bottom of
  // frame and the arc reads across the picture instead of straight up the
  // middle. Pull-back scales with the castle so a small keep still fills it.
  _aimCam() {
    const L = this.launchPos(), f = this.forward();
    const r = new THREE.Vector3(-f.z, 0, f.x);
    const back = 6 + this.orbitR * 0.105;
    const look = 4.2 + this.orbitR * 0.078;
    return {
      pos: new THREE.Vector3(L.x - f.x * back + r.x * 3.2, 3.4 + this.orbitR * 0.11,
        L.z - f.z * back + r.z * 3.2),
      look: CENTRE.clone().setY(look),
    };
  }

  _surveyCam() {
    const L = this.launchPos(), f = this.forward();
    return {
      pos: new THREE.Vector3(L.x - f.x * 6, 8 + this.orbitR * 0.21, L.z - f.z * 6),
      look: CENTRE.clone().setY(3.6 + this.orbitR * 0.064),
    };
  }

  updateCamera(dt) {
    if (!this.rd) return;
    const cam = this.rd.camera;
    let target;
    if (this.state === S.FLIGHT && this.knight) {
      const t = this.knight.body.translation();
      const v = this.knight.body.linvel();
      const d = new THREE.Vector3(v.x, 0, v.z);
      if (d.lengthSq() < 0.01) d.copy(this.forward());
      d.normalize();
      target = {
        pos: new THREE.Vector3(t.x - d.x * 15, Math.max(5.5, t.y + 6.5), t.z - d.z * 15),
        look: new THREE.Vector3(t.x + d.x * 5, t.y + 1, t.z + d.z * 5),
      };
    } else if (this.state === S.SETTLE || this.state === S.OVER) {
      target = this._surveyCam();
    } else {
      target = this._aimCam();
    }
    const k = 1 - Math.pow(0.0009, dt);
    cam.position.lerp(target.pos, k);
    if (!this._look) this._look = target.look.clone();
    this._look.lerp(target.look, k);
    cam.lookAt(this._look);
    this.rd.applyShake(dt);
  }

  // Slow orbit for the title screen. The fortress sells the game better than
  // any splash art, so the menu just watches it.
  cinematicCam(t, dt) {
    if (!this.rd) return;
    const a = t * 0.085;
    const cam = this.rd.camera;
    const r = this.orbitR * 1.36 + Math.sin(t * 0.21) * 5;
    cam.position.set(Math.sin(a) * r, 8 + this.orbitR * 0.22 + Math.sin(t * 0.13) * 3.5,
      -Math.cos(a) * r);
    const look = CENTRE.clone().setY(3.4 + this.orbitR * 0.08);
    if (!this._look) this._look = look.clone();
    this._look.lerp(look, 1 - Math.pow(0.02, dt));
    cam.lookAt(this._look);
    this.rd.setSunFrom(a);
    this.rd.syncAll(this.phys);
    this.rd.stepFX(dt);
    this.rd.hideArc();
  }

  _placeCameraInstant() {
    const t = this._aimCam();
    this.rd.camera.position.copy(t.pos);
    this._look = t.look.clone();
    this.rd.camera.lookAt(this._look);
  }

  // ---- per-frame render sync ---------------------------------------------

  render(dt) {
    if (!this.rd) return;
    const rd = this.rd;
    rd.syncAll(this.phys);
    rd.setSunFrom(this.angle);

    // Launcher pose.
    const L = this.launchPos();
    rd.onager.position.copy(L);
    rd.onager.rotation.y = this.angle + Math.PI / 2;
    if (rd.machine) rd.machine.rotation.y = -this.yaw;
    rd.setWaiting(this.knights);
    const rest = -0.5 - this.power * 0.85;
    const want = this.state === S.AIM ? rest : rd.armAngle;
    rd.armAngle += (want - rd.armAngle) * (1 - Math.pow(0.02, dt));
    rd.arm.rotation.x = rd.armAngle;

    // Knight.
    if (this.knight && this.knightMesh) {
      const t = this.knight.body.translation(), q = this.knight.body.rotation();
      this.knightMesh.position.set(t.x, t.y, t.z);
      this.knightMesh.quaternion.set(q.x, q.y, q.z, q.w);
    }

    // Trajectory.
    if (this.state === S.AIM && this.knights > 0 && SET.showArc) {
      const a = this.arc();
      rd.showArc(a.pts, a.hit);
    } else rd.hideArc();

    rd.stepFX(dt);
    this.updateCamera(dt);
  }

  // ---- ballistic solver ---------------------------------------------------
  //
  // Given a world point, return the orbit angle and elevation that put a shot
  // through it at the given power. Used by the bot so balance is measured
  // against something that can actually AIM — a fixed shot list measures the
  // plan, not the level.
  //
  // Shots travel radially, so the orbit angle is just the target's bearing from
  // the centre. Elevation is the standard two-root ballistic solution; `high`
  // picks the lobbed arc over the flat one.
  solve(tx, ty, tz, power, high = false) {
    const R = Math.hypot(tx, tz);
    if (R < 0.4) return null;                     // dead centre has no bearing
    const angle = Math.atan2(tx, -tz);
    const speed = this.speedMin + (this.speedMax - this.speedMin) * clamp(power, 0, 1);
    const d = this.orbitR - R - 0.9;                  // muzzle sits 0.9 in from the ring
    if (d <= 1) return null;
    const g = -this.phys.world.gravity.y;
    const dy = ty - LAUNCH_H;
    const disc = speed ** 4 - g * (g * d * d + 2 * dy * speed * speed);
    if (disc < 0) return null;                    // out of range at this power
    const root = Math.sqrt(disc);
    const tan = ((speed * speed) + (high ? root : -root)) / (g * d);
    const elev = Math.atan(tan);
    if (elev < ELEV_MIN - 0.02 || elev > ELEV_MAX + 0.02) return null;
    return { angle, elev, elevDeg: elev * 180 / Math.PI, power };
  }

  // The lateral trim needed to point at a world point FROM WHERE THE MACHINE
  // STANDS. Not the target's bearing from the castle centre — the launcher sits
  // 20-38m off centre, so those two differ by several degrees and using the
  // wrong one overshoots by metres.
  yawTo(tx, tz) {
    const L = this.launchPos();
    const dx = tx - L.x, dz = tz - L.z;
    const want = Math.atan2(-dx, dz);      // inverse of aimDir()
    return Math.atan2(Math.sin(want - this.angle), Math.cos(want - this.angle));
  }

  // Aim at a live soldier, searching the whole power range. A coarse list of
  // six powers missed shots that exist — the level looked unwinnable when it
  // was the search that was too thin.
  solveSoldier(sol, high = false) {
    const t = sol.body.translation();
    for (let i = 0; i <= 20; i++) {
      const p = 0.2 + (i / 20) * 0.8;
      const s = this.solve(t.x, t.y, t.z, p, high);
      if (s) return s;
    }
    return null;
  }

  // ---- headless helpers ---------------------------------------------------

  shoot(angle, elevDeg, power) {
    this.angle = angle;
    this.yaw = 0;                     // the solver aims radially
    this.elev = elevDeg * Math.PI / 180;
    this.power = clamp(power, 0, 1);
    return this.fire();
  }

  // Run until the shot resolves (or a cap). Returns seconds simulated.
  settleOut(maxSec = 12) {
    const h = this.phys.world.timestep;
    let t = 0;
    while ((this.state === S.FLIGHT || this.state === S.SETTLE) && t < maxSec) {
      this._tick(); t += h;
    }
    return t;
  }

  snapshot() {
    return {
      state: this.state, knights: this.knights,
      soldiers: this.soldiersTotal - this.soldiersDown, soldiersDown: this.soldiersDown,
      bannersDown: this.bannersDown,
      banners: this.banners.map(b => ({ tag: b.tag, down: b.up0 === 0 })),
      broken: this.broken, score: this.score, won: this.won,
      bodies: this.phys.list.length, face: this.face().name,
    };
  }
}

function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
export { clamp };

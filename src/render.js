// render.js — scene, materials, models, FX.

import * as THREE from '../vendor/three.module.js';
import { activeQuality, SET } from './settings.js';
import { THEMES } from './levels.js';

const UNIT = new THREE.BoxGeometry(1, 1, 1);

// One per knight in the company. Distinct enough to tell apart in a row at the
// bottom of the screen, and all clearly OURS against the garrison's hot red.
export const KNIGHT_PALETTES = [
  { cloth: 0x2f5f8c, plume: 0xe8e2d2, trim: 0xd6b45e, device: 'bar' },
  { cloth: 0x2b6b52, plume: 0xe0b25c, trim: 0xd8d2c2, device: 'cross' },
  { cloth: 0x54407e, plume: 0xd9a13c, trim: 0xd6b45e, device: 'bar' },
  { cloth: 0x1f4f6b, plume: 0xc4622c, trim: 0xb9c0c8, device: 'cross' },
  { cloth: 0x7a3f5c, plume: 0xe8dcc4, trim: 0xd6b45e, device: 'bar' },
  { cloth: 0x3d5f2f, plume: 0xd8d2c2, trim: 0xc9a94e, device: 'cross' },
  { cloth: 0x2d4f7a, plume: 0xc8443a, trim: 0xd8d2c2, device: 'bar' },
  { cloth: 0x6b4a2a, plume: 0x8fb4d6, trim: 0xd6b45e, device: 'cross' },
  { cloth: 0x3f3f5e, plume: 0xe0b25c, trim: 0xb9c0c8, device: 'bar' },
  { cloth: 0x1f6b6b, plume: 0xe8e2d2, trim: 0xd6b45e, device: 'cross' },
  { cloth: 0x8a4a2a, plume: 0xd8d2c2, trim: 0xc9a94e, device: 'bar' },
  { cloth: 0x4a3b6b, plume: 0xc4622c, trim: 0xd6b45e, device: 'cross' },
];

// Warm low sun, cool shadow. Everything else is derived from these two.
const SUN = 0xffe6bd, SKY_HI = 0x6f8fc4, SKY_LO = 0xd9c0a2, GROUND = 0x6f7a4e;

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    const q = activeQuality();
    this.q = q;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: q.pixelRatio > 1.2,
      powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, q.pixelRatio));
    this.renderer.shadowMap.enabled = SET.shadows;
    this.renderer.shadowMap.type = q.softShadows ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0xcbd4dc, 150, 520);   // was 78/260 — it greyed the fortress out

    this.camera = new THREE.PerspectiveCamera(44, 1, 0.4, 900);
    this.camera.position.set(0, 22, 52);

    this._lights();
    this.orbitR = 38;                 // replaced per level by buildEnvironment

    this.mats = null;                 // built per level, once the theme is known
    this.meshes = new Map();       // part -> mesh
    this.shake = 0;
    this.shakeV = new THREE.Vector3();

    this._fxPools();
    this._onager();
    this._aimLine();

    addEventListener('resize', () => this.resize());
    this.resize();
  }

  // Horizontal-plus. The framing is tuned for a wide window; on a narrow or
  // portrait one a fixed vertical FOV crops the fortress down to a wall of
  // masonry with no silhouette left to read. Holding the HORIZONTAL angle
  // constant and letting the vertical open up keeps the whole castle in shot at
  // any aspect.
  // Scatter density is live-adjustable rather than build-time, so changing
  // quality in the settings panel does not need a reload.
  // Trims each instanced pool from the FAR end, because the lists were sorted
  // nearest-first: lowering quality thins the horizon rather than punching
  // holes in the middle of the view.
  setScatterDensity(n) {
    if (!this.scatterPools) return;
    const f = Math.max(0.2, Math.min(1, n / 150));
    for (const p of this.scatterPools) p.im.count = Math.max(1, Math.round(p.total * f));
  }

  resize() {
    const w = innerWidth, h = innerHeight;
    this.renderer.setSize(w, h, false);
    const aspect = w / h;
    this.camera.aspect = aspect;
    const BASE_ASPECT = 16 / 9, BASE_FOV = 44;
    if (aspect < BASE_ASPECT) {
      const hTan = Math.tan((BASE_FOV * Math.PI / 180) / 2) * BASE_ASPECT;
      const fov = 2 * Math.atan(hTan / aspect) * 180 / Math.PI;
      this.camera.fov = Math.min(80, fov);
    } else {
      this.camera.fov = BASE_FOV;
    }
    this.camera.updateProjectionMatrix();
  }

  // ---- world dressing -----------------------------------------------------
  //
  // Everything environmental lives in envGroup and is rebuilt per level from a
  // theme. Three castles of the same grey blocks on the same green field is the
  // definition of drab; the cheapest way to make a small keep feel like a
  // different place is to change the weather and what grows around it.

  _lights() {
    this.hemi = new THREE.HemisphereLight(0xa9c6ea, 0x77874f, 0.78);
    this.scene.add(this.hemi);

    const sun = new THREE.DirectionalLight(0xfff0cf, 3.9);
    sun.position.set(-46, 58, 40);
    sun.castShadow = SET.shadows;
    sun.shadow.mapSize.set(this.q.shadowMap, this.q.shadowMap);
    sun.shadow.radius = 2.2;
    const c = sun.shadow.camera;
    c.left = -30; c.right = 30; c.top = 30; c.bottom = -30; c.near = 10; c.far = 210;
    sun.shadow.bias = -0.0008;
    sun.shadow.normalBias = 0.028;
    this.scene.add(sun);
    this.sun = sun;

    // A dim cool fill from the opposite side keeps shadowed faces readable
    // instead of going to mud.
    const fill = new THREE.DirectionalLight(0x8fa8d8, 0.34);
    fill.position.set(40, 20, -36);
    this.scene.add(fill);
    this.fill = fill;
  }

  // The player orbits 360 degrees, so any FIXED sun spends a quarter of the
  // circle backlighting the exact face they are aiming at. The key light rides
  // the orbit instead. Offset from the attack line, but not by much: 1.35rad
  // put the whole attacked face in shadow and the castle rendered near black
  // while the field around it was lit.
  setSunFrom(angle) {
    const th = this.theme || {};
    const a = angle + (th.rake || 0.9);
    const d = 86;
    this.sun.position.set(Math.sin(a) * d, th.sunHeight || 58, -Math.cos(a) * d);
    this.sun.target.position.set(0, 4, 0);
    this.sun.target.updateMatrixWorld();
    this.fill.position.set(-Math.sin(a) * 60, 30, Math.cos(a) * 60);
  }

  // Metals (helm, lance, the machine's ironwork) render near black with no
  // environment. A tiny procedural sky is enough.
  _envMap(theme) {
    if (this._pmremTex) this._pmremTex.dispose();
    const cv = document.createElement('canvas');
    cv.width = 32; cv.height = 128;
    const g = cv.getContext('2d');
    const grd = g.createLinearGradient(0, 0, 0, 128);
    for (const [t, col] of theme.sky) grd.addColorStop(t, col);
    g.fillStyle = grd; g.fillRect(0, 0, 32, 128);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;             // unflagged renders washed
    tex.mapping = THREE.EquirectangularReflectionMapping;
    const pm = new THREE.PMREMGenerator(this.renderer);
    this._pmremTex = pm.fromEquirectangular(tex).texture;
    this.scene.environment = this._pmremTex;
    pm.dispose(); tex.dispose();
  }

  _clearEnv() {
    if (!this.envGroup) { this.envGroup = new THREE.Group(); this.scene.add(this.envGroup); return; }
    this.envGroup.traverse(o => {
      if (o.isMesh || o.isSprite) {
        if (o.geometry) o.geometry.dispose();
        const m = o.material;
        if (Array.isArray(m)) m.forEach(x => x.dispose()); else if (m) m.dispose();
      }
    });
    this.envGroup.clear();
    this.scatterPools = [];
    this.windmill = null;
  }

  buildEnvironment(theme) {
    this.theme = theme;
    this._clearEnv();
    this.scatter = [];
    this.birds = [];

    this.renderer.toneMappingExposure = theme.exposure;
    this.scene.fog = new THREE.Fog(theme.fogColour, theme.fogNear, theme.fogFar);
    this.hemi.color.setHex(theme.hemiSky);
    this.hemi.groundColor.setHex(theme.hemiGround);
    this.hemi.intensity = theme.hemiPower;
    this.sun.color.setHex(theme.sunColour);
    this.sun.intensity = theme.sunPower;
    this.fill.intensity = theme.fillPower != null ? theme.fillPower : 0.34;
    this.fill.color.setHex(theme.hemiSky);

    this.mats = this._materials();    // block colours follow the theme's plinth
    this._envMap(theme);
    this._sky(theme);
    this._terrain(theme);
    this._scenery(theme);
    this.setScatterDensity(this.q.scatter);
  }

  _sky(theme) {
    const cv = document.createElement('canvas');
    cv.width = 8; cv.height = 256;
    const g = cv.getContext('2d');
    const grd = g.createLinearGradient(0, 0, 0, 256);
    for (const [t, col] of theme.sky) grd.addColorStop(t, col);
    g.fillStyle = grd; g.fillRect(0, 0, 8, 256);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(460, 32, 24),
      new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, depthWrite: false, fog: false }));
    dome.renderOrder = -100;
    this.envGroup.add(dome);

    // A hard disc inside the glow: a bare gradient reads as haze, not a sun.
    const sd = 1 - (theme.sunHeight / 90);
    const disc = new THREE.Mesh(new THREE.CircleGeometry(9 + sd * 5, 28),
      new THREE.MeshBasicMaterial({ color: theme.sunColour, fog: false,
        transparent: true, opacity: 0.95 }));
    disc.position.set(-250, 140 + theme.sunHeight * 2.6, 220);
    disc.lookAt(0, 0, 0);
    disc.renderOrder = -99;
    this.envGroup.add(disc);
    // A low sun sits near the horizon where the HUD text lives, and at the old
    // size and opacity the glow washed out the whole top of the frame.
    const glowSize = 90 + theme.sunHeight * 0.8;
    this.envGroup.add(sprite(radialTex('rgba(255,243,212,0.8)', 'rgba(255,216,154,0)'),
      glowSize, theme.sunColour, 0.42 + (theme.sunHeight / 90) * 0.22,
      disc.position.clone(), THREE.AdditiveBlending));

    const ct = radialTex('rgba(255,255,255,0.95)', 'rgba(255,255,255,0)');
    const NC = this.q.clouds;
    for (let i = 0; i < NC; i++) {
      const a = (i / NC) * Math.PI * 2 + Math.random();
      const r = 210 + Math.random() * 160;
      const s = sprite(ct, 90 + Math.random() * 110, theme.fogColour, 0.3,
        new THREE.Vector3(Math.cos(a) * r, 78 + Math.random() * 60, Math.sin(a) * r));
      s.material.depthWrite = false;
      this.envGroup.add(s);
    }
  }

  _terrain(theme) {
    const gt = groundTex(theme);
    gt.repeat.set(60, 60);
    const g = new THREE.Mesh(new THREE.CircleGeometry(400, 64).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: theme.ground, roughness: 0.99, metalness: 0, map: gt }));
    g.position.y = 0.001;
    g.receiveShadow = true;
    this.envGroup.add(g);

    // Trampled ring where the camp orbits — it says the road is a circle before
    // you ever press A.
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(this.orbitR - 1.8, this.orbitR + 1.8, 96).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: theme.scorch, roughness: 1,
        transparent: true, opacity: 0.6 }));
    ring.position.y = 0.02;
    this.envGroup.add(ring);

    // Broad tonal patches, soft-edged. Hard circles read as blobs stamped on
    // the grass, which is worse than a flat field.
    const soft = radialTex('rgba(255,255,255,0.95)', 'rgba(255,255,255,0)');
    this._soft = soft;
    const pA = new THREE.MeshBasicMaterial({ color: theme.patchA, transparent: true,
      opacity: 0.42, map: soft, depthWrite: false });
    const pB = new THREE.MeshBasicMaterial({ color: theme.patchB, transparent: true,
      opacity: 0.38, map: soft, depthWrite: false });
    for (let i = 0; i < 26; i++) {
      const a = Math.random() * Math.PI * 2, r = this.orbitR + 6 + Math.random() * 160;
      const sz = 18 + Math.random() * 52;
      const m = new THREE.Mesh(new THREE.CircleGeometry(sz, 14).rotateX(-Math.PI / 2),
        i % 2 ? pA : pB);
      m.position.set(Math.cos(a) * r, 0.012 + i * 0.0004, Math.sin(a) * r);
      m.scale.set(1, 1, 0.55 + Math.random() * 0.8);
      m.rotation.y = Math.random() * 3;
      this.envGroup.add(m);
    }

    // Churned earth under the castle, and burn marks around it.
    const scorch = new THREE.Mesh(
      new THREE.CircleGeometry(this.orbitR * 0.78, 40).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: theme.scorch, transparent: true, opacity: 0.55,
        map: soft, depthWrite: false }));
    scorch.position.y = 0.014;
    this.envGroup.add(scorch);
    const burnMat = new THREE.MeshBasicMaterial({ color: 0x4a4232, transparent: true,
      opacity: 0.3, map: soft, depthWrite: false });
    for (let i = 0; i < 14; i++) {
      const a = Math.random() * Math.PI * 2, r = this.orbitR * 0.45 + Math.random() * this.orbitR * 0.45;
      const m = new THREE.Mesh(new THREE.CircleGeometry(1.6 + Math.random() * 3.2, 18)
        .rotateX(-Math.PI / 2), burnMat);
      m.position.set(Math.cos(a) * r, 0.022 + i * 0.0003, Math.sin(a) * r);
      m.scale.set(1, 1, 0.6 + Math.random() * 0.7);
      this.envGroup.add(m);
    }

    // Distant hills in three bands, each further one paler and bluer. Aerial
    // perspective is the cheapest depth cue there is; without it the ridge line
    // sits flat against the sky like a cardboard cutout.
    const bands = [
      { r: 150, h: [14, 30], col: theme.hills[0] },
      { r: 230, h: [26, 54], col: theme.hills[1] },
      { r: 330, h: [40, 82], col: theme.hills[2] },
    ];
    for (const b of bands) {
      const mat = new THREE.MeshStandardMaterial({ color: b.col, roughness: 1, flatShading: true });
      const n = Math.round(14 * this.q.hills);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + Math.random() * 0.35;
        const r = b.r + Math.random() * 60;
        const h = b.h[0] + Math.random() * (b.h[1] - b.h[0]);
        const m = new THREE.Mesh(
          new THREE.ConeGeometry(h * (0.85 + Math.random() * 0.9), h, 4 + ((Math.random() * 3) | 0)), mat);
        m.position.set(Math.cos(a) * r, h / 2 - 5, Math.sin(a) * r);
        m.rotation.y = Math.random() * 3;
        m.scale.set(1, 0.72 + Math.random() * 0.5, 1);
        this.envGroup.add(m);
      }
    }
  }

  // ---- scenery ------------------------------------------------------------
  //
  // INSTANCED. As individual meshes the countryside cost 800+ draw calls, which
  // is the whole budget on a phone and put a hard ceiling on how much of it
  // there could be. Everything scattered is now pushed as a matrix into a pool
  // keyed by (geometry, material) and drawn as a handful of InstancedMeshes, so
  // the scenery can be several times denser for a fraction of the cost.
  //
  // Landmarks — the windmill, the chapel, the jetty — stay as ordinary meshes.
  // There are only a few and they each want their own shape.

  _sceneryGeo() {
    if (this._sg) return this._sg;
    this._sg = {
      trunk: new THREE.CylinderGeometry(0.5, 1, 1, 6),
      canopy: new THREE.IcosahedronGeometry(1, 0),
      cone: new THREE.ConeGeometry(1, 1, 6),
      cone4: new THREE.ConeGeometry(1, 1, 4),
      rock: new THREE.DodecahedronGeometry(1, 0),
      box: new THREE.BoxGeometry(1, 1, 1),
      blob: new THREE.SphereGeometry(1, 6, 5),
      plate: new THREE.PlaneGeometry(1, 1),
    };
    return this._sg;
  }

  _scenery(theme) {
    const G = this._sceneryGeo();
    const R = () => Math.random();
    const M4 = new THREE.Matrix4(), Q = new THREE.Quaternion(),
      Pos = new THREE.Vector3(), Scl = new THREE.Vector3(), Eul = new THREE.Euler();

    const mat = (opts) => new THREE.MeshStandardMaterial({ roughness: 1, ...opts });
    const M = {
      trunk: mat({ color: theme.trunk }),
      rock: mat({ color: theme.rock, flatShading: true }),
      tuft: mat({ color: theme.tuft, flatShading: true }),
      wood: mat({ color: 0x6a4a2c, roughness: 0.95 }),
      hay: mat({ color: 0xc9a94e, flatShading: true }),
      stone: mat({ color: theme.rock }),
      pale: mat({ color: 0xd8d2c2 }),
      dark: mat({ color: 0x3a342c }),
      reed: mat({ color: 0x6c7a42, flatShading: true, side: THREE.DoubleSide }),
      water: new THREE.MeshStandardMaterial({ color: theme.water, roughness: 0.16,
        metalness: 0.4, transparent: true, opacity: 0.88 }),
    };
    M.canopy = theme.canopy.map(c => mat({ color: c, flatShading: true }));
    M.flower = theme.flowers.map(c => mat({ color: c }));

    // ---- instance pool ----
    const pool = new Map();
    const push = (geo, material, x, y, z, sx, sy, sz, rx = 0, ry = 0, rz = 0, shadow = true) => {
      const key = geo.uuid + '|' + material.uuid + '|' + (shadow ? 1 : 0);
      let e = pool.get(key);
      if (!e) { e = { geo, material, shadow, list: [] }; pool.set(key, e); }
      Eul.set(rx, ry, rz);
      Q.setFromEuler(Eul);
      Pos.set(x, y, z); Scl.set(sx, sy, sz);
      e.list.push({ m: new THREE.Matrix4().compose(Pos, Q, Scl), d: Math.hypot(x, z) });
    };

    // Somewhere on the field, and crucially OUTSIDE the camera's own ring. The
    // camera sits about 8m beyond the road, so anything spawned from orbitR+3
    // outward could land between it and the castle or directly on top of it —
    // a conifer filling a quarter of the frame. Big scenery starts at +16.
    const spot = (min = this.orbitR + 16, max = this.orbitR + 130) => {
      const a = R() * Math.PI * 2;
      const r = min + Math.pow(R(), 0.62) * (max - min);
      return [Math.cos(a) * r, Math.sin(a) * r];
    };
    const canopy = () => M.canopy[(R() * M.canopy.length) | 0];

    // ---- plant types ----

    const broadleaf = (x, z, s = 1) => {
      const h = (4.5 + R() * 4) * s, tr = 0.34 * s;
      push(G.trunk, M.trunk, x, h / 2, z, tr, h, tr);
      const c = canopy();
      // Three overlapping lumps, not one cone: a single cone is a Christmas
      // tree and every broadleaf in the game looked identical.
      for (let i = 0; i < 3; i++) {
        const rr = (1.5 + R() * 1.2) * s;
        push(G.canopy, c, x + (R() - 0.5) * 1.8 * s, h * (0.82 + R() * 0.32), z + (R() - 0.5) * 1.8 * s,
          rr, rr * (0.78 + R() * 0.4), rr, R() * 3, R() * 3, R() * 3);
      }
    };

    const conifer = (x, z, s = 1) => {
      const h = (6 + R() * 5) * s;
      push(G.trunk, M.trunk, x, h * 0.25, z, 0.3 * s, h * 0.5, 0.3 * s);
      const c = canopy();
      for (let i = 0; i < 3; i++) {
        const f = 1 - i * 0.26;
        push(G.cone, c, x, h * (0.32 + i * 0.24) + (h * 0.5 * f + 1) / 2, z,
          1.9 * f * s, h * 0.5 * f + 1, 1.9 * f * s, 0, R() * 3, 0);
      }
    };

    // Bare, forked and leaning. Does most of the work in the marsh.
    const dead = (x, z, s = 1) => {
      const h = (4 + R() * 4) * s;
      push(G.trunk, M.trunk, x, h / 2, z, 0.3 * s, h, 0.3 * s, 0, 0, (R() - 0.5) * 0.34);
      for (let i = 0; i < 3 + ((R() * 3) | 0); i++) {
        const bl = (1 + R() * 2) * s, a = R() * Math.PI * 2, lean = 0.5 + R() * 0.7;
        push(G.trunk, M.trunk, x + Math.cos(a) * bl * 0.3, h * (0.55 + R() * 0.4),
          z + Math.sin(a) * bl * 0.3, 0.1 * s, bl, 0.1 * s,
          Math.cos(a) * lean, 0, Math.sin(a) * -lean);
      }
    };

    const bush = (x, z, s = 1) => {
      const c = canopy();
      for (let i = 0; i < 2 + ((R() * 2) | 0); i++) {
        const rr = (0.5 + R() * 0.7) * s;
        push(G.canopy, c, x + (R() - 0.5) * 1.2, rr * 0.8, z + (R() - 0.5) * 1.2,
          rr, rr * 0.8, rr, R() * 3, R() * 3, R() * 3);
      }
    };

    const rock = (x, z, s = 1) => {
      const rr = (0.5 + R() * 1.6) * s;
      push(G.rock, M.rock, x, rr * 0.5, z, rr, rr * (0.6 + R() * 0.5), rr,
        R() * 3, R() * 3, R() * 3);
    };

    // A clump of three short leaning blades. One upright cone at 0.7-1.3m tall
    // reads as a traffic cone, not grass — the give-away is that it is taller
    // than it is wide and perfectly vertical.
    // Blades, not tents. At 0.3-0.56 radius and 0.7 tall these read as a field
    // of little pyramids; grass wants to be thin, short and numerous.
    const tuft = (x, z) => {
      const n = 3 + ((R() * 4) | 0);
      for (let k = 0; k < n; k++) {
        const rr = 0.11 + R() * 0.13, h = 0.28 + R() * 0.3;
        const a = R() * Math.PI * 2, lean = 0.2 + R() * 0.5;
        push(G.cone4, M.tuft,
          x + Math.cos(a) * 0.24, h * 0.5, z + Math.sin(a) * 0.24,
          rr, h, rr, Math.cos(a) * lean, R() * 3, Math.sin(a) * -lean, false);
      }
      // Flowers are tiny but they are the only saturated thing on the field and
      // the eye finds them immediately.
      if (R() < 0.5) {
        const fm = M.flower[(R() * M.flower.length) | 0];
        for (let i = 0; i < 2 + ((R() * 3) | 0); i++) {
          // A flower head at 0.09 is a golf ball lying in the grass at this
          // scale; it wants to be a speck of colour on a stem.
          const fx = x + (R() - 0.5) * 1.6, fz = z + (R() - 0.5) * 1.6;
          const fh = 0.3 + R() * 0.22;
          push(G.cone4, M.tuft, fx, fh * 0.5, fz, 0.02, fh, 0.02, 0, 0, 0, false);
          push(G.blob, fm, fx, fh, fz, 0.055, 0.045, 0.055, 0, 0, 0, false);
        }
      }
    };

    const reeds = (x, z, n = 5, spread = 2.2) => {
      for (let k = 0; k < n; k++) {
        push(G.plate, M.reed, x + (R() - 0.5) * spread, 0.62, z + (R() - 0.5) * spread,
          0.45, 1.2 + R(), 1, 0, R() * 3, 0, false);
      }
    };

    // ---- scatter: copses, not wallpaper ----
    const mix = theme.mix;
    const roll = () => {
      let r = R(), acc = 0;
      for (const k of Object.keys(mix)) { acc += mix[k]; if (r <= acc) return k; }
      return 'tuft';
    };
    const place = (x, z, s) => {
      switch (roll()) {
        case 'broadleaf': broadleaf(x, z, s); break;
        case 'conifer': conifer(x, z, s); break;
        case 'dead': dead(x, z, s); break;
        case 'bush': bush(x, z, s); break;
        case 'rock': rock(x, z, s); break;
        default: tuft(x, z);
      }
    };
    for (let c = 0; c < 40; c++) {
      const [cx, cz] = spot();
      const n = 3 + ((R() * 9) | 0);
      const spread = 4 + R() * 14;
      for (let i = 0; i < n; i++) {
        const f = i / n;                          // a crown in the middle
        place(cx + (R() - 0.5) * spread, cz + (R() - 0.5) * spread,
          (1.25 - f * 0.5) * (0.7 + R() * 0.6));
      }
    }
    for (let i = 0; i < 130; i++) {              // loners between the copses
      const [x, z] = spot();
      place(x, z, 0.65 + R() * 0.8);
    }
    // Grass and flowers are the exception: they are ankle height, so they can
    // carpet the ground the camera actually looks across without ever blocking
    // the castle. Inside the road and just outside it.
    for (let i = 0; i < 130; i++) {
      const a = R() * Math.PI * 2, r = this.orbitR - 14 + R() * 12;
      tuft(Math.cos(a) * r, Math.sin(a) * r);
    }
    for (let i = 0; i < 170; i++) {
      const a = R() * Math.PI * 2, r = this.orbitR + 2 + R() * 22;
      tuft(Math.cos(a) * r, Math.sin(a) * r);
    }
    // Low rocks in the same band — they read as ground detail, not obstacles.
    for (let i = 0; i < 26; i++) {
      const a = R() * Math.PI * 2, r = this.orbitR + 4 + R() * 18;
      rock(Math.cos(a) * r, Math.sin(a) * r, 0.42 + R() * 0.3);
    }

    // ---- set pieces ----
    const P = theme.props;

    for (let f = 0; f < P.fences; f++) {
      const [sx, sz] = spot(this.orbitR + 18, this.orbitR + 62);
      const dir = R() * Math.PI * 2, n = 6 + ((R() * 8) | 0);
      for (let i = 0; i < n; i++) {
        const bend = Math.sin(i * 0.5) * 0.5;
        const px = sx + Math.cos(dir + bend) * i * 2.4, pz = sz + Math.sin(dir + bend) * i * 2.4;
        push(G.box, M.wood, px, 0.72, pz, 0.16, 1.5, 0.16, 0, -(dir + bend), 0);
        if (i) {
          const qx = sx + Math.cos(dir + bend) * (i - 0.5) * 2.4;
          const qz = sz + Math.sin(dir + bend) * (i - 0.5) * 2.4;
          for (const h of [0.6, 1.15])
            push(G.box, M.wood, qx, h, qz, 2.45, 0.11, 0.09, 0, -(dir + bend), 0);
        }
      }
    }

    for (let i = 0; i < P.hay; i++) {
      const [x, z] = spot(this.orbitR + 17, this.orbitR + 56);
      for (let k = 0; k < 1 + ((R() * 4) | 0); k++) {
        const h = 1.6 + R() * 0.9;
        push(G.cone, M.hay, x + (R() - 0.5) * 3.4, h / 2, z + (R() - 0.5) * 3.4,
          0.85, h, 0.85, 0, R() * 3, 0);
      }
    }

    for (let i = 0; i < P.cart; i++) {
      const [x, z] = spot(this.orbitR + 17, this.orbitR + 50);
      const a = R() * 6, ca = Math.cos(a), sa = Math.sin(a);
      const at = (ox, oz) => [x + ox * ca - oz * sa, z + ox * sa + oz * ca];
      let [bx, bz] = at(0, 0);
      push(G.box, M.wood, bx, 1.0, bz, 3.0, 0.34, 1.5, 0, -a, 0);
      for (const s of [-1, 1]) {
        [bx, bz] = at(0, s * 0.7);
        push(G.box, M.wood, bx, 1.4, bz, 3.0, 0.7, 0.12, 0, -a, 0);
        for (const wx of [-0.95, 0.95]) {
          [bx, bz] = at(wx, s * 0.86);
          push(G.box, M.wood, bx, 0.72, bz, 1.44, 1.44, 0.18, Math.PI / 2, -a, 0);
        }
      }
      [bx, bz] = at(2.2, 0);
      push(G.box, M.wood, bx, 0.8, bz, 2.2, 0.12, 0.12, 0, -a, 0.18);
    }

    for (let i = 0; i < P.pond; i++) {
      const [x, z] = spot(this.orbitR + 19, this.orbitR + 60);
      const rr = 5 + R() * 7, sq = 0.6 + R() * 0.6;
      const w = new THREE.Mesh(new THREE.CircleGeometry(rr, 26).rotateX(-Math.PI / 2), M.water);
      w.position.set(x, 0.05, z); w.scale.set(1, 1, sq);
      this.envGroup.add(w);
      const bank = new THREE.Mesh(new THREE.CircleGeometry(rr * 1.25, 26).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ color: theme.scorch, transparent: true, opacity: 0.4,
          map: this._soft, depthWrite: false }));
      bank.position.set(x, 0.03, z); bank.scale.set(1, 1, sq);
      this.envGroup.add(bank);
      for (let k = 0; k < 18; k++) {
        const a = R() * Math.PI * 2, d = rr * (0.85 + R() * 0.4);
        reeds(x + Math.cos(a) * d, z + Math.sin(a) * d * sq, 2, 1.2);
      }
    }
    for (let i = 0; i < P.reeds; i++) {
      const [x, z] = spot(this.orbitR + 17, this.orbitR + 53);
      reeds(x, z);
    }

    for (let i = 0; i < P.ruin; i++) {
      const [x, z] = spot(this.orbitR + 18, this.orbitR + 54);
      const dir = R() * Math.PI * 2, n = 4 + ((R() * 5) | 0);
      for (let c = 0; c < 3; c++) {
        for (let k = 0; k < n; k++) {
          if (R() < 0.16 + c * 0.24) continue;                 // the collapse
          const off = (c % 2) * 0.75;
          push(G.box, M.stone, x + Math.cos(dir) * (k * 1.5 + off), 0.36 + c * 0.7,
            z + Math.sin(dir) * (k * 1.5 + off), 1.45, 0.7, 0.9,
            0, -dir + (R() - 0.5) * 0.06, 0);
        }
      }
    }

    for (let i = 0; i < P.stones; i++) {
      const [x, z] = spot(this.orbitR + 20, this.orbitR + 66);
      const n = 4 + ((R() * 4) | 0), rr = 3 + R() * 3;
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2, h = 2.4 + R() * 2.4;
        push(G.box, M.stone, x + Math.cos(a) * rr, h / 2, z + Math.sin(a) * rr,
          0.9 + R() * 0.5, h, 0.55 + R() * 0.3, (R() - 0.5) * 0.12, a, (R() - 0.5) * 0.12);
      }
    }

    // Grazing flocks. Four squat blobs and a head reads as a sheep at any range
    // the player will ever see one, and nothing else says "inhabited" so fast.
    for (let i = 0; i < (P.flocks || 0); i++) {
      const [x, z] = spot(this.orbitR + 19, this.orbitR + 66);
      for (let k = 0; k < 5 + ((R() * 8) | 0); k++) {
        const sx = x + (R() - 0.5) * 12, sz = z + (R() - 0.5) * 12, a = R() * 6;
        push(G.blob, M.pale, sx, 0.62, sz, 0.62, 0.5, 0.44, 0, a, 0);
        push(G.blob, M.dark, sx + Math.cos(a) * 0.6, 0.66, sz + Math.sin(a) * 0.6, 0.2, 0.2, 0.2);
        for (const [lx, lz] of [[0.25, 0.2], [0.25, -0.2], [-0.25, 0.2], [-0.25, -0.2]])
          push(G.box, M.dark, sx + lx * Math.cos(a) - lz * Math.sin(a), 0.2,
            sz + lx * Math.sin(a) + lz * Math.cos(a), 0.09, 0.42, 0.09, 0, 0, 0, false);
      }
    }

    for (let i = 0; i < (P.woodpile || 0); i++) {
      const [x, z] = spot(this.orbitR + 18, this.orbitR + 52);
      const a = R() * 6;
      for (let row = 0; row < 3; row++)
        for (let k = 0; k < 4 - row; k++)
          push(G.trunk, M.trunk, x + (k - (3 - row) / 2) * 0.42 * Math.cos(a) + row * 0.06,
            0.22 + row * 0.4, z + (k - (3 - row) / 2) * 0.42 * Math.sin(a),
            0.38, 1.7, 0.38, Math.PI / 2, a, 0);
    }

    for (let i = 0; i < (P.graves || 0); i++) {
      const [x, z] = spot(this.orbitR + 19, this.orbitR + 58);
      for (let k = 0; k < 5 + ((R() * 7) | 0); k++) {
        const h = 0.7 + R() * 0.6;
        push(G.box, M.stone, x + (R() - 0.5) * 9, h / 2, z + (R() - 0.5) * 9,
          0.5, h, 0.14, (R() - 0.5) * 0.22, R() * 6, (R() - 0.5) * 0.22);
      }
    }

    // ---- landmarks (ordinary meshes; only a handful, each its own shape) ----
    if (P.windmill) this._windmill(spot(this.orbitR + 18, this.orbitR + 48), M, theme);
    if (P.chapel) this._chapel(spot(this.orbitR + 14, this.orbitR + 44), M);
    if (P.jetty) this._jetty(spot(this.orbitR + 12, this.orbitR + 40), M, theme);

    // A dark belt of forest along the foot of the hills, so the horizon is not
    // bare ground meeting bare sky.
    const treeLine = new THREE.MeshStandardMaterial({ color: theme.hills[0], roughness: 1,
      flatShading: true });
    for (let i = 0; i < 150; i++) {
      const a = R() * Math.PI * 2, r = 130 + R() * 70, h = 8 + R() * 14;
      push(G.cone, treeLine, Math.cos(a) * r, h / 2, Math.sin(a) * r,
        2.6 + R() * 2, h, 2.6 + R() * 2, 0, R() * 3, 0, false);
    }

    // ---- build the instanced meshes ----
    this.scatterPools = [];
    for (const e of pool.values()) {
      // Nearest first, so the quality dial trims the far field rather than
      // punching holes in the middle of the view.
      e.list.sort((a, b) => a.d - b.d);
      const im = new THREE.InstancedMesh(e.geo, e.material, e.list.length);
      im.castShadow = e.shadow;
      im.receiveShadow = e.shadow;
      im.instanceMatrix.setUsage(THREE.StaticDrawUsage);
      for (let i = 0; i < e.list.length; i++) im.setMatrixAt(i, e.list[i].m);
      im.instanceMatrix.needsUpdate = true;
      im.frustumCulled = false;
      this.envGroup.add(im);
      this.scatterPools.push({ im, total: e.list.length });
    }
    this.scatter = [];

    // Birds: three-segment silhouettes wheeling overhead. Cheap, and the sky
    // stops being an empty gradient.
    const birdMat = new THREE.MeshBasicMaterial({ color: 0x2a2620, fog: false,
      side: THREE.DoubleSide });
    for (let i = 0; i < P.birds; i++) {
      const g = new THREE.Group();
      for (const sx of [-1, 1]) {
        const w = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.3), birdMat);
        w.position.x = sx * 0.75; w.rotation.z = sx * 0.4; w.rotation.x = -Math.PI / 2;
        g.add(w);
      }
      g.userData = { r: 55 + R() * 90, h: 34 + R() * 34, sp: 0.09 + R() * 0.1, ph: R() * 7 };
      this.envGroup.add(g);
      this.birds.push(g);
    }
  }

  _windmill([x, z], M, theme) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(2.1, 3.0, 9, 9), M.stone);
    body.position.y = 4.5; g.add(body);
    const cap = new THREE.Mesh(new THREE.ConeGeometry(2.5, 2.2, 9), M.wood);
    cap.position.y = 10.1; g.add(cap);
    const hub = new THREE.Group();
    hub.position.set(0, 9.2, 2.4);
    for (let i = 0; i < 4; i++) {
      const s = new THREE.Group();
      const spar = new THREE.Mesh(new THREE.BoxGeometry(0.22, 7.5, 0.22), M.wood);
      spar.position.y = 3.75; s.add(spar);
      const sail = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 6.2),
        new THREE.MeshStandardMaterial({ color: 0xd8cdb4, roughness: 1, side: THREE.DoubleSide }));
      sail.position.set(0.85, 3.9, 0); s.add(sail);
      s.rotation.z = i * Math.PI / 2;
      hub.add(s);
    }
    g.add(hub);
    this.windmill = hub;
    for (let i = 0; i < 6; i++) {
      const st = new THREE.Mesh(new THREE.BoxGeometry(0.2, 1.4, 0.2), M.wood);
      const a = (i / 6) * Math.PI * 2;
      st.position.set(Math.cos(a) * 4.2, 0.7, Math.sin(a) * 4.2); g.add(st);
    }
    g.position.set(x, 0, z);
    g.rotation.y = Math.random() * 6;
    g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    this.envGroup.add(g);
  }

  _chapel([x, z], M) {
    const g = new THREE.Group();
    const nave = new THREE.Mesh(new THREE.BoxGeometry(4.4, 3.4, 7.0), M.stone);
    nave.position.y = 1.7; g.add(nave);
    const roof = new THREE.Mesh(new THREE.CylinderGeometry(0, 3.3, 2.2, 4), M.wood);
    roof.position.y = 4.5; roof.rotation.y = Math.PI / 4; roof.scale.set(1, 1, 1.55); g.add(roof);
    const tower = new THREE.Mesh(new THREE.BoxGeometry(2.2, 6.4, 2.2), M.stone);
    tower.position.set(0, 3.2, -4.0); g.add(tower);
    const spire = new THREE.Mesh(new THREE.ConeGeometry(1.7, 3.0, 4), M.dark);
    spire.position.set(0, 7.9, -4.0); spire.rotation.y = Math.PI / 4; g.add(spire);
    for (const [ax, ay] of [[0.22, 1.0], [1.0, 0.22]]) {
      const arm = new THREE.Mesh(new THREE.BoxGeometry(ax, ay, 0.16), M.pale);
      arm.position.set(0, 9.9, -4.0); g.add(arm);
    }
    g.position.set(x, 0, z);
    g.rotation.y = Math.random() * 6;
    g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    this.envGroup.add(g);
  }

  _jetty([x, z], M, theme) {
    const g = new THREE.Group();
    const water = new THREE.Mesh(new THREE.CircleGeometry(13, 26).rotateX(-Math.PI / 2), M.water);
    water.position.y = 0.05; water.scale.set(1, 1, 0.62); g.add(water);
    for (let i = 0; i < 7; i++) {
      const plank = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.16, 0.5), M.wood);
      plank.position.set(2 + i * 0.62, 0.7, 0); plank.rotation.y = Math.PI / 2; g.add(plank);
      if (i % 2 === 0) {
        const pile = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.16, 1.6, 5), M.wood);
        pile.position.set(2 + i * 0.62, 0.1, 0.6); g.add(pile);
        const pile2 = pile.clone(); pile2.position.z = -0.6; g.add(pile2);
      }
    }
    const hull = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.42, 3.4, 7, 1, false, 0, Math.PI), M.wood);
    hull.rotation.set(Math.PI / 2, 0, Math.PI / 2);
    hull.position.set(7.4, 0.28, 1.6);
    g.add(hull);
    g.position.set(x, 0, z);
    g.rotation.y = Math.random() * 6;
    g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    this.envGroup.add(g);
  }

  // ---- materials ----------------------------------------------------------

  // Three damage tiers per material, sharing one texture per (surface, tier).
  // A block that just vanishes reads as a glitch; a block that visibly cracks,
  // then cracks badly, then bursts, reads as masonry losing a fight. This is
  // most of what "collisions feel weak" actually is.
  _materials() {
    const stoneMaps = [surfaceTex('stone', 0), surfaceTex('stone', 1), surfaceTex('stone', 2)];
    const woodMaps = [surfaceTex('wood', 0), surfaceTex('wood', 1), surfaceTex('wood', 2)];

    const make = (hex, rough, n, maps) => {
      const tiers = [[], [], []];
      const base = new THREE.Color(hex);
      for (let i = 0; i < n; i++) {
        const c = base.clone();
        const h = {}; c.getHSL(h);
        c.setHSL(h.h + (Math.random() - 0.5) * 0.035,
          h.s * (0.82 + Math.random() * 0.4),
          h.l * (0.86 + Math.random() * 0.3));
        for (let t = 0; t < 3; t++) {
          const cc = c.clone();
          if (t) cc.multiplyScalar(1 - t * 0.09);   // damage also darkens
          tiers[t].push(new THREE.MeshStandardMaterial({
            color: cc, roughness: rough + t * 0.02, metalness: 0.02,
            map: maps ? maps[t] : null }));
        }
      }
      return tiers;
    };
    return {
      plinth: make(this.theme ? this.theme.plinth : 0x6f6a5e, 1.0, 2, stoneMaps),
      stone: make(0xaaa08c, 0.94, 7, stoneMaps),
      block: make(0xb8ab93, 0.92, 7, stoneMaps),
      timber: make(0x8a6339, 0.86, 5, woodMaps),
      banner: make(0xb0a290, 0.9, 2, stoneMaps),
      ground: make(0x6f7a4e, 1, 1, null),
    };
  }

  pick(mat, idx, tier = 0) {
    const pool = this.mats[mat] || this.mats.block;
    const arr = pool[tier] || pool[0];
    return arr[idx % arr.length];
  }

  // ---- part meshes --------------------------------------------------------

  addPart(p) {
    if (p.kind === 'ground') return;
    // The knight has its own rig, built in knightMesh() and driven by the game.
    // Without this it ALSO gets the generic block mesh below and flies to the
    // fortress sealed inside a 1.12m stone cube.
    if (p.kind === 'knight') return;
    if (p.kind === 'banner') { this._bannerMesh(p); return; }
    if (p.kind === 'soldier') { this._soldierMesh(p); return; }
    if (p.kind === 'ragdoll') { this._ragdollMesh(p); return; }

    p.matName = p.kind === 'plinth' ? 'plinth' : p.mat;
    p.matIdx = (Math.random() * 7) | 0;
    p.tier = 0;
    const m = new THREE.Mesh(UNIT, this.pick(p.matName, p.matIdx, 0));
    m.scale.set(p.half.x * 2, p.half.y * 2, p.half.z * 2);
    // Debris is small, numerous and short-lived; making it cast shadows adds a
    // hundred-odd extra draws to the shadow pass at exactly the moment the
    // frame is already busiest.
    m.castShadow = p.kind !== 'plinth' && p.kind !== 'debris';
    m.receiveShadow = p.kind !== 'debris';
    this.scene.add(m);
    p.mesh = m;
    this.meshes.set(p, m);
    this.syncPart(p);
  }

  _bannerMesh(p) {
    const g = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, p.half.y * 2, 7),
      new THREE.MeshStandardMaterial({ color: 0x5a4630, roughness: 0.8 }));
    g.add(pole);
    const cloth = new THREE.Mesh(new THREE.PlaneGeometry(1.15, 1.35),
      new THREE.MeshStandardMaterial({ color: 0xc8443a, roughness: 0.82, side: THREE.DoubleSide,
        emissive: 0x3a0d0a, emissiveIntensity: 0.5 }));
    cloth.position.set(0.6, p.half.y * 0.42, 0);
    cloth.castShadow = true;
    g.add(cloth);
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.34, 6),
      new THREE.MeshStandardMaterial({ color: 0xd6b45e, roughness: 0.32, metalness: 0.85 }));
    tip.position.y = p.half.y + 0.15;
    g.add(tip);
    pole.castShadow = true;
    this.scene.add(g);
    p.mesh = g;
    p.cloth = cloth;
    this.meshes.set(p, g);
    this.syncPart(p);
  }

  // Soldiers are the targets, so they are the most saturated thing in the scene:
  // hot red against tan masonry and green field. The player's knight is blue —
  // you should never have to work out which figure is yours.
  _soldierMesh(p) {
    const g = new THREE.Group();
    const cloth = new THREE.MeshStandardMaterial({ color: 0xc4402f, roughness: 0.86 });
    const steel = new THREE.MeshStandardMaterial({ color: 0x9aa3ad, roughness: 0.38, metalness: 0.8 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x3a3330, roughness: 0.72 });
    const wood = new THREE.MeshStandardMaterial({ color: 0x6a4b2e, roughness: 0.9 });

    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.27, 0.36, 4, 9), cloth);
    body.position.y = -0.04; g.add(body);
    const belt = new THREE.Mesh(new THREE.CylinderGeometry(0.29, 0.29, 0.09, 9), dark);
    belt.position.y = -0.2; g.add(belt);

    const helm = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 7, 0, Math.PI * 2, 0, Math.PI * 0.62), steel);
    helm.position.y = 0.42; g.add(helm);
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.05, 10), steel);
    brim.position.y = 0.4; g.add(brim);
    const face = new THREE.Mesh(new THREE.CylinderGeometry(0.155, 0.16, 0.19, 9), dark);
    face.position.y = 0.3; g.add(face);

    for (const sx of [-1, 1]) {
      const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.085, 0.2, 3, 6), cloth);
      arm.position.set(sx * 0.3, -0.02, 0); g.add(arm);
      const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.095, 0.18, 3, 6), dark);
      leg.position.set(sx * 0.13, -0.5, 0); g.add(leg);
    }

    const spear = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 1.5, 6), wood);
    spear.position.set(0.34, 0.22, 0.06); spear.rotation.z = -0.13; g.add(spear);
    const head = new THREE.Mesh(new THREE.ConeGeometry(0.075, 0.26, 6), steel);
    head.position.set(0.44, 0.98, 0.06); g.add(head);

    const shield = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.42, 0.34), cloth);
    shield.position.set(-0.33, -0.06, 0); g.add(shield);
    const cross = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.34, 0.07),
      new THREE.MeshStandardMaterial({ color: 0xe8dcc4, roughness: 0.9 }));
    cross.position.set(-0.38, -0.06, 0); g.add(cross);

    g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    this.scene.add(g);
    p.mesh = g;
    this.meshes.set(p, g);

    // Target marker. Two of the garrison stand inside the fortress where you
    // cannot see them at all, and a puzzle you can't see the targets of is not
    // a puzzle. Drawn with depthTest off so it reads through masonry, and with
    // size attenuation off so it stays the same size at any range.
    const mk = new THREE.Sprite(new THREE.SpriteMaterial({
      map: markerTex(), color: 0xff6a4a, transparent: true, opacity: 0.92,
      depthTest: false, depthWrite: false, sizeAttenuation: false, fog: false }));
    mk.scale.set(0.028, 0.028, 1);
    mk.renderOrder = 20;
    this.scene.add(mk);
    p.marker = mk;

    this.syncPart(p);
  }

  // Ragdoll limbs. Red surcoat for the garrison, blue for your own knights, so
  // a heap on the ground still says whose it was.
  _ragdollMesh(p) {
    if (!this._rdMat) {
      const mk = (c, r, m) => new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: m || 0 });
      this._rdMat = {
        foe: { body: mk(0xc4402f, 0.86), limb: mk(0x3a3330, 0.72), head: mk(0x9aa3ad, 0.38, 0.8) },
        friend: { body: mk(0x2f5f8c, 0.86), limb: mk(0x3d4450, 0.6, 0.4), head: mk(0xb9c0c8, 0.32, 0.88) },
      };
      this._rdGeo = {
        torso: new THREE.BoxGeometry(1, 1, 1),
        head: new THREE.SphereGeometry(0.5, 9, 7),
        arm: new THREE.CapsuleGeometry(0.34, 0.9, 3, 6),
        leg: new THREE.CapsuleGeometry(0.34, 0.9, 3, 6),
      };
    }
    const set = this._rdMat[p.tint === 'friend' ? 'friend' : 'foe'];
    let mat = p.rdKind === 'head' ? set.head : p.rdKind === 'torso' ? set.body : set.limb;
    // A friendly body wears the surcoat its owner flew in, so you can tell
    // which of your knights is lying in the courtyard.
    if (p.pal && p.rdKind === 'torso') {
      if (!this._rdPalMat) this._rdPalMat = new Map();
      if (!this._rdPalMat.has(p.pal.cloth)) {
        this._rdPalMat.set(p.pal.cloth,
          new THREE.MeshStandardMaterial({ color: p.pal.cloth, roughness: 0.86 }));
      }
      mat = this._rdPalMat.get(p.pal.cloth);
    }
    const m = new THREE.Mesh(this._rdGeo[p.rdKind] || this._rdGeo.torso, mat);
    if (p.rdKind === 'head') m.scale.setScalar(p.half.x * 2.4);
    else if (p.rdKind === 'torso') m.scale.set(p.half.x * 2.2, p.half.y * 2.1, p.half.z * 2.4);
    else m.scale.set(p.half.x * 2.4, p.half.y * 1.6, p.half.z * 2.4);
    m.castShadow = true;
    this.scene.add(m);
    p.mesh = m;
    this.meshes.set(p, m);
    this.syncPart(p);
  }

  syncPart(p) {
    const m = p.mesh; if (!m) return;
    // Damage tier. An integer compare on 360 parts per frame is free, and it
    // means nothing has to remember to notify the renderer when a block is hit.
    if (p.matName && p.maxHp < 1e8) {
      const f = p.hp / p.maxHp;
      const tier = f > 0.66 ? 0 : f > 0.33 ? 1 : 2;
      if (tier !== p.tier) {
        p.tier = tier;
        m.material = this.pick(p.matName, p.matIdx, tier);
      }
    }
    const t = p.body.translation(), q = p.body.rotation();
    m.position.set(t.x, t.y, t.z);
    m.quaternion.set(q.x, q.y, q.z, q.w);
    if (p.marker) {
      p.marker.visible = SET.showMarkers;
      p.marker.position.set(t.x, t.y + 1.15, t.z);
      const pulse = 1 + Math.sin(performance.now() * 0.005) * 0.13;
      p.marker.scale.set(0.028 * pulse, 0.028 * pulse, 1);
    }
  }

  syncAll(phys) {
    for (const p of phys.list) if (p.mesh) this.syncPart(p);
  }

  dropPart(p) {
    if (p.marker) { this.scene.remove(p.marker); p.marker.material.dispose(); p.marker = null; }
    const m = this.meshes.get(p);
    if (!m) return;
    this.scene.remove(m);
    this.meshes.delete(p);
    p.mesh = null;
  }

  markBannerDown(p) {
    if (p.cloth) {
      p.cloth.material.color.set(0x53505c);
      p.cloth.material.emissiveIntensity = 0;
    }
  }

  // ---- the knight ---------------------------------------------------------
  //
  // Every knight in the company is a different man: his own surcoat, plume and
  // shield device, carried from the row waiting by the machine, through the
  // flight, to the body he leaves on the field. Six identical blue figures
  // waiting to be thrown reads as ammunition; six different ones reads as
  // people, which is the whole reason they are knights and not rocks.

  knightRig(pal) {
    const g = new THREE.Group();
    const P = pal || KNIGHT_PALETTES[0];
    const steel = new THREE.MeshStandardMaterial({ color: 0xb9c0c8, roughness: 0.32, metalness: 0.88 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x3d4450, roughness: 0.6, metalness: 0.4 });
    const cloth = new THREE.MeshStandardMaterial({ color: P.cloth, roughness: 0.85 });
    const trim = new THREE.MeshStandardMaterial({ color: P.trim, roughness: 0.34, metalness: 0.72 });
    const plumeM = new THREE.MeshStandardMaterial({ color: P.plume, roughness: 0.9 });

    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 0.34, 4, 10), steel);
    torso.position.y = 0.06; g.add(torso);
    const surcoat = new THREE.Mesh(new THREE.CylinderGeometry(0.31, 0.36, 0.4, 10), cloth);
    surcoat.position.y = -0.12; g.add(surcoat);

    const head = new THREE.Group();
    const helm = new THREE.Mesh(new THREE.CylinderGeometry(0.21, 0.24, 0.32, 9), steel);
    helm.position.y = 0.52; head.add(helm);
    const helmTop = new THREE.Mesh(new THREE.SphereGeometry(0.21, 10, 7, 0, Math.PI * 2, 0, Math.PI / 2), steel);
    helmTop.position.y = 0.68; head.add(helmTop);
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.055, 0.06), dark);
    visor.position.set(0, 0.55, 0.21); head.add(visor);
    const plume = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.4, 6), plumeM);
    plume.position.y = 0.9; head.add(plume);
    g.add(head);

    const legs = [];
    for (const sx of [-1, 1]) {
      const pauldron = new THREE.Mesh(new THREE.SphereGeometry(0.16, 9, 7), steel);
      pauldron.position.set(sx * 0.3, 0.24, 0); g.add(pauldron);
      const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.11, 0.26, 3, 7), dark);
      leg.position.set(sx * 0.14, -0.42, 0); g.add(leg); legs.push(leg);
    }

    // Lance, in its own group so it can be shouldered or couched.
    const lanceG = new THREE.Group();
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.085, 1.5, 7),
      new THREE.MeshStandardMaterial({ color: 0x6b4b2e, roughness: 0.85 }));
    shaft.rotation.z = Math.PI / 2; shaft.rotation.y = 0.14;
    shaft.position.set(0.55, 0.12, 0.18); lanceG.add(shaft);
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.3, 7), steel);
    tip.rotation.z = -Math.PI / 2; tip.position.set(1.42, 0.12, 0.18); lanceG.add(tip);
    const pennon = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.18),
      new THREE.MeshStandardMaterial({ color: P.plume, roughness: 0.9, side: THREE.DoubleSide }));
    pennon.position.set(1.0, 0.28, 0.18); lanceG.add(pennon);
    g.add(lanceG);

    const shield = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.5, 0.36), cloth);
    shield.position.set(-0.36, 0.0, 0.04); shield.rotation.x = 0.12; g.add(shield);
    const dv = P.device === 'bar'
      ? new THREE.BoxGeometry(0.03, 0.34, 0.09)
      : new THREE.BoxGeometry(0.03, 0.1, 0.3);
    const device = new THREE.Mesh(dv, trim);
    device.position.set(-0.4, 0.0, 0.04); device.rotation.x = 0.12; g.add(device);
    const boss = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), trim);
    boss.position.set(-0.41, 0.0, 0.04); g.add(boss);

    g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    g.scale.setScalar(0.92);
    g.userData = { head, legs, lance: lanceG, plume, pal: P, phase: Math.random() * 7 };
    return g;
  }

  knightMesh(pal) {
    const g = this.knightRig(pal);
    this.scene.add(g);
    return g;
  }

  // Idle for the row waiting their turn: breathing, a slow shift of weight, a
  // look around, and the man at the front standing to with his lance up.
  animateWaiting(dt, t) {
    if (!this.waiting) return;
    for (let i = 0; i < this.waiting.length; i++) {
      const k = this.waiting[i];
      if (!k.visible) continue;
      const u = k.userData;
      const ph = u.phase || 0;
      k.position.y = (u.baseY || 0) + Math.sin(t * 1.5 + ph) * 0.02;
      k.rotation.z = Math.sin(t * 0.6 + ph) * 0.035;
      k.rotation.y = (u.baseYaw || 0) + Math.sin(t * 0.4 + ph * 1.7) * 0.12;
      if (u.head) u.head.rotation.y = Math.sin(t * 0.33 + ph * 2.3) * 0.42;
      if (u.lance) {
        const next = i === 0;                       // next up shoulders his lance
        const want = next ? -1.15 : -0.25 + Math.sin(t * 0.5 + ph) * 0.05;
        u.lance.rotation.z += (want - u.lance.rotation.z) * Math.min(1, dt * 3);
      }
    }
  }

  // In flight: lance couched along the direction of travel, rolling slowly.
  // A knight tumbling at random reads as a sack; a knight aimed lance-first
  // reads as a man who chose this.
  poseFlying(mesh, vel, dt) {
    if (!mesh) return;
    const sp = Math.hypot(vel.x, vel.y, vel.z);
    if (sp < 0.5) return;
    if (!this._flyQ) {
      this._flyQ = new THREE.Quaternion();
      this._flyM = new THREE.Matrix4();
      this._flyUp = new THREE.Vector3(0, 1, 0);
      this._flyRight = new THREE.Vector3();
      this._flyRoll = 0;
    }
    // The rig points its +X down the lance, so aim +X along the velocity.
    const right = this._flyRight.set(vel.x, vel.y, vel.z).normalize();
    const up = this._flyUp.clone().addScaledVector(right, -this._flyUp.dot(right));
    if (up.lengthSq() < 0.001) up.set(0, 0, 1);
    up.normalize();
    const fwd = new THREE.Vector3().crossVectors(right, up);
    this._flyM.makeBasis(right, up, fwd);
    this._flyQ.setFromRotationMatrix(this._flyM);
    this._flyRoll += dt * 2.6;
    mesh.quaternion.copy(
      new THREE.Quaternion().setFromAxisAngle(right, this._flyRoll).multiply(this._flyQ));
  }

  // ---- the launcher -------------------------------------------------------

  _onager() {
    const g = new THREE.Group();
    // Only the engine swivels with the lateral trim. Parenting the camp to it
    // would swing the tents and the campfire every time you nudge the aim.
    const machine = new THREE.Group();
    g.add(machine);
    this.machine = machine;
    const wood = new THREE.MeshStandardMaterial({ color: 0x6a4a2c, roughness: 0.86 });
    const iron = new THREE.MeshStandardMaterial({ color: 0x565c66, roughness: 0.42, metalness: 0.8 });
    const rope = new THREE.MeshStandardMaterial({ color: 0xa88b5c, roughness: 1 });

    const base = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.42, 2.2), wood);
    base.position.y = 0.55; machine.add(base);
    for (const s of [-1, 1]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.26, 0.3), wood);
      rail.position.set(0, 0.9, s * 0.9); machine.add(rail);
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.3, 12), wood);
      wheel.rotation.x = Math.PI / 2; wheel.position.set(-1.0, 0.62, s * 1.16); machine.add(wheel);
      const wheel2 = wheel.clone(); wheel2.position.x = 1.2; machine.add(wheel2);
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.28, 1.9, 0.28), wood);
      post.position.set(-0.2, 1.75, s * 0.72); post.rotation.x = s * 0.12; machine.add(post);
    }
    const skein = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 1.7, 10), rope);
    skein.rotation.z = Math.PI / 2; skein.position.set(-0.2, 1.0, 0); machine.add(skein);

    // The arm is animated on release — it's the only thing that tells you the
    // shot actually left the machine.
    const arm = new THREE.Group();
    const beam = new THREE.Mesh(new THREE.BoxGeometry(0.26, 2.9, 0.26), wood);
    beam.position.y = 1.45; arm.add(beam);
    const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.44, 0.3, 0.3, 10, 1, true), iron);
    bowl.position.y = 2.9; arm.add(bowl);
    arm.position.set(-0.2, 1.0, 0);
    machine.add(arm);
    this.arm = arm;
    this.armRest = -0.5;
    this.armAngle = this.armRest;

    const stop = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.5, 1.9), wood);
    stop.position.set(1.5, 1.4, 0); machine.add(stop);

    g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    this.scene.add(g);
    this.onager = g;

    // A pennant on the machine, so the launch site is findable at any orbit.
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 3.4, 6), wood);
    pole.position.set(-1.6, 2.2, -0.9); machine.add(pole);
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.5),
      new THREE.MeshStandardMaterial({ color: 0x2f5f8c, side: THREE.DoubleSide, roughness: 0.9 }));
    flag.position.set(-1.15, 3.5, -0.9); machine.add(flag);
    this.flag = flag;

    this._camp(g, wood, iron);
  }

  // The siege camp, parented to the machine so it travels round the ring with
  // you. Without it the foreground is an empty green field and the whole thing
  // reads as a physics demo rather than a siege.
  _camp(g, wood, iron) {
    const canvasM = new THREE.MeshStandardMaterial({ color: 0xbfae90, roughness: 0.95, side: THREE.DoubleSide });
    const canvasM2 = new THREE.MeshStandardMaterial({ color: 0xa89574, roughness: 0.95, side: THREE.DoubleSide });
    const rope = new THREE.MeshStandardMaterial({ color: 0xa88b5c, roughness: 1 });
    const blue = new THREE.MeshStandardMaterial({ color: 0x2f5f8c, roughness: 0.88 });
    const steel = new THREE.MeshStandardMaterial({ color: 0xb9c0c8, roughness: 0.34, metalness: 0.86 });

    // Two ridge tents, set back and to the sides.
    for (const [tx, tz, mat, sc] of [[-4.6, -3.4, canvasM, 1], [-5.4, 3.0, canvasM2, 0.85]]) {
      const t = new THREE.Group();
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0, 1.9, 2.3, 4), mat);
      body.position.y = 1.15; body.rotation.y = Math.PI / 4;
      t.add(body);
      const ridge = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 3.2, 5), wood);
      ridge.rotation.z = Math.PI / 2; ridge.position.y = 2.3; t.add(ridge);
      const door = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 1.2),
        new THREE.MeshStandardMaterial({ color: 0x2b2519, roughness: 1, side: THREE.DoubleSide }));
      door.position.set(1.0, 0.6, 0.0); door.rotation.y = Math.PI / 2; t.add(door);
      t.position.set(tx, 0, tz); t.scale.setScalar(sc);
      g.add(t);
    }

    // Campfire with a warm point light — the only warm light in the scene, and
    // it anchors the camp at any orbit angle.
    const fire = new THREE.Group();
    for (let i = 0; i < 6; i++) {
      const log = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 1.0, 5), wood);
      const a = (i / 6) * Math.PI * 2;
      log.position.set(Math.cos(a) * 0.22, 0.2, Math.sin(a) * 0.22);
      log.rotation.set(Math.cos(a) * 0.9, a, Math.sin(a) * 0.9);
      fire.add(log);
    }
    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.34, 0.9, 7),
      new THREE.MeshBasicMaterial({ color: 0xffa544, transparent: true, opacity: 0.9, fog: false }));
    flame.position.y = 0.62; fire.add(flame);
    this.flame = flame;
    const fl = new THREE.PointLight(0xff9a44, 6, 14, 2);
    fl.position.y = 1.0; fire.add(fl);
    this.fireLight = fl;
    fire.position.set(-4.4, 0, 0);
    g.add(fire);

    // The company waits by the arm; buildWaiting() fills this once the game
    // knows how many knights there are and what colours they wear.
    this.waiting = [];
    this.campGroup = g;

    // Stores.
    for (const [bx, bz, r] of [[-3.2, 2.4, 0], [-3.9, 2.9, 0.5], [-2.4, 3.1, 1.1]]) {
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.32, 0.86, 9), wood);
      barrel.position.set(bx, 0.43, bz); barrel.rotation.y = r;
      barrel.castShadow = true; g.add(barrel);
      const hoop = new THREE.Mesh(new THREE.TorusGeometry(0.35, 0.035, 5, 12), iron);
      hoop.position.set(bx, 0.6, bz); hoop.rotation.x = Math.PI / 2; g.add(hoop);
    }
    for (let i = 0; i < 5; i++) {
      const c = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.55, 0.7), wood);
      c.position.set(-1.4 + (i % 2) * 0.8, 0.28 + ((i / 2) | 0) * 0.56, 3.0 + (i % 3) * 0.3);
      c.rotation.y = Math.random(); c.castShadow = true; g.add(c);
    }
    // Stakes and rope, to make the ground read as occupied.
    for (let i = 0; i < 10; i++) {
      const st = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.02, 0.8, 4), wood);
      const a = -0.9 + i * 0.26;
      st.position.set(-5.6 + Math.cos(a) * 1.4, 0.34, Math.sin(a) * 4.2);
      st.rotation.z = (Math.random() - 0.5) * 0.5;
      g.add(st);
    }
    const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 8.6, 4), rope);
    cord.rotation.x = Math.PI / 2; cord.position.set(-5.4, 0.62, 0); g.add(cord);
  }

  // ---- aim trajectory -----------------------------------------------------

  _aimLine() {
    this.dots = [];
    const geo = new THREE.SphereGeometry(0.13, 7, 5);
    for (let i = 0; i < 64; i++) {
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
        color: 0xe0b25c, transparent: true, opacity: 0.85, depthWrite: false, fog: false }));
      m.visible = false;
      m.renderOrder = 5;
      this.scene.add(m);
      this.dots.push(m);
    }

    // The impact marker. A flat ground ring was wrong the moment the shot hit a
    // WALL: it lay horizontally, half inside the masonry, and told you nothing
    // about where on the face you were about to land. This one is built in the
    // XY plane and rotated onto the surface normal, so it sits ON whatever it
    // hits, with a plumb line down to the ground because a fixed camera cannot
    // read height off a mark hanging in the air.
    const mk = new THREE.Group();
    const ringMat = () => new THREE.MeshBasicMaterial({ color: 0xe0b25c, transparent: true,
      opacity: 0.9, depthWrite: false, depthTest: false, side: THREE.DoubleSide, fog: false });

    this.mkRing = new THREE.Mesh(new THREE.RingGeometry(0.62, 0.78, 32), ringMat());
    mk.add(this.mkRing);
    this.mkInner = new THREE.Mesh(new THREE.RingGeometry(0.16, 0.24, 20), ringMat());
    mk.add(this.mkInner);
    this.mkTicks = [];
    for (let i = 0; i < 4; i++) {
      const t = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.055), ringMat());
      t.position.set(Math.cos(i * Math.PI / 2) * 1.0, Math.sin(i * Math.PI / 2) * 1.0, 0);
      t.rotation.z = i * Math.PI / 2;
      mk.add(t); this.mkTicks.push(t);
    }
    // A short stub along the normal, so a marker on a vertical face still reads
    // as attached to that face and not painted on the air in front of it.
    this.mkStub = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.55, 6), ringMat());
    this.mkStub.rotation.x = Math.PI / 2;
    this.mkStub.position.z = 0.27;
    mk.add(this.mkStub);

    mk.renderOrder = 8;
    mk.visible = false;
    this.scene.add(mk);
    this.marker = mk;

    // Plumb line + shadow ring on the ground beneath the impact.
    this.mkDrop = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1, 5),
      new THREE.MeshBasicMaterial({ color: 0xe0b25c, transparent: true, opacity: 0.32,
        depthWrite: false, fog: false }));
    this.mkDrop.visible = false;
    this.scene.add(this.mkDrop);
    this.mkFoot = new THREE.Mesh(new THREE.RingGeometry(0.3, 0.4, 22).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xe0b25c, transparent: true, opacity: 0.4,
        depthWrite: false, side: THREE.DoubleSide, fog: false }));
    this.mkFoot.visible = false;
    this.scene.add(this.mkFoot);

    // The arc's shadow on the ground, and a few uprights joining the two.
    //
    // A parabola drawn in mid-air over a 3D scene has no depth: coming toward
    // you or going away from you it is the same handful of dots. Its ground
    // track is the cue that fixes that, and it is the standard fix for exactly
    // this reason.
    this.trail = [];
    const tg = new THREE.CircleGeometry(0.3, 12).rotateX(-Math.PI / 2);
    for (let i = 0; i < 64; i++) {
      const m = new THREE.Mesh(tg, new THREE.MeshBasicMaterial({
        color: 0x241f14, transparent: true, opacity: 0.45, depthWrite: false, fog: false }));
      m.visible = false; m.renderOrder = 3;
      this.scene.add(m);
      this.trail.push(m);
    }
    this.risers = [];
    const rg = new THREE.CylinderGeometry(0.018, 0.018, 1, 4);
    for (let i = 0; i < 9; i++) {
      const m = new THREE.Mesh(rg, new THREE.MeshBasicMaterial({
        color: 0xe0b25c, transparent: true, opacity: 0.3, depthWrite: false, fog: false }));
      m.visible = false; m.renderOrder = 3;
      this.scene.add(m);
      this.risers.push(m);
    }

    this._mkUp = new THREE.Vector3(0, 0, 1);
    this._mkN = new THREE.Vector3();
  }

  showArc(pts, hit) {
    const n = this.dots.length;
    for (let i = 0; i < n; i++) {
      const d = this.dots[i];
      if (i < pts.length) {
        d.visible = true;
        d.position.copy(pts[i]);
        const f = i / Math.max(1, pts.length - 1);
        d.scale.setScalar(1.05 - f * 0.55);
        d.material.opacity = 0.92 - f * 0.5;
      } else d.visible = false;
    }

    // Ground track, and uprights every eighth point.
    for (let i = 0; i < this.trail.length; i++) {
      const t = this.trail[i];
      if (i < pts.length) {
        t.visible = true;
        t.position.set(pts[i].x, 0.035, pts[i].z);
        const f = i / Math.max(1, pts.length - 1);
        const sc = 1 - f * 0.4;
        t.scale.set(sc, 1, sc);
        t.material.opacity = 0.5 - f * 0.22;
      } else t.visible = false;
    }
    let ri = 0;
    for (let i = 3; i < pts.length && ri < this.risers.length; i += 7) {
      const r = this.risers[ri++];
      const h = Math.max(0.1, pts[i].y);
      r.visible = true;
      r.position.set(pts[i].x, h / 2, pts[i].z);
      r.scale.set(1, h, 1);
    }
    for (; ri < this.risers.length; ri++) this.risers[ri].visible = false;

    if (!hit) { this.marker.visible = false; this.mkDrop.visible = false; this.mkFoot.visible = false; return; }

    // Red when the shot is predicted to reach a soldier. That is the single
    // most useful thing the reticle can tell you, and it is free here.
    const onTarget = hit.kind === 'soldier';
    const col = onTarget ? 0xff5a3c : 0xe0b25c;
    for (const m of [this.mkRing, this.mkInner, this.mkStub, ...this.mkTicks]) m.material.color.setHex(col);
    this.mkDrop.material.color.setHex(col);
    this.mkFoot.material.color.setHex(col);

    this._mkN.set(hit.nx, hit.ny, hit.nz);
    if (this._mkN.lengthSq() < 0.0001) this._mkN.set(0, 1, 0);
    this._mkN.normalize();
    this.marker.position.set(hit.x, hit.y, hit.z).addScaledVector(this._mkN, 0.06);
    this.marker.quaternion.setFromUnitVectors(this._mkUp, this._mkN);
    const pulse = onTarget ? 1 + Math.sin(performance.now() * 0.012) * 0.12 : 1;
    this.marker.scale.setScalar(pulse);
    this.marker.visible = true;

    const h = Math.max(0, hit.y);
    if (h > 1.2) {
      this.mkDrop.position.set(hit.x, h / 2, hit.z);
      this.mkDrop.scale.set(1, h, 1);
      this.mkDrop.visible = true;
      this.mkFoot.position.set(hit.x, 0.05, hit.z);
      this.mkFoot.visible = true;
    } else {
      this.mkDrop.visible = false;
      this.mkFoot.visible = false;
    }
  }

  hideArc() {
    for (const d of this.dots) d.visible = false;
    if (this.trail) for (const t of this.trail) t.visible = false;
    if (this.risers) for (const r of this.risers) r.visible = false;
    if (this.marker) this.marker.visible = false;
    if (this.mkDrop) this.mkDrop.visible = false;
    if (this.mkFoot) this.mkFoot.visible = false;
  }

  // ---- FX -----------------------------------------------------------------

  _fxPools() {
    this.dust = [];
    const dt = radialTex('rgba(214,203,180,0.95)', 'rgba(214,203,180,0)');
    for (let i = 0; i < 90; i++) {
      const s = sprite(dt, 1, 0xd6cbb4, 0, new THREE.Vector3());
      s.visible = false;
      this.scene.add(s);
      this.dust.push({ s, life: 0, max: 1, vel: new THREE.Vector3(), size: 1 });
    }
    this.sparks = [];
    const st = radialTex('rgba(255,236,190,1)', 'rgba(255,170,80,0)');
    for (let i = 0; i < 60; i++) {
      const s = sprite(st, 1, 0xffe6b0, 0, new THREE.Vector3(), THREE.AdditiveBlending);
      s.visible = false; s.material.depthWrite = false;
      this.scene.add(s);
      this.sparks.push({ s, life: 0, max: 1, vel: new THREE.Vector3(), size: 1 });
    }

    // Expanding shockwave rings. A flat additive ring billboard is the cheapest
    // way to make an impact read as force rather than as a puff of dust.
    this.rings = [];
    const rt = ringTex();
    for (let i = 0; i < 22; i++) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1),
        new THREE.MeshBasicMaterial({ map: rt, transparent: true, opacity: 0,
          depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
          side: THREE.DoubleSide, color: 0xffd9a0 }));
      m.visible = false; m.renderOrder = 6;
      this.scene.add(m);
      this.rings.push({ m, life: 0, max: 1, size: 1 });
    }
    this._ri = 0;

    // Helms that survive their owner and bounce once. Cheap, and it gives a
    // knockout a physical follow-through without a second rigid body.
    this.helms = [];
    const helmGeo = new THREE.SphereGeometry(0.2, 9, 6, 0, Math.PI * 2, 0, Math.PI * 0.62);
    const helmMat = new THREE.MeshStandardMaterial({ color: 0x9aa3ad, roughness: 0.38, metalness: 0.8 });
    for (let i = 0; i < 8; i++) {
      const h = new THREE.Mesh(helmGeo, helmMat);
      h.castShadow = true; h.visible = false;
      h.userData = { v: new THREE.Vector3(), w: new THREE.Vector3(), life: 0 };
      this.scene.add(h);
      this.helms.push(h);
    }
    this._helm = 0;

    this._di = 0; this._si = 0;
  }

  ring(x, y, z, scale = 1, colour = 0xffd9a0) {
    const r = this.rings[this._ri++ % this.rings.length];
    r.m.visible = true;
    r.m.position.set(x, y, z);
    r.m.material.color.setHex(colour);
    r.life = r.max = 0.42 + scale * 0.16;
    r.size = 1.6 * scale;
  }

  puff(x, y, z, scale = 1, n = 5) {
    for (let i = 0; i < n; i++) {
      const d = this.dust[this._di++ % this.dust.length];
      d.s.visible = true;
      d.s.position.set(x + rnd(-0.4, 0.4), y + rnd(-0.3, 0.4), z + rnd(-0.4, 0.4));
      d.vel.set(rnd(-2, 2) * scale, rnd(0.5, 3) * scale, rnd(-2, 2) * scale);
      d.max = rnd(0.55, 1.25); d.life = d.max;
      d.size = rnd(0.9, 2.3) * scale;
    }
  }

  spark(x, y, z, scale = 1, n = 5) {
    for (let i = 0; i < n; i++) {
      const d = this.sparks[this._si++ % this.sparks.length];
      d.s.visible = true;
      d.s.position.set(x, y, z);
      d.vel.set(rnd(-7, 7) * scale, rnd(1, 9) * scale, rnd(-7, 7) * scale);
      d.max = rnd(0.2, 0.5); d.life = d.max;
      d.size = rnd(0.25, 0.7) * scale;
    }
  }

  stepFX(dt) {
    for (const d of this.dust) {
      if (d.life <= 0) { if (d.s.visible) d.s.visible = false; continue; }
      d.life -= dt;
      d.s.position.addScaledVector(d.vel, dt);
      d.vel.y -= 1.6 * dt; d.vel.multiplyScalar(1 - 1.9 * dt);
      const f = Math.max(0, d.life / d.max);
      d.s.material.opacity = f * 0.62;
      const g = d.size * (1.9 - f * 0.9);
      d.s.scale.set(g, g, 1);
      if (d.life <= 0) d.s.visible = false;
    }
    for (const d of this.sparks) {
      if (d.life <= 0) { if (d.s.visible) d.s.visible = false; continue; }
      d.life -= dt;
      d.s.position.addScaledVector(d.vel, dt);
      d.vel.y -= 16 * dt;
      const f = Math.max(0, d.life / d.max);
      d.s.material.opacity = f;
      d.s.scale.set(d.size * f, d.size * f, 1);
      if (d.life <= 0) d.s.visible = false;
    }
    for (const r of this.rings) {
      if (r.life <= 0) { if (r.m.visible) r.m.visible = false; continue; }
      r.life -= dt;
      const f = 1 - Math.max(0, r.life / r.max);
      const g = r.size * (0.4 + f * 4.2);
      r.m.scale.set(g, g, 1);
      r.m.material.opacity = (1 - f) * 0.85;
      r.m.quaternion.copy(this.camera.quaternion);
      if (r.life <= 0) r.m.visible = false;
    }
    for (const h of this.helms) {
      const u = h.userData;
      if (u.life <= 0) { if (h.visible) h.visible = false; continue; }
      u.life -= dt;
      h.position.addScaledVector(u.v, dt);
      u.v.y -= 21.5 * dt;
      if (h.position.y < 0.18) {                 // one bounce, then settle
        h.position.y = 0.18;
        u.v.y = Math.abs(u.v.y) * 0.34;
        u.v.x *= 0.62; u.v.z *= 0.62; u.w.multiplyScalar(0.5);
      }
      h.rotation.x += u.w.x * dt; h.rotation.y += u.w.y * dt; h.rotation.z += u.w.z * dt;
      if (u.life <= 0) h.visible = false;
    }
    if (this.birds) {
      const t = performance.now() * 0.001;
      for (const b of this.birds) {
        const u = b.userData, a = t * u.sp + u.ph;
        b.position.set(Math.cos(a) * u.r, u.h + Math.sin(a * 2.3) * 3, Math.sin(a) * u.r);
        b.rotation.y = -a + Math.PI / 2;
        const flap = Math.sin(t * 7 + u.ph) * 0.35;
        b.children[0].rotation.z = 0.4 + flap;
        b.children[1].rotation.z = -0.4 - flap;
      }
    }
    if (this.windmill) this.windmill.rotation.z -= dt * 0.42;
    if (this.flag) this.flag.rotation.y = Math.sin(performance.now() * 0.002) * 0.22;
    if (this.flame) {
      const t = performance.now() * 0.006;
      const f = 0.85 + Math.sin(t) * 0.13 + Math.sin(t * 2.7) * 0.07;
      this.flame.scale.set(f, 0.85 + Math.sin(t * 1.7) * 0.2, f);
      this.flame.rotation.y += dt * 2.4;
      if (this.fireLight) this.fireLight.intensity = 5.2 + Math.sin(t * 1.3) * 1.6;
    }
  }

  // The company, in the colours they will fly in. Built per level because the
  // knight count changes, and because the man at the front of the queue is the
  // one you are about to throw — he should be wearing what lands.
  buildWaiting(pals) {
    if (!this.campGroup) return;
    for (const k of this.waiting || []) {
      this.campGroup.remove(k);
      k.traverse(o => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
    }
    this.waiting = [];
    for (let i = 0; i < pals.length; i++) {
      const k = this.knightRig(pals[i]);
      // Two ranks, the front one nearest the machine.
      const col = i % 4, row = (i / 4) | 0;
      const x = -2.5 - row * 1.25, z = -1.9 + col * 1.06 + row * 0.26;
      // The rig's feet sit 0.61 below its origin at 0.92 scale. At 0.86 the
      // whole company hovered, boots in the air.
      k.position.set(x, 0.61, z);
      k.rotation.y = 1.15 + (Math.random() - 0.5) * 0.4;
      k.userData.baseY = 0.61;
      k.userData.baseYaw = k.rotation.y;
      k.userData.phase = i * 1.7 + Math.random();
      this.campGroup.add(k);
      this.waiting.push(k);
    }
  }

  // The waiting knights are the ammunition counter, in the world. They are
  // spent from the FRONT, so the row shortens toward the machine.
  setWaiting(n) {
    if (!this.waiting) return;
    const spent = this.waiting.length - n;
    for (let i = 0; i < this.waiting.length; i++) this.waiting[i].visible = i >= spent;
  }

  // The pop. A soldier leaving the field has to be the loudest thing that
  // happens, or crushing one under a wall reads as nothing at all.
  popSoldier(x, y, z, vel) {
    this.puff(x, y, z, 1.7, 14);
    this.spark(x, y, z, 1.25, 18);
    this.ring(x, y, z, 0.9);
    this.kick(0.42);
    // The helm survives and bounces — a small readable "that one is done".
    if (this.helms) {
      const h = this.helms[this._helm++ % this.helms.length];
      h.visible = true;
      h.position.set(x, y + 0.4, z);
      h.userData.v.set(
        (vel ? vel.x * 0.3 : 0) + rnd(-2.5, 2.5),
        rnd(4.5, 8.5),
        (vel ? vel.z * 0.3 : 0) + rnd(-2.5, 2.5));
      h.userData.w.set(rnd(-12, 12), rnd(-12, 12), rnd(-12, 12));
      h.userData.life = 2.6;
    }
  }

  kick(amount) {
    if (!SET.shake || SET.reduceMotion) return;
    this.shake = Math.min(1.4, this.shake + amount);
  }

  applyShake(dt) {
    if (this.shake <= 0.0005) { this.shake = 0; return; }
    this.shake *= Math.pow(0.0016, dt);
    const s = this.shake;
    this.shakeV.set(rnd(-1, 1) * s, rnd(-1, 1) * s, rnd(-1, 1) * s);
    this.camera.position.add(this.shakeV);
  }

  render() { this.renderer.render(this.scene, this.camera); }
}

// ---- small helpers --------------------------------------------------------

function rnd(a, b) { return a + Math.random() * (b - a); }

// Procedural surface: mortar joints, blotchy wear, and cracks that accumulate
// with the damage tier. Mostly white so the material's own colour tints it.
const _surfCache = {};
function surfaceTex(kind, tier) {
  const key = kind + tier;
  if (_surfCache[key]) return _surfCache[key];
  const S = 128;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d');
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, S, S);

  if (kind === 'wood') {
    for (let i = 0; i < 16; i++) {
      const y = (i / 16) * S + Math.random() * 3;
      g.strokeStyle = `rgba(120,90,60,${0.10 + Math.random() * 0.14})`;
      g.lineWidth = 1 + Math.random() * 2.4;
      g.beginPath(); g.moveTo(0, y);
      for (let x = 0; x <= S; x += 16) g.lineTo(x, y + Math.sin(x * 0.08 + i) * 2.4);
      g.stroke();
    }
  } else {
    // Blotchy wear.
    for (let i = 0; i < 42; i++) {
      const x = Math.random() * S, y = Math.random() * S, r = 4 + Math.random() * 18;
      const grd = g.createRadialGradient(x, y, 0, x, y, r);
      const a = 0.05 + Math.random() * 0.09;
      grd.addColorStop(0, `rgba(120,112,96,${a})`);
      grd.addColorStop(1, 'rgba(120,112,96,0)');
      g.fillStyle = grd; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
    }
    // Mortar joint around the edge, so a bare cube reads as a dressed stone.
    g.strokeStyle = 'rgba(96,88,74,0.26)'; g.lineWidth = 6;
    g.strokeRect(3, 3, S - 6, S - 6);
    g.strokeStyle = 'rgba(255,252,244,0.20)'; g.lineWidth = 2;
    g.strokeRect(8, 8, S - 16, S - 16);
    // A slight per-texture tone shift stops a wall of cubes reading as tiling.
    g.fillStyle = `rgba(${180 + tier * 6},${172},${156},0.05)`;
    g.fillRect(0, 0, S, S);
  }

  // Cracks. None at tier 0, a fracture at tier 1, a shattered face at tier 2.
  const cracks = tier === 0 ? 0 : tier === 1 ? 2 : 5;
  for (let i = 0; i < cracks; i++) {
    g.strokeStyle = `rgba(38,32,26,${0.5 + tier * 0.16})`;
    g.lineWidth = 1 + Math.random() * (1 + tier);
    let x = Math.random() * S, y = Math.random() * S;
    g.beginPath(); g.moveTo(x, y);
    const steps = 4 + ((Math.random() * 4) | 0);
    for (let k = 0; k < steps; k++) {
      x += (Math.random() - 0.5) * 46; y += (Math.random() - 0.5) * 46;
      g.lineTo(x, y);
    }
    g.stroke();
  }

  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;             // unflagged renders washed
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  _surfCache[key] = t;
  return t;
}

let _markerTex = null;
function markerTex() {
  if (_markerTex) return _markerTex;
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const g = cv.getContext('2d');
  g.fillStyle = '#fff';
  g.beginPath(); g.moveTo(32, 52); g.lineTo(10, 16); g.lineTo(54, 16); g.closePath(); g.fill();
  g.globalCompositeOperation = 'destination-out';
  g.beginPath(); g.moveTo(32, 42); g.lineTo(19, 22); g.lineTo(45, 22); g.closePath(); g.fill();
  _markerTex = new THREE.CanvasTexture(cv);
  _markerTex.colorSpace = THREE.SRGBColorSpace;
  return _markerTex;
}

function groundTex(theme) {
  const S = 64;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d');
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, S, S);
  for (let i = 0; i < 90; i++) {
    const x = Math.random() * S, y = Math.random() * S;
    const c = new THREE.Color(theme ? theme.patchB : 0x5d7440);
    g.strokeStyle = `rgba(${(c.r * 255) | 0},${(c.g * 255) | 0},${(c.b * 255) | 0},${0.12 + Math.random() * 0.2})`;
    g.lineWidth = 1;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + (Math.random() - 0.5) * 4, y - 2 - Math.random() * 3); g.stroke();
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

function ringTex() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const g = cv.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 40, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,255,255,0)');
  grd.addColorStop(0.62, 'rgba(255,255,255,0.95)');
  grd.addColorStop(0.82, 'rgba(255,255,255,0.35)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function radialTex(inner, outer) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const g = cv.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, inner);
  grd.addColorStop(1, outer);
  g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function sprite(tex, size, color, opacity, pos, blending) {
  const m = new THREE.Sprite(new THREE.SpriteMaterial({
    map: tex, color, transparent: true, opacity, depthWrite: false, fog: false,
    blending: blending || THREE.NormalBlending }));
  m.scale.set(size, size, 1);
  m.position.copy(pos);
  return m;
}

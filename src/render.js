// render.js — scene, materials, models, FX.

import * as THREE from '../vendor/three.module.js';
import { activeQuality, SET } from './settings.js';
import { THEMES } from './levels.js';

const UNIT = new THREE.BoxGeometry(1, 1, 1);

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
  setScatterDensity(n) {
    if (!this.scatter) return;
    for (let i = 0; i < this.scatter.length; i++) this.scatter[i].visible = i < n * 2;
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
    this.envGroup.add(sprite(radialTex('rgba(255,243,212,0.95)', 'rgba(255,216,154,0)'),
      150, theme.sunColour, 0.8, disc.position.clone(), THREE.AdditiveBlending));

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
  // A prop library rather than "trees and rocks". The mix and the set-pieces
  // come from the theme, so the same code makes a summer meadow, a harvest
  // field and a dead marsh.

  _scenery(theme) {
    const M = {
      trunk: new THREE.MeshStandardMaterial({ color: theme.trunk, roughness: 1 }),
      rock: new THREE.MeshStandardMaterial({ color: theme.rock, roughness: 1, flatShading: true }),
      tuft: new THREE.MeshStandardMaterial({ color: theme.tuft, roughness: 1, flatShading: true }),
      wood: new THREE.MeshStandardMaterial({ color: 0x6a4a2c, roughness: 0.95 }),
    };
    M.hay = new THREE.MeshStandardMaterial({ color: 0xc9a94e, roughness: 1, flatShading: true });
    M.canopy = theme.canopy.map(c =>
      new THREE.MeshStandardMaterial({ color: c, roughness: 1, flatShading: true }));
    M.stone = new THREE.MeshStandardMaterial({ color: theme.rock, roughness: 1 });
    M.water = new THREE.MeshStandardMaterial({ color: theme.water, roughness: 0.18,
      metalness: 0.36, transparent: true, opacity: 0.86 });
    M.reed = new THREE.MeshStandardMaterial({ color: 0x6c7a42, roughness: 1, flatShading: true,
      side: THREE.DoubleSide });
    M.flower = theme.flowers.map(c => new THREE.MeshStandardMaterial({ color: c, roughness: 1 }));

    const add = (m, scatter = true) => {
      this.envGroup.add(m);
      if (scatter) this.scatter.push(m);
      return m;
    };
    const R = () => Math.random();

    // Somewhere on the field, but never on the orbit road or the castle.
    const spot = (min = this.orbitR + 3, max = this.orbitR + 120) => {
      const a = R() * Math.PI * 2;
      const r = min + Math.pow(R(), 0.62) * (max - min);
      return [Math.cos(a) * r, Math.sin(a) * r];
    };

    const broadleaf = (x, z, s = 1) => {
      const h = (4.5 + R() * 4) * s;
      const t = new THREE.Mesh(new THREE.CylinderGeometry(0.2 * s, 0.42 * s, h, 6), M.trunk);
      t.position.set(x, h / 2, z); t.castShadow = true; add(t);
      const mat = M.canopy[(R() * M.canopy.length) | 0];
      // Three overlapping lumps, not one cone — a single cone is a Christmas
      // tree and every broadleaf in the game looked identical.
      for (let i = 0; i < 3; i++) {
        const rr = (1.5 + R() * 1.2) * s;
        const c = new THREE.Mesh(new THREE.IcosahedronGeometry(rr, 0), mat);
        c.position.set(x + (R() - 0.5) * 1.8 * s, h * (0.82 + R() * 0.32), z + (R() - 0.5) * 1.8 * s);
        c.rotation.set(R() * 3, R() * 3, R() * 3);
        c.castShadow = true; add(c);
      }
    };

    const conifer = (x, z, s = 1) => {
      const h = (6 + R() * 5) * s;
      const t = new THREE.Mesh(new THREE.CylinderGeometry(0.16 * s, 0.34 * s, h * 0.5, 5), M.trunk);
      t.position.set(x, h * 0.25, z); t.castShadow = true; add(t);
      const mat = M.canopy[(R() * M.canopy.length) | 0];
      for (let i = 0; i < 3; i++) {
        const f = 1 - i * 0.26;
        const c = new THREE.Mesh(new THREE.ConeGeometry(1.9 * f * s, h * 0.5 * f + 1, 6), mat);
        c.position.set(x, h * (0.32 + i * 0.24), z);
        c.rotation.y = R() * 3; c.castShadow = true; add(c);
      }
    };

    // Bare, forked and slightly leaning. Does most of the work in the marsh.
    const dead = (x, z, s = 1) => {
      const h = (4 + R() * 4) * s;
      const t = new THREE.Mesh(new THREE.CylinderGeometry(0.12 * s, 0.34 * s, h, 5), M.trunk);
      t.position.set(x, h / 2, z);
      t.rotation.z = (R() - 0.5) * 0.34;
      t.castShadow = true; add(t);
      for (let i = 0; i < 3 + ((R() * 3) | 0); i++) {
        const bl = (1 + R() * 2) * s;
        const br = new THREE.Mesh(new THREE.CylinderGeometry(0.05 * s, 0.11 * s, bl, 4), M.trunk);
        const a = R() * Math.PI * 2, lean = 0.5 + R() * 0.7;
        br.position.set(x + Math.cos(a) * bl * 0.3, h * (0.55 + R() * 0.4), z + Math.sin(a) * bl * 0.3);
        br.rotation.set(Math.cos(a) * lean, 0, Math.sin(a) * -lean);
        br.castShadow = true; add(br);
      }
    };

    const bush = (x, z) => {
      const mat = M.canopy[(R() * M.canopy.length) | 0];
      for (let i = 0; i < 2 + ((R() * 2) | 0); i++) {
        const rr = 0.5 + R() * 0.7;
        const c = new THREE.Mesh(new THREE.IcosahedronGeometry(rr, 0), mat);
        c.position.set(x + (R() - 0.5) * 1.2, rr * 0.8, z + (R() - 0.5) * 1.2);
        c.rotation.set(R() * 3, R() * 3, R() * 3);
        c.castShadow = true; add(c);
      }
    };

    const rock = (x, z) => {
      const s = 0.5 + R() * 1.6;
      const m = new THREE.Mesh(new THREE.DodecahedronGeometry(s, 0), M.rock);
      m.position.set(x, s * 0.5, z);
      m.rotation.set(R() * 3, R() * 3, R() * 3);
      m.scale.set(1, 0.6 + R() * 0.5, 1);
      m.castShadow = true; m.receiveShadow = true; add(m);
    };

    const tuft = (x, z) => {
      const m = new THREE.Mesh(new THREE.ConeGeometry(0.45 + R() * 0.3, 0.7 + R() * 0.6, 4), M.tuft);
      m.position.set(x, 0.4, z); m.rotation.y = R() * 3; add(m);
      // A few flowers in the grass. Tiny, but they are the only saturated thing
      // on the field and the eye finds them immediately.
      if (R() < 0.45) {
        for (let i = 0; i < 2 + ((R() * 3) | 0); i++) {
          const f = new THREE.Mesh(new THREE.SphereGeometry(0.09, 5, 4),
            M.flower[(R() * M.flower.length) | 0]);
          f.position.set(x + (R() - 0.5) * 1.6, 0.42 + R() * 0.2, z + (R() - 0.5) * 1.6);
          add(f);
        }
      }
    };

    // ---- scatter ----
    const mix = theme.mix;
    const roll = () => {
      let r = R(), acc = 0;
      for (const k of Object.keys(mix)) { acc += mix[k]; if (r <= acc) return k; }
      return 'tuft';
    };
    // Clustered, not sprinkled. An even scatter of same-sized trees reads as
    // wallpaper; copses with gaps between them read as countryside.
    const place = (x, z, s) => {
      switch (roll()) {
        case 'broadleaf': broadleaf(x, z, s); break;
        case 'conifer': conifer(x, z, s); break;
        case 'dead': dead(x, z, s); break;
        case 'bush': bush(x, z); break;
        case 'rock': rock(x, z); break;
        default: tuft(x, z);
      }
    };
    for (let c = 0; c < 22; c++) {
      const [cx, cz] = spot();
      const n = 2 + ((R() * 7) | 0);
      const spread = 4 + R() * 12;
      for (let i = 0; i < n; i++) {
        // Size falls off from the middle of the copse, so each one has a crown.
        const f = i / n;
        place(cx + (R() - 0.5) * spread, cz + (R() - 0.5) * spread,
          (1.25 - f * 0.5) * (0.7 + R() * 0.6));
      }
    }
    for (let i = 0; i < 46; i++) {          // loners between the copses
      const [x, z] = spot();
      place(x, z, 0.65 + R() * 0.8);
    }

    // ---- set pieces ----
    const P = theme.props;

    // Hedgerow fences: posts and two rails, following a gentle arc.
    for (let f = 0; f < P.fences; f++) {
      const [sx, sz] = spot(this.orbitR + 7, this.orbitR + 55);
      const dir = R() * Math.PI * 2, n = 5 + ((R() * 6) | 0);
      for (let i = 0; i < n; i++) {
        const bend = Math.sin(i * 0.5) * 0.5;
        const px = sx + Math.cos(dir + bend) * i * 2.4;
        const pz = sz + Math.sin(dir + bend) * i * 2.4;
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.16, 1.5, 0.16), M.wood);
        post.position.set(px, 0.72, pz); post.castShadow = true; add(post);
        if (i) {
          for (const h of [0.6, 1.15]) {
            const rail = new THREE.Mesh(new THREE.BoxGeometry(2.45, 0.11, 0.09), M.wood);
            const qx = sx + Math.cos(dir + bend) * (i - 0.5) * 2.4;
            const qz = sz + Math.sin(dir + bend) * (i - 0.5) * 2.4;
            rail.position.set(qx, h, qz);
            rail.rotation.y = -(dir + bend);
            add(rail);
          }
        }
      }
    }

    // Stooks — cones of cut corn standing in the stubble.
    for (let i = 0; i < P.hay; i++) {
      const [x, z] = spot(this.orbitR + 6, this.orbitR + 48);
      const cluster = 1 + ((R() * 4) | 0);
      for (let k = 0; k < cluster; k++) {
        const h = 1.6 + R() * 0.9;
        const m = new THREE.Mesh(new THREE.ConeGeometry(0.85, h, 7), M.hay);
        m.position.set(x + (R() - 0.5) * 3.4, h / 2, z + (R() - 0.5) * 3.4);
        m.rotation.y = R() * 3;
        m.castShadow = true; add(m);
      }
    }

    for (let i = 0; i < P.cart; i++) {
      const [x, z] = spot(this.orbitR + 6, this.orbitR + 42);
      const g = new THREE.Group();
      const bed = new THREE.Mesh(new THREE.BoxGeometry(3.0, 0.34, 1.5), M.wood);
      bed.position.y = 1.0; g.add(bed);
      for (const sx of [-1, 1]) {
        const side = new THREE.Mesh(new THREE.BoxGeometry(3.0, 0.7, 0.12), M.wood);
        side.position.set(0, 1.4, sx * 0.7); g.add(side);
        for (const wx of [-0.95, 0.95]) {
          const w = new THREE.Mesh(new THREE.CylinderGeometry(0.72, 0.72, 0.18, 12), M.wood);
          w.rotation.x = Math.PI / 2; w.position.set(wx, 0.72, sx * 0.86); g.add(w);
        }
      }
      const shaft = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.12, 0.12), M.wood);
      shaft.position.set(2.2, 0.8, 0); shaft.rotation.z = 0.18; g.add(shaft);
      g.position.set(x, 0, z); g.rotation.y = R() * 6;
      g.traverse(o => { if (o.isMesh) o.castShadow = true; });
      add(g);
    }

    // Standing water, with reeds around the rim.
    for (let i = 0; i < P.pond; i++) {
      const [x, z] = spot(this.orbitR + 8, this.orbitR + 52);
      const rr = 5 + R() * 7;
      const w = new THREE.Mesh(new THREE.CircleGeometry(rr, 26).rotateX(-Math.PI / 2), M.water);
      w.position.set(x, 0.05, z);
      w.scale.set(1, 1, 0.6 + R() * 0.6);
      add(w);
      const bank = new THREE.Mesh(new THREE.CircleGeometry(rr * 1.25, 26).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ color: theme.scorch, transparent: true, opacity: 0.4,
          map: this._soft, depthWrite: false }));
      bank.position.set(x, 0.03, z); bank.scale.copy(w.scale);
      add(bank);
      for (let k = 0; k < 14; k++) {
        const a = R() * Math.PI * 2, d = rr * (0.85 + R() * 0.4);
        const rd = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 1.4 + R()), M.reed);
        rd.position.set(x + Math.cos(a) * d, 0.7, z + Math.sin(a) * d * (0.6 + R() * 0.6));
        rd.rotation.y = R() * 3; add(rd);
      }
    }

    for (let i = 0; i < P.reeds; i++) {
      const [x, z] = spot(this.orbitR + 5, this.orbitR + 45);
      for (let k = 0; k < 5; k++) {
        const rd = new THREE.Mesh(new THREE.PlaneGeometry(0.45, 1.2 + R()), M.reed);
        rd.position.set(x + (R() - 0.5) * 2.2, 0.62, z + (R() - 0.5) * 2.2);
        rd.rotation.y = R() * 3; add(rd);
      }
    }

    // Broken walls: the same masonry as the castle, half fallen.
    for (let i = 0; i < P.ruin; i++) {
      const [x, z] = spot(this.orbitR + 7, this.orbitR + 46);
      const dir = R() * Math.PI * 2, n = 4 + ((R() * 4) | 0);
      for (let c = 0; c < 3; c++) {
        for (let k = 0; k < n; k++) {
          if (R() < 0.16 + c * 0.24) continue;              // the collapse
          const off = (c % 2) * 0.75;
          const px = x + Math.cos(dir) * (k * 1.5 + off);
          const pz = z + Math.sin(dir) * (k * 1.5 + off);
          const m = new THREE.Mesh(new THREE.BoxGeometry(1.45, 0.7, 0.9), M.stone);
          m.position.set(px, 0.36 + c * 0.7, pz);
          m.rotation.y = -dir + (R() - 0.5) * 0.06;
          m.castShadow = true; m.receiveShadow = true; add(m);
        }
      }
    }

    for (let i = 0; i < P.stones; i++) {
      const [x, z] = spot(this.orbitR + 7, this.orbitR + 55);
      const n = 4 + ((R() * 4) | 0), rr = 3 + R() * 3;
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2;
        const h = 2.4 + R() * 2.4;
        const m = new THREE.Mesh(new THREE.BoxGeometry(0.9 + R() * 0.5, h, 0.55 + R() * 0.3), M.stone);
        m.position.set(x + Math.cos(a) * rr, h / 2, z + Math.sin(a) * rr);
        m.rotation.set((R() - 0.5) * 0.12, a, (R() - 0.5) * 0.12);
        m.castShadow = true; add(m);
      }
    }

    // Birds: three-segment silhouettes wheeling slowly overhead. Cheap, and the
    // sky stops being an empty gradient.
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

  knightMesh() {
    const g = new THREE.Group();
    const steel = new THREE.MeshStandardMaterial({ color: 0xb9c0c8, roughness: 0.32, metalness: 0.88 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x3d4450, roughness: 0.6, metalness: 0.4 });
    const cloth = new THREE.MeshStandardMaterial({ color: 0x2f5f8c, roughness: 0.85 });
    const gold = new THREE.MeshStandardMaterial({ color: 0xd6b45e, roughness: 0.28, metalness: 0.9 });

    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 0.34, 4, 10), steel);
    torso.position.y = 0.06; g.add(torso);
    const surcoat = new THREE.Mesh(new THREE.CylinderGeometry(0.31, 0.36, 0.4, 10), cloth);
    surcoat.position.y = -0.12; g.add(surcoat);

    const helm = new THREE.Mesh(new THREE.CylinderGeometry(0.21, 0.24, 0.32, 9), steel);
    helm.position.y = 0.52; g.add(helm);
    const helmTop = new THREE.Mesh(new THREE.SphereGeometry(0.21, 10, 7, 0, Math.PI * 2, 0, Math.PI / 2), steel);
    helmTop.position.y = 0.68; g.add(helmTop);
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.055, 0.06), dark);
    visor.position.set(0, 0.55, 0.21); g.add(visor);
    const plume = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.4, 6),
      new THREE.MeshStandardMaterial({ color: 0xc8443a, roughness: 0.9 }));
    plume.position.y = 0.9; g.add(plume);

    for (const s of [-1, 1]) {
      const pauldron = new THREE.Mesh(new THREE.SphereGeometry(0.16, 9, 7), steel);
      pauldron.position.set(s * 0.3, 0.24, 0); g.add(pauldron);
      const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.11, 0.26, 3, 7), dark);
      leg.position.set(s * 0.14, -0.42, 0); g.add(leg);
    }

    // Lance — reads the tumble instantly, which a smooth ball never would.
    const lance = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.085, 1.5, 7),
      new THREE.MeshStandardMaterial({ color: 0x6b4b2e, roughness: 0.85 }));
    lance.rotation.z = Math.PI / 2; lance.rotation.y = 0.14;
    lance.position.set(0.55, 0.12, 0.18); g.add(lance);
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.3, 7), steel);
    tip.rotation.z = -Math.PI / 2; tip.position.set(1.42, 0.12, 0.18); g.add(tip);

    const shield = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.6, 0.46), cloth);
    shield.position.set(-0.34, 0.04, 0); g.add(shield);
    const boss = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), gold);
    boss.position.set(-0.4, 0.06, 0); g.add(boss);

    g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    g.scale.setScalar(0.92);
    this.scene.add(g);
    return g;
  }

  // ---- the launcher -------------------------------------------------------

  _onager() {
    const g = new THREE.Group();
    const wood = new THREE.MeshStandardMaterial({ color: 0x6a4a2c, roughness: 0.86 });
    const iron = new THREE.MeshStandardMaterial({ color: 0x565c66, roughness: 0.42, metalness: 0.8 });
    const rope = new THREE.MeshStandardMaterial({ color: 0xa88b5c, roughness: 1 });

    const base = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.42, 2.2), wood);
    base.position.y = 0.55; g.add(base);
    for (const s of [-1, 1]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.26, 0.3), wood);
      rail.position.set(0, 0.9, s * 0.9); g.add(rail);
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.3, 12), wood);
      wheel.rotation.x = Math.PI / 2; wheel.position.set(-1.0, 0.62, s * 1.16); g.add(wheel);
      const wheel2 = wheel.clone(); wheel2.position.x = 1.2; g.add(wheel2);
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.28, 1.9, 0.28), wood);
      post.position.set(-0.2, 1.75, s * 0.72); post.rotation.x = s * 0.12; g.add(post);
    }
    const skein = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 1.7, 10), rope);
    skein.rotation.z = Math.PI / 2; skein.position.set(-0.2, 1.0, 0); g.add(skein);

    // The arm is animated on release — it's the only thing that tells you the
    // shot actually left the machine.
    const arm = new THREE.Group();
    const beam = new THREE.Mesh(new THREE.BoxGeometry(0.26, 2.9, 0.26), wood);
    beam.position.y = 1.45; arm.add(beam);
    const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.44, 0.3, 0.3, 10, 1, true), iron);
    bowl.position.y = 2.9; arm.add(bowl);
    arm.position.set(-0.2, 1.0, 0);
    g.add(arm);
    this.arm = arm;
    this.armRest = -0.5;
    this.armAngle = this.armRest;

    const stop = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.5, 1.9), wood);
    stop.position.set(1.5, 1.4, 0); g.add(stop);

    g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    this.scene.add(g);
    this.onager = g;

    // A pennant on the machine, so the launch site is findable at any orbit.
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 3.4, 6), wood);
    pole.position.set(-1.6, 2.2, -0.9); g.add(pole);
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.5),
      new THREE.MeshStandardMaterial({ color: 0x2f5f8c, side: THREE.DoubleSide, roughness: 0.9 }));
    flag.position.set(-1.15, 3.5, -0.9); g.add(flag);
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

    // Ammunition: the knights who have not been fired yet, waiting by the arm.
    this.waiting = [];
    for (let i = 0; i < 8; i++) {
      const k = new THREE.Group();
      const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.24, 0.34, 3, 8), blue);
      body.position.y = 0.62; k.add(body);
      const helm = new THREE.Mesh(new THREE.SphereGeometry(0.19, 9, 6, 0, 7, 0, Math.PI * 0.62), steel);
      helm.position.y = 1.12; k.add(helm);
      const lance = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.05, 2.0, 5), wood);
      lance.position.set(0.24, 0.9, 0); lance.rotation.z = -0.16; k.add(lance);
      k.position.set(-2.6 - (i % 4) * 0.85, 0, -2.0 + ((i / 4) | 0) * 0.95 + (i % 4) * 0.12);
      k.rotation.y = 1.2 + Math.random() * 0.5;
      k.traverse(o => { if (o.isMesh) o.castShadow = true; });
      g.add(k);
      this.waiting.push(k);
    }

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
    const geo = new THREE.SphereGeometry(0.15, 7, 5);
    for (let i = 0; i < 42; i++) {
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
        color: 0xe0b25c, transparent: true, opacity: 0.85, depthWrite: false, fog: false }));
      m.visible = false;
      m.renderOrder = 5;
      this.scene.add(m);
      this.dots.push(m);
    }
    // Where the arc first meets something, drawn on the ground/wall.
    const ringGeo = new THREE.RingGeometry(0.5, 0.78, 24).rotateX(-Math.PI / 2);
    this.landRing = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({
      color: 0xe0b25c, transparent: true, opacity: 0.75, depthWrite: false, side: THREE.DoubleSide, fog: false }));
    this.landRing.visible = false;
    this.landRing.renderOrder = 5;
    this.scene.add(this.landRing);
  }

  showArc(pts, land) {
    for (let i = 0; i < this.dots.length; i++) {
      const d = this.dots[i];
      if (i < pts.length) {
        d.visible = true;
        d.position.copy(pts[i]);
        const f = i / this.dots.length;
        d.scale.setScalar(1 - f * 0.55);
        d.material.opacity = 0.9 - f * 0.6;
      } else d.visible = false;
    }
    if (land) { this.landRing.visible = true; this.landRing.position.copy(land); }
    else this.landRing.visible = false;
  }

  hideArc() {
    for (const d of this.dots) d.visible = false;
    this.landRing.visible = false;
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
    if (this.flag) this.flag.rotation.y = Math.sin(performance.now() * 0.002) * 0.22;
    if (this.flame) {
      const t = performance.now() * 0.006;
      const f = 0.85 + Math.sin(t) * 0.13 + Math.sin(t * 2.7) * 0.07;
      this.flame.scale.set(f, 0.85 + Math.sin(t * 1.7) * 0.2, f);
      this.flame.rotation.y += dt * 2.4;
      if (this.fireLight) this.fireLight.intensity = 5.2 + Math.sin(t * 1.3) * 1.6;
    }
  }

  // The waiting knights are the ammunition counter, in the world.
  setWaiting(n) {
    if (!this.waiting) return;
    for (let i = 0; i < this.waiting.length; i++) this.waiting[i].visible = i < n;
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

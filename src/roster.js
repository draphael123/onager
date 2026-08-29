// roster.js — the garrison book.
//
// A live 3D portrait of each foe type, turning on the spot and playing its own
// idle. A still image of a soldier tells you nothing about him; the model in
// motion is the only place his SIZE and bearing read, and size is the tell for
// what a Serjeant is going to do to your Lance.
//
// It runs on its own small WebGL context rather than borrowing the game's,
// because the panel is a DOM overlay sitting above the canvas — sharing the
// game renderer would mean scissoring a viewport to a moving div, and this is
// a menu that renders for a few seconds at a time.

import * as THREE from '../vendor/three.module.js';
import { MODELS, spawnCharacter, MODEL_HEIGHT } from './models.js';
import { FOES, foe } from './foes.js';

export class RosterView {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({
      canvas, antialias: true, alpha: true, powerPreference: 'low-power',
    });
    this.renderer.setPixelRatio(Math.min(2, devicePixelRatio || 1));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(30, 1, 0.1, 40);

    // Three-point-ish: a warm key from the front left, a cool fill so the
    // shaded side does not go to mud, and a rim to lift him off the panel.
    const key = new THREE.DirectionalLight(0xfff0d8, 2.6);
    key.position.set(-2.4, 3.4, 3.2);
    const rim = new THREE.DirectionalLight(0xa8c4ff, 1.5);
    rim.position.set(2.8, 2.0, -3.0);
    this.scene.add(key, rim,
      new THREE.HemisphereLight(0x9db4d4, 0x40382f, 1.05));

    // Metals in the KayKit atlas render near black with no environment, and
    // half this roster is in plate.
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const env = new THREE.Scene();
    env.background = new THREE.Color(0x6b7c96);
    this.env = pmrem.fromScene(env, 0.04).texture;
    this.scene.environment = this.env;
    pmrem.dispose();

    this.clock = new THREE.Clock();
    this.rig = null;
    this.mixer = null;
    this.turn = 0;
    this.running = false;
  }

  show(id) {
    this.clear();
    const F = foe(id);
    this.foeId = F.id;
    const g = new THREE.Group();

    if (MODELS.ready) {
      const m = spawnCharacter(F.model, { bodyTint: F.tint });
      m.scale.setScalar(1.55 / MODEL_HEIGHT * F.scale);
      m.position.y = -0.78;
      g.add(m);
      this.mixer = new THREE.AnimationMixer(m);
      const clip = MODELS.clips[F.idle] || MODELS.clips.Idle_A;
      if (clip) this.mixer.clipAction(clip).play();
    } else {
      // No models: a blocky stand-in, so the screen still says something about
      // his size and colour rather than showing an empty box.
      const body = new THREE.Mesh(
        new THREE.CapsuleGeometry(0.26 * F.scale, 0.5 * F.scale, 4, 10),
        new THREE.MeshStandardMaterial({ color: F.tint, roughness: 0.85 }));
      const head = new THREE.Mesh(
        new THREE.SphereGeometry(0.19 * F.scale, 12, 9),
        new THREE.MeshStandardMaterial({ color: 0x9aa3ad, roughness: 0.4, metalness: 0.7 }));
      head.position.y = 0.56 * F.scale;
      g.add(body, head);
    }

    // The Warden's ring, at a scale that fits the portrait rather than the
    // eight metres it actually covers — this is a likeness, not a diagram.
    if (F.shore) {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.74, 0.86, 52),
        new THREE.MeshBasicMaterial({
          color: 0x8f74d8, transparent: true, opacity: 0.5, side: THREE.DoubleSide,
          depthWrite: false, blending: THREE.AdditiveBlending }));
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = -0.78;
      g.add(ring);
      this.ring = ring;
    }

    // A pack is three men, so the portrait is three men. Showing one Rabble
    // beside one Serjeant is a lie about what you will be shooting at.
    if (F.pack && MODELS.ready) {
      for (const dx of [-0.52, 0.52]) {
        const m = spawnCharacter(F.model, { bodyTint: F.tint });
        m.scale.setScalar(1.55 / MODEL_HEIGHT * F.scale * 0.94);
        m.position.set(dx, -0.78, dx > 0 ? -0.3 : -0.16);
        m.rotation.y = dx > 0 ? -0.5 : 0.45;
        g.add(m);
        const mx = new THREE.AnimationMixer(m);
        const c = MODELS.clips[F.idle] || MODELS.clips.Idle_A;
        if (c) { const a = mx.clipAction(c); a.play(); a.time = Math.random() * c.duration; }
        (this.extraMixers = this.extraMixers || []).push(mx);
      }
    }

    this.scene.add(g);
    this.rig = g;
    this.turn = -0.5;
    this.resize();
  }

  clear() {
    if (this.rig) {
      this.scene.remove(this.rig);
      this.rig.traverse(o => { if (o.geometry) o.geometry.dispose(); });
    }
    this.rig = null;
    this.mixer = null;
    this.extraMixers = null;
    this.ring = null;
  }

  resize() {
    const w = this.canvas.clientWidth || 260;
    const h = this.canvas.clientHeight || 300;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // Framed on the BODY, not on the origin. Looking at y=0 with the feet at
    // -0.78 left a third of the frame as empty floor and made every foe look
    // small — which is the one thing this screen exists to communicate.
    this.camera.position.set(0, 0.30, 3.45);
    this.camera.lookAt(0, -0.18, 0);
    this.camera.updateProjectionMatrix();
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.clock.getDelta();
    const loop = () => {
      if (!this.running) return;
      this._raf = requestAnimationFrame(loop);
      const dt = Math.min(0.05, this.clock.getDelta());
      if (this.rig) {
        this.turn += dt * 0.5;
        this.rig.rotation.y = Math.sin(this.turn) * 0.72;
      }
      if (this.mixer) this.mixer.update(dt);
      for (const m of this.extraMixers || []) m.update(dt);
      if (this.ring) this.ring.rotation.z += dt * 0.5;
      this.renderer.render(this.scene, this.camera);
    };
    loop();
  }

  stop() {
    this.running = false;
    if (this._raf) cancelAnimationFrame(this._raf);
  }

  dispose() {
    this.stop();
    this.clear();
    if (this.env) this.env.dispose();
    this.renderer.dispose();
  }
}

// The book itself: the list, the portrait, and the notes on what beats him.
export function rosterHtml(unlockedLevel) {
  const rows = Object.keys(FOES).map((id) => {
    const F = FOES[id];
    return `<button class="foeRow" data-foe="${id}">
      <i style="background:#${F.tint.toString(16).padStart(6, '0')}"></i>
      <span class="fname">${F.name}</span>
      <span class="fsub">${F.blurb}</span>
    </button>`;
  }).join('');
  return `
    <h2>The garrison</h2>
    <p class="lead">Every castle is held by men, not walls. These are the men.</p>
    <div class="rosterWrap">
      <div class="foeList">${rows}</div>
      <div class="foeStage">
        <canvas id="foeCanvas"></canvas>
        <div class="foeCard">
          <div class="fcName" id="fcName"></div>
          <div class="fcRole" id="fcRole"></div>
          <div class="fcStats" id="fcStats"></div>
        </div>
      </div>
    </div>
    <button class="tbtn ghost" id="panelClose">Close</button>`;
}

// audio.js — WebAudio synthesis. No assets, no licensing.
//
// NOTE: the class is `Sfx`, never `Audio` — a class named Audio shadows the
// Web API global for the whole module and the error surfaces far downstream.

export class Sfx {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.enabled = true;
    this.last = {};
  }

  ensure() {
    if (this.ctx) return this.ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { this.enabled = false; return null; }
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.5;
    // A touch of compression keeps a 30-block collapse from clipping.
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -18; comp.ratio.value = 5; comp.attack.value = 0.004;
    this.master.connect(comp).connect(this.ctx.destination);
    return this.ctx;
  }

  resume() { const c = this.ensure(); if (c && c.state === 'suspended') c.resume(); }

  // Rate-limit a sound name so a collapse doesn't fire 40 identical cracks.
  _gate(name, ms) {
    const t = performance.now();
    if (this.last[name] && t - this.last[name] < ms) return false;
    this.last[name] = t; return true;
  }

  _noise(dur) {
    const c = this.ctx;
    const n = Math.max(1, Math.floor(c.sampleRate * dur));
    const buf = c.createBuffer(1, n, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    const src = c.createBufferSource(); src.buffer = buf;
    return src;
  }

  _env(node, gain, attack, decay) {
    const c = this.ctx, g = c.createGain(), t = c.currentTime;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    node.connect(g).connect(this.master);
    return g;
  }

  launch() {
    const c = this.ensure(); if (!c) return;
    // Torsion release: a wooden thump plus the skein's low groan.
    const o = c.createOscillator(); o.type = 'triangle';
    o.frequency.setValueAtTime(150, c.currentTime);
    o.frequency.exponentialRampToValueAtTime(44, c.currentTime + 0.22);
    this._env(o, 0.5, 0.005, 0.3); o.start(); o.stop(c.currentTime + 0.4);

    const n = this._noise(0.3);
    const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 900; f.Q.value = 1.1;
    n.connect(f); this._env(f, 0.28, 0.004, 0.24); n.start(); n.stop(c.currentTime + 0.34);
  }

  whoosh(speed) {
    const c = this.ensure(); if (!c) return;
    const n = this._noise(0.5);
    const f = c.createBiquadFilter(); f.type = 'bandpass';
    f.frequency.setValueAtTime(320, c.currentTime);
    f.frequency.linearRampToValueAtTime(180 + speed * 22, c.currentTime + 0.4);
    f.Q.value = 2.2;
    n.connect(f); this._env(f, 0.2, 0.09, 0.4); n.start(); n.stop(c.currentTime + 0.55);
  }

  // Struck stone: inharmonic partials, short. A harmonic stack sounds like a bell.
  stone(strength) {
    const c = this.ensure(); if (!c || !this._gate('stone', 34)) return;
    const s = Math.min(1, strength);
    const base = 190 + Math.random() * 130;
    for (const [mul, amp] of [[1, 0.34], [1.71, 0.2], [2.43, 0.13], [3.19, 0.08]]) {
      const o = c.createOscillator(); o.type = 'sine';
      o.frequency.value = base * mul * (0.94 + Math.random() * 0.12);
      this._env(o, amp * (0.35 + s * 0.75), 0.002, 0.1 + s * 0.16);
      o.start(); o.stop(c.currentTime + 0.4);
    }
    const n = this._noise(0.14);
    const f = c.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 1400;
    n.connect(f); this._env(f, 0.2 + s * 0.32, 0.001, 0.11); n.start(); n.stop(c.currentTime + 0.2);
  }

  wood(strength) {
    const c = this.ensure(); if (!c || !this._gate('wood', 30)) return;
    const s = Math.min(1, strength);
    const o = c.createOscillator(); o.type = 'square';
    o.frequency.setValueAtTime(420 + Math.random() * 180, c.currentTime);
    o.frequency.exponentialRampToValueAtTime(120, c.currentTime + 0.09);
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 2200;
    o.connect(f); this._env(f, 0.22 + s * 0.3, 0.002, 0.13);
    o.start(); o.stop(c.currentTime + 0.24);
  }

  rubble(mass) {
    const c = this.ensure(); if (!c || !this._gate('rubble', 220)) return;
    const n = this._noise(1.1);
    const f = c.createBiquadFilter(); f.type = 'lowpass';
    f.frequency.setValueAtTime(1100, c.currentTime);
    f.frequency.exponentialRampToValueAtTime(140, c.currentTime + 0.9);
    n.connect(f); this._env(f, 0.16 + Math.min(0.34, mass * 0.04), 0.05, 0.95);
    n.start(); n.stop(c.currentTime + 1.2);

    const o = c.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(58, c.currentTime);
    o.frequency.exponentialRampToValueAtTime(28, c.currentTime + 0.8);
    this._env(o, 0.34, 0.03, 0.85); o.start(); o.stop(c.currentTime + 1);
  }

  bannerDown(index) {
    const c = this.ensure(); if (!c) return;
    // Rising thirds — the third one resolves, so clearing feels like an ending.
    const notes = [[392, 523], [466, 622], [523, 784, 1046]][Math.min(2, index)] || [523];
    notes.forEach((hz, i) => {
      const o = c.createOscillator(); o.type = 'triangle';
      o.frequency.value = hz;
      const g = c.createGain(), t = c.currentTime + i * 0.09;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.3, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
      o.connect(g).connect(this.master);
      o.start(t); o.stop(t + 1);
    });
  }

  // A knockout needs its own sound or crushing one reads as nothing. Rising
  // pitch per kill in a shot, and a heavier low thump when they were crushed
  // rather than struck.
  soldierDown(chain, crushed) {
    const c = this.ensure(); if (!c) return;
    const t = c.currentTime;
    const base = 300 * Math.pow(1.18, Math.min(6, chain - 1));

    const o = c.createOscillator(); o.type = 'triangle';
    o.frequency.setValueAtTime(base * 1.6, t);
    o.frequency.exponentialRampToValueAtTime(base * 0.7, t + 0.16);
    this._env(o, 0.34, 0.004, 0.2); o.start(); o.stop(t + 0.3);

    const n = this._noise(0.22);
    const f = c.createBiquadFilter(); f.type = 'bandpass';
    f.frequency.value = crushed ? 420 : 1500; f.Q.value = 0.8;
    n.connect(f); this._env(f, crushed ? 0.4 : 0.26, 0.002, 0.2);
    n.start(); n.stop(t + 0.3);

    if (crushed) {
      const lo = c.createOscillator(); lo.type = 'sine';
      lo.frequency.setValueAtTime(96, t);
      lo.frequency.exponentialRampToValueAtTime(38, t + 0.3);
      this._env(lo, 0.42, 0.005, 0.34); lo.start(); lo.stop(t + 0.45);
    }
  }

  cleared() {
    const c = this.ensure(); if (!c) return;
    [392, 523, 659, 784].forEach((hz, i) => {
      const o = c.createOscillator(); o.type = 'triangle'; o.frequency.value = hz;
      const g = c.createGain(), t = c.currentTime + i * 0.13;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.26, t + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 1.4);
      o.connect(g).connect(this.master);
      o.start(t); o.stop(t + 1.5);
    });
  }

  failed() {
    const c = this.ensure(); if (!c) return;
    [294, 233].forEach((hz, i) => {
      const o = c.createOscillator(); o.type = 'sine'; o.frequency.value = hz;
      const g = c.createGain(), t = c.currentTime + i * 0.24;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.24, t + 0.05);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 1.5);
      o.connect(g).connect(this.master);
      o.start(t); o.stop(t + 1.6);
    });
  }

  dive() {
    const c = this.ensure(); if (!c) return;
    const o = c.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(880, c.currentTime);
    o.frequency.exponentialRampToValueAtTime(180, c.currentTime + 0.3);
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 2600;
    o.connect(f); this._env(f, 0.3, 0.006, 0.32);
    o.start(); o.stop(c.currentTime + 0.42);
  }

  tick(pitch = 1) {
    const c = this.ensure(); if (!c || !this._gate('tick', 28)) return;
    const o = c.createOscillator(); o.type = 'square';
    o.frequency.value = 1200 * pitch;
    this._env(o, 0.055, 0.001, 0.035); o.start(); o.stop(c.currentTime + 0.07);
  }
}

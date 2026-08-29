// rand.js — one seedable stream for everything that affects the SIMULATION.
//
// Renderer scatter (trees, rocks, material tints) deliberately stays on
// Math.random: it must not consume from this stream, or a headless run and a
// rendered run would diverge.
//
// Pinning the seed is not enough on its own — the same seed must also produce
// the same call ORDER, so never add a rnd() call inside a render-only path.

let state = 0x9e3779b9;

export function seed(n) { state = (n >>> 0) || 1; }

export function rnd01() {
  state |= 0; state = (state + 0x6D2B79F5) | 0;
  let t = Math.imul(state ^ (state >>> 15), 1 | state);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function rnd(a, b) { return a + rnd01() * (b - a); }

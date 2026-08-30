// editor.js — the castle workshop.
//
// A top-down plan, not a 3D scene. Every castle in this game is laid out on a
// plan and then given a height: walls run along X or Z, towers are circles,
// piers are dots, and the only genuinely 3D decision is what height a soldier
// or a slab sits at. Building a 3D gizmo editor would be weeks of work to make
// a job harder than it is on paper.
//
// What the plan cannot show — whether the thing stands up — is checked by the
// same audit the built-in castles are held to, and previewed by playing it.
//
// The canvas is 2D. The siege ring is drawn on it, because where you can stand
// is half of what makes a castle interesting, and it is invisible otherwise.

import { PIECES, PIECE_ORDER, LIMITS, blankDef, normaliseDef, defaultsFor,
  garrisonCount, knightCount, groundAt, topOf } from './leveldef.js';
import { TYPES, TYPE_ORDER } from './knights.js';
import { FOES } from './foes.js';
import { THEMES } from './levels.js';

const GRID = 1;                       // metres per grid step, and the snap
const TARGET_TINT = { levy: '#ff7a5e', rabble: '#c08a4a', watch: '#5f7f9c',
  serjeant: '#7d8794', warden: '#6f5aa8' };

export class Editor {
  constructor(canvas, def, onChange) {
    this.cv = canvas;
    this.g = canvas.getContext('2d');
    this.def = normaliseDef(def || blankDef());
    this.onChange = onChange || (() => {});
    this.sel = -1;
    this.tool = null;                 // a piece type, or null for select
    this.drag = null;
    this.hover = -1;
    this.undo = [];
    this.redo = [];
    this._bind();
    this.resize();
  }

  // ---- history ------------------------------------------------------------
  //
  // Whole-document snapshots. A castle is a couple of kilobytes of JSON and the
  // stack is capped at 60, so this costs nothing and is impossible to get
  // wrong — which matters more here than elegance.
  mark() {
    this.undo.push(JSON.stringify(this.def));
    if (this.undo.length > 60) this.undo.shift();
    this.redo.length = 0;
  }

  undoStep() {
    if (!this.undo.length) return;
    this.redo.push(JSON.stringify(this.def));
    this.def = normaliseDef(JSON.parse(this.undo.pop()));
    this.sel = Math.min(this.sel, this.def.pieces.length - 1);
    this.changed();
  }

  redoStep() {
    if (!this.redo.length) return;
    this.undo.push(JSON.stringify(this.def));
    this.def = normaliseDef(JSON.parse(this.redo.pop()));
    this.sel = Math.min(this.sel, this.def.pieces.length - 1);
    this.changed();
  }

  changed() { this.draw(); this.onChange(this.def); }

  // ---- view ---------------------------------------------------------------

  resize() {
    const r = this.cv.getBoundingClientRect();
    const dpr = Math.min(2, devicePixelRatio || 1);
    this.cv.width = Math.max(1, Math.round(r.width * dpr));
    this.cv.height = Math.max(1, Math.round(r.height * dpr));
    this.w = r.width; this.h = r.height;
    this.g.setTransform(dpr, 0, 0, dpr, 0, 0);
    // Fit the whole siege ring plus a margin, so the plan always shows where
    // the machine can stand rather than only the castle.
    const span = (this.def.orbitR + 6) * 2;
    this.scale = Math.min(this.w, this.h) / span;
    this.draw();
  }

  toWorld(px, py) {
    return { x: (px - this.w / 2) / this.scale, z: (py - this.h / 2) / this.scale };
  }

  toScreen(x, z) {
    return { px: this.w / 2 + x * this.scale, py: this.h / 2 + z * this.scale };
  }

  snap(v) { return Math.round(v / GRID) * GRID; }

  // ---- hit testing --------------------------------------------------------

  boxOf(p) {
    const f = PIECES[p.t].footprint(p);
    return { x0: p.x - f.hx, x1: p.x + f.hx, z0: p.z - f.hz, z1: p.z + f.hz };
  }

  pieceAt(x, z) {
    // Topmost first, so the thing drawn on top is the thing you grab.
    for (let i = this.def.pieces.length - 1; i >= 0; i--) {
      const b = this.boxOf(this.def.pieces[i]);
      const m = 0.4;                  // a little slack for the small pieces
      if (x >= b.x0 - m && x <= b.x1 + m && z >= b.z0 - m && z <= b.z1 + m) return i;
    }
    return -1;
  }

  // ---- editing ------------------------------------------------------------

  add(t, x, z) {
    if (this.def.pieces.length >= LIMITS.pieces) return null;
    this.mark();
    const p = defaultsFor(t);
    p.x = this.snap(x); p.z = this.snap(z);
    // Pushed BEFORE settling: support is by placement order, so the piece has
    // to be in the list to know where it sits in that order.
    this.def.pieces.push(p);
    this.settle(p);
    this.sel = this.def.pieces.length - 1;
    this.changed();
    return p;
  }

  // Move a piece to the top of the build order — "this goes on last". The one
  // control an order-based model needs, for when you place the roof and then
  // realise the wall under it came second.
  raise(i) {
    const p = this.def.pieces[i];
    if (!p || i === this.def.pieces.length - 1) return;
    this.mark();
    this.def.pieces.splice(i, 1);
    this.def.pieces.push(p);
    this.sel = this.def.pieces.length - 1;
    this.resettleAll();
    this.changed();
  }

  // Put a piece ON whatever is under it. Everything that takes a height —
  // soldiers, packs, pickets, standards, slabs — used to want an absolute
  // number the author had no way to know: a six-course tower's roof is at
  // 8.14, and guessing 7.6 leaves a lookout hovering half a metre in the air.
  // Snapping is on unless the author has typed a height themselves.
  settle(p) {
    if (p.pinY) return;
    const spec = PIECES[p.t];
    if (!spec.fields.y) return;
    // A slab is looked up across its whole span so a lintel finds the piers at
    // its ends; a man is looked up at his feet.
    const g = p.t === 'slab'
      ? groundAt(this.def, p.x, p.z, p, p.hx, p.hz)
      : groundAt(this.def, p.x, p.z, p);
    p.y = p.t === 'slab' ? g + p.hy : g;
  }

  remove(i) {
    if (i < 0 || i >= this.def.pieces.length) return;
    this.mark();
    this.def.pieces.splice(i, 1);
    this.sel = -1;
    this.changed();
  }

  duplicate(i) {
    if (i < 0 || this.def.pieces.length >= LIMITS.pieces) return;
    this.mark();
    const c = JSON.parse(JSON.stringify(this.def.pieces[i]));
    c.x += 2; c.z += 2;
    this.def.pieces.push(c);
    this.sel = this.def.pieces.length - 1;
    this.changed();
  }

  setField(i, k, v) {
    const p = this.def.pieces[i];
    if (!p) return;
    this.mark();
    p[k] = v;
    // Typing a height means you meant that height. Everything else — moving it,
    // making the tower taller — re-snaps it to what is beneath.
    if (k === 'y') p.pinY = true;
    else if (k === 'x' || k === 'z') this.settle(p);
    this.def = normaliseDef(this.def);
    // Changing a support changes what stands on it. Anything unpinned above
    // this piece follows it up or down rather than being left in mid-air.
    if (k !== 'y') this.resettleAll();
    this.changed();
  }

  resettleAll() {
    for (const q of this.def.pieces) {
      if (q.pinY) continue;
      const spec = PIECES[q.t];
      if (spec && spec.fields.y) this.settle(q);
    }
  }

  unpin(i) {
    const p = this.def.pieces[i];
    if (!p) return;
    this.mark();
    delete p.pinY;
    this.settle(p);
    this.changed();
  }

  setMeta(k, v) {
    this.mark();
    this.def[k] = v;
    this.def = normaliseDef(this.def);
    if (k === 'orbitR') this.resize();
    this.changed();
  }

  // ---- input --------------------------------------------------------------

  _bind() {
    const cv = this.cv;
    const pt = (e) => {
      const r = cv.getBoundingClientRect();
      return this.toWorld(e.clientX - r.left, e.clientY - r.top);
    };

    cv.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      cv.setPointerCapture(e.pointerId);
      const w = pt(e);
      if (this.tool) {
        const p = this.add(this.tool, w.x, w.z);
        // Placing stays armed on shift, so a row of merlons or a picket line
        // is one click each rather than a trip back to the palette.
        if (!e.shiftKey) this.tool = null;
        this.onChange(this.def);
        if (p) this.drag = { i: this.sel, dx: 0, dz: 0, moved: false };
        return;
      }
      const i = this.pieceAt(w.x, w.z);
      this.sel = i;
      if (i >= 0) {
        const p = this.def.pieces[i];
        this.mark();
        this.drag = { i, dx: p.x - w.x, dz: p.z - w.z, moved: false };
      }
      this.changed();
    });

    cv.addEventListener('pointermove', (e) => {
      const w = pt(e);
      if (this.drag) {
        const p = this.def.pieces[this.drag.i];
        if (!p) return;
        const nx = this.snap(w.x + this.drag.dx), nz = this.snap(w.z + this.drag.dz);
        if (nx !== p.x || nz !== p.z) {
          p.x = Math.max(-LIMITS.coord, Math.min(LIMITS.coord, nx));
          p.z = Math.max(-LIMITS.coord, Math.min(LIMITS.coord, nz));
          this.settle(p);
          this.drag.moved = true;
          this.changed();
        }
        return;
      }
      const h = this.pieceAt(w.x, w.z);
      if (h !== this.hover) { this.hover = h; this.draw(); }
      cv.style.cursor = this.tool ? 'copy' : (h >= 0 ? 'move' : 'default');
    });

    const up = () => {
      // A click that moved nothing should not leave an undo step behind.
      if (this.drag && !this.drag.moved) this.undo.pop();
      this.drag = null;
    };
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', up);
  }

  // ---- drawing ------------------------------------------------------------

  draw() {
    const g = this.g;
    if (!g) return;
    g.clearRect(0, 0, this.w, this.h);
    g.fillStyle = '#14111d';
    g.fillRect(0, 0, this.w, this.h);

    const S = this.scale;
    const c = this.toScreen(0, 0);

    // The ground the castle stands on.
    const pl = this.def.plinth;
    g.fillStyle = 'rgba(120,132,96,.16)';
    g.fillRect(c.px - pl[0] * S, c.py - pl[1] * S, pl[0] * 2 * S, pl[1] * 2 * S);
    g.strokeStyle = 'rgba(160,175,120,.4)'; g.lineWidth = 1;
    g.strokeRect(c.px - pl[0] * S, c.py - pl[1] * S, pl[0] * 2 * S, pl[1] * 2 * S);

    // Grid.
    g.strokeStyle = 'rgba(233,226,210,.055)'; g.lineWidth = 1;
    g.beginPath();
    const step = 5 * S;
    for (let x = c.px % step; x < this.w; x += step) { g.moveTo(x, 0); g.lineTo(x, this.h); }
    for (let y = c.py % step; y < this.h; y += step) { g.moveTo(0, y); g.lineTo(this.w, y); }
    g.stroke();

    // The siege ring, and the four bearings. Where you can stand IS the level
    // design here, so the plan has to show it.
    g.strokeStyle = 'rgba(224,178,92,.42)'; g.lineWidth = 1.5;
    g.setLineDash([5, 5]);
    g.beginPath(); g.arc(c.px, c.py, this.def.orbitR * S, 0, Math.PI * 2); g.stroke();
    g.setLineDash([]);
    g.font = '10px system-ui, sans-serif';
    g.fillStyle = 'rgba(224,178,92,.7)';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    for (const [nm, ang] of [['N', 0], ['E', Math.PI / 2], ['S', Math.PI], ['W', -Math.PI / 2]]) {
      const rr = (this.def.orbitR + 3.2) * S;
      g.fillText(nm, c.px + Math.sin(ang) * rr, c.py - Math.cos(ang) * rr);
    }

    for (let i = 0; i < this.def.pieces.length; i++) {
      this._piece(this.def.pieces[i], i === this.sel, i === this.hover);
    }

    // Centre cross, so "the middle" is findable when the plinth is off-screen.
    g.strokeStyle = 'rgba(233,226,210,.2)';
    g.beginPath();
    g.moveTo(c.px - 6, c.py); g.lineTo(c.px + 6, c.py);
    g.moveTo(c.px, c.py - 6); g.lineTo(c.px, c.py + 6);
    g.stroke();
  }

  _piece(p, selected, hovered) {
    const g = this.g, S = this.scale;
    const s = this.toScreen(p.x, p.z);
    const f = PIECES[p.t].footprint(p);
    const spec = PIECES[p.t];

    g.save();
    if (spec.target) {
      // Men are drawn as a filled dot in their own colour: they are the
      // objective, and on a plan full of grey rectangles they must not be grey.
      const col = p.t === 'soldier' ? (TARGET_TINT[p.foe] || '#ff7a5e')
        : p.t === 'pack' ? TARGET_TINT.rabble : TARGET_TINT.watch;
      if (p.t === 'picket') {
        g.strokeStyle = col; g.lineWidth = 2; g.setLineDash([3, 3]);
        g.beginPath();
        g.moveTo(s.px - (p.dx / 2) * S, s.py - (p.dz / 2) * S);
        g.lineTo(s.px + (p.dx / 2) * S, s.py + (p.dz / 2) * S);
        g.stroke(); g.setLineDash([]);
      }
      const n = p.t === 'soldier' ? 1 : 3;
      for (let k = 0; k < n; k++) {
        let ox = 0, oz = 0;
        if (p.t === 'pack') { const a = k / 3 * Math.PI * 2; ox = Math.cos(a) * 0.62; oz = Math.sin(a) * 0.62; }
        if (p.t === 'picket') { const u = n === 1 ? 0.5 : k / (n - 1); ox = p.dx * (u - 0.5); oz = p.dz * (u - 0.5); }
        g.fillStyle = col;
        g.beginPath();
        g.arc(s.px + ox * S, s.py + oz * S, Math.max(3, 0.34 * S), 0, Math.PI * 2);
        g.fill();
      }
    } else if (p.t === 'tower') {
      g.fillStyle = 'rgba(184,171,147,.34)';
      g.strokeStyle = 'rgba(212,202,180,.85)'; g.lineWidth = 2;
      g.beginPath(); g.arc(s.px, s.py, (p.r + p.thick) * S, 0, Math.PI * 2);
      g.fill(); g.stroke();
      g.beginPath(); g.arc(s.px, s.py, Math.max(1, (p.r - p.thick) * S), 0, Math.PI * 2);
      g.strokeStyle = 'rgba(212,202,180,.4)'; g.lineWidth = 1; g.stroke();
    } else if (p.t === 'banner') {
      g.strokeStyle = '#c8443a'; g.lineWidth = 2;
      g.beginPath(); g.moveTo(s.px, s.py + 7); g.lineTo(s.px, s.py - 8); g.stroke();
      g.fillStyle = '#c8443a';
      g.beginPath(); g.moveTo(s.px, s.py - 8); g.lineTo(s.px + 9, s.py - 5);
      g.lineTo(s.px, s.py - 2); g.closePath(); g.fill();
    } else {
      const fillFor = { stone: 'rgba(170,160,140,.42)', block: 'rgba(184,171,147,.34)',
        timber: 'rgba(138,99,57,.44)' };
      g.fillStyle = fillFor[p.mat] || 'rgba(184,171,147,.3)';
      g.strokeStyle = p.t === 'slab' ? 'rgba(240,200,120,.8)' : 'rgba(212,202,180,.8)';
      g.lineWidth = p.t === 'pier' ? 2.5 : 1.5;
      if (p.t === 'slab') g.setLineDash([4, 3]);
      g.fillRect(s.px - f.hx * S, s.py - f.hz * S, f.hx * 2 * S, f.hz * 2 * S);
      g.strokeRect(s.px - f.hx * S, s.py - f.hz * S, f.hx * 2 * S, f.hz * 2 * S);
      g.setLineDash([]);
      if (p.t === 'crate') {
        g.fillStyle = 'rgba(240,200,120,.6)';
        g.font = '9px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText(String(p.n), s.px, s.py);
      }
    }

    if (selected || hovered) {
      g.strokeStyle = selected ? '#e0b25c' : 'rgba(224,178,92,.45)';
      g.lineWidth = selected ? 2 : 1;
      g.setLineDash(selected ? [] : [3, 3]);
      const pad = 4;
      g.strokeRect(s.px - f.hx * S - pad, s.py - f.hz * S - pad,
        f.hx * 2 * S + pad * 2, f.hz * 2 * S + pad * 2);
      g.setLineDash([]);
    }
    g.restore();
  }
}

// ---------------------------------------------------------------------------
// checks
// ---------------------------------------------------------------------------

// What the plan CAN tell you without building the world. The real faults —
// interpenetration and floating masonry — need Rapier and are checked by
// verify() in main.js, which builds the castle headlessly and runs the same
// audit the built-in levels are held to.
export function planWarnings(def) {
  const d = normaliseDef(def);
  const out = [];
  const men = garrisonCount(d);
  const knights = knightCount(d);

  if (!men) out.push({ bad: true, msg: 'No garrison. There is nothing to win.' });
  if (!d.pieces.some(p => p.t === 'wall' || p.t === 'tower' || p.t === 'pier')) {
    out.push({ msg: 'No masonry. It will play as a shooting gallery.' });
  }
  if (men && knights < men) {
    out.push({ msg: `${knights} men against ${men}. That is a hard castle — `
      + 'every shot has to count.' });
  }
  if (men && knights > men * 2.5) {
    out.push({ msg: `${knights} men against ${men}. Generous; consider fewer.` });
  }

  // Anything outside the plinth is standing on open ground, which is legal but
  // almost never what somebody meant.
  const pl = d.plinth;
  const off = d.pieces.filter(p => Math.abs(p.x) > pl[0] + 0.5 || Math.abs(p.z) > pl[1] + 0.5);
  if (off.length) {
    out.push({ msg: `${off.length} piece${off.length > 1 ? 's' : ''} outside the plinth, `
      + 'standing on open ground.' });
  }

  // A castle nobody can reach is the one failure the player cannot see coming.
  const near = d.pieces.filter(p => Math.hypot(p.x, p.z) > d.orbitR - 4);
  if (near.length) {
    out.push({ bad: true, msg: `${near.length} piece${near.length > 1 ? 's' : ''} too close `
      + 'to the siege ring — the machine would be standing on top of them.' });
  }

  // Every bearing having something on it is not a rule, but every bearing
  // having NOTHING is a castle with one shot in it.
  const bearings = new Set();
  for (const p of d.pieces) {
    if (!PIECES[p.t].target) continue;
    const a = Math.atan2(p.x, -p.z);
    bearings.add(Math.round((a + Math.PI) / (Math.PI / 2)) % 4);
  }
  if (men && bearings.size === 1) {
    out.push({ msg: 'Every man is on one side. Circling the castle will not matter.' });
  }
  return out;
}

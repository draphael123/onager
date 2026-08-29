// main.js — boot, input, HUD, menus, loop.

import * as RAPIER from '../vendor/rapier.es.js';
import { Renderer } from './render.js';
import { Sfx } from './audio.js';
import { Game, S } from './game.js';
import { LEVELS, loadProgress, saveProgress } from './levels.js';
import { runSim, sweep, sweepAll, audit, bot, reachability, setSimLevel, FACE_ANGLE, BEST } from './sim.js';
import { SET, loadSettings, saveSettings, applySettings, activeQualityName, activeQuality } from './settings.js';

let prog = loadProgress();

const $ = (id) => document.getElementById(id);
const boot = $('boot'), bootmsg = $('bootmsg');

let game, rd, sfx;
let playing = false;                 // false while the title screen is up
let tTitle = 0;
const keys = new Set();

(async function start() {
  try {
    loadSettings();
    document.body.classList.add('pregame');
    if (matchMedia('(pointer: coarse)').matches) document.body.classList.add('touch');
    document.body.classList.toggle('lefty', SET.leftHanded);

    bootmsg.textContent = 'Loading physics';
    await RAPIER.init();

    bootmsg.textContent = 'Raising the fortress';
    rd = new Renderer($('stage'));
    sfx = new Sfx();
    game = new Game(rd, sfx, { level: 0 });
    applySettings(rd, sfx);
    rd.setScatterDensity(activeQuality().scatter);

    buildHud();
    wireInput();
    wireMenus();
    loop();

    window.__OK = true;
    boot.classList.add('gone');
  } catch (e) {
    console.error(e);
    window.__fail((e && e.message) || String(e));
  }
})();

// ---- HUD ------------------------------------------------------------------

let kpips = [], bpips = [], spips = [], csegs = [];

function buildHud() {
  const kw = $('knights'); kw.innerHTML = '';
  kpips = [];
  for (let i = 0; i < game.knightsTotal; i++) {
    const d = document.createElement('div'); d.className = 'kpip';
    kw.appendChild(d); kpips.push(d);
  }
  const sw = $('soldiers'); sw.innerHTML = '';
  spips = [];
  for (let i = 0; i < game.soldiersTotal; i++) {
    const d = document.createElement('div'); d.className = 'spip';
    sw.appendChild(d); spips.push(d);
  }
  const bw = $('banners'); bw.innerHTML = '';
  bpips = [];
  for (let i = 0; i < game.banners.length; i++) {
    const d = document.createElement('div'); d.className = 'bpip';
    bw.appendChild(d); bpips.push(d);
  }
  const cw = $('compass'); cw.innerHTML = '';
  csegs = [];
  for (let i = 0; i < game.faces.length; i++) {
    const d = document.createElement('div'); d.className = 'cseg';
    cw.appendChild(d); csegs.push(d);
  }
}

let hintT = 0;
function hint(t, secs = 4) { $('hint').textContent = t; hintT = secs; }

function syncPower() {
  $('powerfill').style.width = (game.power * 100).toFixed(1) + '%';
  $('powVal').textContent = (game.power * 100).toFixed(0) + '%';
}

function syncHud(dt) {
  for (let i = 0; i < kpips.length; i++)
    kpips[i].classList.toggle('spent', i >= game.knights);
  for (let i = 0; i < spips.length; i++)
    spips[i].classList.toggle('down', i < game.soldiersDown);
  for (let i = 0; i < bpips.length; i++)
    bpips[i].classList.toggle('down', game.banners[i].up0 === 0);
  // Narrow screens show these instead of the pip rows.
  $('knightsNum').innerHTML = `${game.knights}<i>/${game.knightsTotal}</i>`;
  $('soldiersNum').innerHTML =
    `${game.soldiersTotal - game.soldiersDown}<i>/${game.soldiersTotal}</i>`;

  const f = game.face();
  $('face').textContent = f.name;
  $('facesub').textContent = f.sub;

  let best = 0, bd = 9;
  for (let i = 0; i < game.faces.length; i++) {
    const fa = game.faces[i].a;
    const d = Math.abs(Math.atan2(Math.sin(game.angle - fa), Math.cos(game.angle - fa)));
    if (d < bd) { bd = d; best = i; }
  }
  csegs.forEach((c, i) => c.classList.toggle('on', i === best && !f.corner));

  if (game.msg) { hint(game.msg, 3); game.msg = ''; }
  if (hintT > 0) { hintT -= dt; if (hintT <= 0) $('hint').textContent = ''; }
}

function showCard() {
  const r = game.result; if (!r) return;
  const idx = game.levelIdx, L = LEVELS[idx];
  const last = idx >= LEVELS.length - 1;

  if (r.win) {
    prog.best[L.id] = Math.max(prog.best[L.id] || 0, r.score);
    if (!last) prog.unlocked = Math.max(prog.unlocked, idx + 2);
    saveProgress(prog);
  }

  $('cardTitle').textContent = r.win ? 'THE FORTRESS FALLS' : 'THE GARRISON HOLDS';
  $('cardSub').innerHTML = r.win
    ? `${L.name} &middot; ${r.score} points<br>${r.knightsLeft} knight${r.knightsLeft === 1 ? '' : 's'} unspent ` +
      `&middot; ${r.broken} blocks broken &middot; ${r.standards} standard${r.standards === 1 ? '' : 's'}`
    : `${r.standing} still holding the walls<br>${r.score} points &middot; ${r.broken} blocks broken`;

  const foot = $('cardBtns');
  foot.innerHTML = '';
  if (r.win && !last) {
    foot.appendChild(mkBtn('Next castle', () => startLevel(idx + 1), true));
  } else if (r.win && last) {
    foot.appendChild(mkBtn('All castles taken', () => toTitle(), true));
  }
  foot.appendChild(mkBtn(r.win ? 'Again' : 'Try again', () => startLevel(idx), !r.win));
  foot.appendChild(mkBtn('Castles', () => toTitle(), false, true));
  $('card').classList.add('on');
}

function mkBtn(label, fn, primary = false, ghost = false) {
  const b = document.createElement('button');
  b.className = 'tbtn' + (ghost || !primary ? ' ghost' : '');
  b.textContent = label;
  b.addEventListener('click', fn);
  return b;
}

// ---- drag band ------------------------------------------------------------
//
// The slingshot had no visual anchor at all: you dragged in empty space and the
// only feedback was an arm winding back thirty metres away. The band IS the
// cursor — anchor ring, taut cord, a power gauge, and a live angle/power
// readout that follows the pointer.

const GAUGE_R = 34, GAUGE_C = 2 * Math.PI * GAUGE_R;

function showBand(ax, ay, px, py) {
  const ring = $('bandRing'), track = $('bandTrack'), fill = $('bandFill');
  const cord = $('bandCord'), knob = $('bandKnob');
  $('band').classList.add('on');
  for (const el of [ring, track, fill]) { el.setAttribute('cx', ax); el.setAttribute('cy', ay); }
  track.setAttribute('stroke-dasharray', GAUGE_C);
  fill.setAttribute('stroke-dasharray', GAUGE_C);
  // The ring now shows how far the ARM is raised, since power left the drag.
  fill.setAttribute('stroke-dashoffset', GAUGE_C * (1 - (game.elev - 0.1047) / 1.047));
  const hot = game.power > 0.86 ? '#c8443a' : game.power > 0.55 ? '#e0b25c' : '#7fa86a';
  fill.setAttribute('stroke', hot);
  cord.setAttribute('x1', ax); cord.setAttribute('y1', ay);
  cord.setAttribute('x2', px); cord.setAttribute('y2', py);
  knob.setAttribute('cx', px); knob.setAttribute('cy', py);
  knob.setAttribute('fill', hot);

  const r = $('readout');
  r.classList.add('on');
  r.style.left = px + 'px'; r.style.top = py + 'px';
  const yawDeg = game.yaw * 180 / Math.PI;
  r.innerHTML = `<b>${(game.elev * 180 / Math.PI).toFixed(0)}&deg;</b> up &nbsp; ` +
    `<b>${yawDeg >= 0 ? '+' : ''}${yawDeg.toFixed(0)}&deg;</b> ${yawDeg >= 0 ? 'right' : 'left'}`;
}

function hideBand() {
  $('band').classList.remove('on');
  $('readout').classList.remove('on');
}

// ---- input ----------------------------------------------------------------

let orbitHeld = 0;                   // -1 / 0 / +1 from the touch buttons

function wireInput() {
  const cv = $('stage');
  let anchor = null, lastNotch = -1;

  const down = (e) => {
    sfx.resume();
    if (!playing || game.state !== S.AIM || game.knights <= 0) return;
    anchor = { x: e.clientX, y: e.clientY };
    game.dragging = true;
    game.setDrag(0, 0);
    lastNotch = -1;
    showBand(anchor.x, anchor.y, anchor.x, anchor.y);
    if (cv.setPointerCapture) cv.setPointerCapture(e.pointerId);
  };
  const move = (e) => {
    if (!anchor || !game.dragging) return;
    game.setDrag(e.clientX - anchor.x, e.clientY - anchor.y);
    showBand(anchor.x, anchor.y, e.clientX, e.clientY);
    // A notch every 10% of draw. Winding a torsion engine should be felt, and
    // on a touch screen this is the only feedback the hand ever gets.
    const notch = Math.floor(game.power * 10);
    if (notch !== lastNotch) {
      lastNotch = notch;
      sfx.tick(0.7 + notch * 0.09);
      buzz(5);
    }
  };
  const up = () => {
    if (!game.dragging) return;
    game.dragging = false;
    anchor = null;
    hideBand();
    game.fire();
    buzz(26);
    if (game.knights === game.knightsTotal - 1) hint('SPACE or DIVE mid-flight for a lance dive.', 5);
  };

  cv.addEventListener('pointerdown', down);
  addEventListener('pointermove', move);
  addEventListener('pointerup', up);
  addEventListener('pointercancel', up);

  addEventListener('keydown', (e) => {
    sfx.resume();
    const k = e.key.toLowerCase();
    keys.add(k);
    if (k === ' ') { e.preventDefault(); if (playing) game.dive(); }
    if (playing && game.state === S.AIM) {
      if (k === 'w' || k === 'arrowup') { e.preventDefault(); bumpPower(0.04); }
      if (k === 's' || k === 'arrowdown') { e.preventDefault(); bumpPower(-0.04); }
    }
    if (k === 'r' && playing) restart();
    if (k === 'escape') togglePanel();
  });
  addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
  addEventListener('blur', () => { keys.clear(); orbitHeld = 0; });

  // The result card builds its own buttons per outcome; see showCard().

  // Touch controls. Orbit is the third axis and there is no keyboard on a
  // phone, so it needs real buttons rather than a gesture that would fight
  // with the drag.
  const holdBtn = (id, dir) => {
    const el = $(id);
    const start = (e) => { e.preventDefault(); el.classList.add('held'); orbitHeld = dir; };
    const end = () => { el.classList.remove('held'); if (orbitHeld === dir) orbitHeld = 0; };
    el.addEventListener('pointerdown', start);
    el.addEventListener('pointerup', end);
    el.addEventListener('pointerleave', end);
    el.addEventListener('pointercancel', end);
  };
  holdBtn('tcL', -1);
  holdBtn('tcR', 1);
  // Range is its own control now. Wheel, W/S, arrows, and buttons for touch.
  const bumpPower = (d) => {
    game.addPower(d);
    syncPower();
    sfx.tick(0.7 + game.power * 0.6);
  };
  addEventListener('wheel', (e) => {
    if (!playing || game.state !== S.AIM) return;
    e.preventDefault();
    bumpPower(e.deltaY < 0 ? 0.04 : -0.04);
  }, { passive: false });
  const holdPow = (id, d) => {
    const el = $(id);
    let t = 0;
    const go = (e) => {
      e.preventDefault(); bumpPower(d);
      clearInterval(t); t = setInterval(() => bumpPower(d), 110);
    };
    const stop = () => clearInterval(t);
    el.addEventListener('pointerdown', go);
    el.addEventListener('pointerup', stop);
    el.addEventListener('pointerleave', stop);
    el.addEventListener('pointercancel', stop);
  };
  holdPow('powUp', 0.04);
  holdPow('powDown', -0.04);

  $('tcDive').addEventListener('pointerdown', (e) => {
    e.preventDefault(); sfx.resume(); if (playing && game.dive()) buzz(18);
  });
}

function buzz(ms) {
  if (SET.haptics && !SET.reduceMotion && navigator.vibrate) {
    try { navigator.vibrate(ms); } catch (e) { /* ignore */ }
  }
}

function restart() { startLevel(game.levelIdx); }

function startLevel(i) {
  $('card').classList.remove('on');
  closePanel();
  playing = true;
  $('title').classList.add('gone');
  // Hide it outright once the fade is done. A CSS transition can stall when the
  // tab is unfocused, leaving a fully opaque title sitting over the game.
  clearTimeout(titleHideT);
  titleHideT = setTimeout(() => { if (playing) $('title').style.display = 'none'; }, 620);
  document.body.classList.remove('pregame');
  document.body.classList.add('playing');
  game.setLevel(i);
  buildHud();
  const L = LEVELS[i];
  hint(`${L.name} — ${L.blurb}`, 6);
}

function toTitle() {
  $('card').classList.remove('on');
  closePanel();
  playing = false;
  document.body.classList.add('pregame');
  document.body.classList.remove('playing');
  clearTimeout(titleHideT);
  $('title').style.display = '';
  $('title').classList.remove('gone');
  renderLevelPicker();
}

// ---- menus ----------------------------------------------------------------

function wireMenus() {
  $('btnPlay').addEventListener('click', beginGame);
  renderLevelPicker();
  $('btnHow').addEventListener('click', () => openPanel(howToHtml()));
  $('btnSet').addEventListener('click', () => openPanel(settingsHtml(), wireSettings));
  $('gear').addEventListener('click', () => openPanel(settingsHtml(), wireSettings));
  $('panel').addEventListener('click', (e) => { if (e.target === $('panel')) closePanel(); });
}

function beginGame() {
  sfx.resume();
  startLevel(Math.min(prog.unlocked, LEVELS.length) - 1);
}

// The picker doubles as the level list: it shows what is unlocked and the best
// score on each, which is the whole progression UI.
function renderLevelPicker() {
  const wrap = $('levels');
  if (!wrap) return;
  wrap.innerHTML = '';
  LEVELS.forEach((L, i) => {
    const open = i < prog.unlocked;
    const b = document.createElement('button');
    b.className = 'lvl' + (open ? '' : ' locked');
    b.innerHTML = `<span class="n">${L.id}</span>` +
      `<span class="t">${L.name}<em>${open ? L.sub : 'Take the castle before it'}</em></span>` +
      `<span class="s">${prog.best[L.id] ? prog.best[L.id] : (open ? '&mdash;' : '&#128274;')}</span>`;
    if (open) b.addEventListener('click', () => { sfx.resume(); startLevel(i); });
    wrap.appendChild(b);
  });
  // The main button resumes at your furthest castle, so it must not keep
  // saying "begin" once you are three castles in.
  const play = $('btnPlay');
  if (play) play.textContent = prog.unlocked > 1 ? 'Continue the campaign' : 'Begin the siege';
}

function openPanel(html, wire) {
  $('sheet').innerHTML = html;
  $('panel').classList.add('on');
  if (wire) wire();
  const close = $('panelClose');
  if (close) close.addEventListener('click', closePanel);
}
function closePanel() { $('panel').classList.remove('on'); }
function togglePanel() {
  if ($('panel').classList.contains('on')) closePanel();
  else if (playing) openPanel(settingsHtml(), wireSettings);
}

function howToHtml() {
  return `
    <h2>How to play</h2>
    <div class="howRow"><kbd>A / D</kbd><div>
      <b>Circle the fortress.</b> This is the whole game. Each face is a
      different problem and one of them cannot be beaten at all — the compass
      tells you which face you are on and what it is. Hold <b>Shift</b> to trim.
    </div></div>
    <div class="howRow"><kbd>drag</kbd><div>
      <b>Draw the arm back.</b> The drag's angle sets elevation, its length sets
      power. Nothing else. The dotted arc is exactly where the knight will fly.
    </div></div>
    <div class="howRow"><kbd>space</kbd><div>
      <b>Lance dive.</b> Once per shot, in flight. Trades the rest of your arc
      for a steep fast drop &mdash; it turns a shot that would sail over into one
      that lands on a roof.
    </div></div>
    <div class="howRow"><kbd>R</kbd><div><b>Restart the siege.</b></div></div>
    <h3>Winning</h3>
    <div class="howRow"><kbd>&#9650;</kbd><div>
      Put the whole <b>garrison</b> down. Ride them down in person, or drop the
      building on them &mdash; a soldier under a collapsing arch counts, and
      counts for more. Standards are a bonus, not a requirement.
    </div></div>
    <div class="sheetFoot"><button class="tbtn" id="panelClose">Close</button></div>`;
}

function settingsHtml() {
  const sw = (id, on) => `<button class="sw ${on ? 'on' : ''}" id="${id}"></button>`;
  const seg = (id, opts, cur) => `<div class="seg" id="${id}">` +
    opts.map(o => `<button data-v="${o}" class="${o === cur ? 'on' : ''}">${o}</button>`).join('') +
    '</div>';
  return `
    <h2>Settings</h2>
    <h3>Picture</h3>
    <div class="row"><label>Quality<span class="sub">now: ${activeQualityName()}</span></label>
      ${seg('setQuality', ['auto', 'low', 'medium', 'high'], SET.quality)}</div>
    <div class="row"><label>Shadows</label>${sw('setShadows', SET.shadows)}</div>
    <div class="row"><label>Screen shake</label>${sw('setShake', SET.shake)}</div>
    <div class="row"><label>Reduce motion<span class="sub">no shake, no vibration</span></label>
      ${sw('setReduce', SET.reduceMotion)}</div>
    <h3>Play</h3>
    <div class="row"><label>Trajectory preview</label>${sw('setArc', SET.showArc)}</div>
    <div class="row"><label>Target markers<span class="sub">shows the garrison through walls</span></label>
      ${sw('setMarkers', SET.showMarkers)}</div>
    <div class="row"><label>Knights per siege<span class="sub">applies next siege</span></label>
      ${seg('setKnights', ['6', '8', '9', '12'], String(SET.knights))}</div>
    <h3>Sound &amp; touch</h3>
    <div class="row"><label>Volume</label>
      <input type="range" id="setVol" min="0" max="1" step="0.05" value="${SET.volume}"></div>
    <div class="row"><label>Vibration</label>${sw('setHaptics', SET.haptics)}</div>
    <div class="row"><label>Left-handed<span class="sub">swaps the touch buttons</span></label>
      ${sw('setLefty', SET.leftHanded)}</div>
    <div class="sheetFoot"><button class="tbtn" id="panelClose">Done</button></div>`;
}

function wireSettings() {
  const toggle = (id, key, after) => {
    const el = $(id); if (!el) return;
    el.addEventListener('click', () => {
      SET[key] = !SET[key];
      el.classList.toggle('on', SET[key]);
      saveSettings(); applySettings(rd, sfx);
      if (after) after();
    });
  };
  const segment = (id, fn) => {
    const el = $(id); if (!el) return;
    el.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      [...el.children].forEach(c => c.classList.toggle('on', c === b));
      fn(b.dataset.v);
      saveSettings(); applySettings(rd, sfx);
    });
  };
  toggle('setShadows', 'shadows');
  toggle('setShake', 'shake');
  toggle('setReduce', 'reduceMotion');
  toggle('setArc', 'showArc');
  toggle('setMarkers', 'showMarkers');
  toggle('setHaptics', 'haptics');
  toggle('setLefty', 'leftHanded', () => document.body.classList.toggle('lefty', SET.leftHanded));
  segment('setQuality', (v) => { SET.quality = v; rd.setScatterDensity(activeQuality().scatter); });
  segment('setKnights', (v) => { SET.knights = +v; });
  const vol = $('setVol');
  if (vol) vol.addEventListener('input', () => {
    SET.volume = +vol.value; applySettings(rd, sfx); saveSettings();
  });
}

// ---- loop -----------------------------------------------------------------

let last = performance.now(), frames = 0, alive = 0, cardPending = false, titleHideT = 0;
let paused = false;                  // headless sweeps starve if the world runs

// One tick of everything, so the RAF loop and the watchdog cannot drift apart.
function tickGame(dt) {
  if (!playing) {
    tTitle += dt;
    game.cinematicCam(tTitle, dt);
    rd.render();
    return;
  }
  // Orbit. Shift is fine trim — you want to line up on one pier, not one face.
  if (game.state === S.AIM && !game.dragging) {
    const rate = (keys.has('shift') ? 0.22 : 1.05) * dt;
    if (keys.has('a') || keys.has('arrowleft')) game.orbit(-rate);
    if (keys.has('d') || keys.has('arrowright')) game.orbit(rate);
    if (orbitHeld) game.orbit(orbitHeld * 1.05 * dt);
  }
  game.step(dt);
  game.render(dt);
  syncHud(dt);
  rd.render();
  if (game.state === S.OVER && !$('card').classList.contains('on') && !cardPending) {
    cardPending = true;
    setTimeout(() => { cardPending = false; showCard(); }, 900);
  }
}

function loop() {
  requestAnimationFrame(loop);
  if (paused) { last = performance.now(); return; }
  const now = performance.now();
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  alive = now;
  tickGame(dt);
  frames++;
}

// Watchdog. In embedded preview panes RAF can be throttled to nearly zero and
// the canvas goes black with no error at all. Painting alone is not enough:
// without stepping and syncing here you get a live-looking picture of a frozen
// game with a HUD that quietly lies about the score.
let lastWatch = performance.now();
setInterval(() => {
  if (!rd || !game) return;
  const now = performance.now();
  const dt = Math.min(0.25, (now - lastWatch) / 1000);
  lastWatch = now;
  if (now - alive > 700 && !paused) tickGame(dt);
}, 220);

// ---- headless handle ------------------------------------------------------

window.ONAGER = {
  get game() { return game; },
  get phys() { return game && game.phys; },
  Game, S, SET,
  fps() { const f = frames; frames = 0; return f; },
  state() { return game.snapshot(); },
  shoot(angle, elevDeg, power) { return game.shoot(angle, elevDeg, power); },
  settle(max) { return game.settleOut(max); },
  reset() { restart(); },
  play() { beginGame(); },
  level(i) { startLevel(i); },
  title() { toTitle(); },
  sim: runSim, sweep, sweepAll, audit, bot, reachability, setSimLevel, LEVELS, FACE_ANGLE, BEST,
  pause(on = true) { paused = on; return paused; },
};

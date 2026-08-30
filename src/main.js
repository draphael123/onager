// main.js — boot, input, HUD, menus, loop.

import * as RAPIER from '../vendor/rapier.es.js';
import { Renderer } from './render.js';
import { Sfx } from './audio.js';
import { Game, S, CAM_MODES, CAM_NAMES } from './game.js';
import { TYPES, TYPE_ORDER } from './knights.js';
import { Tutorial } from './tutorial.js';
import { RosterView, rosterHtml } from './roster.js';
import { FOES, FOE_ORDER, FOE_DEBUT } from './foes.js';
import { LEVELS, loadProgress, saveProgress } from './levels.js';
import { runSim, sweep, sweepAll, audit, bot, reachability, setSimLevel, FACE_ANGLE, BEST } from './sim.js';
import { SET, loadSettings, saveSettings, applySettings, activeQualityName, activeQuality } from './settings.js';
import { loadModels, MODELS, listClips, spawnCharacter } from './models.js';

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

    // Samples decode on a suspended context, so this can run now; anything that
    // fires before it lands falls back to synthesis rather than going silent.
    // Characters are optional: if they fail we keep the procedural rigs, so
    // the game starts either way.
    loadModels().then(ok => {
      if (ok && game) { game.reset(); buildHud(); }
      else console.warn('ONAGER: using procedural character rigs');
    });

    sfx.loadSamples().then(ok => {
      if (!ok) console.warn('ONAGER: impact samples unavailable, using synthesis');
    });

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
  // The rack is built from whatever this castle actually issued, so a level
  // that has no Sappers does not show you an empty Sapper slot to wonder about.
  const kw = $('knights'); kw.innerHTML = '';
  kpips = [];
  const issued = TYPE_ORDER.filter(id => (game.loadCounts[id] || 0) > 0);
  issued.forEach((id, i) => {
    const T = TYPES[id];
    const d = document.createElement('div');
    d.className = 'ktile'; d.dataset.type = id;
    d.title = T.name + ' — ' + T.blurb;
    d.innerHTML =
      `<div class="kglyph" style="background:#${T.colour.toString(16).padStart(6, '0')}"></div>` +
      `<div class="kname">${T.name}</div><div class="kct"></div>` +
      `<div class="kkey">${i + 1}</div>`;
    d.addEventListener('click', () => { if (game.selectType(id)) sfx.tick && sfx.tick(); });
    kw.appendChild(d); kpips.push(d);
  });
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

// The view is a persistent choice, not a per-level one: someone who wants to
// watch from the wall wants that on every castle.
function setCam(mode) {
  game.camMode = mode;
  SET.camera = mode;
  saveSettings();
  $('viewName').textContent = CAM_NAMES[mode] || mode;
  $('viewChip').classList.remove('flash');
  void $('viewChip').offsetWidth;
  $('viewChip').classList.add('flash');
  hint(CAM_BLURB[mode] || '', 2.5);
}

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'];

const CAM_BLURB = {
  siege: 'Siege view — over the shoulder.',
  low: 'Low view — down at the arm, riding in with him.',
  wide: 'Wide view — the whole arc at once.',
  wall: 'Wall view — watch it arrive from the castle.',
};

let hintT = 0;
function hint(t, secs = 4) { $('hint').textContent = t; hintT = secs; }

let bumpElev = () => {};
let lastGaugeKey = '';

const ELEV_LO = 6, ELEV_HI = 66;      // must match game.js ELEV_MIN/MAX

function syncPower() {
  $('powerfill').style.width = (game.power * 100).toFixed(1) + '%';
  $('powVal').textContent = (game.power * 100).toFixed(0) + '%';
  const e = game.elevDeg();
  $('elevfill').style.width = ((e - ELEV_LO) / (ELEV_HI - ELEV_LO) * 100).toFixed(1) + '%';
  $('elevVal').textContent = e.toFixed(0) + '°';
  // The window of RANGES that reach anything at all from this bearing. Without
  // it, standing where no range works looks identical to standing where the
  // angle is merely wrong, and the player sweeps sixty degrees for nothing.
  const A = game.aimBand();
  const pbar = $('powBand');
  if (A && A.power) {
    pbar.style.left = ((A.power.lo - 0.2) / 0.8 * 100).toFixed(1) + '%';
    pbar.style.width = Math.max(2, (A.power.hi - A.power.lo) / 0.8 * 100).toFixed(1) + '%';
    pbar.style.opacity = '1';
  } else pbar.style.opacity = '0';
  // Nothing on this bearing at any range means the answer is to move, and the
  // game should say so rather than let you keep trying.
  $('powerRow').classList.toggle('nosol', !(A && A.power));

  // The band of angles that reach something on this bearing at THIS range.
  // Aiming used to be a blind search between 6 and 66 degrees.
  const b = game.elevBand();
  const bar = $('elevBand');
  if (b) {
    // Pad it out to a visible width. When only one target on this bearing has
    // a solution the true band is a single angle, and a zero-width marker is
    // no help at all — 3 degrees each side is roughly the tolerance a shot
    // actually has anyway.
    const lo = Math.max(ELEV_LO, b.lo - 3), hi = Math.min(ELEV_HI, b.hi + 3);
    const l = ((lo - ELEV_LO) / (ELEV_HI - ELEV_LO)) * 100;
    const r = ((hi - ELEV_LO) / (ELEV_HI - ELEV_LO)) * 100;
    bar.style.left = l.toFixed(1) + '%';
    bar.style.width = Math.max(2, r - l).toFixed(1) + '%';
    bar.style.opacity = '1';
  } else bar.style.opacity = '0';
}

function syncHud(dt) {
  // The gauges have to be driven from the STATE every frame, not only from the
  // events that change it: dragging sets elevation directly and the readout sat
  // at its last button-pressed value while the arm visibly moved.
  const key = game.power.toFixed(3) + '|' + game.elev.toFixed(4) + '|' + game.angle.toFixed(2);
  if (key !== lastGaugeKey) { lastGaugeKey = key; syncPower(); }
  for (const t of kpips) {
    const n = game.loadCounts[t.dataset.type] || 0;
    t.querySelector('.kct').textContent = '×' + n;
    t.classList.toggle('out', n === 0);
    t.classList.toggle('on', n > 0 && game.selected === t.dataset.type);
  }
  const sel = TYPES[game.selected];
  $('loadsub').textContent = sel ? sel.blurb + ' · ' + sel.diveHint : '';
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
    game.beginDrag();
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
    if (game.fire() && coach) coach.noteFire();
    buzz(26);
    const T = game.shotType;
    if (T) {
      $('tcDive').textContent = T.dive === 'burst' ? 'BURST'
        : T.dive === 'split' ? 'SPLIT' : T.dive === 'pound' ? 'POUND' : 'DIVE';
      if (game.knights === game.knightsTotal - 1 || T.dive !== 'dive') {
        hint('SPACE or the button, mid-flight — ' + T.diveHint, 5);
      }
    }
  };

  cv.addEventListener('pointerdown', down);
  addEventListener('pointermove', move);
  addEventListener('pointerup', up);
  addEventListener('pointercancel', up);

  addEventListener('keydown', (e) => {
    sfx.resume();
    const k = e.key.toLowerCase();
    keys.add(k);
    if (k === ' ') { e.preventDefault(); if (playing && game.dive() && coach) coach.noteDive(); }
    if (playing && game.state === S.AIM) {
      if (k === 'w') { e.preventDefault(); bumpPower(0.04); }
      if (k === 's') { e.preventDefault(); bumpPower(-0.04); }
      // Elevation gets its own pair of keys. Aiming high or low used to mean
      // finding room to drag 280 pixels downward, which on a trackpad or near
      // the bottom of the window simply was not there.
      const fine = keys.has('shift') ? 0.35 : 1;
      if (k === 'arrowup') { e.preventDefault(); bumpElev(2.5 * fine); }
      if (k === 'arrowdown') { e.preventDefault(); bumpElev(-2.5 * fine); }
    }
    // 1-5 load a different man. Cycling with one key was worse: you are
    // choosing between five things at once, not stepping through a list.
    if (playing && k >= '1' && k <= '9') {
      const t = kpips[+k - 1];
      if (t) { e.preventDefault(); game.selectType(t.dataset.type); }
    }
    if (k === 'c' && playing) { e.preventDefault(); setCam(game.cycleCam(1)); }
    if (k === 'r' && playing) restart();
    if (k === 'escape') togglePanel();
  });
  addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
  addEventListener('blur', () => { keys.clear(); orbitHeld = 0; });

  $('coachNext').addEventListener('click', () => stopCoach(true));
  $('viewChip').addEventListener('click', () => setCam(game.cycleCam(1)));

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
    sfx.tick(0.7 + game.power * 0.6);
  };
  bumpElev = (deg) => {
    game.addElev(deg);
    sfx.tick(0.5 + (game.elev / 1.2) * 0.6);
  };
  addEventListener('wheel', (e) => {
    if (!playing || game.state !== S.AIM) return;
    e.preventDefault();
    bumpPower(e.deltaY < 0 ? 0.04 : -0.04);
  }, { passive: false });
  const hold = (id, fn) => {
    const el = $(id);
    if (!el) return;
    let t = 0;
    const go = (e) => {
      e.preventDefault(); fn();
      clearInterval(t); t = setInterval(fn, 110);
    };
    const stop = () => clearInterval(t);
    el.addEventListener('pointerdown', go);
    el.addEventListener('pointerup', stop);
    el.addEventListener('pointerleave', stop);
    el.addEventListener('pointercancel', stop);
  };
  hold('powUp', () => bumpPower(0.04));
  hold('powDown', () => bumpPower(-0.04));
  hold('elevUp', () => bumpElev(2.5));
  hold('elevDown', () => bumpElev(-2.5));

  $('tcDive').addEventListener('pointerdown', (e) => {
    e.preventDefault(); sfx.resume();
    if (playing && game.dive()) { buzz(18); if (coach) coach.noteDive(); }
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
  $('castleNum').textContent = ROMAN[i] || String(i + 1);
  $('castleName').textContent = L.name;
  setCam(game.camMode);
  hint(`${L.name} — ${L.blurb}`, 6);
  startCoach(i);
}

// ---- the guided first siege ------------------------------------------------
//
// Runs on the first castle only, once, unless the player asks for it again.
// It never gates anything: every step can be ignored and the shot still fires.

let coach = null;
function startCoach(levelIdx) {
  stopCoach();
  if (levelIdx !== 0 || !SET.tutorial) return;
  const touch = matchMedia('(pointer: coarse)').matches;
  coach = new Tutorial(game, {
    root: $('coach'), title: $('coachTitle'), body: $('coachBody'),
    ask: $('coachAsk'), halo: $('coachHalo'),
    dots: $('coachDots'), next: $('coachNext'),
  }, touch);
  document.body.classList.add('coaching');
}

function stopCoach(remember) {
  if (coach) coach.finish();
  coach = null;
  document.body.classList.remove('coaching');
  $('coach').classList.remove('on');
  if (remember) { SET.tutorial = false; saveSettings(); }
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
  $('btnHow').addEventListener('click', () => openPanel(howToHtml(), wireHow));
  $('btnFoes').addEventListener('click', openRoster);
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
function wireHow() {
  const b = $('howFoes');
  if (b) b.addEventListener('click', openRoster);
}

function closePanel() {
  $('panel').classList.remove('on');
  // The book runs its own GL context and its own RAF. Leaving it running
  // behind a closed panel is a second render loop nobody is looking at.
  if (roster) { roster.dispose(); roster = null; }
}

// ---- the garrison book -----------------------------------------------------

let roster = null;
function openRoster() {
  openPanel(rosterHtml(prog.unlocked), () => {
    roster = new RosterView($('foeCanvas'));
    const rows = [...document.querySelectorAll('.foeRow')];
    const pick = (id) => {
      rows.forEach(r => r.classList.toggle('on', r.dataset.foe === id));
      const F = FOES[id];
      roster.show(id);
      $('fcName').textContent = F.name;
      $('fcRole').textContent = F.role;
      const chips = [`${F.hp} hp`];
      if (F.armour < 1) chips.push(`${Math.round((1 - F.armour) * 100)}% off a strike`);
      if (F.pack) chips.push(`${F.pack} to a post`);
      if (F.picket) chips.push(`${F.picket}, spread wide`);
      if (F.shore) chips.push(`shores ${F.shore.radius}m`);
      chips.push(`first seen: castle ${FOE_DEBUT[id] || 1}`);
      const beat = F.counter && TYPES[F.counter];
      $('fcStats').innerHTML = chips.map(c => `<span>${c}</span>`).join('')
        + (beat ? `<span class="beat">answer: the ${beat.name}</span>` : '');
    };
    for (const r of rows) r.addEventListener('click', () => pick(r.dataset.foe));
    pick(FOE_ORDER[0]);
    roster.start();
    addEventListener('resize', () => roster && roster.resize());
  });
}
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
    <div class="howRow"><kbd>1 &ndash; 4</kbd><div>
      <b>Choose the man.</b> Four kinds ride the arm and they are not
      interchangeable. A <b>Lance</b> punches through. A <b>Maul</b> shatters
      stone and stops dead. A <b>Sapper</b> bursts and is useless against a
      wall. The <b>Brothers</b> are three men in one shot &mdash; but only if
      you split them.
    </div></div>
    <div class="howRow"><kbd>C</kbd><div>
      <b>Change the view.</b> Four of them: over the shoulder, down at the arm,
      high and wide, or parked at the castle watching the shot arrive.
    </div></div>
    <div class="howRow"><kbd>space</kbd><div>
      <b>The second tap.</b> Once per shot, in flight, and it does something
      different for every kind of man. For a Lance it trades the rest of your arc
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
    <div class="sheetFoot">
      <button class="tbtn ghost" id="howFoes">The garrison</button>
      <button class="tbtn" id="panelClose">Close</button></div>`;
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
  if (coach) {
    coach.update(dt);
    if (!coach.active) stopCoach(true);
  }
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
  MODELS, listClips, spawnCharacter,
  pause(on = true) { paused = on; return paused; },
  // Handy from the console, and used by the screenshot pass: switch view
  // without hunting for the chip.
  view(mode) { setCam(mode); return game.camMode; },
  coach() { return coach; },
  roster() { openRoster(); },
};

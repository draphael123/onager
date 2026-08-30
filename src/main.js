// main.js — boot, input, HUD, menus, loop.

import * as RAPIER from '../vendor/rapier.es.js';
import { Renderer } from './render.js';
import { Sfx } from './audio.js';
import { Game, S, CAM_MODES, CAM_NAMES } from './game.js';
import { TYPES, TYPE_ORDER } from './knights.js';
import { Tutorial } from './tutorial.js';
import { RosterView, rosterHtml } from './roster.js';
import { Editor, planWarnings } from './editor.js';
import { PIECES, PIECE_ORDER, LIMITS, blankDef, normaliseDef, garrisonCount,
  knightCount, buildFromDef } from './leveldef.js';
import { Physics } from './physics.js';
import { levelLink, packLink, readHash, clearHash, blankPack, normalisePack,
  download, pickFile, safeName, loadWorkshop, saveWorkshop } from './share.js';
import { THEMES } from './levels.js';
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

    // A shared castle in the URL. Offered rather than launched: the link came
    // from somebody else, and the player should see what they are opening.
    checkSharedLink().catch(() => {});
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

  // A player-made castle has no campaign slot: no unlock, no saved best against
  // a built-in id, and "next" means the next castle in ITS pack, if it is in
  // one. Handled first so none of the campaign bookkeeping below runs on it.
  if (game.custom) return showCustomCard(r);

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

function showCustomCard(r) {
  const C = game.custom;
  const inPack = activePack && activePack.pack;
  const more = inPack && C.packIdx + 1 < activePack.packLen;

  $('cardTitle').textContent = r.win ? 'THE FORTRESS FALLS' : 'THE GARRISON HOLDS';
  $('cardSub').innerHTML = r.win
    ? `${esc(C.name)} &middot; ${r.score} points<br>` +
      `${r.knightsLeft} knight${r.knightsLeft === 1 ? '' : 's'} unspent &middot; ` +
      `${r.broken} blocks broken` +
      (inPack ? `<br><b>${esc(activePack.packName)}</b> &mdash; ${C.packIdx + 1} of ${activePack.packLen}` : '')
    : `${r.standing} still holding the walls<br>${r.score} points &middot; ${r.broken} blocks broken`;

  const foot = $('cardBtns');
  foot.innerHTML = '';
  if (r.win && more) {
    foot.appendChild(mkBtn('Next castle', () => playPack(activePack.pack, C.packIdx + 1), true));
  } else if (r.win && inPack) {
    foot.appendChild(mkBtn('Pack complete', () => { $('card').classList.remove('on'); openWorkshop(); }, true));
  }
  foot.appendChild(mkBtn(r.win ? 'Again' : 'Try again',
    () => playCustom(C.def, inPack ? activePack : null), !r.win));
  foot.appendChild(mkBtn('Workshop', () => {
    $('card').classList.remove('on');
    playing = false;
    document.body.classList.add('pregame');
    document.body.classList.remove('playing');
    openWorkshop();
  }, false, true));
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

function restart() {
  // R on a player-made castle has to restart THAT castle, not drop you back
  // into whatever campaign level happens to be under it.
  if (game.custom) return playCustom(game.custom.def, activePack);
  startLevel(game.levelIdx);
}

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
  $('btnWorkshop').addEventListener('click', openWorkshop);
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
  const w = $('howShop');
  if (w) w.addEventListener('click', openWorkshop);
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
      <button class="tbtn ghost" id="howShop">Build a castle</button>
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
    <div class="row"><label>Weak points<span class="sub">marks the block holding up each face</span></label>
      ${sw('setWeak', SET.showWeak !== false)}</div>
    <div class="row"><label>Knights per siege<span class="sub">applies next siege</span></label>
      ${seg('setKnights', ['6', '8', '9', '12'], String(SET.knights))}</div>
    <h3>Sound &amp; touch</h3>
    <div class="row"><label>Volume</label>
      <input type="range" id="setVol" min="0" max="1" step="0.05" value="${SET.volume}"></div>
    <div class="row"><label>Vibration</label>${sw('setHaptics', SET.haptics)}</div>
    <div class="row"><label>Left-handed<span class="sub">swaps the touch buttons</span></label>
      ${sw('setLefty', SET.leftHanded)}</div>
    <div class="sheetFoot">
      <button class="tbtn ghost" id="setShop">Build a castle</button>
      <button class="tbtn" id="panelClose">Done</button></div>`;
}

function wireSettings() {
  const shop = $('setShop');
  if (shop) shop.addEventListener('click', openWorkshop);
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
  toggle('setWeak', 'showWeak');
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

// ---- the workshop ----------------------------------------------------------
//
// The level creator's screen. The Editor class owns the plan and the document;
// this owns the chrome around it — the palette, the property sheet, the checks,
// and getting a finished castle out of the browser and into somebody else's.

let ed = null;                       // the live Editor
let workshop = loadWorkshop();
let wsTab = 'levels';

function openWorkshop() {
  closePanel();
  $('workshop').classList.add('on');
  document.body.classList.add('inWorkshop');
  renderShelf();
}

function closeWorkshop() {
  $('workshop').classList.remove('on');
  document.body.classList.remove('inWorkshop');
  ed = null;
}

// ---- the shelf: what you have made so far ---------------------------------

function renderShelf() {
  $('wsEditor').style.display = 'none';
  $('wsShelf').style.display = '';
  const lv = workshop.levels, pk = workshop.packs;
  const card = (d, i) => `
    <div class="wsCard" data-lvl="${i}">
      <div class="wsCardName">${esc(d.name)}</div>
      <div class="wsCardSub">${garrisonCount(d)} to put down &middot; ${knightCount(d)} knights
        &middot; ${d.pieces.length} pieces &middot; ${esc(d.theme)}</div>
      <div class="wsCardBtns">
        <button data-act="edit" data-i="${i}">Edit</button>
        <button data-act="play" data-i="${i}">Play</button>
        <button data-act="link" data-i="${i}">Link</button>
        <button data-act="file" data-i="${i}">File</button>
        <button data-act="del" data-i="${i}" class="danger">Delete</button>
      </div>
    </div>`;
  const packCard = (p, i) => `
    <div class="wsCard" data-pack="${i}">
      <div class="wsCardName">${esc(p.name)}</div>
      <div class="wsCardSub">${p.levels.length} castle${p.levels.length === 1 ? '' : 's'}${p.author ? ' &middot; by ' + esc(p.author) : ''}</div>
      <div class="wsCardBtns">
        <button data-pact="play" data-i="${i}">Play pack</button>
        <button data-pact="link" data-i="${i}">Link</button>
        <button data-pact="file" data-i="${i}">File</button>
        <button data-pact="del" data-i="${i}" class="danger">Delete</button>
      </div>
    </div>`;

  $('wsShelf').innerHTML = `
    <div class="wsHead">
      <div>
        <h2>The workshop</h2>
        <p class="lead">Build a castle, then send it to somebody as a link or a file.
          There is no server: a castle lives in this browser and in whatever you share.</p>
      </div>
      <div class="wsHeadBtns">
        <button class="tbtn" id="wsNew">New castle</button>
        <button class="tbtn ghost" id="wsExamples">Worked examples</button>
        <button class="tbtn ghost" id="wsImport">Open a file</button>
        <button class="tbtn ghost" id="wsClose">Back</button>
      </div>
    </div>
    <div class="wsTabs">
      <button class="${wsTab === 'levels' ? 'on' : ''}" data-tab="levels">Castles (${lv.length})</button>
      <button class="${wsTab === 'packs' ? 'on' : ''}" data-tab="packs">Packs (${pk.length})</button>
    </div>
    ${wsTab === 'levels'
      ? (lv.length
        ? `<div class="wsGrid">${lv.map(card).join('')}</div>`
        : `<p class="wsEmpty">Nothing built yet. <b>New castle</b> starts a plan.</p>`)
      : `<div class="wsPackMake">
           <input id="wsPackName" placeholder="Pack name" maxlength="44" value="">
           <button class="tbtn ghost" id="wsPackNew">Make a pack from every castle</button>
         </div>
         ${pk.length
        ? `<div class="wsGrid">${pk.map(packCard).join('')}</div>`
        : `<p class="wsEmpty">A pack is a set of castles that play in order, shared as one link.</p>`}`}
  `;

  $('wsNew').onclick = () => openEditor(blankDef());
  $('wsClose').onclick = closeWorkshop;
  $('wsImport').onclick = importFile;
  $('wsExamples').onclick = loadExamples;
  for (const b of $('wsShelf').querySelectorAll('[data-tab]')) {
    b.onclick = () => { wsTab = b.dataset.tab; renderShelf(); };
  }
  const pn = $('wsPackNew');
  if (pn) pn.onclick = () => {
    if (!workshop.levels.length) return toast('Build a castle first.');
    const p = blankPack($('wsPackName').value.trim() || 'My pack');
    p.levels = workshop.levels.map(l => l);
    workshop.packs.push(p);
    persist(); renderShelf();
  };
  for (const b of $('wsShelf').querySelectorAll('[data-act]')) {
    b.onclick = () => shelfAct(b.dataset.act, +b.dataset.i);
  }
  for (const b of $('wsShelf').querySelectorAll('[data-pact]')) {
    b.onclick = () => packAct(b.dataset.pact, +b.dataset.i);
  }
}

async function shelfAct(act, i) {
  const d = workshop.levels[i];
  if (!d) return;
  if (act === 'edit') return openEditor(d, i);
  if (act === 'play') return playCustom(d);
  if (act === 'link') return copyLink(await levelLink(d), 'castle');
  if (act === 'file') return download(d, safeName(d.name) + '.onager.json');
  if (act === 'del') {
    if (!confirmed('wsDel' + i, 'Delete ' + d.name + '?')) return;
    workshop.levels.splice(i, 1); persist(); renderShelf();
  }
}

async function packAct(act, i) {
  const p = workshop.packs[i];
  if (!p) return;
  if (act === 'play') return playPack(p, 0);
  if (act === 'link') return copyLink(await packLink(p), 'pack');
  if (act === 'file') return download(p, safeName(p.name) + '.pack.json');
  if (act === 'del') {
    if (!confirmed('wsPDel' + i, 'Delete the pack ' + p.name + '?')) return;
    workshop.packs.splice(i, 1); persist(); renderShelf();
  }
}

// A two-click confirm rather than window.confirm(), which is blocked in some
// embedded contexts and looks like a browser error when it does appear.
const pending = {};
function confirmed(key, msg) {
  if (pending[key]) { delete pending[key]; return true; }
  pending[key] = true;
  toast(msg + ' Press again to confirm.');
  setTimeout(() => { delete pending[key]; }, 4000);
  return false;
}

function persist() {
  if (!saveWorkshop(workshop)) toast('Could not save — the browser is out of storage.');
}

// ---- the editor screen ----------------------------------------------------

let editIdx = -1;

function openEditor(def, idx = -1) {
  editIdx = idx;
  $('wsShelf').style.display = 'none';
  $('wsEditor').style.display = '';
  $('wsEditor').innerHTML = editorHtml();
  ed = new Editor($('wsCanvas'), def, () => { renderProps(); renderChecks(); });
  wireEditor();
  renderPalette();
  renderProps();
  renderChecks();
  addEventListener('resize', wsResize);
  requestAnimationFrame(() => ed && ed.resize());
}

function wsResize() { if (ed) ed.resize(); }

function editorHtml() {
  return `
    <div class="wsEdHead">
      <input id="wsName" maxlength="44" placeholder="Castle name">
      <input id="wsAuthor" maxlength="28" placeholder="Your name (optional)">
      <div class="wsEdBtns">
        <button class="tbtn" id="wsTest">Test it</button>
        <button class="tbtn ghost" id="wsSave">Save</button>
        <button class="tbtn ghost" id="wsBack">Back</button>
      </div>
    </div>
    <div class="wsBody">
      <div class="wsPal" id="wsPal"></div>
      <div class="wsPlanWrap">
        <canvas id="wsCanvas"></canvas>
        <div class="wsPlanFoot">
          <span id="wsCount"></span>
          <span class="wsKeys"><b>Drag</b> to move &middot; <b>Shift</b>-click to keep placing
            &middot; <b>Del</b> removes &middot; <b>Ctrl+Z</b> undoes</span>
        </div>
      </div>
      <div class="wsProps" id="wsProps"></div>
    </div>
    <div class="wsChecks" id="wsChecks"></div>`;
}

function renderPalette() {
  const rows = PIECE_ORDER.map(t => `
    <button class="wsPiece" data-piece="${t}" title="${esc(PIECES[t].hint)}">
      <span class="wsPieceName">${PIECES[t].name}</span>
      <span class="wsPieceHint">${esc(PIECES[t].hint)}</span>
    </button>`).join('');
  $('wsPal').innerHTML = `<div class="wsPalTitle">Place</div>${rows}`;
  for (const b of $('wsPal').querySelectorAll('[data-piece]')) {
    b.onclick = () => {
      ed.tool = ed.tool === b.dataset.piece ? null : b.dataset.piece;
      for (const o of $('wsPal').querySelectorAll('[data-piece]')) {
        o.classList.toggle('on', o.dataset.piece === ed.tool);
      }
    };
  }
}

function renderProps() {
  const d = ed.def;
  const p = d.pieces[ed.sel];
  const num = (id, label, v, min, max, step) => `
    <label class="wsRow"><span>${label}</span>
      <input type="number" id="${id}" value="${v}" min="${min}" max="${max}" step="${step}"></label>`;

  let piece = '<p class="wsNone">Nothing selected. Click a piece on the plan, or place one.</p>';
  if (p) {
    const spec = PIECES[p.t];
    const fields = Object.entries(spec.fields).map(([k, f]) => {
      if (f.opts) {
        return `<label class="wsRow"><span>${f.label}</span><select data-f="${k}">${
          f.opts.map(o => `<option value="${o}"${p[k] === o ? ' selected' : ''}>${
            o === 'levy' || FOES[o] ? FOES[o].name : o}</option>`).join('')}</select></label>`;
      }
      if (f.bool) {
        return `<label class="wsRow"><span>${f.label}</span>
          <input type="checkbox" data-f="${k}"${p[k] ? ' checked' : ''}></label>`;
      }
      return `<label class="wsRow"><span>${f.label}</span>
        <input type="number" data-f="${k}" value="${p[k]}" min="${f.min}" max="${f.max}" step="${f.step}"></label>`;
    }).join('');
    piece = `
      <div class="wsPropTitle">${spec.name}</div>
      <p class="wsHint">${esc(spec.hint)}</p>
      <label class="wsRow"><span>X</span><input type="number" data-f="x" value="${p.x}" step="0.5"></label>
      <label class="wsRow"><span>Z</span><input type="number" data-f="z" value="${p.z}" step="0.5"></label>
      ${fields}
      <div class="wsPropBtns">
        <button id="wsDup">Duplicate</button>
        <button id="wsRaise" title="Move to the end of the build order, so it rests on everything else">Build last</button>
        ${p.pinY ? '<button id="wsUnpin" title="Snap it back onto whatever is beneath">Re-snap</button>' : ''}
        <button id="wsDel" class="danger">Delete</button>
      </div>
      ${spec.fields.y ? `<p class="wsHint">Height snaps to whatever was placed
        <b>before</b> it and sits underneath. Type a height to pin it.</p>` : ''}`;
  }

  const loadout = TYPE_ORDER.map(id => `
    <label class="wsRow"><span>${TYPES[id].name}</span>
      <input type="number" data-load="${id}" value="${d.loadout[id] || 0}" min="0" max="20" step="1"></label>`).join('');

  $('wsProps').innerHTML = `
    <div class="wsPropTitle">Selected</div>
    ${piece}
    <div class="wsPropTitle mt">The castle</div>
    <label class="wsRow"><span>Weather</span><select id="wsTheme">${
      Object.keys(THEMES).map(t => `<option value="${t}"${d.theme === t ? ' selected' : ''}>${t}</option>`).join('')
    }</select></label>
    ${num('wsOrbit', 'Siege ring', d.orbitR, LIMITS.orbitR.min, LIMITS.orbitR.max, 1)}
    ${num('wsPlinthX', 'Ground X', d.plinth[0], LIMITS.plinth.min, LIMITS.plinth.max, 0.5)}
    ${num('wsPlinthZ', 'Ground Z', d.plinth[1], LIMITS.plinth.min, LIMITS.plinth.max, 0.5)}
    ${num('wsMasonry', 'Mortar', d.masonry, LIMITS.masonry.min, LIMITS.masonry.max, 0.02)}
    <p class="wsHint">Mortar under 1 makes every block softer. The first castle
      in the campaign runs at 0.62.</p>
    <div class="wsPropTitle mt">The company</div>
    ${loadout}`;

  $('wsCount').textContent =
    `${ed.def.pieces.length}/${LIMITS.pieces} pieces · ${garrisonCount(d)} to put down · ${knightCount(d)} knights`;

  for (const el of $('wsProps').querySelectorAll('[data-f]')) {
    const k = el.dataset.f;
    el.onchange = () => {
      const v = el.type === 'checkbox' ? el.checked
        : (el.tagName === 'SELECT' ? el.value : Number(el.value));
      ed.setField(ed.sel, k, v);
    };
  }
  for (const el of $('wsProps').querySelectorAll('[data-load]')) {
    el.onchange = () => {
      const l = { ...ed.def.loadout };
      l[el.dataset.load] = Math.max(0, Math.round(Number(el.value) || 0));
      ed.setMeta('loadout', l);
    };
  }
  const bind = (id, key, fn) => {
    const el = $(id);
    if (el) el.onchange = () => ed.setMeta(key, fn ? fn(el.value) : el.value);
  };
  bind('wsTheme', 'theme');
  bind('wsOrbit', 'orbitR', Number);
  bind('wsMasonry', 'masonry', Number);
  const px = $('wsPlinthX'), pz = $('wsPlinthZ');
  if (px) px.onchange = () => ed.setMeta('plinth', [Number(px.value), ed.def.plinth[1]]);
  if (pz) pz.onchange = () => ed.setMeta('plinth', [ed.def.plinth[0], Number(pz.value)]);
  const dup = $('wsDup'), del = $('wsDel'), rai = $('wsRaise'), unp = $('wsUnpin');
  if (dup) dup.onclick = () => ed.duplicate(ed.sel);
  if (del) del.onclick = () => ed.remove(ed.sel);
  if (rai) rai.onclick = () => ed.raise(ed.sel);
  if (unp) unp.onclick = () => ed.unpin(ed.sel);
}

function wireEditor() {
  $('wsName').value = ed.def.name;
  $('wsAuthor').value = ed.def.author;
  $('wsName').onchange = () => ed.setMeta('name', $('wsName').value);
  $('wsAuthor').onchange = () => ed.setMeta('author', $('wsAuthor').value);
  $('wsBack').onclick = () => { removeEventListener('resize', wsResize); renderShelf(); };
  $('wsSave').onclick = saveCurrent;
  $('wsTest').onclick = () => { saveCurrent(true); playCustom(ed.def); };

  addEventListener('keydown', wsKeys);
}

function wsKeys(e) {
  if (!ed || !$('workshop').classList.contains('on')) return;
  const tag = (e.target && e.target.tagName) || '';
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
  const k = e.key.toLowerCase();
  if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); e.shiftKey ? ed.redoStep() : ed.undoStep(); }
  else if ((e.ctrlKey || e.metaKey) && k === 'y') { e.preventDefault(); ed.redoStep(); }
  else if (k === 'delete' || k === 'backspace') { e.preventDefault(); ed.remove(ed.sel); }
  else if (k === 'd' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); ed.duplicate(ed.sel); }
  else if (k === 'escape') { ed.tool = null; renderPalette(); }
}

function saveCurrent(quiet) {
  const d = ed.def;
  if (editIdx >= 0) workshop.levels[editIdx] = d;
  else { workshop.levels.push(d); editIdx = workshop.levels.length - 1; }
  persist();
  if (!quiet) toast('Saved to this browser.');
}

// ---- checks ----------------------------------------------------------------

// The plan warnings are instant. The real audit builds the castle in a headless
// Rapier world and runs the same overlap-and-float check the built-in levels
// are held to — that is the check that catches a fortress which will detonate
// on frame one, and no amount of looking at the plan finds it.
function renderChecks() {
  const w = planWarnings(ed.def);
  const rows = w.map(x => `<li class="${x.bad ? 'bad' : ''}">${esc(x.msg)}</li>`).join('');
  $('wsChecks').innerHTML = `
    <div class="wsChecksHead">
      <b>Checks</b>
      <button class="tbtn ghost" id="wsVerify">Build and check it</button>
    </div>
    <ul>${rows || '<li class="good">The plan looks sound.</li>'}</ul>
    <div id="wsVerdict"></div>`;
  $('wsVerify').onclick = verifyCurrent;
}

async function verifyCurrent() {
  const out = $('wsVerdict');
  out.innerHTML = '<p class="wsBusy">Building it&hellip;</p>';
  await new Promise(r => setTimeout(r, 30));
  let phys = null;
  try {
    phys = new Physics();
    phys.masonryScale = ed.def.masonry;
    const b = buildFromDef(phys, ed.def);
    const fake = { phys };
    const a = audit(fake);
    // Let it stand for five seconds on its own. A castle that falls down
    // before the player has fired reads as a bug, not as a soft castle.
    const spawn = phys.list.filter(p => !p.fixed).map(p => {
      const t = p.body.translation(); return { p, x: t.x, y: t.y, z: t.z };
    });
    for (let i = 0; i < 300; i++) phys.step();
    let drift = 0, lost = 0;
    for (const s of spawn) {
      if (s.p.dead) { lost++; continue; }
      const t = s.p.body.translation();
      drift = Math.max(drift, Math.hypot(t.x - s.x, t.y - s.y, t.z - s.z));
    }
    const fell = b.soldiers.filter(s => s.dead || s.up0 === 0).length;

    const bad = [];
    const ok = [];
    (a.overlaps.length ? bad : ok).push(a.overlaps.length
      ? `${a.overlaps.length} pieces overlap where they spawn — the castle will blow itself apart.`
      : 'Nothing interpenetrates.');
    (a.floaters.length ? bad : ok).push(a.floaters.length
      ? `${a.floaters.length} pieces are floating with nothing under them.`
      : 'Nothing is floating.');
    (drift > 0.35 || lost ? bad : ok).push(drift > 0.35 || lost
      ? `It shifts ${drift.toFixed(2)}m on its own${lost ? ` and loses ${lost} pieces` : ''}.`
      : `It stands up (${drift.toFixed(2)}m of settle).`);
    (fell ? bad : ok).push(fell
      ? `${fell} of the garrison fall over unaided.`
      : 'The garrison stays on its feet.');

    out.innerHTML = `
      <div class="wsVerdict ${bad.length ? 'bad' : 'good'}">
        <b>${bad.length ? 'Needs work' : 'It stands'}</b>
        <ul>${bad.map(m => `<li class="bad">${esc(m)}</li>`).join('')}
            ${ok.map(m => `<li class="good">${esc(m)}</li>`).join('')}</ul>
        ${a.overlaps.length ? `<p class="wsHint">First overlap near
          ${a.overlaps[0].at.join(', ')}.</p>` : ''}
      </div>`;
  } catch (e) {
    out.innerHTML = `<div class="wsVerdict bad"><b>Could not build it</b>
      <p class="wsHint">${esc(String((e && e.message) || e))}</p></div>`;
  } finally {
    if (phys) phys.dispose();
  }
}

// ---- playing ---------------------------------------------------------------

let activePack = null;

function playCustom(def, meta) {
  activePack = meta && meta.pack ? meta : null;
  closeWorkshop();
  $('card').classList.remove('on');
  closePanel();
  playing = true;
  $('title').classList.add('gone');
  clearTimeout(titleHideT);
  titleHideT = setTimeout(() => { if (playing) $('title').style.display = 'none'; }, 620);
  document.body.classList.remove('pregame');
  document.body.classList.add('playing');
  stopCoach();
  game.setCustom(def, meta || {});
  buildHud();
  $('castleNum').textContent = meta && meta.pack ? String(meta.packIdx + 1) : '✦';
  $('castleName').textContent = def.name;
  setCam(game.camMode);
  hint(`${def.name}${def.author ? ' — by ' + def.author : ''}`, 6);
}

function playPack(pack, i) {
  const d = pack.levels[i];
  if (!d) return;
  playCustom(d, { pack, packIdx: i, packLen: pack.levels.length, packName: pack.name });
}

// ---- sharing ---------------------------------------------------------------

async function copyLink(url, what) {
  let done = false;
  try { await navigator.clipboard.writeText(url); done = true; } catch (e) { /* no permission */ }
  showLinkBox(url, done
    ? `The ${what} link is on your clipboard.`
    : `Copy this ${what} link:`);
}

function showLinkBox(url, msg) {
  const el = $('linkBox');
  el.innerHTML = `<p>${esc(msg)}</p>
    <textarea readonly rows="3">${esc(url)}</textarea>
    <p class="wsHint">${url.length} characters. Anyone who opens it gets the castle;
      nothing is uploaded anywhere.</p>
    <button class="tbtn ghost" id="linkClose">Close</button>`;
  el.classList.add('on');
  el.querySelector('textarea').select();
  $('linkClose').onclick = () => el.classList.remove('on');
}

// Three castles built the way the built-in ones are, to open and take apart.
// A blank plan is the worst place to learn what a Pier is for.
async function loadExamples() {
  if (workshop.packs.some(p => p.name === 'Worked examples')) {
    wsTab = 'packs'; renderShelf();
    return toast('Already in your workshop, under Packs.');
  }
  try {
    const r = await fetch('assets/examples.json', { cache: 'no-store' });
    const p = normalisePack(await r.json());
    workshop.packs.push(p);
    for (const l of p.levels) workshop.levels.push(l);
    persist();
    wsTab = 'levels'; renderShelf();
    toast(`${p.levels.length} worked examples added. Open one and take it apart.`);
  } catch (e) {
    toast('Could not load the examples.');
  }
}

async function importFile() {
  const r = await pickFile();
  if (!r) return;
  if (r.error) return toast(r.error);
  const o = r.obj;
  if (o && Array.isArray(o.levels)) {
    workshop.packs.push(normalisePack(o));
    wsTab = 'packs';
    persist(); renderShelf();
    return toast('Pack added.');
  }
  workshop.levels.push(normaliseDef(o));
  wsTab = 'levels';
  persist(); renderShelf();
  toast('Castle added.');
}

// Somebody opened a shared link. Offer it rather than launching straight into
// it: the URL is a stranger's, and the player should see what they are opening.
async function checkSharedLink() {
  const got = await readHash();
  if (!got) return false;
  clearHash();
  if (got.kind === 'level') {
    const d = got.def;
    openPanel(`
      <h2>${esc(d.name)}</h2>
      <p class="lead">${d.author ? 'By ' + esc(d.author) + '. ' : ''}Somebody sent you a castle:
        ${garrisonCount(d)} to put down, ${knightCount(d)} knights, ${d.pieces.length} pieces.</p>
      <div class="sheetFoot">
        <button class="tbtn" id="shPlay">Lay siege to it</button>
        <button class="tbtn ghost" id="shKeep">Keep it</button>
        <button class="tbtn ghost" id="panelClose">Not now</button>
      </div>`, () => {
      $('shPlay').onclick = () => { closePanel(); playCustom(d); };
      $('shKeep').onclick = () => {
        workshop.levels.push(d); persist(); closePanel(); toast('Saved to your workshop.');
      };
    });
  } else {
    const p = got.pack;
    openPanel(`
      <h2>${esc(p.name)}</h2>
      <p class="lead">${p.author ? 'By ' + esc(p.author) + '. ' : ''}A pack of
        ${p.levels.length} castle${p.levels.length === 1 ? '' : 's'}.</p>
      <div class="sheetFoot">
        <button class="tbtn" id="shPlay">Start the first</button>
        <button class="tbtn ghost" id="shKeep">Keep it</button>
        <button class="tbtn ghost" id="panelClose">Not now</button>
      </div>`, () => {
      $('shPlay').onclick = () => { closePanel(); playPack(p, 0); };
      $('shKeep').onclick = () => {
        workshop.packs.push(p); persist(); closePanel(); toast('Saved to your workshop.');
      };
    });
  }
  return true;
}

// ---- helpers ---------------------------------------------------------------

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

let toastT = 0;
function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('on');
  clearTimeout(toastT);
  toastT = setTimeout(() => el.classList.remove('on'), 3200);
}

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
  workshop() { openWorkshop(); },
  playDef(d) { playCustom(normaliseDef(d)); },
  // Handy from the console, and used by the screenshot pass: switch view
  // without hunting for the chip.
  view(mode) { setCam(mode); return game.camMode; },
  coach() { return coach; },
  roster() { openRoster(); },
};

// tutorial.js — the guided first siege.
//
// The old onboarding was a wall of text on the title screen and a hint line
// that fired once. Nobody reads a control list before they have a reason to
// care about any single control, so this teaches one verb at a time and WAITS
// for you to do it. Every step names the thing, tells you the key, and then
// watches the game state until it sees you use it.
//
// The rules it follows:
//   * a step never advances on a timer — only on the player performing it
//   * a step never blocks play; you can ignore it and shoot
//   * the whole thing is one keypress from being gone, forever
//
// Steps are pure data. `done(g, tut)` reads the live Game; nothing here writes
// to the game, so the tutorial cannot change how the game plays.

export const STEPS = [
  {
    id: 'orbit',
    title: 'Walk the siege line',
    body: 'Every wall of this castle is a different problem, and you choose which one to attack before you shoot. Move the machine around it.',
    ask: 'Hold <b>A</b> or <b>D</b>',
    askTouch: 'Hold <b>&#8249;</b> or <b>&#8250;</b>',
    at: () => document.getElementById('compass'),
    where: 'below',
    done: (g, t) => Math.abs(g.angle - t.startAngle) > 0.35,
  },
  {
    id: 'wind',
    title: 'Set the range',
    body: 'How far the shot carries. Nothing else changes it.',
    ask: 'Roll the wheel, or press <b>W</b> / <b>S</b>',
    askTouch: 'Tap <b>&minus;</b> and <b>+</b> on the Range bar',
    at: () => document.getElementById('powerRow'),
    where: 'above',
    // A CHANGE in draw, not an absolute one: the machine starts at 80% wound,
    // so `power > 0.55` was true before the player had touched anything and
    // the step marked itself complete on the way past.
    done: (g, t) => Math.abs(g.power - t.startPower) > 0.12,
  },
  {
    id: 'angle',
    title: 'Set the angle',
    body: 'Low is flat and fast; high lobs it over a wall. The gold band on this bar is where a shot from here actually reaches something.',
    ask: 'Press the up or down arrow key',
    askTouch: 'Tap <b>&minus;</b> and <b>+</b> on the Angle bar',
    at: () => document.querySelector('.elevRow'),
    where: 'above',
    done: (g, t) => Math.abs(g.elevDeg() - t.startElev) > 5,
  },
  {
    id: 'trim',
    title: 'Aim, and loose',
    body: 'Press and drag on the field. Sideways swings the machine, up and down fine-tunes the angle. The dotted line is a real cast of the shot, not a guess: let go and he goes exactly there.',
    ask: 'Drag on the field, then let go',
    at: () => document.getElementById('stage'),
    where: 'above',
    done: (g, t) => t.fired > 0,
  },
  {
    id: 'dive',
    title: 'The second tap',
    body: 'Once per shot, in mid-air, and every kind of man does something different with it. A Lance drops out of the arc like a stone.',
    ask: 'Press <b>SPACE</b> while he is in the air',
    askTouch: 'Hit <b>DIVE</b> while he is in the air',
    at: () => document.getElementById('tcDive'),
    where: 'above',
    done: (g, t) => t.dived > 0,
    // Nothing to do until there is something in the air.
    idle: (g) => g.state !== 'flight',
    idleNote: 'Loose another one first.',
  },
  {
    id: 'weak',
    title: 'Find the weak point',
    body: 'The gold bracket marks a block holding up everything above it. Take that and the rest comes down on its own. The men in <b>red</b> count either way, hit or crushed.',
    ask: 'Bring one of them down',
    at: () => document.getElementById('soldiers'),
    where: 'below',
    done: (g) => g.soldiersDown > 0,
  },
  {
    id: 'types',
    title: 'Change the man on the arm',
    body: 'You have <b>Mauls</b> as well as Lances, and they are not interchangeable: a Maul shatters stone a Lance bounces off. Later castles issue four kinds.',
    ask: 'Press <b>2</b>, or click the Maul',
    askTouch: 'Tap the <b>Maul</b> in the rack',
    at: () => document.querySelector('.ktile[data-type="maul"]'),
    where: 'below',
    done: (g) => g.selected !== 'lance',
  },
  {
    id: 'done',
    title: 'That is the whole game',
    body: 'Circle, choose your man, set range and angle, loose, and use the second tap. Bring the rest of them down.',
    done: () => false,          // the last card is dismissed, not completed
    last: true,
  },
];

export class Tutorial {
  constructor(game, els, touch) {
    this.g = game;
    this.els = els;                 // { root, title, body, dots, skip, next }
    this.touch = !!touch;
    this.i = 0;
    this.fired = 0;
    this.dived = 0;
    this.startAngle = game.angle;
    this.startPower = game.power;
    this.startElev = game.elevDeg();
    this.active = true;
    this.shownAt = 0;
    this.t = 0;
    this._render();
  }

  // The game reports these rather than the tutorial reaching into input
  // handling, so the coach cannot get out of step with what actually happened.
  noteFire() { this.fired++; }
  noteDive() { this.dived++; }

  step() { return STEPS[this.i]; }

  update(dt) {
    if (!this.active) return;
    this.t += dt;
    const s = this.step();
    if (!s) return this.finish();
    // A step whose moment has not arrived yet dims rather than nagging.
    const idle = s.idle ? s.idle(this.g) : false;
    this.els.root.classList.toggle('idle', !!idle);
    this._point(s, idle);
    if (idle) return;
    // A quarter second of grace so a step cannot be satisfied by the same
    // input that dismissed the one before it.
    if (this.t - this.shownAt < 0.25) return;
    if (s.done(this.g, this)) this.advance();
  }

  // Put a ring round the thing the current step is talking about. Text alone
  // reads as a menu; a ring on the actual control reads as a hand pointing.
  // Re-measured every frame because the elements it points at move (the rack
  // rebuilds, the touch buttons appear and vanish with the state).
  _point(s, idle) {
    const halo = this.els.halo;
    if (!halo) return;
    const el = (!idle && s.at) ? s.at() : null;
    if (!el || !el.getBoundingClientRect) { halo.classList.remove('on'); return; }
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) { halo.classList.remove('on'); return; }
    // The field is the whole canvas; ringing it would ring the window, so that
    // one gets a small target in the middle instead.
    const full = r.width > innerWidth * 0.8 && r.height > innerHeight * 0.8;
    // A minimum size, because some of the things worth pointing at are only a
    // few pixels tall — the compass is three 3px bars, and a ring drawn tight
    // round it reads as a box floating over nothing.
    const pad = 10;
    const w = full ? 190 : Math.max(48, r.width + pad * 2);
    const h = full ? 190 : Math.max(30, r.height + pad * 2);
    const x = full ? innerWidth / 2 - w / 2 : r.left + r.width / 2 - w / 2;
    const y = full ? innerHeight * 0.52 - h / 2 : r.top + r.height / 2 - h / 2;
    halo.style.left = x + 'px';
    halo.style.top = y + 'px';
    halo.style.width = w + 'px';
    halo.style.height = h + 'px';
    halo.style.borderRadius = full ? '50%' : '10px';
    halo.classList.add('on');
  }

  advance() {
    this.i++;
    if (this.i >= STEPS.length) return this.finish();
    this.shownAt = this.t;
    this._render();
    if (this.els.root.animate) {
      this.els.root.classList.remove('pop');
      void this.els.root.offsetWidth;
      this.els.root.classList.add('pop');
    }
  }

  finish() {
    this.active = false;
    this.els.root.classList.remove('on');
    if (this.els.halo) this.els.halo.classList.remove('on');
  }

  _render() {
    const s = this.step();
    if (!s) return;
    const { root, title, body, ask, dots, next } = this.els;
    root.classList.add('on');
    root.classList.toggle('final', !!s.last);
    title.textContent = s.title;
    body.innerHTML = s.body;
    // The instruction is separated from the explanation and given its own row,
    // because "what do I press" is the only part you need on the second read.
    const a = (this.touch && s.askTouch) ? s.askTouch : s.ask;
    ask.innerHTML = a ? `<span class="do">Do this</span>${a}` : '';
    ask.style.display = a ? '' : 'none';
    dots.innerHTML = STEPS.map((_, i) =>
      `<i class="${i < this.i ? 'was' : i === this.i ? 'is' : ''}"></i>`).join('');
    next.textContent = s.last ? 'Begin the siege' : 'Skip';
    next.classList.toggle('go', !!s.last);
  }
}

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
    body: 'Hold <b>A</b> or <b>D</b> to move the machine around the fortress. Every wall is a different problem.',
    touch: 'Use <b>&#8249;</b> and <b>&#8250;</b> to move the machine around the fortress.',
    done: (g, t) => Math.abs(g.angle - t.startAngle) > 0.35,
  },
  {
    id: 'wind',
    title: 'Wind the arm',
    body: 'Press and drag <b>downward</b> anywhere on the field. The further you pull, the further the shot carries.',
    touch: 'Press and drag <b>downward</b> anywhere on the field to wind the arm.',
    // A CHANGE in draw, not an absolute one: the machine starts at 80% wound,
    // so `power > 0.55` was true before the player had touched anything and
    // the step marked itself complete on the way past.
    done: (g, t) => Math.abs(g.power - t.startPower) > 0.12,
  },
  {
    id: 'trim',
    title: 'Trim the aim',
    body: 'Still holding, drag <b>left and right</b>. The dotted line is where the man will actually land \u2014 it is a real cast, not a guess.',
    touch: 'Still holding, drag <b>left and right</b>. The dotted line is where he will land.',
    done: (g) => Math.abs(g.yaw) > 0.06,
  },
  {
    id: 'loose',
    title: 'Loose',
    body: 'Let go.',
    done: (g, t) => t.fired > 0,
  },
  {
    id: 'dive',
    title: 'The second tap',
    body: 'While he is in the air, press <b>SPACE</b>. Every kind of man does something different with it \u2014 a Lance drops out of the arc like a stone.',
    touch: 'While he is in the air, hit <b>DIVE</b>. Every kind of man does something different with it.',
    done: (g, t) => t.dived > 0,
    // Nothing to do until there is something in the air.
    idle: (g) => g.state !== 'flight',
  },
  {
    id: 'garrison',
    title: 'The garrison is the objective',
    body: 'The men in <b>red</b> are what you are here for. Hit them, or drop the wall they are standing on \u2014 masonry counts.',
    done: (g) => g.soldiersDown > 0,
  },
  {
    id: 'types',
    title: 'Change the man on the arm',
    body: 'You have <b>Mauls</b> as well as Lances. Press <b>2</b>, or click it in the rack. A Maul shatters stone a Lance bounces off.',
    touch: 'You have <b>Mauls</b> as well as Lances. Tap one in the rack. A Maul shatters stone a Lance bounces off.',
    done: (g) => g.selected !== 'lance',
  },
  {
    id: 'done',
    title: 'That is the whole game',
    body: 'Circle, choose your man, wind, trim, loose, and use the second tap. Bring the rest of them down.',
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
    if (idle) return;
    // A quarter second of grace so a step cannot be satisfied by the same
    // input that dismissed the one before it.
    if (this.t - this.shownAt < 0.25) return;
    if (s.done(this.g, this)) this.advance();
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
  }

  _render() {
    const s = this.step();
    if (!s) return;
    const { root, title, body, dots, next } = this.els;
    root.classList.add('on');
    title.textContent = s.title;
    body.innerHTML = (this.touch && s.touch) ? s.touch : s.body;
    dots.innerHTML = STEPS.map((_, i) =>
      `<i class="${i < this.i ? 'was' : i === this.i ? 'is' : ''}"></i>`).join('');
    next.textContent = s.last ? 'Begin' : 'Skip';
  }
}

// Standing-desk rhythm. Pure logic, like RestTimer: no Electron imports.
//
// Phases:
//   off       – standing reminders disabled
//   sitting   – counting down to the next stand (may be held by a zone, a break, a fullscreen app…)
//   raise     – "Raise your desk" prompt is up, waiting for "I'm standing"
//   exercise  – guided routine: fullscreen ('full') or a small desk routine in the corner ('mini')
//   standing  – working standing up; a small widget counts down
//   lower     – "Lower your desk" prompt, waiting for "Desk is down"
//
// While standing (raise → lower), regular breaks wait: RestTimer asks isActive().
const { EventEmitter } = require('events');

const ACTIVE = new Set(['raise', 'exercise', 'standing', 'lower']);
const SNOOZE_MINUTES = 10;
const EXERCISE_TIMEOUT_MS = 12 * 60 * 1000; // safety net if the exercise screen never reports back

class StandTimer extends EventEmitter {
  /**
   * @param {() => object} getSettings
   * @param {{ unitMs?: number, now?: () => number, holdReason?: () => string | null }} opts
   *   holdReason – why a stand can't start right now ('break', 'zone', 'fullscreen', 'paused'…) or null
   */
  constructor(getSettings, opts = {}) {
    super();
    this.getSettings = getSettings;
    this.unitMs = opts.unitMs ?? 60000;
    this.now = opts.now ?? Date.now;
    this.holdReason = opts.holdReason ?? (() => null);

    this.phase = 'off';
    this.dueAt = 0;
    this.endsAt = 0;         // end of the standing period
    this.standStartedAt = 0;
    this.exerciseStartedAt = 0;
    this.held = null;        // why a due stand is waiting
    this.mode = null;        // 'full' | 'mini' while exercising
    this.warned = false;
  }

  isActive() {
    return ACTIVE.has(this.phase);
  }

  // ---- transitions --------------------------------------------------------

  /** (Re)start the sitting countdown; `ms` overrides the normal interval (e.g. a snooze). */
  sit(ms) {
    const s = this.getSettings();
    if (!s.standEnabled) {
      this.phase = 'off';
      this.emitState();
      return;
    }
    this.phase = 'sitting';
    this.dueAt = this.now() + (ms ?? s.standEveryMinutes * this.unitMs);
    this.held = null;
    this.warned = false;
    this.emitState();
  }

  /** Settings changed: turn on/off or restart the countdown if the interval changed. */
  refresh() {
    const s = this.getSettings();
    if (!s.standEnabled && this.phase !== 'off') {
      const wasActive = this.isActive();
      this.phase = 'off';
      if (wasActive) this.emit('closed');
      this.emitState();
    } else if (s.standEnabled && this.phase === 'off') {
      this.sit();
    }
  }

  /** Start a stand right away (tray "Stand now" / settings preview). */
  standNow() {
    if (this.isActive()) return;
    this.phase = 'raise';
    this.held = null;
    this.standStartedAt = 0;
    this.emit('raise');
    this.emitState();
  }

  /**
   * User: "I'm standing".
   * @param {'full' | 'mini'} mode  full: follow along fullscreen; mini: keep working with the desk routine
   */
  up(mode = 'full') {
    if (this.phase !== 'raise') return;
    this.standStartedAt = this.now();
    const routine = this.getSettings().standRoutine;
    if (routine && routine !== 'none') {
      this.phase = 'exercise';
      this.#startExercise(mode);
    } else {
      this.#startStanding();
    }
  }

  /** Switch between the fullscreen routine and the mini window mid-routine. */
  setMode(mode) {
    if (this.phase !== 'exercise' || mode === this.mode) return;
    this.#startExercise(mode);
  }

  #startExercise(mode) {
    this.mode = mode === 'mini' ? 'mini' : 'full';
    this.exerciseStartedAt = this.now();
    // The mini window always runs the desk routine: small moves you can do while you work.
    const routine = this.mode === 'mini' ? 'desk' : this.getSettings().standRoutine;
    this.emit('exercise', { routine, mode: this.mode });
    this.emitState();
  }

  /** Exercise screen finished (or the user skipped the rest of the routine). */
  exercisesDone() {
    if (this.phase !== 'exercise') return;
    this.#startStanding();
  }

  #startStanding() {
    const s = this.getSettings();
    this.phase = 'standing';
    // The routine counts toward standing time, so the timer starts from when you stood up.
    this.endsAt = this.standStartedAt + s.standMinutes * this.unitMs;
    if (this.endsAt <= this.now()) this.endsAt = this.now() + 60 * 1000;
    this.emit('standing');
    this.emitState();
  }

  /** User wants to sit early (from the widget). */
  sitNow() {
    if (this.phase !== 'standing') return;
    this.#lower();
  }

  #lower() {
    this.phase = 'lower';
    this.emit('lower');
    this.emitState();
  }

  /** User: "5 more minutes" on the lower prompt. */
  moreTime(minutes = 5) {
    if (this.phase !== 'lower') return;
    this.phase = 'standing';
    this.endsAt = this.now() + minutes * this.unitMs;
    this.emit('standing');
    this.emitState();
  }

  /** User: "Desk is down". */
  down() {
    if (this.phase !== 'lower') return;
    this.emit('stood', { ms: this.now() - this.standStartedAt });
    this.emit('outcome', { outcome: 'done' });
    this.emit('closed');
    this.sit();
  }

  /** User: "Not now" on the raise prompt. */
  notNow() {
    if (this.phase !== 'raise') return;
    this.emit('outcome', { outcome: 'snoozed' });
    this.emit('closed');
    this.sit(SNOOZE_MINUTES * this.unitMs);
  }

  /** User: "Skip this one" on the raise prompt. */
  skip() {
    if (this.phase !== 'raise') return;
    this.emit('outcome', { outcome: 'skipped' });
    this.emit('closed');
    this.sit();
  }

  /** Smart order chose to stand instead of a break that's (nearly) due: take its slot. */
  pullForward(ms = 0) {
    const at = this.now() + ms;
    if (this.phase === 'sitting' && this.dueAt > at) this.dueAt = at;
  }

  /** Back from being away / paused: you weren't sitting, so start a fresh countdown. */
  restartSitting() {
    if (this.phase === 'sitting') this.sit();
  }

  // ---- clock --------------------------------------------------------------

  tick() {
    const s = this.getSettings();
    const now = this.now();
    if (!s.standEnabled) {
      if (this.phase !== 'off') this.refresh();
      return;
    }

    switch (this.phase) {
      case 'off':
        this.sit();
        break;
      case 'sitting': {
        const hold = this.holdReason();
        this.held = now >= this.dueAt ? hold : null;
        const left = this.dueAt - now;
        if (!hold && !this.warned && s.warningSeconds > 0 && left <= s.warningSeconds * 1000 && left > 0) {
          this.warned = true;
          this.emit('warning', { secondsLeft: Math.round(left / 1000) });
        }
        if (left <= 0 && !hold) {
          this.phase = 'raise';
          this.held = null;
          this.standStartedAt = 0;
          this.emit('raise');
        }
        break;
      }
      case 'exercise':
        if (now - this.exerciseStartedAt > EXERCISE_TIMEOUT_MS) this.#startStanding();
        break;
      case 'standing':
        if (now >= this.endsAt) this.#lower();
        break;
    }
    this.emitState();
  }

  // ---- views --------------------------------------------------------------

  state() {
    const now = this.now();
    return {
      phase: this.phase,
      held: this.held,
      mode: this.phase === 'exercise' ? this.mode : null,
      dueInMs: this.phase === 'sitting' ? Math.max(0, this.dueAt - now) : null,
      standingLeftMs: this.phase === 'standing' ? Math.max(0, this.endsAt - now) : null,
      standingTotalMs: this.phase === 'standing' ? this.endsAt - this.standStartedAt : null,
      standingForMs: this.isActive() && this.standStartedAt ? now - this.standStartedAt : null,
    };
  }

  emitState() {
    this.emit('state', this.state());
  }
}

module.exports = { StandTimer };

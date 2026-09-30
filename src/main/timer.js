// The work/break rhythm. Pure logic: no Electron imports, so it's easy to reason about and test.
//
// Phases:
//   working   – counting down to the next break
//   break     – resting, overlay is up
//   waiting   – break finished, waiting for the user to click "I'm back" (confirmEnd)
//   paused    – user paused reminders (optionally until a time)
//   away      – user is idle / screen locked; the work timer restarts when they return
//   deferred  – a break is due but is being held: a fullscreen game/video/presentation is in
//               front, or you're inside a break zone (a meeting, class, …); it waits
const { EventEmitter } = require('events');
const { activeZone } = require('./zones');

class RestTimer extends EventEmitter {
  /**
   * @param {() => object} getSettings
   * @param {{ unitMs?: number, now?: () => number, idleSeconds?: () => number, isFullscreen?: () => boolean }} opts
   *   unitMs – length of one "minute" (60000 normally; 1000 in --fast dev mode)
   */
  constructor(getSettings, opts = {}) {
    super();
    this.getSettings = getSettings;
    this.unitMs = opts.unitMs ?? 60000;
    this.now = opts.now ?? Date.now;
    this.idleSeconds = opts.idleSeconds ?? (() => 0);
    this.isFullscreen = opts.isFullscreen ?? (() => false);
    this.isStanding = opts.isStanding ?? (() => false);
    this.yieldReason = opts.yieldReason ?? (() => null); // smart order (coordinator.js)
    this.deferredSince = 0;
    this.deferReason = null; // 'fullscreen' | 'zone'

    this.phase = 'working';
    this.endsAt = 0;          // end of the current work block or break
    this.breakTotalMs = 0;
    this.workTotalMs = 0;
    this.isLongBreak = false;
    this.breaksTaken = 0;     // counts completed breaks for the long-break cycle
    this.pausedUntil = null;  // null = until resumed
    this.warned = false;
    this.snoozed = false;
    this.interval = null;
  }

  start() {
    this.startWork();
    this.interval = setInterval(() => this.tick(), 1000);
  }

  stop() {
    clearInterval(this.interval);
  }

  // ---- transitions --------------------------------------------------------

  startWork(ms) {
    const s = this.getSettings();
    this.phase = 'working';
    this.workTotalMs = ms ?? s.workMinutes * this.unitMs;
    this.endsAt = this.now() + this.workTotalMs;
    this.warned = false;
    this.emitState();
  }

  startBreak({ long } = {}) {
    const s = this.getSettings();
    const nextIndex = this.breaksTaken + 1;
    this.isLongBreak = long ?? (s.longBreakEnabled && nextIndex % s.longBreakEvery === 0);
    const minutes = this.isLongBreak ? s.longBreakMinutes : s.breakMinutes;
    this.breakTotalMs = Math.max(5000, minutes * this.unitMs);
    this.phase = 'break';
    this.endsAt = this.now() + this.breakTotalMs;
    this.snoozed = false;
    this.emit('break-start', this.breakInfo());
    this.emitState();
  }

  finishBreak() {
    this.breaksTaken += 1;
    const s = this.getSettings();
    this.emit('break-end', { completed: true, reason: 'completed' });
    if (s.confirmEnd) {
      this.phase = 'waiting';
      this.emit('break-waiting');
      this.emitState();
    } else {
      this.startWork();
    }
  }

  /** User clicked "I'm back" after a break that waits for confirmation. */
  confirmBack() {
    if (this.phase === 'waiting') {
      this.emit('break-closed');
      this.startWork();
    }
  }

  skipBreak() {
    if (this.phase !== 'break' && this.phase !== 'waiting') return;
    const wasWaiting = this.phase === 'waiting';
    if (!wasWaiting) this.emit('break-end', { completed: false, reason: 'skipped' });
    this.emit('break-closed');
    this.startWork();
  }

  snooze() {
    if (this.phase !== 'break') return;
    const s = this.getSettings();
    this.emit('break-end', { completed: false, reason: 'snoozed' });
    this.emit('break-closed');
    this.startWork(s.snoozeMinutes * this.unitMs);
    this.warned = true; // don't warn again right before a snoozed break
  }

  breakNow() {
    if (this.phase === 'break' || this.phase === 'waiting') return;
    this.startBreak();
  }

  pause(minutes) {
    if (this.phase === 'break') this.emit('break-end', { completed: false, reason: 'paused' });
    if (this.phase === 'break' || this.phase === 'waiting') {
      this.emit('break-closed');
    }
    this.phase = 'paused';
    this.pausedUntil = minutes ? this.now() + minutes * this.unitMs : null;
    this.emitState();
  }

  resume() {
    if (this.phase !== 'paused' && this.phase !== 'away') return;
    this.pausedUntil = null;
    this.startWork();
  }

  /** A standing session counted as your break: start a fresh work block. */
  creditRest() {
    if (this.phase === 'working' || this.phase === 'deferred') {
      this.deferReason = null;
      this.startWork();
    }
  }

  /** Restart the current work block (e.g. after changing the interval). */
  restartWork() {
    if (this.phase === 'working') this.startWork();
  }

  /** Screen locked / computer went to sleep. */
  goAway() {
    if (this.phase === 'working' || this.phase === 'deferred') {
      this.phase = 'away';
      this.emitState();
    }
  }

  /** Screen unlocked / computer woke up. */
  comeBack() {
    if (this.phase === 'away') this.startWork();
  }

  // ---- clock --------------------------------------------------------------

  tick() {
    const s = this.getSettings();
    const now = this.now();

    switch (this.phase) {
      case 'working': {
        const hold = this.holdReason(s, now);
        // Idle long enough? You were already resting: restart the work block when you return.
        // (Not while fullscreen: a controller or a movie doesn't register as input.)
        if (hold !== 'fullscreen' && hold !== 'standing' && s.idleResetMinutes > 0 && this.idleSeconds() * 1000 >= s.idleResetMinutes * this.unitMs) {
          this.phase = 'away';
          break;
        }
        const left = this.endsAt - now;
        if (!hold && !this.warned && s.warningSeconds > 0 && left <= s.warningSeconds * 1000 && left > 0) {
          this.warned = true;
          this.emit('warning', { secondsLeft: Math.round(left / 1000) });
        }
        if (left <= 0) {
          if (hold) {
            this.phase = 'deferred';
            this.deferReason = hold;
            this.deferredSince = now;
          } else {
            this.startBreak();
          }
        }
        break;
      }
      case 'deferred': {
        const hold = this.holdReason(s, now);
        this.deferReason = hold || this.deferReason;
        // The max wait only applies to fullscreen apps; zones end on their own.
        const maxWait = hold === 'fullscreen' && s.fullscreenMaxWaitMinutes > 0 ? s.fullscreenMaxWaitMinutes * this.unitMs : Infinity;
        if (now - this.deferredSince >= maxWait) {
          this.startBreak();
        } else if (!hold) {
          // Game closed / zone over: give a heads-up, then the break follows shortly.
          this.startWork(Math.max(10, s.warningSeconds) * 1000);
          this.warned = false;
        }
        break;
      }
      case 'break':
        if (now >= this.endsAt) this.finishBreak();
        break;
      case 'paused':
        if (this.pausedUntil && now >= this.pausedUntil) this.resume();
        break;
      case 'away':
        if (this.idleSeconds() < 3) this.startWork();
        break;
    }
    this.emitState();
  }

  /** Why a due break should wait right now, or null. Zones win over fullscreen for display. */
  holdReason(s, now) {
    if (this.isStanding()) return 'standing'; // standing sessions take priority over breaks
    const y = this.yieldReason(this.phase === 'working' ? this.endsAt - now : 0);
    if (y) return y;                         // 'stand-first' | 'spacing'
    if (activeZone(s.zones, now)) return 'zone';
    if (s.holdForFullscreen && this.isFullscreen()) return 'fullscreen';
    return null;
  }

  // ---- views --------------------------------------------------------------

  breakInfo() {
    return {
      endsAt: this.endsAt,
      totalMs: this.breakTotalMs,
      isLong: this.isLongBreak,
    };
  }

  state() {
    const now = this.now();
    const remainingMs =
      this.phase === 'paused'
        ? (this.pausedUntil ? Math.max(0, this.pausedUntil - now) : null)
        : this.phase === 'working' || this.phase === 'break'
          ? Math.max(0, this.endsAt - now)
          : null;
    const totalMs =
      this.phase === 'working' ? this.workTotalMs
        : this.phase === 'break' ? this.breakTotalMs
          : null;
    const s = this.getSettings();
    const nextIndex = this.breaksTaken + 1;
    const zone = activeZone(s.zones, now);
    return {
      phase: this.phase,
      remainingMs,
      deferredMs: this.phase === 'deferred' ? now - this.deferredSince : null,
      deferReason: this.phase === 'deferred' ? this.deferReason : null,
      zone: zone ? { label: zone.zone.label || 'Break zone', endsAt: zone.endsAt } : null,
      totalMs,
      breaksTaken: this.breaksTaken,
      nextIsLong: s.longBreakEnabled && nextIndex % s.longBreakEvery === 0,
      isLongBreak: this.isLongBreak,
    };
  }

  emitState() {
    this.emit('state', this.state());
  }
}

module.exports = { RestTimer };

// Smart order: breaks and standing sessions never land on top of each other.
// Pure logic (no Electron imports), like RestTimer and StandTimer.
//
// Rules
//   1. One at a time, with space in between. After a break or a stand, the other one waits
//      at least `gap` minutes (a third of that if you only dismissed the prompt).
//   2. When both are due close together, only the one you're more likely to do right now
//      goes first:
//        – stand first: the break waits while you stand, and a finished stand counts as
//          your break (the work timer starts over);
//        – break first: the stand waits until the gap after the break has passed.
//   3. It learns from what you do. Each outcome (done / snoozed / skipped) updates a
//      running score per kind and per part of the day, and the gap grows when you dismiss
//      something that came soon after something else (shrinking slowly when you don't).
const PARTS = ['morning', 'afternoon', 'evening'];
const VALUE = { done: 1, snoozed: 0.35, skipped: 0 };
const ALPHA = 0.2;          // how fast scores follow recent behaviour
const MIN_SAMPLES = 3;      // per part of the day before trusting that part over the overall score
const GAP = { start: 15, min: 10, max: 40, up: 5, down: 1 };

function partOf(ts) {
  const h = new Date(ts).getHours();
  if (h < 12) return 'morning';
  if (h < 17) return 'afternoon';
  return 'evening';
}

function freshData() {
  const scores = () => ({ all: 0.6, morning: 0.6, afternoon: 0.6, evening: 0.6 });
  const counts = () => ({ all: 0, morning: 0, afternoon: 0, evening: 0 });
  return {
    gapMin: GAP.start,
    scores: { break: scores(), stand: scores() },
    counts: { break: counts(), stand: counts() },
    lastKind: null,
    lastOutcome: null,
    lastEnd: 0,
  };
}

class Coordinator {
  /**
   * @param {{ load?: () => object | null, save?: (data: object) => void, now?: () => number,
   *           unitMs?: number, enabled?: () => boolean }} opts
   */
  constructor(opts = {}) {
    this.now = opts.now ?? Date.now;
    this.unitMs = opts.unitMs ?? 60000;
    this.enabled = opts.enabled ?? (() => true);
    this.save = opts.save ?? (() => {});
    const loaded = opts.load?.();
    const base = freshData();
    this.data = loaded ? { ...base, ...loaded, scores: { ...base.scores, ...loaded.scores }, counts: { ...base.counts, ...loaded.counts } } : base;
    this.shownAt = { break: 0, stand: 0 };
    this.pullStand = () => {};
  }

  gapMs() {
    return this.data.gapMin * this.unitMs;
  }

  /** Until when nothing new should pop up (after the last break or stand). */
  quietUntil() {
    if (!this.data.lastEnd) return 0;
    const dismissed = this.data.lastOutcome !== 'done';
    return this.data.lastEnd + (dismissed ? this.gapMs() / 3 : this.gapMs());
  }

  #score(kind, part) {
    const n = this.data.counts[kind][part];
    const s = this.data.scores[kind];
    return n >= MIN_SAMPLES ? s[part] : s.all;
  }

  /** Which one to put first right now: 'stand' or 'break'. Ties go to standing (you also move). */
  prefer(now = this.now()) {
    const part = partOf(now);
    return this.#score('stand', part) >= this.#score('break', part) - 0.05 ? 'stand' : 'break';
  }

  // ---- what happened ------------------------------------------------------

  /** A break or stand prompt appeared. */
  started(kind) {
    this.shownAt[kind] = this.now();
  }

  /** A break or stand is over. outcome: 'done' | 'snoozed' | 'skipped'. */
  record(kind, outcome) {
    const now = this.now();
    const d = this.data;
    const v = VALUE[outcome] ?? 0;
    const part = partOf(now);
    for (const key of ['all', part]) {
      d.scores[kind][key] += ALPHA * (v - d.scores[kind][key]);
      d.counts[kind][key] += 1;
    }
    // Did this one come soon after the other kind? Then learn how much space you like.
    const shown = this.shownAt[kind] || now;
    const crowded = d.lastKind && d.lastKind !== kind && shown - d.lastEnd < this.gapMs() + 10 * this.unitMs;
    if (crowded) {
      d.gapMin = outcome === 'done' ? Math.max(GAP.min, d.gapMin - GAP.down) : Math.min(GAP.max, d.gapMin + GAP.up);
    }
    d.lastKind = kind;
    d.lastOutcome = outcome;
    d.lastEnd = now;
    this.save(d);
  }

  // ---- decisions ------------------------------------------------------------

  /**
   * Why a break should wait (for RestTimer), or null.
   * @param standState  StandTimer.state()
   * @param breakInMs   time until the break is due (0 once it's due)
   * @param leadMs      how early to decide (the heads-up window), so only one heads-up goes out
   */
  breakHold(standState, breakInMs = 0, leadMs = 30000) {
    if (!this.enabled()) return null;
    const now = this.now();
    if (this.data.lastKind === 'stand' && now < this.quietUntil()) return 'spacing';
    // A stand is coming soon and it's the one you'd rather do: stand first, break waits.
    const recentlyDismissedStand = this.data.lastKind === 'stand' && this.data.lastOutcome !== 'done' && now - this.data.lastEnd < this.gapMs();
    if (breakInMs <= leadMs && standState?.phase === 'sitting' && !standState.held
        && standState.dueInMs < breakInMs + this.gapMs()
        && !recentlyDismissedStand && this.prefer(now) === 'stand') {
      this.pullStand(Math.max(0, breakInMs)); // the stand takes the break's slot (and gives its own heads-up)
      return 'stand-first';
    }
    return null;
  }

  /** Why a due stand should wait (for StandTimer), or null. */
  standHold(timerState) {
    if (!this.enabled()) return null;
    const now = this.now();
    if (this.data.lastKind === 'break' && now < this.quietUntil()) return 'spacing';
    if (timerState?.phase === 'working' && timerState.remainingMs < this.gapMs() && this.prefer(now) === 'break') return 'break-soon';
    return null;
  }

  // ---- wiring -----------------------------------------------------------------

  /** Listen to both timers: learn from outcomes, and count a finished stand as a break. */
  attach(timer, stand) {
    this.pullStand = (ms) => stand.pullForward(ms);
    timer.on('break-start', () => this.started('break'));
    timer.on('break-end', ({ reason }) => {
      if (reason === 'completed') this.record('break', 'done');
      else if (reason === 'snoozed') this.record('break', 'snoozed');
      else if (reason === 'skipped') this.record('break', 'skipped');
    });
    stand.on('raise', () => this.started('stand'));
    stand.on('outcome', ({ outcome }) => {
      this.record('stand', outcome);
      if (outcome === 'done' && this.enabled()) timer.creditRest();
    });
  }

  /** For the settings page. */
  summary() {
    const now = this.now();
    const part = partOf(now);
    const samples = this.data.counts.break.all + this.data.counts.stand.all;
    return {
      enabled: this.enabled(),
      gapMin: this.data.gapMin,
      part,
      prefer: this.prefer(now),
      learning: samples < 6,
      byPart: Object.fromEntries(PARTS.map((p) => {
        const t = new Date(now);
        t.setHours({ morning: 9, afternoon: 14, evening: 19 }[p], 0, 0, 0);
        return [p, this.prefer(t.getTime())];
      })),
    };
  }
}

module.exports = { Coordinator, partOf };

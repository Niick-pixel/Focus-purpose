const test = require('node:test');
const assert = require('node:assert');
const { RestTimer } = require('../src/main/timer');
const { StandTimer } = require('../src/main/stand');
const { Coordinator } = require('../src/main/coordinator');

const MIN = 60000;
const T0 = new Date(2026, 8, 30, 14, 0, 0).getTime(); // an afternoon

function setup(overrides = {}, learned = null) {
  let now = T0;
  const settings = {
    workMinutes: 45, breakMinutes: 2, longBreakEnabled: false, longBreakEvery: 4, longBreakMinutes: 10,
    idleResetMinutes: 0, holdForFullscreen: false, fullscreenMaxWaitMinutes: 0, zones: [], warningSeconds: 30,
    confirmEnd: false, snoozeMinutes: 5,
    standEnabled: true, standEveryMinutes: 60, standMinutes: 15, standRoutine: 'short',
    ...overrides,
  };
  const clock = () => now;
  let stand;
  let coord;
  const timer = new RestTimer(() => settings, {
    now: clock,
    isStanding: () => stand.isActive(),
    yieldReason: (ms) => coord.breakHold(stand.state(), ms, 30000),
  });
  stand = new StandTimer(() => settings, {
    now: clock,
    holdReason: () => {
      const p = timer.state().phase;
      if (p === 'break' || p === 'waiting') return 'break';
      return coord.standHold(timer.state());
    },
  });
  coord = new Coordinator({ now: clock, load: () => learned });
  coord.attach(timer, stand);
  const log = [];
  timer.on('break-start', () => log.push(['break', now]));
  stand.on('raise', () => log.push(['stand', now]));
  timer.startWork();
  stand.sit();
  const advance = (ms) => { const end = now + ms; while (now < end) { now = Math.min(end, now + 1000); timer.tick(); stand.tick(); } };
  return { timer, stand, coord, log, advance, clock: () => now, settings };
}

test('stand and break due together: only one goes, and a finished stand counts as the break', () => {
  // Stand every 45 min too, so both land on the same minute.
  const { timer, stand, log, advance } = setup({ standEveryMinutes: 45 });
  advance(45 * MIN + 2000);
  assert.deepStrictEqual(log.map((e) => e[0]), ['stand'], 'only the stand appears (ties go to standing)');
  assert.strictEqual(timer.state().phase, 'deferred');
  stand.up();
  stand.exercisesDone();
  advance(15 * MIN);
  stand.down();
  assert.strictEqual(timer.state().phase, 'working', 'break was credited');
  assert.ok(timer.state().remainingMs > 44 * MIN, 'fresh work block after standing');
  advance(20 * MIN);
  assert.deepStrictEqual(log.map((e) => e[0]), ['stand'], 'no break right after sitting down');
});

test('stand due a few minutes after a break waits until there is space', () => {
  // Break at 45 min, stand at 50 min; learned: you tend to take breaks and skip stands.
  const learned = { scores: { break: { all: 0.9, morning: 0.9, afternoon: 0.9, evening: 0.9 }, stand: { all: 0.2, morning: 0.2, afternoon: 0.2, evening: 0.2 } } };
  const { log, advance, coord } = setup({ standEveryMinutes: 50 }, learned);
  assert.strictEqual(coord.prefer(T0), 'break');
  advance(45 * MIN + 2000);
  assert.deepStrictEqual(log.map((e) => e[0]), ['break']);
  advance(2 * MIN); // break ends at ~47 min
  const breakEnd = T0 + 47 * MIN;
  advance(20 * MIN);
  const standAt = log.find((e) => e[0] === 'stand')[1];
  assert.ok(standAt - breakEnd >= 15 * MIN - 2000, `stand came ${(standAt - breakEnd) / MIN} min after the break`);
});

test('the break waits for space after a dismissed stand, then comes', () => {
  const { timer, stand, log, advance } = setup({ standEveryMinutes: 44 });
  // The stand comes first; you dismiss it.
  advance(44 * MIN + 1000);
  assert.deepStrictEqual(log.map((e) => e[0]), ['stand']);
  stand.skip();
  advance(90 * 1000);
  assert.notStrictEqual(timer.state().phase, 'break', 'no break straight after dismissing the stand');
  advance(6 * MIN);
  assert.deepStrictEqual(log.map((e) => e[0]), ['stand', 'break']);
});

test('learns: skipping things that come right after each other widens the gap; preferences follow outcomes', () => {
  let now = T0;
  const c = new Coordinator({ now: () => now });
  assert.strictEqual(c.prefer(), 'stand');
  c.started('break'); now += 2 * MIN; c.record('break', 'done');
  now += 5 * MIN; c.started('stand'); c.record('stand', 'skipped');
  assert.strictEqual(c.data.gapMin, 20, 'crowded + skipped → more space');
  for (let i = 0; i < 4; i++) { c.record('stand', 'skipped'); c.record('break', 'done'); }
  assert.strictEqual(c.prefer(), 'break', 'breaks first when you keep skipping stands');
  // Mornings can learn differently from afternoons.
  now = new Date(2026, 8, 30, 9, 0, 0).getTime();
  for (let i = 0; i < 6; i++) { c.record('stand', 'done'); c.record('break', 'skipped'); }
  assert.strictEqual(c.prefer(), 'stand');
  assert.strictEqual(c.prefer(T0), 'break');
  assert.deepStrictEqual(c.summary().byPart, { morning: 'stand', afternoon: 'break', evening: 'stand' });
});

test('smart order off: old behaviour (no holds)', () => {
  const c = new Coordinator({ enabled: () => false });
  assert.strictEqual(c.breakHold({ phase: 'sitting', dueInMs: 0 }, 0), null);
  assert.strictEqual(c.standHold({ phase: 'working', remainingMs: 1000 }), null);
});

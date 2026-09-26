const test = require('node:test');
const assert = require('node:assert');
const { StandTimer } = require('../src/main/stand');
const { RestTimer } = require('../src/main/timer');

function setup(overrides = {}) {
  let now = 0;
  let hold = null;
  const settings = {
    standEnabled: true, standEveryMinutes: 60, standMinutes: 15, standRoutine: 'short', warningSeconds: 30,
    workMinutes: 45, breakMinutes: 2, longBreakEnabled: false, longBreakEvery: 4, longBreakMinutes: 10,
    idleResetMinutes: 0, holdForFullscreen: true, fullscreenMaxWaitMinutes: 0, zones: [],
    ...overrides,
  };
  const stand = new StandTimer(() => settings, { now: () => now, holdReason: () => hold });
  const events = [];
  for (const e of ['raise', 'exercise', 'standing', 'lower', 'stood', 'closed', 'warning']) {
    stand.on(e, (p) => events.push([e, p]));
  }
  stand.sit();
  const advance = (ms) => { const end = now + ms; while (now < end) { now = Math.min(end, now + 1000); stand.tick(); } };
  return { stand, events, settings, advance, setHold: (h) => { hold = h; }, clock: () => now, setNow: (t) => { now = t; } };
}

const names = (events) => events.map((e) => e[0]);

test('full cycle: raise → exercise → standing → lower → sitting', () => {
  const { stand, events, advance } = setup();
  advance(60 * 60000);
  assert.strictEqual(stand.phase, 'raise');
  assert.deepStrictEqual(names(events), ['warning', 'raise']);
  advance(20000); // takes a moment to raise the desk
  stand.up();
  assert.strictEqual(stand.phase, 'exercise');
  advance(3 * 60000);
  stand.exercisesDone();
  assert.strictEqual(stand.phase, 'standing');
  assert.ok(Math.abs(stand.state().standingLeftMs - 12 * 60000) <= 1000, 'routine counts toward the 15 min');
  advance(12 * 60000);
  assert.strictEqual(stand.phase, 'lower');
  stand.down();
  assert.strictEqual(stand.phase, 'sitting');
  const stood = events.find((e) => e[0] === 'stood')[1].ms;
  assert.ok(Math.abs(stood - 15 * 60000) <= 1000);
  assert.ok(Math.abs(stand.state().dueInMs - 60 * 60000) <= 1000);
});

test('no routine goes straight to standing', () => {
  const { stand } = setup({ standRoutine: 'none' });
  stand.standNow();
  stand.up();
  assert.strictEqual(stand.phase, 'standing');
});

test('"Not now" snoozes 10 minutes, "Skip" waits a full interval', () => {
  const { stand } = setup();
  stand.standNow();
  stand.notNow();
  assert.strictEqual(stand.state().dueInMs, 10 * 60000);
  stand.standNow();
  stand.skip();
  assert.strictEqual(stand.state().dueInMs, 60 * 60000);
});

test('"5 more minutes" keeps you standing', () => {
  const { stand, advance } = setup({ standRoutine: 'none' });
  stand.standNow();
  stand.up();
  advance(15 * 60000);
  assert.strictEqual(stand.phase, 'lower');
  stand.moreTime(5);
  assert.strictEqual(stand.phase, 'standing');
  advance(5 * 60000);
  assert.strictEqual(stand.phase, 'lower');
});

test('a due stand waits while held (zone, break, fullscreen) and starts when released', () => {
  const { stand, events, advance, setHold } = setup();
  setHold('zone');
  advance(90 * 60000);
  assert.strictEqual(stand.phase, 'sitting');
  assert.strictEqual(stand.state().held, 'zone');
  assert.ok(!names(events).includes('warning'), 'no heads-up while held');
  setHold(null);
  advance(1000);
  assert.strictEqual(stand.phase, 'raise');
});

test('turning the feature off closes an active session', () => {
  const { stand, events, settings } = setup();
  stand.standNow();
  settings.standEnabled = false;
  stand.refresh();
  assert.strictEqual(stand.phase, 'off');
  assert.ok(names(events).includes('closed'));
});

test('regular breaks wait while standing, then follow after a heads-up', () => {
  const { stand, settings, clock, setNow } = setup({ standRoutine: 'none', warningSeconds: 30 });
  const rest = new RestTimer(() => settings, { now: clock, isStanding: () => stand.isActive() });
  const breaks = [];
  rest.on('break-start', () => breaks.push('break'));
  rest.startWork();
  const drive = (ms) => {
    for (let i = 0; i < ms / 1000; i++) {
      setNow(clock() + 1000);
      stand.tick();
      rest.tick();
    }
  };

  drive(40 * 60000);
  stand.standNow();
  stand.up();
  drive(10 * 60000); // the break came due at 45 min, but we're standing
  assert.strictEqual(rest.phase, 'deferred');
  assert.strictEqual(rest.state().deferReason, 'standing');
  assert.deepStrictEqual(breaks, []);
  drive(5 * 60000); // standing time over: the lower prompt still counts as standing
  assert.strictEqual(stand.phase, 'lower');
  assert.strictEqual(rest.phase, 'deferred');
  stand.down();
  drive(2000);
  assert.strictEqual(rest.phase, 'working'); // short heads-up window
  drive(31000);
  assert.deepStrictEqual(breaks, ['break']);
});

test('"Keep working" runs the desk routine in the mini window; modes can switch mid-routine', () => {
  const { stand, events } = setup({ standRoutine: 'stretch' });
  stand.standNow();
  stand.up('mini');
  assert.strictEqual(stand.phase, 'exercise');
  assert.deepStrictEqual(events.at(-1), ['exercise', { routine: 'desk', mode: 'mini' }]);
  assert.strictEqual(stand.state().mode, 'mini');

  stand.setMode('mini'); // no-op: already there
  assert.strictEqual(events.filter((e) => e[0] === 'exercise').length, 1);

  stand.setMode('full');
  assert.deepStrictEqual(events.at(-1), ['exercise', { routine: 'stretch', mode: 'full' }]);
  stand.exercisesDone();
  assert.strictEqual(stand.phase, 'standing');
  assert.strictEqual(stand.state().mode, null);
  stand.setMode('mini'); // ignored outside the routine
  assert.strictEqual(stand.phase, 'standing');
});

test('"Guide me" (default) runs the chosen routine full screen', () => {
  const { stand, events } = setup({ standRoutine: 'mix' });
  stand.standNow();
  stand.up();
  assert.deepStrictEqual(events.at(-1), ['exercise', { routine: 'mix', mode: 'full' }]);
});

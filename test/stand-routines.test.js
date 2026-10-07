const test = require('node:test');
const assert = require('node:assert');
const X = require('../src/renderer/stand/exercises.js');

const POSE_RANGES = {
  squat: [0, 1], heel: [0, 1], tilt: [-1, 1], swayX: [-1, 1], swayY: [-1, 1], march: [-1, 1], reach: [0, 1],
  stance: [0, 1], sink: [0, 1], backHeel: [0, 1], hinge: [0, 1], lean: [-1, 1], headBack: [0, 1],
};
const ARMS = new Set(['hang', 'forward', 'hips', 'overhead', 'behind', 'desk']);

test('every routine resolves at every level and every frame is valid', () => {
  for (const [name, ids] of Object.entries(X.ROUTINES)) {
    for (const level of [1, 2, 3]) {
      for (const id of ids) {
        const ex = X.getExercise(id, level);
        assert.ok(ex.title && ex.how && ex.focus, `${name}/${id} has title, how and focus`);
        assert.ok(ex.secs > 0);
        for (let t = 0; t < ex.secs; t += 0.1) {
          const r = ex.at(t);
          assert.ok(Number.isFinite(r.floor) && r.floor >= -0.3 && r.floor <= 1, `${id} floor at ${t}`);
          assert.ok(typeof r.cue === 'string' && r.cue.length, `${id} cue at ${t}`);
          assert.ok(ARMS.has(r.pose.arms), `${id} arms`);
          for (const [k, [lo, hi]] of Object.entries(POSE_RANGES)) {
            const v = r.pose[k];
            assert.ok(Number.isFinite(v) && v >= lo - 1e-9 && v <= hi + 1e-9, `${id} ${k}=${v} at ${t}`);
          }
        }
      }
    }
  }
});

test('holds and flicks progress with level', () => {
  const secs = [1, 2, 3].map((l) => X.getExercise('holds', l).secs);
  assert.ok(secs[0] < secs[1] && secs[1] < secs[2]);
  assert.match(X.getExercise('holds', 3).how, /10 seconds/);
  assert.strictEqual(X.getExercise('flicks', 2).secs, 24);
  assert.deepStrictEqual([0, 9, 10, 24, 25, 99].map(X.levelFor), [1, 1, 2, 2, 3, 3]);
});

test('two-sided stretches switch sides halfway', () => {
  const ex = X.getExercise('hipflexor', 1);
  assert.strictEqual(ex.at(5).count, 'Right side');
  assert.strictEqual(ex.at(25).count, 'Left side');
  assert.ok(ex.at(19.9).pose.stance < 0.2, 'steps out before switching');
  assert.ok(ex.at(10).pose.stance > 0.8, 'fully in the stretch mid-side');
});

test('stretch routine ends with the pelvic floor release', () => {
  for (const ids of Object.values(X.ROUTINES)) assert.strictEqual(ids[ids.length - 1], 'release');
});

test('desk routine: about five minutes, hands-free moves, pelvic view for floor-only exercises', () => {
  const secs = X.routineLength('desk', 1);
  assert.ok(secs >= 240 && secs <= 360, `desk routine is ${secs}s`);
  for (const id of X.ROUTINES.desk) {
    const ex = X.getExercise(id, 1);
    for (let t = 0; t < ex.secs; t += 0.5) {
      assert.ok(!['overhead', 'behind', 'forward', 'desk'].includes(ex.at(t).pose.arms), `${id} keeps hands free to work`);
      assert.ok(ex.at(t).pose.stance === 0 && ex.at(t).pose.hinge === 0, `${id} stays at the desk`);
    }
  }
  for (const id of X.PELVIS_VIEW) assert.ok(X.EXERCISES[id], `${id} exists`);
});

test('paced moves: short, slow, valid, and spread through the stand with the release last', () => {
  for (const level of [1, 2, 3]) {
    for (const id of X.PACED_ORDER) {
      const ex = X.getPaced(id, level);
      assert.ok(ex.title && ex.how && ex.focus, `${id} has title, how and focus`);
      assert.ok(ex.secs <= 54, `${id} is short (${ex.secs}s)`);
      for (let t = 0; t < ex.secs; t += 0.1) {
        const r = ex.at(t);
        assert.ok(Number.isFinite(r.floor) && r.floor >= -0.3 && r.floor <= 1, `${id} floor at ${t}`);
        assert.ok(r.cue, `${id} cue at ${t}`);
        assert.ok(!['overhead', 'behind', 'forward', 'desk'].includes(r.pose.arms), `${id} keeps hands free to work`);
      }
    }
  }
  // Slower than the guided versions: fewer flicks, longer rests between holds.
  assert.ok(X.getPaced('flicks', 1).secs / 6 > X.getExercise('flicks', 1).secs / X.LEVELS[1].flicks);

  const MIN = 60000;
  const s15 = X.pacedSchedule(15 * MIN);
  assert.strictEqual(s15[0].at, 1 * MIN, 'first move after a minute');
  assert.strictEqual(s15.at(-1).id, 'release');
  for (let i = 1; i < s15.length; i++) assert.ok(s15[i].at - s15[i - 1].at >= 2.5 * MIN, 'at least 2½ min apart');
  assert.ok(s15.at(-1).at <= 13.5 * MIN, 'last one fits before sitting down');
  assert.ok(X.pacedSchedule(60 * MIN).length === X.PACED_ORDER.length);
  assert.ok(X.pacedSchedule(60 * MIN).every((s, i, a) => i === 0 || s.at - a[i - 1].at <= 4 * MIN), 'never more than 4 min apart');
  assert.deepStrictEqual(X.pacedSchedule(2 * MIN).map((s) => s.id), ['release']);
});

test('stretches highlight the muscle they work', () => {
  const spots = { reach: 'spine', hipflexor: 'hipFront', hamstring: 'backThigh', calf: 'calf', chest: 'chest', chin: 'neck' };
  for (const [id, spot] of Object.entries(spots)) {
    const ex = X.getExercise(id, 1);
    assert.strictEqual(ex.at(ex.secs / 4).pose.focus, spot, id);
  }
});

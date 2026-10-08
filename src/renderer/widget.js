// Floating standing widget ("the dock"): a small card in the corner while you stand.
// The "time to stand / sit" reminders are full screen; this only covers the standing part.
//   pill   – countdown while you stand
//   move   – one slow move (when you chose "Keep working"); every few minutes the pill
//            expands for ~30 seconds, then shrinks back.
const $ = (id) => document.getElementById(id);
const { Figure, PelvisSide } = window.StandVisuals;
const { PELVIS_VIEW, getPaced, pacedSchedule } = window.StandExercises;
const { RoutinePlayer, Cues, countLabel } = window.StandPlayer;
const CIRC = 2 * Math.PI * 17;
const SIZE = { pill: [252, 64], move: [384, 212] };
const READY_SECS = 3;

let payload = {};
let standState = null;
let view = '';
let pace = null;  // { done, readyAt } — paced moves so far (times are ms since you stood up)
let move = null;  // the move on screen: { player, figure, pelvis, cue, raf, total }

const cues = new Cues();
try { cues.muted = localStorage.getItem('standMuted') === '1'; } catch { /* storage unavailable */ }

function fmt(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function setView(v) {
  if (view === v) return;
  view = v;
  $('dock').dataset.view = v;
  window.api.dockResize(...SIZE[v]);
}

// ---- standing pill & pacing ---------------------------------------------------------

function standingElapsed(st) {
  return Math.max(0, (st.standingTotalMs || 0) - (st.standingLeftMs || 0));
}

/** The next paced move, or null when there are none left in this stand. */
function nextMove(st) {
  if (!pace || !st || st.phase !== 'standing') return null;
  const unit = payload.unitMs || 60000;
  const schedule = pacedSchedule(st.standingTotalMs, unit);
  const slot = schedule[pace.done];
  if (!slot) return null;
  return { id: slot.id, at: Math.max(slot.at, pace.readyAt), index: pace.done, count: schedule.length };
}

function renderPill(st) {
  if (!st || st.phase !== 'standing') return;
  $('time').textContent = fmt(st.standingLeftMs);
  const done = 1 - st.standingLeftMs / st.standingTotalMs;
  $('ring').style.strokeDashoffset = String(CIRC * Math.min(1, Math.max(0, done)));
  const next = nextMove(st);
  $('moveNow').hidden = !next;
  $('pillLabel').textContent = next ? `Move in ${fmt(next.at - standingElapsed(st))}` : 'Standing';
  if (next && !move && standingElapsed(st) >= next.at) startMove(next);
}

// ---- one paced move ------------------------------------------------------------------

function startMove(next) {
  stopMove();
  const level = payload.level || 1;
  const ex = getPaced(next.id, level);
  const player = new RoutinePlayer(null, level, { exercises: [{ id: next.id, ex }], ready: READY_SECS });
  $('figure').replaceChildren();
  $('pelvis').replaceChildren();
  const figure = new Figure($('figure'));
  $('figure').setAttribute('viewBox', '40 30 220 400'); // crop to the body: bigger in the small card
  const pelvis = new PelvisSide($('pelvis'), { labels: false });
  move = { player, figure, pelvis, cue: '', raf: 0, next };
  $('mEyebrow').textContent = `Gentle move · ${next.index + 1} of ${next.count}`;
  $('mTitle').textContent = ex.title;
  $('card').title = ex.how; // hover for the full instruction
  $('visual').classList.toggle('show-pelvis', PELVIS_VIEW.has(next.id));
  $('visual').classList.toggle('show-figure', !PELVIS_VIEW.has(next.id));
  setPaused(false);
  setView('move');
  cues.resetSpeech();
  cues.chime(587, 0.04, 0.7);
  cues.speak(ex.title);
  const step = () => {
    moveFrame();
    if (move) move.raf = requestAnimationFrame(step);
  };
  move.raf = requestAnimationFrame(step);
}

function setCue(text) {
  if (text === move.cue) return;
  move.cue = text;
  const cue = $('mCue');
  cue.classList.add('swap');
  setTimeout(() => {
    cue.textContent = text;
    cue.classList.remove('swap');
  }, 140);
}

function moveFrame() {
  const f = move.player.frame();
  if (!f) {
    endMove(false);
    return;
  }
  $('mBar').style.width = `${f.total * 100}%`;
  if (move.player.paused) {
    setCue('Paused');
    return;
  }
  const { ready, state } = f;
  move.figure.ease({ ...state.pose, floor: state.floor });
  move.pelvis.set(state.floor);
  setCue(ready ? 'When you’re ready…' : state.cue);
  if (!ready) cues.speak(state.cue);
  $('mCount').textContent = ready ? '' : countLabel(state.count);
  cues.floor(state.floor);
}

/** Back to the pill. A skipped move pushes the next one a bit further away. */
function endMove(skipped) {
  if (!move) return;
  stopMove();
  const unit = payload.unitMs || 60000;
  pace.done += 1;
  pace.readyAt = standingElapsed(standState) + (skipped ? 3 : 1.5) * unit;
  if (!skipped) cues.chime(523, 0.035, 0.6);
  setView('pill');
  renderPill(standState);
}

function stopMove() {
  if (!move) return;
  cancelAnimationFrame(move.raf);
  cues.silence();
  move = null;
}

function setPaused(paused) {
  document.body.classList.toggle('paused', paused);
  $('mPause').title = paused ? 'Resume' : 'Pause';
  if (paused) cues.silence();
}

function renderVoice() {
  $('voice').setAttribute('aria-pressed', String(cues.voiceOn));
  $('voice').title = cues.voiceOn ? 'Spoken cues: on' : 'Spoken cues: off';
}

$('ring').style.strokeDasharray = String(CIRC);
$('sit').addEventListener('click', () => window.api.standSitNow());
$('moveNow').addEventListener('click', () => {
  const next = nextMove(standState);
  if (next) startMove(next);
});
$('mPause').addEventListener('click', () => move && setPaused(move.player.togglePause()));
$('later').addEventListener('click', () => endMove(true));
$('help').addEventListener('click', () => {
  if (move && !move.player.paused) setPaused(move.player.togglePause());
  window.api.openGuide();
});
$('voice').addEventListener('click', () => {
  cues.voiceOn = !cues.voiceOn;
  cues.resetSpeech();
  if (!cues.voiceOn) cues.silence();
  window.api.setSettings({ standVoice: cues.voiceOn });
  renderVoice();
});

// ---- wiring ---------------------------------------------------------------------------

window.api.onStandMode((p) => {
  payload = { ...payload, ...p };
  document.documentElement.dataset.theme = payload.theme || 'night';
  cues.voiceOn = !!payload.voice;
  renderVoice();
  if (p.mode !== 'standing') return;
  if (!move) setView('pill');
  window.api.getStandState().then((st) => {
    standState = st;
    // "Keep working" starts paced moves. After "5 more minutes" the widget opens again
    // part-way through: pick up after the moves whose time has already passed.
    if (!payload.paced) pace = null;
    else if (!pace) {
      const elapsed = standingElapsed(st);
      const unit = payload.unitMs || 60000;
      const passed = elapsed > 0 ? pacedSchedule(st.standingTotalMs, unit).filter((s) => s.at < elapsed).length : 0;
      pace = { done: passed, readyAt: passed ? elapsed + unit : 0 };
    }
    renderPill(st);
  });
});

window.api.onStandState((st) => {
  standState = st;
  if (st.phase === 'standing' && view === 'pill') renderPill(st);
  if (st.phase !== 'standing' && move) stopMove();
});

window.api.onSettings((s) => { document.documentElement.dataset.theme = s.theme; });

window.api.onStandClosing(() => {
  document.body.classList.add('leaving');
  stopMove();
});

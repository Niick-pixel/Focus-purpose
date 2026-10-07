// Floating standing widget ("the dock"). One small card in the corner for the whole
// standing session while you keep working:
//   prompt – "Time to stand" / "Time to sit"
//   pill   – countdown while you stand
//   move   – one paced move (when you chose "I'm standing" and keep working); every few
//            minutes it expands for ~30 seconds, then shrinks back to the pill.
const $ = (id) => document.getElementById(id);
const { Figure, PelvisSide } = window.StandVisuals;
const { PELVIS_VIEW, getPaced, pacedSchedule } = window.StandExercises;
const { RoutinePlayer, Cues, countLabel } = window.StandPlayer;
const CIRC = 2 * Math.PI * 17;
const SIZE = { prompt: [360, 168], pill: [252, 64], move: [384, 212] };
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

function button(label, onClick) {
  const b = document.createElement('button');
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}

// ---- prompts ------------------------------------------------------------------

function showPrompt(kind) {
  stopMove();
  const links = $('pLinks');
  links.replaceChildren();
  if (kind === 'raise') {
    const guided = payload.routine !== 'none';
    $('pTitle').textContent = 'Time to stand';
    $('pSub').textContent = guided
      ? 'Raise your desk and keep working. A small move every few minutes, nothing more.'
      : 'Raise your desk and keep working on your feet.';
    $('pPrimary').textContent = 'I’m standing';
    $('pPrimary').onclick = () => window.api.standUp(guided ? 'mini' : 'full');
    $('pSecondary').hidden = !guided;
    $('pSecondary').textContent = 'Guide me';
    $('pSecondary').title = 'Follow the full routine on screen';
    $('pSecondary').onclick = () => window.api.standUp('full');
    links.append(button('Not now', () => window.api.standNotNow()), button('Skip', () => window.api.standSkip()));
    links.firstChild.title = 'Remind me in 10 minutes';
    cues.chime(587, 0.05, 0.9);
  } else {
    const minutes = Math.max(1, Math.round((payload.stoodMs || 0) / 60000));
    $('pTitle').textContent = 'Time to sit';
    $('pSub').textContent = `You stood for ${minutes} minute${minutes === 1 ? '' : 's'}. Lower your desk and let your shoulders drop.`;
    $('pPrimary').textContent = 'Desk is down';
    $('pPrimary').onclick = () => window.api.standDown();
    $('pSecondary').hidden = false;
    $('pSecondary').textContent = '5 more min';
    $('pSecondary').title = 'Stand a little longer';
    $('pSecondary').onclick = () => window.api.standMore();
    cues.chime(440, 0.05, 0.9);
  }
  setView('prompt');
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
  if (p.mode === 'raise' || p.mode === 'lower') {
    showPrompt(p.mode);
  } else if (p.mode === 'standing') {
    // "I'm standing · keep working" starts paced moves; "5 more minutes" keeps the pacing going.
    if (payload.paced && !pace) pace = { done: 0, readyAt: 0 };
    if (!payload.paced) pace = null;
    if (!move) setView('pill');
    window.api.getStandState().then((st) => { standState = st; renderPill(st); });
  }
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

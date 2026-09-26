// Mini desk routine: a small always-on-top card in the corner, for when you're standing
// but still working. Same engine as the fullscreen routine (stand/player.js), smaller moves.
const $ = (id) => document.getElementById(id);
const { Figure, PelvisSide } = window.StandVisuals;
const { PELVIS_VIEW } = window.StandExercises;
const { RoutinePlayer, Cues, countLabel } = window.StandPlayer;

let payload = null;
let player = null;
let figure = null;
let pelvis = null;
let segIndex = -1;
let cueText = '';
let frame = 0;
let finished = false;

const cues = new Cues();
try { cues.muted = localStorage.getItem('standMuted') === '1'; } catch { /* storage unavailable */ }

function start() {
  $('figure').replaceChildren();
  $('pelvis').replaceChildren();
  figure = new Figure($('figure'));
  $('figure').setAttribute('viewBox', '40 30 220 400'); // crop to the body: bigger in the small window
  pelvis = new PelvisSide($('pelvis'), { labels: false });
  player = new RoutinePlayer(payload.routine, payload.level || 1);
  segIndex = -1;
  finished = false;
  $('dots').replaceChildren(...player.segments.map(() => document.createElement('i')));
  $('eyebrow').textContent = 'Desk routine';
  setPaused(false);
  cancelAnimationFrame(frame);
  const step = () => {
    tick();
    frame = requestAnimationFrame(step);
  };
  frame = requestAnimationFrame(step);
}

function setCue(text) {
  if (text === cueText) return;
  cueText = text;
  const cue = $('cue');
  cue.classList.add('swap');
  setTimeout(() => {
    cue.textContent = text;
    cue.classList.remove('swap');
  }, 140);
}

function tick() {
  const f = player.frame();
  if (!f) {
    finish();
    return;
  }
  const { seg, index, ready, state } = f;
  if (index !== segIndex) {
    segIndex = index;
    $('title').textContent = seg.ex.title;
    $('card').title = seg.ex.how; // hover for the full instruction
    $('visual').classList.toggle('show-pelvis', PELVIS_VIEW.has(seg.id));
    $('visual').classList.toggle('show-figure', !PELVIS_VIEW.has(seg.id));
    cues.resetSpeech();
    cues.speak(`${index === 0 ? '' : 'Next: '}${seg.ex.title}`);
    [...$('dots').children].forEach((d, i) => {
      d.classList.toggle('done', i < index);
      d.classList.toggle('now', i === index);
    });
  }
  $('next').textContent = ready ? (index === 0 ? 'Get ready' : 'Up next') : `${index + 1} of ${player.segments.length}`;
  $('bar').style.width = `${f.total * 100}%`;
  if (player.paused) {
    setCue('Paused');
    return;
  }
  figure.ease({ ...state.pose, floor: state.floor });
  pelvis.set(state.floor);
  setCue(ready ? 'Get ready…' : state.cue);
  if (!ready) cues.speak(state.cue);
  $('count').textContent = countLabel(state.count);
  cues.floor(state.floor);
}

function setPaused(paused) {
  document.body.classList.toggle('paused', paused);
  $('pause').title = paused ? 'Resume' : 'Pause';
  if (paused) cues.silence();
}

function finish() {
  if (finished) return;
  finished = true;
  cancelAnimationFrame(frame);
  $('card').classList.add('done');
  setCue('Nice work — keep standing');
  cues.chime(523, 0.04, 0.8);
  window.api.standExercisesDone();
}

function renderVoice() {
  $('voice').setAttribute('aria-pressed', String(cues.voiceOn));
  $('voice').title = cues.voiceOn ? 'Spoken cues: on' : 'Spoken cues: off';
}

$('pause').addEventListener('click', () => player && setPaused(player.togglePause()));
$('skip').addEventListener('click', () => {
  if (player && !player.skip()) finish();
});
$('end').addEventListener('click', finish);
$('full').addEventListener('click', () => window.api.standMode('full'));
$('help').addEventListener('click', () => {
  if (player && !player.paused) setPaused(player.togglePause());
  window.api.openGuide();
});
$('voice').addEventListener('click', () => {
  cues.voiceOn = !cues.voiceOn;
  cues.resetSpeech();
  if (!cues.voiceOn) cues.silence();
  window.api.setSettings({ standVoice: cues.voiceOn });
  renderVoice();
});

window.api.onStandMode((p) => {
  payload = { ...payload, ...p };
  document.documentElement.dataset.theme = payload.theme || 'night';
  cues.voiceOn = !!payload.voice;
  renderVoice();
  if (p.mode === 'mini') start();
});

window.api.onStandClosing(() => {
  document.body.classList.add('leaving');
  cues.silence();
  setTimeout(() => cancelAnimationFrame(frame), 600);
});

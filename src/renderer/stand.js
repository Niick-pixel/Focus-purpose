const $ = (id) => document.getElementById(id);
const { Figure, PelvisSide, Desk } = window.StandVisuals;
const { ROUTINE_NAMES } = window.StandExercises;
const { RoutinePlayer, Cues, countLabel } = window.StandPlayer;

let payload = null;
let frame = 0;
let desk = null;
let routine = null; // { player, figure, pelvis, seg, cue }
let finished = false;
let guide = null;   // mounted PelvicGuide overlay

// ---- sound & voice cues ----------------------------------------------------------

const cues = new Cues();
try { cues.muted = localStorage.getItem('standMuted') === '1'; } catch { /* storage unavailable */ }
const chime = (...args) => cues.chime(...args);

function renderVoice() {
  $('voice').setAttribute('aria-pressed', String(cues.voiceOn));
  $('voice').title = cues.voiceOn ? 'Spoken cues: on' : 'Spoken cues: off';
}

$('voice').addEventListener('click', () => {
  cues.voiceOn = !cues.voiceOn;
  cues.resetSpeech();
  if (!cues.voiceOn) cues.silence();
  window.api.setSettings({ standVoice: cues.voiceOn });
  renderVoice();
});

function renderMute() {
  $('mute').classList.toggle('muted', cues.muted);
  $('mute').title = cues.muted ? 'Unmute cues' : 'Mute cues';
}

$('mute').addEventListener('click', () => {
  cues.muted = !cues.muted;
  try { localStorage.setItem('standMuted', cues.muted ? '1' : '0'); } catch { /* ignore */ }
  renderMute();
});

// ---- raise / lower ------------------------------------------------------------

function button(label, onClick) {
  const b = document.createElement('button');
  b.className = 'btn';
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}

function showDesk(direction) {
  $('exerciseView').hidden = true;
  $('deskView').hidden = false;
  const art = $('deskArt');
  art.replaceChildren();
  desk = new Desk(art, direction);
  const secondary = $('deskSecondary');
  secondary.replaceChildren();

  if (direction === 'up') {
    $('deskEyebrow').textContent = 'Standing time';
    $('deskTitle').textContent = 'Time to stand';
    const guided = payload.routine !== 'none';
    $('deskSub').textContent = guided
      ? 'Raise your desk. Then follow along full screen, or keep working with a small desk routine in the corner.'
      : 'Raise your desk and keep working on your feet.';
    $('deskPrimary').textContent = guided ? 'I’m standing · Guide me' : 'I’m standing';
    $('deskPrimary').onclick = () => window.api.standUp('full');
    $('deskAlt').hidden = !guided;
    $('deskAlt').onclick = () => window.api.standUp('mini');
    secondary.append(
      button('Not now · 10 min', () => window.api.standNotNow()),
      button('Skip this one', () => window.api.standSkip()),
    );
    chime(587, 0.05, 0.9);
  } else {
    const minutes = Math.max(1, Math.round((payload.stoodMs || 0) / 60000));
    $('deskEyebrow').textContent = 'Standing time';
    $('deskTitle').textContent = 'Time to sit';
    $('deskSub').textContent = `You stood for ${minutes} minute${minutes === 1 ? '' : 's'}. Lower your desk and let your shoulders drop.`;
    $('deskPrimary').textContent = 'Desk is down';
    $('deskPrimary').onclick = () => window.api.standDown();
    $('deskAlt').hidden = true;
    secondary.append(button('5 more minutes', () => window.api.standMore()));
    chime(440, 0.05, 0.9);
  }
  $('deskPrimary').focus();
  loop();
}

// ---- guided routine -------------------------------------------------------------

function showExercises() {
  $('deskView').hidden = true;
  $('exerciseView').hidden = false;
  desk = null;
  const figSvg = $('figure');
  const pelSvg = $('pelvis');
  figSvg.replaceChildren();
  pelSvg.replaceChildren();
  const level = payload.level || 1;
  const player = new RoutinePlayer(payload.routine, level);
  $('exEyebrow').textContent = `Standing · ${ROUTINE_NAMES[payload.routine] || 'Pelvic floor'}${payload.routine === 'stretch' ? '' : ` · Level ${level}`}`;
  routine = { player, figure: new Figure(figSvg), pelvis: new PelvisSide(pelSvg), seg: -1, cue: '' };
  $('exDots').replaceChildren(...player.segments.map(() => document.createElement('i')));
  setPaused(false);
  // First guided pelvic-floor session: show how it's done before starting.
  if (!payload.guideSeen && payload.primary && payload.routine !== 'stretch') openGuide(true);
  loop();
}

function setPaused(paused) {
  $('exPause').textContent = paused ? 'Resume' : 'Pause';
  document.body.classList.toggle('paused', paused);
  if (paused) cues.silence();
}

function togglePause() {
  if (!routine || $('exerciseView').hidden || guide) return;
  setPaused(routine.player.togglePause());
}

function skipToNext() {
  if (!routine || guide) return;
  if (!routine.player.skip()) finish();
}

function finish() {
  if (finished) return;
  finished = true;
  window.api.standExercisesDone();
}

function setCue(text) {
  if (text === routine.cue) return;
  routine.cue = text;
  const cue = $('exCue');
  cue.classList.add('swap');
  setTimeout(() => {
    cue.textContent = text;
    cue.classList.remove('swap');
  }, 140);
}

function routineFrame() {
  const f = routine.player.frame();
  if (!f) {
    routine.figure.ease({ arms: 'hang' });
    routine.pelvis.set(0);
    if (payload.primary) finish();
    return;
  }
  const { seg, index, ready, state } = f;
  const ex = seg.ex;
  const segs = routine.player.segments;

  if (index !== routine.seg) {
    routine.seg = index;
    $('exTitle').textContent = ex.title;
    $('exHow').textContent = ex.how;
    $('exFocus').textContent = `Focus · ${ex.focus}`;
    // Stretches get the stage to themselves; the pelvis diagram returns for pelvic-floor work.
    $('exPelvis').closest('.ex-stage').classList.toggle('solo', ex.focus !== 'Pelvic floor');
    cues.resetSpeech();
    cues.speak(`${index === 0 ? '' : 'Next: '}${ex.title}`);
    [...$('exDots').children].forEach((d, i) => {
      d.classList.toggle('done', i < index);
      d.classList.toggle('now', i === index);
    });
  }

  $('exNext').textContent = ready ? (index === 0 ? 'Get ready' : 'Up next') : `${index + 1} of ${segs.length}`;
  $('exBar').style.width = `${f.progress * 100}%`;

  if (routine.player.paused) {
    setCue('Paused');
    return;
  }
  routine.figure.ease({ ...state.pose, floor: state.floor });
  routine.pelvis.set(state.floor);
  setCue(state.cue);
  if (!ready) cues.speak(state.cue);
  $('exCount').textContent = countLabel(state.count);
  cues.floor(state.floor);
}

// ---- pelvic floor guide overlay ----------------------------------------------------

function openGuide(first = false) {
  if (guide || !routine) return;
  const wasPaused = routine.player.paused;
  routine.player.pause();
  setPaused(true);
  const host = $('guide');
  host.hidden = false;
  guide = window.PelvicGuide.mount(host, {
    closeLabel: first ? 'Start the routine' : 'Back to the routine',
    onClose: () => {
      guide.destroy();
      guide = null;
      host.hidden = true;
      if (first || !payload.guideSeen) window.api.setSettings({ standGuideSeen: true });
      payload.guideSeen = true;
      if (!wasPaused) setPaused(routine.player.togglePause());
      $('exPause').focus();
    },
  });
  host.scrollTop = 0;
}

$('exSkip').addEventListener('click', skipToNext);
$('exPause').addEventListener('click', togglePause);
$('exEnd').addEventListener('click', finish);
$('exGuide').addEventListener('click', () => openGuide());
$('exMini').addEventListener('click', () => window.api.standMode('mini'));

// ---- frame loop ---------------------------------------------------------------

function loop() {
  cancelAnimationFrame(frame);
  const step = (now) => {
    if (desk) desk.frame(now);
    if (routine && !$('exerciseView').hidden) routineFrame();
    frame = requestAnimationFrame(step);
  };
  frame = requestAnimationFrame(step);
}

// ---- wiring -------------------------------------------------------------------

window.api.onStandMode((p) => {
  payload = { ...payload, ...p };
  document.documentElement.dataset.theme = payload.theme || 'night';
  document.body.classList.toggle('secondary', !payload.primary);
  cues.voiceOn = !!payload.voice;
  cues.active = !!payload.primary;
  renderMute();
  renderVoice();
  if (p.mode === 'raise') showDesk('up');
  else if (p.mode === 'lower') showDesk('down');
  else if (p.mode === 'exercise') {
    finished = false;
    showExercises();
  }
  requestAnimationFrame(() => document.body.classList.add('visible'));
});

window.api.onStandClosing(() => {
  document.body.classList.add('leaving');
  cues.silence();
  setTimeout(() => cancelAnimationFrame(frame), 1500);
});

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' || (e.ctrlKey && ['r', 'w'].includes(e.key.toLowerCase())) || e.key === 'F5') e.preventDefault();
  if (guide) {
    if (e.key === 'Escape') $('guide').querySelector('.guide-close')?.click();
    return;
  }
  if (!routine || $('exerciseView').hidden || e.target.closest?.('button')) return;
  if (e.key === ' ') { e.preventDefault(); togglePause(); }
  if (e.key === 'ArrowRight') skipToNext();
});

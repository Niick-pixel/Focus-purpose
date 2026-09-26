const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const engine = new window.SoundEngine({ loadAsset: (name) => window.api.loadSound(name) });

let settings = null;
let previewing = false;

const PRESETS = {
  'Rainy night': { rain: 0.75, dream: 0.5, ocean: 0, wind: 0, fire: 0, custom: 0 },
  'Dreamscape': { rain: 0, dream: 0.9, ocean: 0, wind: 0.15, fire: 0, custom: 0 },
  'Seaside': { rain: 0, dream: 0.25, ocean: 0.85, wind: 0.25, fire: 0, custom: 0 },
  'Cabin': { rain: 0.45, dream: 0, ocean: 0, wind: 0.25, fire: 0.7, custom: 0 },
  'Storm': { rain: 0.95, dream: 0, ocean: 0, wind: 0.6, fire: 0, custom: 0 },
  'My music': { rain: 0, dream: 0, ocean: 0, wind: 0, fire: 0, custom: 0.9 },
};

// ---- formatting -------------------------------------------------------------

const FORMATS = {
  min: (v) => {
    if (v < 1) return `${Math.round(v * 60)} sec`;
    const m = Math.floor(v);
    const s = Math.round((v - m) * 60);
    return s ? `${m} min ${s} s` : `${m} min`;
  },
  sec: (v) => (v === 0 ? 'Off' : `${v} s`),
  breaks: (v) => `${v} breaks`,
  idle: (v) => (v === 0 ? 'Never' : `${v} min`),
  hm: (v) => (v < 60 ? `${v} min` : `${Math.floor(v / 60)} h${v % 60 ? ` ${v % 60} min` : ''}`),
  maxwait: (v) => (v === 0 ? 'As long as it takes' : v < 60 ? `${v} min` : `${Math.floor(v / 60)} h${v % 60 ? ` ${v % 60} min` : ''}`),
};

const clockFmt = (ms) => {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
};

// ---- settings <-> controls --------------------------------------------------

const getKey = (key) => key.split('.').reduce((o, k) => o?.[k], settings);

function partialFor(key, value) {
  const [a, b] = key.split('.');
  return b ? { [a]: { [b]: value } } : { [a]: value };
}

function applyLocal(key, value) {
  const [a, b] = key.split('.');
  if (b) settings[a] = { ...settings[a], [b]: value };
  else settings[a] = value;
}

const saveTimers = new Map();
function save(key, value, delay = 300) {
  applyLocal(key, value);
  clearTimeout(saveTimers.get(key));
  saveTimers.set(key, setTimeout(() => {
    saveTimers.delete(key);
    api.setSettings(partialFor(key, value));
  }, delay));
}

function paintRange(input) {
  const min = +input.min, max = +input.max;
  input.style.setProperty('--p', `${((+input.value - min) / (max - min)) * 100}%`);
  const out = $(`output[data-for="${input.dataset.key}"]`);
  if (out && input.dataset.fmt) out.textContent = FORMATS[input.dataset.fmt](+input.value);
}

function render() {
  document.documentElement.dataset.theme = settings.theme;

  for (const input of $$('[data-key]')) {
    const v = getKey(input.dataset.key);
    if (input.type === 'checkbox') input.checked = !!v;
    else {
      input.value = v;
      paintRange(input);
    }
  }
  for (const el of $$('[data-show-if]')) el.hidden = !settings[el.dataset.showIf];
  for (const group of $$('[data-choice-key]')) {
    const value = settings[group.dataset.choiceKey];
    for (const b of $$('button', group)) b.setAttribute('aria-checked', String(b.dataset.value === value));
  }
  const hints = {
    breathe: 'A slow 4 · 2 · 6 breathing orb.',
    eyes: 'Follow a dot around the screen, then shift focus near and far. Relaxes tired eye muscles.',
    alternate: 'Breathing on one break, eye exercises on the next.',
    none: 'Just the countdown and your tip.',
  };
  $('#activityHint').textContent = hints[settings.breakActivity] || '';
  $('#routineHint').textContent = {
    short: 'Pelvic floor, ~3 min: find it, long holds, quick flicks, mini squats and a full release. Holds get longer as you progress.',
    full: 'Pelvic floor, ~6 min: adds the elevator, heel raises, pelvic tilts, hip circles and a standing march.',
    stretch: 'Stretches for sitters, ~3½ min: overhead reach, hip flexors, hamstrings, calves, chest opener and chin tucks.',
    mix: 'Best of both, ~4 min: pelvic floor holds and squats with hip-flexor and chest stretches.',
    none: 'Just the reminders to raise and lower your desk.',
  }[settings.standRoutine] || '';
  for (const el of $$('[data-disabled-if]')) el.classList.toggle('disabled', !!settings[el.dataset.disabledIf]);

  const tips = $('#tips');
  if (document.activeElement !== tips) tips.value = (settings.tips || []).join('\n');

  for (const b of $$('[data-theme-choice]')) b.classList.toggle('active', b.dataset.themeChoice === settings.theme);

  renderFiles();
  if (typeof renderZones === 'function') renderZones();
}

function renderFiles() {
  const list = $('#fileList');
  list.innerHTML = '';
  if (!settings.customFiles.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'No files yet. Add MP3s, lo-fi mixes, anything calm.';
    list.append(li);
    return;
  }
  settings.customFiles.forEach((file, i) => {
    const li = document.createElement('li');
    const name = document.createElement('span');
    name.textContent = file.split(/[\\/]/).pop();
    name.title = file;
    const rm = document.createElement('button');
    rm.textContent = '×';
    rm.title = 'Remove';
    rm.addEventListener('click', () => setFiles(settings.customFiles.filter((_, j) => j !== i)));
    li.append(name, rm);
    list.append(li);
  });
}

async function setFiles(files) {
  settings.customFiles = files;
  await api.setSettings({ customFiles: files });
  renderFiles();
  if (previewing) engine.setCustom(await api.audioUrls(files), settings.customShuffle);
}

function wireControls() {
  for (const input of $$('[data-key]')) {
    const key = input.dataset.key;
    if (input.type === 'checkbox') {
      input.addEventListener('change', () => {
        save(key, input.checked, 0);
        for (const el of $$(`[data-show-if="${key}"]`)) el.hidden = !input.checked;
        for (const el of $$(`[data-disabled-if="${key}"]`)) el.classList.toggle('disabled', input.checked);
      });
    } else {
      input.addEventListener('input', () => {
        const v = +input.value;
        paintRange(input);
        save(key, v);
        if (previewing) {
          if (key === 'masterVolume') engine.setMaster(v);
          else if (key.startsWith('mix.')) engine.setMix({ [key.slice(4)]: v });
        }
      });
    }
  }

  for (const group of $$('[data-choice-key]')) {
    for (const b of $$('button', group)) {
      b.addEventListener('click', () => {
        save(group.dataset.choiceKey, b.dataset.value, 0);
        render();
      });
    }
  }

  $('#tips').addEventListener('input', (e) => {
    const tips = e.target.value.split('\n').map((t) => t.trim()).filter(Boolean);
    save('tips', tips, 600);
  });

  for (const b of $$('[data-theme-choice]')) {
    b.addEventListener('click', () => {
      save('theme', b.dataset.themeChoice, 0);
      render();
    });
  }

  // Presets
  const presets = $('#presets');
  for (const [name, mix] of Object.entries(PRESETS)) {
    const chip = document.createElement('button');
    chip.className = 'chip';
    chip.textContent = name;
    chip.addEventListener('click', () => {
      settings.mix = { ...mix };
      api.setSettings({ mix });
      render();
      if (previewing) engine.setMix(mix);
    });
    presets.append(chip);
  }

  $('#addFiles').addEventListener('click', async () => {
    const picked = await api.pickAudio();
    if (!picked.length) return;
    const merged = [...new Set([...settings.customFiles, ...picked])];
    await setFiles(merged);
    if (!settings.mix.custom) {
      save('mix.custom', 0.8, 0);
      render();
      if (previewing) engine.setMix({ custom: 0.8 });
    }
  });

  $('#preview').addEventListener('click', togglePreview);
  api.onPreviewStop(() => previewing && togglePreview());

  // Tabs
  for (const tab of $$('.tab')) tab.addEventListener('click', () => showTab(tab.dataset.tab));
  api.onNavTab(showTab);

  $('#breakNow').addEventListener('click', () => api.breakNow());
  $('#standNow').addEventListener('click', () => api.standNow());
  $('#openGuide').addEventListener('click', () => api.openGuide());
  $('#pauseBtn').addEventListener('click', () => {
    if ($('#pauseBtn').dataset.mode === 'resume') api.resume();
    else api.pauseMenu();
  });

  $('#reset').addEventListener('click', async () => {
    if (!confirm('Reset all settings to their defaults?')) return;
    settings = await api.resetSettings();
    render();
  });
}

function showTab(name) {
  if (!$(`.tab[data-tab="${name}"]`)) return;
  $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
  $$('.panel').forEach((p) => p.classList.toggle('active', p.dataset.panel === name));
  if (name !== 'sound' && previewing) togglePreview();
  document.dispatchEvent(new CustomEvent('tabchange', { detail: name }));
}

async function togglePreview() {
  const btn = $('#preview');
  if (previewing) {
    previewing = false;
    btn.classList.remove('playing');
    $('#previewLabel').textContent = 'Listen';
    await engine.stop(0.8);
  } else {
    previewing = true;
    btn.classList.add('playing');
    $('#previewLabel').textContent = 'Stop';
    await engine.start({
      master: settings.masterVolume,
      mix: settings.mix,
      customUrls: await api.audioUrls(settings.customFiles),
      shuffle: settings.customShuffle,
      fadeIn: 1.5,
    });
  }
}

// ---- live status ------------------------------------------------------------

const CIRC = 2 * Math.PI * 54;
const timeFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });

function renderState(state) {
  const clock = $('#clock');
  const caption = $('#caption');
  const ring = $('#ring');
  const pauseBtn = $('#pauseBtn');
  let progress = 0;

  const paused = state.phase === 'paused' || state.phase === 'away';
  pauseBtn.textContent = paused ? 'Resume' : 'Pause';
  pauseBtn.dataset.mode = paused ? 'resume' : 'pause';
  $('#breakNow').disabled = state.phase === 'break';

  switch (state.phase) {
    case 'working':
      clock.textContent = clockFmt(state.remainingMs);
      caption.textContent = state.nextIsLong ? 'until your long break' : 'until your break';
      progress = state.totalMs ? state.remainingMs / state.totalMs : 0;
      break;
    case 'break':
      clock.textContent = clockFmt(state.remainingMs);
      caption.textContent = 'resting';
      progress = state.totalMs ? state.remainingMs / state.totalMs : 0;
      break;
    case 'waiting':
      clock.textContent = 'Done';
      caption.textContent = 'waiting for you';
      break;
    case 'paused':
      clock.textContent = state.remainingMs != null ? clockFmt(state.remainingMs) : 'Paused';
      caption.textContent = state.remainingMs != null ? 'paused — resumes in' : 'until you resume';
      break;
    case 'away':
      clock.textContent = 'Away';
      caption.textContent = 'fresh start when you return';
      break;
    case 'deferred':
      clock.textContent = 'Waiting';
      caption.textContent = state.deferReason === 'zone' && state.zone
        ? `break after ${timeFmt.format(state.zone.endsAt)}`
        : 'break after you exit fullscreen';
      progress = 0;
      break;
  }
  const pill = $('#zonePill');
  const showZone = state.zone && (state.phase === 'working' || state.phase === 'deferred');
  pill.hidden = !showZone;
  if (showZone) pill.textContent = `${state.zone.label} · breaks resume at ${timeFmt.format(state.zone.endsAt)}`;

  ring.style.strokeDashoffset = String(CIRC * (1 - progress));
  ring.style.opacity = progress > 0 ? '1' : '0';
  clock.classList.toggle('word', !/\d/.test(clock.textContent));
}

// ---- updates ----------------------------------------------------------------

function renderUpdate(u) {
  const text = {
    dev: 'Running from source — updates come from git',
    idle: 'New versions download in the background',
    checking: 'Checking for updates…',
    'up-to-date': 'You have the latest version',
    downloading: `Downloading v${u.version}… ${u.progress}%`,
    ready: `Version ${u.version} is ready to install`,
    error: `Couldn't check for updates${u.error ? ` (${u.error})` : ''}`,
  }[u.status];
  $('#updateStatus').textContent = text || '';
  $('#checkUpdates').disabled = ['dev', 'checking', 'downloading', 'ready'].includes(u.status);
  $('#installUpdate').hidden = u.status !== 'ready';
  if (u.status === 'ready') $('#installUpdate').textContent = `Restart to update to v${u.version}`;
}

// ---- standing ----------------------------------------------------------------

function renderStand(st) {
  const line = $('#standLine');
  const text = {
    sitting: st.held
      ? (st.held === 'zone' ? 'Stand after your break zone' : 'Stand reminder waiting')
      : `Stand in ${st.dueInMs >= 3600000 ? clockFmt(st.dueInMs) : `${Math.ceil(st.dueInMs / 60000)} min`}`,
    raise: 'Time to stand',
    exercise: 'Standing · exercises',
    standing: `Standing · ${clockFmt(st.standingLeftMs)} left`,
    lower: 'Time to sit',
  }[st.phase];
  line.hidden = !text;
  if (text) line.textContent = text;
  $('#standNow').disabled = st.phase !== 'sitting';
}

// ---- boot -------------------------------------------------------------------

(async () => {
  settings = await api.getSettings();
  $('#ring').style.strokeDasharray = String(CIRC);
  render();
  wireControls();
  if (location.hash) showTab(location.hash.slice(1));
  renderState(await api.getState());
  api.onState(renderState);
  api.onSettings((s) => {
    if (saveTimers.size) return; // our own edits are still in flight; don't clobber them
    settings = s;
    render();
  });
  renderStand(await api.getStandState());
  api.onStandState(renderStand);
  renderUpdate(await api.updateState());
  api.onUpdate(renderUpdate);
  $('#checkUpdates').addEventListener('click', () => api.checkForUpdates());
  $('#installUpdate').addEventListener('click', () => api.installUpdate());

  const info = await api.appInfo();
  if (info.platform !== 'win32') {
    for (const el of $$('[data-windows-only]')) el.remove();
  }
  $('#version').textContent = `v${info.version}${info.fast ? ' · fast mode' : ''}`;
})();

const path = require('path');
const { pathToFileURL } = require('url');
const {
  app, BrowserWindow, Tray, Menu, screen, ipcMain, powerMonitor,
  Notification, nativeImage, dialog,
} = require('electron');
const { Store } = require('./store');
const { RestTimer } = require('./timer');
const { createDetector } = require('./fullscreen');
const { Stats } = require('./stats');
const { createKeyBlocker } = require('./keyblock');
const { createUpdater } = require('./updater');
const { StandTimer } = require('./stand');
const { Coordinator } = require('./coordinator');
const { activeZone } = require('./zones');

const FAST = process.argv.includes('--fast'); // dev: "minutes" become seconds
const START_HIDDEN = process.argv.includes('--hidden');
const ASSETS = path.join(__dirname, '..', '..', 'assets');
const RENDERER = path.join(__dirname, '..', 'renderer');
const BUNDLED_SOUNDS = new Set(['rain']);

// Title-bar colors for each theme (must match the CSS themes).
const THEMES = {
  night:  { bg: '#12131f', fg: '#c9c6e8' },
  dusk:   { bg: '#1c1426', fg: '#e4c9e0' },
  forest: { bg: '#0f1a17', fg: '#bfdccd' },
  sand:   { bg: '#f3eee6', fg: '#5a4f45' },
};

if (!app.requestSingleInstanceLock()) {
  app.quit();
  return;
}

app.setAppUserModelId('com.focuspoint.app');

let store;
let stats;
let timer;
let tray;
let settingsWin = null;
let overlays = [];
let quitting = false;
let lastTrayLabel = '';
let keyBlocker;
let updater;
let isFullscreen = () => false;
let stand;
let coord;
let standWins = [];
let dockWin = null;       // floating standing widget (prompts, countdown, paced moves)
let guideWin = null;      // pelvic floor guide
let exerciseRoutine = null;
let alternateTurn = 0; // 'alternate' activity: breathe, eyes, breathe, ...

// ---------------------------------------------------------------------------
// Helpers

const fmt = (ms) => {
  const total = Math.ceil(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m >= 1 ? `${m} min` : `${s}s`;
};

const clock = (ms) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

function broadcast(channel, payload) {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send(channel, payload);
  }
}

function applyLoginItem(enabled) {
  if (!app.isPackaged) return; // don't register the dev electron binary
  app.setLoginItemSettings({ openAtLogin: enabled, args: ['--hidden'] });
}

function fileUrls(paths) {
  return (paths || []).map((p) => pathToFileURL(p).href);
}

// ---------------------------------------------------------------------------
// Settings window

function openSettings(tab) {
  if (typeof tab !== 'string') tab = null; // menu clicks pass their own args
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.show();
    settingsWin.focus();
    if (tab) settingsWin.webContents.send('nav:tab', tab);
    return;
  }
  const theme = THEMES[store.get().theme] || THEMES.night;
  settingsWin = new BrowserWindow({
    width: 460,
    height: 740,
    minWidth: 400,
    minHeight: 560,
    show: false,
    title: 'Focus Point',
    icon: path.join(ASSETS, 'icon.png'),
    backgroundColor: theme.bg,
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: theme.bg, symbolColor: theme.fg, height: 36 },
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  settingsWin.removeMenu();
  settingsWin.loadFile(path.join(RENDERER, 'settings.html'), tab ? { hash: tab } : undefined);
  settingsWin.once('ready-to-show', () => settingsWin.show());
  settingsWin.on('close', (e) => {
    if (!quitting) {
      e.preventDefault();
      settingsWin.webContents.send('preview:stop');
      settingsWin.hide();
    }
  });
  settingsWin.on('closed', () => { settingsWin = null; });
}

function applyThemeToSettings(themeName) {
  const theme = THEMES[themeName] || THEMES.night;
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.setBackgroundColor(theme.bg);
    try {
      settingsWin.setTitleBarOverlay({ color: theme.bg, symbolColor: theme.fg, height: 36 });
    } catch { /* not supported on this platform */ }
  }
}

// ---------------------------------------------------------------------------
// Break overlays (one per monitor)

function pickTip(settings) {
  const tips = (settings.tips || []).filter((t) => t.trim());
  if (!settings.showTips || !tips.length) return '';
  return tips[Math.floor(Math.random() * tips.length)];
}

function destroyWindows(list) {
  for (const w of list) {
    if (!w.isDestroyed()) {
      w.__allowClose = true;
      w.destroy();
    }
  }
}

function destroyOverlays() {
  keyBlocker?.stop();
  destroyWindows(overlays);
  overlays = [];
}

function openOverlays(info) {
  destroyOverlays();
  const s = store.get();
  const tip = pickTip(s);
  const primaryId = screen.getPrimaryDisplay().id;
  const strict = !!s.strictMode;
  if (strict) keyBlocker.start();
  const activity = s.breakActivity === 'alternate'
    ? (alternateTurn++ % 2 ? 'eyes' : 'breathe')
    : s.breakActivity || 'breathe';

  // Stop the settings preview so sounds don't double up.
  if (settingsWin && !settingsWin.isDestroyed()) settingsWin.webContents.send('preview:stop');

  for (const display of screen.getAllDisplays()) {
    const primary = display.id === primaryId;
    const { x, y, width, height } = display.bounds;
    const win = new BrowserWindow({
      x, y, width, height,
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: true,
      skipTaskbar: true,
      alwaysOnTop: true,
      hasShadow: false,
      webPreferences: {
        preload: path.join(__dirname, '..', 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false,
        autoplayPolicy: 'no-user-gesture-required',
      },
    });
    win.setAlwaysOnTop(true, 'screen-saver');
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    win.loadFile(path.join(RENDERER, 'break.html'));

    win.on('close', (e) => { if (!win.__allowClose && !quitting) e.preventDefault(); });

    // Keep the break in front: if focus leaves every overlay, pull it back.
    win.on('blur', () => {
      setTimeout(() => {
        if (win.isDestroyed() || !overlays.includes(win)) return;
        const focused = BrowserWindow.getFocusedWindow();
        if (!focused || !overlays.includes(focused)) {
          win.setAlwaysOnTop(true, 'screen-saver');
          win.moveTop();
          if (primary) win.focus();
        }
      }, 150);
    });

    win.webContents.once('did-finish-load', () => {
      win.webContents.send('break:start', {
        ...info,
        primary,
        tip,
        theme: s.theme,
        strict,
        allowSkip: s.allowSkip && !strict,
        allowSnooze: s.allowSnooze && !strict,
        snoozeMinutes: s.snoozeMinutes,
        // The dot routine runs on the primary screen; other screens show the breathing orb.
        activity: activity === 'eyes' && !primary ? 'breathe' : activity,
        sound: primary && s.soundEnabled
          ? { master: s.masterVolume, mix: s.mix, customUrls: fileUrls(s.customFiles), shuffle: s.customShuffle }
          : null,
      });
      win.setFullScreen(true);
      win.show();
      if (primary) win.focus();
    });

    overlays.push(win);
  }
}

function closeOverlays() {
  if (!overlays.length) return;
  const closing = overlays;
  overlays = [];
  keyBlocker.stop();
  for (const w of closing) if (!w.isDestroyed()) w.webContents.send('break:closing');
  setTimeout(() => destroyWindows(closing), 1600); // let the fade-out finish
}

// ---------------------------------------------------------------------------
// Standing desk: raise / exercise / lower screens and the floating widget

function standPayload(mode, primary) {
  const s = store.get();
  const st = stand.state();
  const sessions = Object.values(stats.get()).reduce((n, d) => n + (d.stands || 0), 0);
  const level = sessions >= 25 ? 3 : sessions >= 10 ? 2 : 1; // same thresholds as StandExercises.levelFor
  return {
    mode, primary, theme: s.theme, routine: exerciseRoutine || s.standRoutine, voice: !!s.standVoice, level,
    guideSeen: !!s.standGuideSeen, stoodMs: st.standingForMs || 0,
    paced: !!st.paced, unitMs: FAST ? 1000 : 60000,
  };
}

function openStandWindows(mode) {
  if (standWins.length) {
    for (const w of standWins) if (!w.isDestroyed()) w.webContents.send('stand:mode', standPayload(mode, w.__primary));
    return;
  }
  const primaryId = screen.getPrimaryDisplay().id;
  for (const display of screen.getAllDisplays()) {
    const primary = display.id === primaryId;
    const { x, y, width, height } = display.bounds;
    const win = new BrowserWindow({
      x, y, width, height,
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      hasShadow: false,
      webPreferences: {
        preload: path.join(__dirname, '..', 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false,
        autoplayPolicy: 'no-user-gesture-required',
      },
    });
    win.__primary = primary;
    win.setAlwaysOnTop(true, 'screen-saver');
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    win.on('close', (e) => { if (!win.__allowClose && !quitting) e.preventDefault(); });
    win.loadFile(path.join(RENDERER, 'stand.html'));
    win.webContents.once('did-finish-load', () => {
      win.webContents.send('stand:mode', standPayload(mode, primary));
      win.setFullScreen(true);
      win.show();
      if (primary) win.focus();
    });
    standWins.push(win);
  }
}

function closeStandWindows() {
  if (!standWins.length) return;
  const closing = standWins;
  standWins = [];
  for (const w of closing) if (!w.isDestroyed()) w.webContents.send('stand:closing');
  setTimeout(() => destroyWindows(closing), 1600);
}

// The dock: one small floating window in the bottom-right corner for the whole standing
// session while you keep working — the "time to stand" prompt, the countdown pill, one
// paced move every few minutes, and the "time to sit" prompt. It never takes focus, so
// whatever you're working in stays active, and it grows/shrinks around its bottom-right corner.
const DOCK_MARGIN = 14;

function openDock(mode) {
  if (dockWin && !dockWin.isDestroyed()) {
    dockWin.webContents.send('stand:mode', standPayload(mode, true));
    return;
  }
  const area = screen.getPrimaryDisplay().workArea;
  const width = 360;
  const height = 168;
  dockWin = new BrowserWindow({
    x: area.x + area.width - width - DOCK_MARGIN,
    y: area.y + area.height - height - DOCK_MARGIN,
    width,
    height,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    focusable: false, // clicks work, but the keyboard stays with what you're working on
    hasShadow: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      autoplayPolicy: 'no-user-gesture-required',
    },
  });
  dockWin.setAlwaysOnTop(true, 'pop-up-menu');
  dockWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  dockWin.loadFile(path.join(RENDERER, 'widget.html'));
  dockWin.webContents.once('did-finish-load', () => {
    dockWin?.webContents.send('stand:mode', standPayload(mode, true));
    dockWin?.showInactive();
  });
  // Some apps push themselves to the top; quietly stay above them without taking focus.
  const keepOnTop = setInterval(() => {
    if (dockWin && !dockWin.isDestroyed() && dockWin.isVisible()) dockWin.moveTop();
  }, 5000);
  dockWin.on('closed', () => {
    clearInterval(keepOnTop);
    dockWin = null;
  });
}

/** The dock asks for a new size; keep its bottom-right corner where it is. */
function resizeDock(width, height) {
  if (!dockWin || dockWin.isDestroyed()) return;
  const w = Math.round(Math.min(460, Math.max(180, width)));
  const h = Math.round(Math.min(320, Math.max(56, height)));
  const b = dockWin.getBounds();
  const area = screen.getDisplayMatching(b).workArea;
  const x = Math.min(area.x + area.width - w, Math.max(area.x, b.x + b.width - w));
  const y = Math.min(area.y + area.height - h, Math.max(area.y, b.y + b.height - h));
  dockWin.setBounds({ x, y, width: w, height: h });
}

function closeDock() {
  if (!dockWin || dockWin.isDestroyed()) return;
  const win = dockWin;
  dockWin = null;
  win.webContents.send('stand:closing');
  setTimeout(() => { if (!win.isDestroyed()) win.destroy(); }, 600);
}

/** Stand prompts as the floating dock (default) or full screen (Settings → Stand). */
const floatingPrompts = () => store.get().standPrompt !== 'fullscreen';

function openGuide() {
  if (guideWin && !guideWin.isDestroyed()) {
    guideWin.show();
    guideWin.focus();
    return;
  }
  const theme = THEMES[store.get().theme] || THEMES.night;
  const area = screen.getPrimaryDisplay().workArea;
  guideWin = new BrowserWindow({
    width: Math.min(1100, area.width - 80),
    height: Math.min(860, area.height - 60),
    minWidth: 520,
    minHeight: 480,
    show: false,
    title: 'Pelvic floor guide — Focus Point',
    icon: path.join(ASSETS, 'icon.png'),
    backgroundColor: theme.bg,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  guideWin.removeMenu();
  guideWin.loadFile(path.join(RENDERER, 'guide.html'));
  guideWin.once('ready-to-show', () => guideWin?.show());
  guideWin.on('closed', () => { guideWin = null; });
}

/** Why a stand reminder can't start right now (or null). */
function standHoldReason() {
  const s = store.get();
  const phase = timer.state().phase;
  if (phase === 'break' || phase === 'waiting') return 'break';
  if (phase === 'paused' || phase === 'away') return phase;
  if (activeZone(s.zones, Date.now())) return 'zone';
  if (s.holdForFullscreen && isFullscreen()) return 'fullscreen';
  return coord?.standHold(timer.state()) ?? null; // smart order: 'spacing' | 'break-soon'
}

function standLabel(st) {
  switch (st.phase) {
    case 'sitting':
      if (st.held === 'zone') return 'Stand — waiting for your break zone to end';
      if (st.held === 'break-soon' || st.held === 'spacing') return 'Stand — after your break';
      if (st.held) return 'Stand — waiting';
      return `Stand in ${fmt(st.dueInMs)}`;
    case 'raise': return 'Time to stand';
    case 'exercise': return 'Standing — exercises';
    case 'standing': return `Standing — ${fmt(st.standingLeftMs)} left`;
    case 'lower': return 'Time to sit';
    default: return null;
  }
}

// ---------------------------------------------------------------------------
// Tray

function trayLabel(state) {
  switch (state.phase) {
    case 'working': return `Next break in ${fmt(state.remainingMs)}`;
    case 'break': return `On a break — ${fmt(state.remainingMs)} left`;
    case 'waiting': return 'Break finished';
    case 'paused': return state.remainingMs != null ? `Paused — ${fmt(state.remainingMs)} left` : 'Paused';
    case 'away': return 'Away — timer restarts when you return';
    case 'deferred':
      if (state.deferReason === 'standing') return 'Break waiting — you’re standing';
      if (state.deferReason === 'stand-first') return 'Break waiting — standing first';
      if (state.deferReason === 'spacing') return 'Break in a moment';
      return state.deferReason === 'zone' && state.zone
        ? `${state.zone.label} — breaks resume at ${clock(state.zone.endsAt)}`
        : 'Break waiting — fullscreen app open';
    default: return 'Focus Point';
  }
}

function buildTrayMenu(state) {
  const paused = state.phase === 'paused' || state.phase === 'away';
  const st = stand?.state();
  const standLine = st ? standLabel(st) : null;
  return Menu.buildFromTemplate([
    { label: trayLabel(state), enabled: false },
    ...(standLine ? [{ label: standLine, enabled: false }] : []),
    { type: 'separator' },
    { label: 'Take a break now', click: () => timer.breakNow(), enabled: state.phase !== 'break' },
    { label: 'Restart work timer', click: () => timer.startWork(), enabled: state.phase === 'working' },
    ...(st && st.phase !== 'off'
      ? [{ label: 'Stand now', click: () => stand.standNow(), enabled: !stand.isActive() }]
      : []),
    paused
      ? { label: 'Resume', click: () => timer.resume() }
      : {
          label: 'Pause',
          submenu: [
            { label: 'For 15 minutes', click: () => timer.pause(15) },
            { label: 'For 30 minutes', click: () => timer.pause(30) },
            { label: 'For 1 hour', click: () => timer.pause(60) },
            { label: 'For 2 hours', click: () => timer.pause(120) },
            { label: 'Until I resume', click: () => timer.pause(null) },
          ],
        },
    { type: 'separator' },
    ...(updater?.state().status === 'ready'
      ? [{ label: `Restart to update to v${updater.state().version}`, click: () => installUpdate() }]
      : []),
    { label: 'This week\'s rest…', click: () => openSettings('stats') },
    { label: 'Settings…', click: () => openSettings() },
    { label: 'Quit Focus Point', click: () => { quitting = true; app.quit(); } },
  ]);
}

function createTray() {
  const img = nativeImage.createFromPath(path.join(ASSETS, 'tray.png'));
  tray = new Tray(img);
  tray.setToolTip('Focus Point');
  tray.on('click', () => openSettings());
  updateTray(timer.state());
}

function updateTray(state) {
  if (!tray) return;
  const label = trayLabel(state);
  const st = stand?.state();
  const standLine = st ? standLabel(st) : null;
  tray.setToolTip(`Focus Point — ${label}${standLine ? `\n${standLine}` : ''}`);
  // Rebuild the menu only when its text changes (avoids closing an open menu every second).
  const key = `${label}|${standLine}|${state.phase}|${updater?.state().status}`;
  if (key !== lastTrayLabel) {
    lastTrayLabel = key;
    tray.setContextMenu(buildTrayMenu(state));
  }
}

// ---------------------------------------------------------------------------
// Updates

function installUpdate() {
  quitting = true;
  keyBlocker?.stop();
  stats?.save();
  updater.install();
}

function onUpdateChange(state) {
  broadcast('update:status', state);
  lastTrayLabel = ''; // rebuild the tray menu (adds/removes the restart item)
  updateTray(timer.state());
  if (state.status === 'ready' && Notification.isSupported()) {
    new Notification({
      title: `Focus Point ${state.version} is ready`,
      body: 'It installs the next time you quit. Or restart now from the tray menu.',
      icon: path.join(ASSETS, 'icon.png'),
      silent: true,
    }).show();
  }
}

// ---------------------------------------------------------------------------
// IPC

function registerIpc() {
  ipcMain.handle('settings:get', () => store.get());
  ipcMain.handle('settings:reset', () => {
    const s = store.reset();
    applyThemeToSettings(s.theme);
    applyLoginItem(s.launchAtLogin);
    timer.restartWork();
    stand.refresh();
    broadcast('settings:changed', s);
    return s;
  });
  ipcMain.handle('settings:set', (_e, partial) => {
    const before = store.get();
    const s = store.set(partial);
    if ('theme' in partial) applyThemeToSettings(s.theme);
    if ('launchAtLogin' in partial) applyLoginItem(s.launchAtLogin);
    if ('workMinutes' in partial && partial.workMinutes !== before.workMinutes) timer.restartWork();
    if ('standEnabled' in partial) stand.refresh();
    if ('standEveryMinutes' in partial && partial.standEveryMinutes !== before.standEveryMinutes) stand.restartSitting();
    broadcast('settings:changed', s);
    return s;
  });

  ipcMain.handle('state:get', () => timer.state());
  ipcMain.handle('stand:state', () => stand.state());
  ipcMain.handle('coord:summary', () => coord.summary());
  ipcMain.on('stand:now', () => stand.standNow());
  ipcMain.on('stand:up', (_e, mode) => stand.up(mode === 'mini' ? 'mini' : 'full'));
  ipcMain.on('stand:mode', (_e, mode) => stand.setMode(mode === 'mini' ? 'mini' : 'full'));
  ipcMain.on('guide:open', () => openGuide());
  ipcMain.on('dock:resize', (_e, { width, height }) => resizeDock(width, height));
  ipcMain.on('stand:notNow', () => stand.notNow());
  ipcMain.on('stand:skip', () => stand.skip());
  ipcMain.on('stand:exercisesDone', () => stand.exercisesDone());
  ipcMain.on('stand:sitNow', () => stand.sitNow());
  ipcMain.on('stand:more', () => stand.moreTime(5));
  ipcMain.on('stand:down', () => stand.down());
  ipcMain.handle('stats:get', () => stats.get());
  ipcMain.handle('stats:clear', () => {
    stats.clear();
    broadcast('stats:changed');
  });
  ipcMain.handle('update:state', () => updater.state());
  ipcMain.on('update:check', () => updater.check());
  ipcMain.on('update:install', () => installUpdate());
  ipcMain.handle('app:info', () => ({ version: app.getVersion(), fast: FAST, platform: process.platform }));

  ipcMain.on('timer:breakNow', () => timer.breakNow());
  ipcMain.on('timer:skip', () => timer.skipBreak());
  ipcMain.on('timer:snooze', () => timer.snooze());
  ipcMain.on('timer:back', () => timer.confirmBack());
  ipcMain.on('timer:pause', (_e, minutes) => timer.pause(minutes));
  ipcMain.on('timer:resume', () => timer.resume());
  ipcMain.on('timer:restart', () => timer.startWork());

  ipcMain.on('menu:pause', (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    Menu.buildFromTemplate([
      { label: 'For 15 minutes', click: () => timer.pause(15) },
      { label: 'For 30 minutes', click: () => timer.pause(30) },
      { label: 'For 1 hour', click: () => timer.pause(60) },
      { label: 'For 2 hours', click: () => timer.pause(120) },
      { label: 'Until I resume', click: () => timer.pause(null) },
    ]).popup({ window: win });
  });

  ipcMain.handle('audio:pick', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const res = await dialog.showOpenDialog(win, {
      title: 'Add your own sounds',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Audio', extensions: ['mp3', 'wav', 'ogg', 'flac', 'm4a', 'aac', 'opus', 'webm'] }],
    });
    return res.canceled ? [] : res.filePaths;
  });
  ipcMain.handle('audio:urls', (_e, paths) => fileUrls(paths));
  ipcMain.handle('audio:asset', (_e, name) => {
    if (!BUNDLED_SOUNDS.has(name)) throw new Error(`Unknown sound: ${name}`);
    return require('fs').promises.readFile(path.join(ASSETS, 'sounds', `${name}.ogg`));
  });
}

// ---------------------------------------------------------------------------
// Boot

app.whenReady().then(() => {
  store = new Store(app.getPath('userData'));
  const firstRun = !require('fs').existsSync(store.file);
  if (firstRun) store.set({}); // write defaults

  isFullscreen = createDetector();
  timer = new RestTimer(() => store.get(), {
    unitMs: FAST ? 1000 : 60000,
    idleSeconds: () => powerMonitor.getSystemIdleTime(),
    isFullscreen,
    isStanding: () => stand?.isActive() ?? false,
    yieldReason: (breakInMs) => coord?.breakHold(stand.state(), breakInMs, Math.max(30, store.get().warningSeconds) * 1000) ?? null,
  });

  stand = new StandTimer(() => store.get(), {
    unitMs: FAST ? 1000 : 60000,
    holdReason: standHoldReason,
  });

  coord = new Coordinator({
    unitMs: FAST ? 1000 : 60000,
    enabled: () => store.get().smartOrder !== false && store.get().standEnabled,
    load: () => store.get().coordination || null,
    save: (data) => store.set({ coordination: data }),
  });
  coord.attach(timer, stand);

  let lastPhase = timer.state().phase;
  timer.on('state', (state) => {
    updateTray(state);
    broadcast('state', state);
    // Back from being away or paused: you weren't sitting all that time.
    if ((lastPhase === 'away' || lastPhase === 'paused') && state.phase === 'working') stand.restartSitting();
    lastPhase = state.phase;
  });

  stand.on('state', (st) => {
    broadcast('stand:state', st);
    updateTray(timer.state());
  });
  stand.on('warning', ({ secondsLeft }) => {
    if (!Notification.isSupported()) return;
    new Notification({
      title: `Stand up in ${secondsLeft} seconds`,
      body: 'Get ready to raise your desk.',
      icon: path.join(ASSETS, 'icon.png'),
      silent: true,
    }).show();
  });
  stand.on('raise', () => {
    if (settingsWin && !settingsWin.isDestroyed()) settingsWin.webContents.send('preview:stop');
    if (floatingPrompts()) openDock('raise');
    else openStandWindows('raise');
  });
  stand.on('exercise', ({ routine }) => {
    exerciseRoutine = routine;
    closeDock();
    openStandWindows('exercise');
  });
  stand.on('standing', () => {
    exerciseRoutine = null;
    closeStandWindows();
    openDock('standing');
  });
  stand.on('lower', () => {
    if (floatingPrompts()) {
      openDock('lower');
    } else {
      closeDock();
      openStandWindows('lower');
    }
  });
  stand.on('closed', () => {
    exerciseRoutine = null;
    closeStandWindows();
    closeDock();
  });
  timer.on('warning', ({ secondsLeft }) => {
    if (!Notification.isSupported()) return;
    new Notification({
      title: `Break in ${secondsLeft} seconds`,
      body: 'Start wrapping up — time to rest your eyes soon.',
      icon: path.join(ASSETS, 'icon.png'),
      silent: true,
    }).show();
  });
  timer.on('break-start', (info) => openOverlays(info));
  timer.on('break-waiting', () => {
    for (const w of overlays) if (!w.isDestroyed()) w.webContents.send('break:waiting');
  });
  timer.on('break-end', ({ completed }) => {
    if (!(completed && store.get().confirmEnd)) closeOverlays();
  });
  timer.on('break-closed', closeOverlays);

  powerMonitor.on('lock-screen', () => timer.goAway());
  powerMonitor.on('suspend', () => timer.goAway());
  powerMonitor.on('unlock-screen', () => timer.comeBack());
  powerMonitor.on('resume', () => timer.comeBack());

  keyBlocker = createKeyBlocker();
  stats = new Stats(app.getPath('userData'));
  stats.attach(timer, () => broadcast('stats:changed'));
  stand.on('stood', ({ ms }) => {
    stats.recordStand(ms);
    broadcast('stats:changed');
  });

  updater = createUpdater({ app, getSettings: () => store.get(), onChange: onUpdateChange });

  registerIpc();
  applyLoginItem(store.get().launchAtLogin);
  timer.start();
  stand.sit();
  setInterval(() => stand.tick(), 1000);
  createTray();
  updater.start();

  if (!START_HIDDEN) openSettings();
});

app.on('second-instance', () => app.whenReady().then(() => openSettings()));
app.on('before-quit', () => {
  quitting = true;
  keyBlocker?.stop();
  stats?.save();
});
app.on('window-all-closed', () => { /* keep running in the tray */ });

// Safe bridge between the UI pages and the main process.
const { contextBridge, ipcRenderer } = require('electron');

const on = (channel) => (cb) => {
  const handler = (_e, payload) => cb(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};

contextBridge.exposeInMainWorld('api', {
  // settings
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (partial) => ipcRenderer.invoke('settings:set', partial),
  resetSettings: () => ipcRenderer.invoke('settings:reset'),
  onSettings: on('settings:changed'),

  // timer
  getState: () => ipcRenderer.invoke('state:get'),
  onState: on('state'),
  breakNow: () => ipcRenderer.send('timer:breakNow'),
  skip: () => ipcRenderer.send('timer:skip'),
  snooze: () => ipcRenderer.send('timer:snooze'),
  back: () => ipcRenderer.send('timer:back'),
  pause: (minutes) => ipcRenderer.send('timer:pause', minutes),
  resume: () => ipcRenderer.send('timer:resume'),
  restart: () => ipcRenderer.send('timer:restart'),
  pauseMenu: () => ipcRenderer.send('menu:pause'),

  // standing desk
  getStandState: () => ipcRenderer.invoke('stand:state'),
  coordSummary: () => ipcRenderer.invoke('coord:summary'),
  onStandState: on('stand:state'),
  onStandMode: on('stand:mode'),
  onStandClosing: on('stand:closing'),
  standNow: () => ipcRenderer.send('stand:now'),
  standUp: (mode) => ipcRenderer.send('stand:up', mode),   // 'full' | 'mini'
  standMode: (mode) => ipcRenderer.send('stand:mode', mode), // switch mid-routine
  openGuide: () => ipcRenderer.send('guide:open'),
  standNotNow: () => ipcRenderer.send('stand:notNow'),
  standSkip: () => ipcRenderer.send('stand:skip'),
  standExercisesDone: () => ipcRenderer.send('stand:exercisesDone'),
  standSitNow: () => ipcRenderer.send('stand:sitNow'),
  standMore: () => ipcRenderer.send('stand:more'),
  standDown: () => ipcRenderer.send('stand:down'),

  // stats
  getStats: () => ipcRenderer.invoke('stats:get'),
  clearStats: () => ipcRenderer.invoke('stats:clear'),
  onStats: on('stats:changed'),
  onNavTab: on('nav:tab'),

  // audio
  pickAudio: () => ipcRenderer.invoke('audio:pick'),
  audioUrls: (paths) => ipcRenderer.invoke('audio:urls', paths),
  loadSound: (name) => ipcRenderer.invoke('audio:asset', name),
  onPreviewStop: on('preview:stop'),

  // break overlay
  onBreakStart: on('break:start'),
  onBreakWaiting: on('break:waiting'),
  onBreakClosing: on('break:closing'),

  appInfo: () => ipcRenderer.invoke('app:info'),
  updateState: () => ipcRenderer.invoke('update:state'),
  checkForUpdates: () => ipcRenderer.send('update:check'),
  installUpdate: () => ipcRenderer.send('update:install'),
  onUpdate: on('update:status'),
});

// Tiny JSON settings store kept in the user's app-data folder.
const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  // Rhythm
  workMinutes: 45,
  breakMinutes: 2,
  longBreakEnabled: true,
  longBreakEvery: 4, // every Nth break is a long one
  longBreakMinutes: 10,
  // Standing desk (its own rhythm; regular breaks wait while you stand)
  standEnabled: true,
  standEveryMinutes: 60,
  standMinutes: 15, // includes the exercise routine
  standRoutine: 'short', // 'short' | 'full' (pelvic floor) | 'stretch' | 'mix' | 'none'
  standVoice: false, // speak the exercise cues
  standGuideSeen: false,
  smartOrder: true, // breaks and stands never overlap; learns which you prefer (coordinator.js)
  coordination: null, // what smart order has learned // the pelvic floor guide shows once before the first guided routine

  zones: [], // break zones: [{ id, label, days: [0-6], start: 'HH:MM', end: 'HH:MM', enabled }]

  // Break screen
  strictMode: false, // no skip/snooze, Alt+Tab & Windows key blocked (hold Esc 5 s = emergency exit)
  allowSkip: true,
  allowSnooze: true,
  snoozeMinutes: 5,
  warningSeconds: 30, // heads-up notification before a break (0 = off)
  confirmEnd: false, // wait for "I'm back" before the next work block starts
  holdForFullscreen: true, // don't interrupt fullscreen games / videos / presentations (Windows)
  fullscreenMaxWaitMinutes: 0, // force the break after waiting this long (0 = wait as long as it takes)
  showBreathing: true, // legacy; breakActivity decides now
  breakActivity: 'alternate', // 'breathe' | 'eyes' | 'alternate' | 'none'
  showTips: true,
  tips: [
    'Look at something far away. Let your eyes soften.',
    'Roll your shoulders back, slowly, five times.',
    'Unclench your jaw. Drop your shoulders.',
    'Stand up and stretch toward the ceiling.',
    'Take a sip of water.',
    'Close your eyes and just listen.',
    'Blink slowly a few times. Your eyes will thank you.',
    'Stretch your wrists and fingers gently.',
  ],

  // Sound
  soundEnabled: true,
  masterVolume: 0.7,
  mix: {
    rain: 0.7,
    ocean: 0,
    wind: 0,
    fire: 0,
    dream: 0.5,
    custom: 0,
  },
  customFiles: [],
  customShuffle: true,

  // General
  theme: 'night',
  launchAtLogin: true,
  autoUpdate: true, // download new versions from GitHub Releases in the background
  idleResetMinutes: 5, // if you're away this long, the work timer restarts (0 = off)
};

class Store {
  constructor(dir) {
    this.file = path.join(dir, 'settings.json');
    this.data = this.#load();
  }

  #load() {
    try {
      const saved = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (!('breakActivity' in saved)) saved.breakActivity = saved.showBreathing === false ? 'none' : 'breathe';
      return { ...DEFAULTS, ...saved, mix: { ...DEFAULTS.mix, ...(saved.mix || {}) } };
    } catch {
      return structuredClone(DEFAULTS);
    }
  }

  get() {
    return structuredClone(this.data);
  }

  set(partial) {
    const next = { ...this.data, ...partial };
    if (partial.mix) next.mix = { ...this.data.mix, ...partial.mix };
    this.data = next;
    this.#save();
    return this.get();
  }

  reset() {
    this.data = structuredClone(DEFAULTS);
    this.#save();
    return this.get();
  }

  #save() {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = this.file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
      fs.renameSync(tmp, this.file);
    } catch (err) {
      console.error('Could not save settings:', err);
    }
  }
}

module.exports = { Store, DEFAULTS };

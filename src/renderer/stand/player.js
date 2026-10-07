// Shared by the fullscreen routine (stand.js) and the floating widget's paced moves (widget.js):
// RoutinePlayer walks a routine's timeline (with pause / skip), Cues plays soft chimes and spoken cues.
(function () {
  const { ROUTINES, GET_READY, getExercise } = window.StandExercises;

  class RoutinePlayer {
    /**
     * @param {string} name   a routine from ROUTINES
     * @param {number} level  progression level
     * @param {{ exercises?: { id: string, ex: object }[], ready?: number }} opts
     *   exercises – play these instead of a named routine (e.g. one paced move)
     *   ready     – seconds of "get ready" before each exercise
     */
    constructor(name, level = 1, opts = {}) {
      const list = opts.exercises || (ROUTINES[name] || ROUTINES.short).map((id) => ({ id, ex: getExercise(id, level) }));
      const ready = opts.ready ?? GET_READY;
      let t = 0;
      this.segments = list.map(({ id, ex }, index) => {
        const seg = { id, ex, index, start: t, readyEnd: t + ready, end: t + ready + ex.secs };
        t = seg.end;
        return seg;
      });
      this.length = t;
      this.t0 = performance.now();
      this.offset = 0;
      this.pausedAt = 0;
    }

    get paused() {
      return !!this.pausedAt;
    }

    elapsed() {
      const now = this.pausedAt || performance.now();
      return (now - this.t0) / 1000 + this.offset;
    }

    /** Returns true if now paused. */
    togglePause() {
      if (this.pausedAt) {
        this.offset -= (performance.now() - this.pausedAt) / 1000;
        this.pausedAt = 0;
      } else {
        this.pausedAt = performance.now();
      }
      return this.paused;
    }

    pause() {
      if (!this.pausedAt) this.togglePause();
    }

    /** Jump to the next exercise. Returns false if there is none (the routine is over). */
    skip() {
      const t = this.elapsed();
      const next = this.segments.find((seg) => seg.start > t);
      if (!next) return false;
      this.offset += next.start - t;
      return true;
    }

    /** Where we are right now, or null once the routine has finished. */
    frame() {
      const t = this.elapsed();
      const index = this.segments.findIndex((s) => t < s.end);
      if (index === -1) return null;
      const seg = this.segments[index];
      const ready = t < seg.readyEnd;
      const state = ready
        ? { floor: 0, pose: { arms: seg.ex.at(0).pose.arms }, cue: 'Stand tall and breathe', count: '' }
        : seg.ex.at(t - seg.readyEnd);
      const progress = ready ? (t - seg.start) / (seg.readyEnd - seg.start || 1) : (t - seg.readyEnd) / seg.ex.secs;
      return { t, seg, index, ready, state, progress: Math.min(1, Math.max(0, progress)), total: t / this.length };
    }
  }

  /** "3 of 8" → "Rep 3 of 8"; "Left side" stays as it is. */
  const countLabel = (count) => (!count ? '' : /^\d/.test(count) ? `Rep ${count}` : count);

  class Cues {
    constructor() {
      this.muted = false;
      this.voiceOn = false;
      this.active = true; // only one window per routine makes sound
      this.audio = null;
      this.lastChime = 0;
      this.lastSpoken = '';
      this.lastFloor = 0;
    }

    chime(freq, gain = 0.06, length = 0.5) {
      if (this.muted || this.voiceOn || !this.active) return;
      const now = performance.now();
      if (now - this.lastChime < 1400) return; // never nag: at most one cue every 1.4 s
      this.lastChime = now;
      try {
        this.audio ??= new AudioContext();
        const t = this.audio.currentTime;
        const o = this.audio.createOscillator();
        const g = this.audio.createGain();
        o.type = 'sine';
        o.frequency.value = freq;
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(gain, t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t + length);
        o.connect(g).connect(this.audio.destination);
        o.start(t);
        o.stop(t + length + 0.05);
      } catch { /* audio unavailable */ }
    }

    /** Soft cue as a lift begins (higher note) or fully lets go (lower note). */
    floor(value) {
      if (this.lastFloor < 0.45 && value >= 0.45) this.chime(660, 0.035, 0.35);
      if (this.lastFloor > 0.25 && value <= 0.05) this.chime(494, 0.03, 0.45);
      this.lastFloor = value;
    }

    speak(text) {
      if (!this.voiceOn || !this.active || !('speechSynthesis' in window)) return;
      // Speak each kind of cue once ("Hold… 4", "Hold… 3" → "Hold").
      const key = text.replace(/[…\d]+/g, '').trim();
      if (!key || key === this.lastSpoken) return;
      this.lastSpoken = key;
      try {
        speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(key);
        const voices = speechSynthesis.getVoices();
        u.voice = voices.find((v) => /^en(-|_)/i.test(v.lang) && /natural|aria|jenny|guy|zira/i.test(v.name))
          || voices.find((v) => /^en(-|_)/i.test(v.lang)) || null;
        u.rate = 0.95;
        u.volume = 0.9;
        speechSynthesis.speak(u);
      } catch { /* speech unavailable */ }
    }

    /** New exercise: allow the same words to be spoken again. */
    resetSpeech() {
      this.lastSpoken = '';
    }

    silence() {
      try { speechSynthesis.cancel(); } catch { /* ignore */ }
    }
  }

  window.StandPlayer = { RoutinePlayer, Cues, countLabel };
})();

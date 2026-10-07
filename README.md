# Focus Point

A calm break reminder for Windows. Every so often (45 minutes by default) it gently takes over your screens and makes you rest for a minute or two, with a breathing guide and soft rain or dreamy ambient music.

<p align="center">
  <img src="docs/break.png" width="640" alt="Break screen" />
  <img src="docs/settings.png" width="220" alt="Settings" />
</p>

## Features

- **Break screen on every monitor.** It covers the whole screen, stays on top, and fades in and out slowly.
- **Breathing guide.** An orb for 4 · 2 · 6 breathing (in, hold, out). A longer exhale helps you calm down.
- **Real rain, plus live-generated ambience.** The rain is a real public-domain (CC0) field recording, softened to sound like rain heard from indoors and looped seamlessly. Ocean waves, wind, fireplace and a *Dreamscape* pad (slow chords, distant bells, long reverb) are synthesized live, so they never loop audibly. Mix them with sliders or pick a preset: Rainy night, Dreamscape, Seaside, Cabin, Storm.
- **Eye exercises.** Follow a glowing dot side to side, up and down, in circles and figure-eights, shift your focus near and far, then close your eyes. Choose breathing, eye exercises, both on alternating breaks, or nothing.
- **Standing desk mode.** On its own schedule (e.g. stand 15 min every hour), Focus Point asks you to raise your desk, guides you through a short standing routine, then gets out of the way with a small floating countdown. When time's up, it reminds you to lower the desk. Regular breaks wait while you're standing; break zones and fullscreen apps hold standing reminders.
  - **Routines:**
    - **Pelvic floor** (~3 min, or ~6 min): find your pelvic floor, long holds, quick flicks, the elevator, mini squats, heel raises, pelvic tilts, hip circles, a standing march, and a full release.
    - **Stretch** (~3½ min, for people who sit all day): overhead reach, hip flexors, hamstrings at the desk, calves, a chest opener and chin tucks.
    - **Mix** of both.
    - **None**: just the reminders.
  - **A floating widget, so you never have to leave your work.** By default the whole standing session lives in one small card in the bottom-right corner that stays on top but never takes keyboard focus: *Time to stand* → a countdown pill → *Time to sit*. (Prefer the old way? Set *Stand reminders appear as → Full screen*.)
  - **Two ways to follow along:**
    - *I'm standing* (keep working): about once every 2½–4 minutes the pill expands into **one slow, ~30-second move**, then shrinks back. The moves are a posture reset, long holds, slow heel raises, shoulder-blade squeezes, quick flicks, weight shifts, the elevator, soft knee bends, and finally a release. Hover the pill to do the next move now; close a move to skip it, and the next one waits a bit longer.
    - *Guide me*: the full routine on screen.
  - **Visuals:** a shaded figure demonstrates every move and highlights the muscle each stretch works, next to a side-view pelvic-floor diagram (tailbone to pubic bone, with the bladder and bowel resting on it) that lifts and softens with each cue.
  - **Pelvic floor guide:** what it is, how to find it, a good lift step by step, common mistakes, signs you're doing it right, why letting go matters, *the Knack*, and when to see a pelvic-health physio. It opens once before your first guided routine, and any time from the routine or Settings.
  - **Progression:** holds and flicks get longer as your sessions add up (levels 1–3).
  - **Controls:** optional **spoken cues**, **Pause** (Space) and **next exercise** (→).
- **Smart order.** A break and a stand never land on top of each other. When both are due close together, only one goes: standing first (the break waits, and a finished stand counts as your break) or the break first (the stand waits until there's some space). It learns from what you do — which one you take or dismiss, separately for mornings, afternoons and evenings — and widens the space between them when you keep dismissing things that come right after each other. You can see what it has learned, or turn it off, in *Settings → Stand*.
- **Your own music.** Add MP3/WAV/OGG/FLAC/M4A files. They're shuffled and mixed with the ambient layers.
- **Customizable rhythm.** Choose how long you work and rest, add a longer break every N breaks, and get a heads-up notification before each break.
- **Soft or strict.** Skip and Snooze buttons are optional. You can also turn on "Wait for me" so work doesn't restart until you click *I'm back*.
- **Strict mode.** No Skip or Snooze, and during a break Alt+Tab, the Windows key, Alt+Esc, Ctrl+Esc, Alt+F4 and Alt+Space are blocked. For an emergency, hold **Esc for 5 seconds**. Ctrl+Alt+Del and Task Manager (Ctrl+Shift+Esc) always work, and the block releases after 2 hours no matter what.
- **Break zones.** Set time ranges when you need to be present (meetings, classes, calls), e.g. *Team meeting, Mon–Fri 14:00–15:30*. Zones can run past midnight. Breaks never pop up inside a zone: the timer keeps counting, and a break that came due follows shortly after the zone ends.
- **Never interrupts your games.** If a fullscreen game, video or presentation is in front when a break is due, the break waits. Exclusive and borderless-windowed games both count. When you exit, you get a short heads-up and then the break. You can also set a maximum wait if you want a guaranteed break.
- **Knows when you're away.** Locking the screen, sleep, or being idle for X minutes counts as resting, and the timer starts fresh when you return.
- **Weekly stats.** See how much you rested each day this week, compared with the same point last week. Also shows breaks taken vs skipped, screen time, and rest per screen hour. Browse past weeks, or switch to a table view. History stays on your computer.
- **Lives in the tray.** Take a break now, pause for 15 min / 30 min / 1 h / 2 h, restart the timer, or quit.
- **Four themes:** Night, Dusk, Forest, Sand.
- **Starts with Windows** (optional) and runs quietly in the tray.
- **Updates itself.** New versions download in the background from GitHub Releases and install when you quit, or right away from the tray.

## Install (Windows)

Download the latest **`FocusPoint-Setup-x.y.z.exe`** from the [Releases page](https://github.com/Niick-pixel/Focus-purpose/releases/latest) and run it. After that, the app keeps itself up to date.

> Windows SmartScreen may warn you because the app isn't code-signed. Click *More info → Run anyway*.

**Publishing a new version:** bump `version` in `package.json` and get it onto `main` (merge a pull request). The *Build Windows app* workflow notices that version has no release yet, builds the installer, creates the `vX.Y.Z` tag and a GitHub Release, and attaches the installer plus the `latest.yml` update manifest. Every installed copy picks it up within a few hours.

## Run from source

```bash
npm install
npm start          # normal
npm run dev        # fast mode: every "minute" is one second, handy for trying breaks
npm test           # timer logic tests
npm run dist       # build the Windows installer into dist/ (run on Windows)
```

## How it's built

| Part | File |
| --- | --- |
| Timer (work → break → work, long breaks, idle, snooze, pause) | `src/main/timer.js` |
| App shell: tray, windows, overlays on every display, notifications | `src/main/main.js` |
| Fullscreen game/video detection (Win32 APIs via koffi) | `src/main/fullscreen.js` |
| Rest history (per-day totals in `stats.json`) | `src/main/stats.js`, `src/renderer/stats-view.js` |
| Strict mode keyboard hook (`WH_KEYBOARD_LL`) | `src/main/keyblock.js` |
| Standing desk rhythm (sit → raise → exercise → stand → lower) | `src/main/stand.js` |
| Smart order between breaks and stands (learns your preferences) | `src/main/coordinator.js` |
| Standing screens, figure rig (two-bone IK), pelvic-floor diagrams, routines, guide | `src/renderer/stand.*`, `src/renderer/stand/`, `src/renderer/guide.*` |
| Floating standing widget: prompts, countdown, paced moves | `src/renderer/widget.*` |
| Break zones (time ranges that hold breaks) | `src/main/zones.js`, `src/renderer/zones-view.js` |
| Auto-updates (electron-updater + GitHub Releases) | `src/main/updater.js` |
| Settings saved to `%APPDATA%/Focus Point/settings.json` | `src/main/store.js` |
| Sound synthesizer (Web Audio API) | `src/renderer/audio/engine.js` |
| Settings UI | `src/renderer/settings.*` |
| Break screen | `src/renderer/break.*` |

The sounds are built from a few basic ingredients:

- **Rain.** A CC0 field recording ([credits](assets/sounds/CREDITS.md)): the harsh 3 kHz region and top end are tamed so it sounds like rain heard from indoors, a time-shifted copy makes it truly stereo, and a 3-second crossfade makes the 57-second loop seamless. If it can't load, the app falls back to synthesized rain: pink noise, a brown-noise rumble, and randomized droplet clicks.
- **Ocean.** Brown noise with its volume and filter swept by a very slow wave (~13 s per wave), plus a bright foam wash on each crest.
- **Wind.** White noise through a band-pass filter whose frequency drifts, which gives the whistle.
- **Fireplace.** A low roar plus random crackles and pops.
- **Dreamscape.** Lush 7th/9th chords (Cmaj9 → Am11 → Fmaj7♯11 → G6/9 → Em9 → Fmaj9). Each note is a pair of slightly detuned oscillators, played through a slowly opening filter and a 5-second generated reverb, with pentatonic bells on top.

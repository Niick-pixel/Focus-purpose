// Standing pelvic-floor routine. Each exercise is a timeline: at(t) returns
//   { floor, pose, cue, count }
//   floor  -0.3..1   pelvic floor lift (negative = consciously softening/descending)
// Each exercise also names its `focus` (shown under the figure).
//   pose             see StandVisuals.Figure
//   cue              short live instruction
//   count            e.g. "Rep 2 of 5" (optional)
//
// General wellness guidance, not medical advice. The routine alternates lifting with
// complete release: for people who sit all day, letting go matters as much as squeezing.
(function () {
  const ease = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
  const ramp = (t, a, b) => ease((t - a) / (b - a));
  const TAU = Math.PI * 2;
  const pose = (extra = {}) => ({
    squat: 0, heel: 0, tilt: 0, swayX: 0, swayY: 0, march: 0, arms: 'hang', reach: 0,
    stance: 0, sink: 0, backHeel: 0, hinge: 0, lean: 0, headBack: 0, focus: null, ...extra,
  });
  const breath = (t, period) => 0.5 - 0.5 * Math.cos((TAU * t) / period); // 0 → 1 → 0 over one breath

  /** Two-sided stretch: first half one side, a short switch, then the other side. */
  function sides(total, fn) {
    const half = total / 2;
    return (t) => {
      const second = t >= half;
      const local = second ? t - half : t;
      const settle = ramp(local, 0, 2.5) * (1 - ramp(local, half - 1.5, half)); // step in, then out to switch
      const r = fn(local, settle);
      return { ...r, count: second ? 'Left side' : 'Right side' };
    };
  }

  /** Repeat a rep function `reps` times, each `len` seconds long. */
  function reps(total, len, fn) {
    return (t) => {
      const i = Math.min(total - 1, Math.floor(t / len));
      const r = fn(t - i * len, i);
      return { ...r, count: `${i + 1} of ${total}` };
    };
  }

  // Progression: holds and flicks grow as sessions add up (see LEVELS below).
  const LEVELS = {
    1: { hold: 5, holdReps: 5, flicks: 10 },
    2: { hold: 7, holdReps: 5, flicks: 12 },
    3: { hold: 10, holdReps: 6, flicks: 15 },
  };

  const EXERCISES = {
    find: {
      title: 'Find your pelvic floor',
      how: 'Stand tall, feet hip-width, knees soft. Imagine stopping the flow of urine and holding in wind at the same time — that gentle inward lift is your pelvic floor. Keep your glutes, thighs and belly relaxed.',
      secs: 36,
      at: (t) => {
        const c = t % 6;
        const exhale = c >= 3;
        const floor = exhale ? 0.75 * ramp(c, 3, 4.6) : 0.75 * (1 - ramp(c, 0, 1.6));
        return { floor, pose: pose(), cue: exhale ? 'Breathe out — gently lift' : 'Breathe in — let it soften' };
      },
    },

    holds: (level) => {
      const { hold, holdReps } = LEVELS[level];
      const len = hold + 5; // 1 s lift, hold, 1 s release, 3 s rest
      return {
        title: 'Long holds',
        how: `Lift and hold for ${hold} seconds while breathing normally, then let go completely. The release is part of the exercise.`,
        secs: holdReps * len,
        at: reps(holdReps, len, (t) => {
          const floor = ramp(t, 0, 1) * (1 - ramp(t, hold + 1, hold + 2));
          let cue = 'Rest — fully relaxed';
          if (t < 1) cue = 'Lift';
          else if (t < hold + 1) cue = `Hold… ${Math.ceil(hold + 1 - t)}`;
          else if (t < hold + 2) cue = 'Release';
          return { floor, pose: pose(), cue };
        }),
      };
    },

    flicks: (level) => {
      const n = LEVELS[level].flicks;
      return {
        title: 'Quick flicks',
        how: 'Short, quick squeezes and full releases. These train the fast muscle fibres that react when you cough, sneeze or lift.',
        secs: n * 2,
        at: reps(n, 2, (t) => {
          const floor = t < 0.35 ? ramp(t, 0, 0.3) : 1 - ramp(t, 0.35, 0.75);
          return { floor, pose: pose(), cue: t < 0.6 ? 'Squeeze' : 'Release' };
        }),
      };
    },

    elevator: {
      title: 'The elevator',
      how: 'Lift in three steps like an elevator going up floor by floor, then lower it one floor at a time. Slow and controlled.',
      secs: 36,
      at: reps(3, 12, (t) => {
        const steps = [0.33, 0.66, 1];
        let floor = 0;
        let cue = 'Rest';
        if (t < 4.5) {
          const i = Math.min(2, Math.floor(t / 1.5));
          floor = (i ? steps[i - 1] : 0) + (steps[i] - (i ? steps[i - 1] : 0)) * ramp(t - i * 1.5, 0, 0.7);
          cue = `Up — floor ${i + 1}`;
        } else if (t < 9) {
          const i = Math.min(2, Math.floor((t - 4.5) / 1.5));
          const from = steps[2 - i];
          const to = i === 2 ? 0 : steps[1 - i];
          floor = from + (to - from) * ramp(t - 4.5 - i * 1.5, 0, 0.7);
          cue = `Down — floor ${3 - i}`;
        }
        return { floor, pose: pose(), cue };
      }),
    },

    squats: {
      title: 'Mini squats',
      how: 'Sit back into a shallow squat as you breathe in. Breathe out, lift your pelvic floor and push the floor away to stand. Knees track over your toes.',
      secs: 40,
      at: reps(8, 5, (t) => {
        const down = t < 2.5;
        const squat = down ? 0.55 * ramp(t, 0, 2.3) : 0.55 * (1 - ramp(t, 2.5, 4.8));
        const floor = down ? 0.1 : 0.9 * ramp(t, 2.5, 3.3);
        return { floor, pose: pose({ squat, arms: 'forward', reach: squat / 0.55 }), cue: down ? 'Breathe in, sit back' : 'Breathe out, lift & rise' };
      }),
    },

    heels: {
      title: 'Heel raises',
      how: 'Rise onto the balls of your feet with a gentle lift, pause, and lower slowly. Good for circulation after sitting.',
      secs: 30,
      at: reps(10, 3, (t) => {
        const heel = ramp(t, 0, 1.1) * (1 - ramp(t, 1.7, 2.9));
        return { floor: 0.8 * heel, pose: pose({ heel }), cue: t < 1.7 ? 'Rise & lift' : 'Lower slowly' };
      }),
    },

    tilts: {
      title: 'Pelvic tilts',
      how: 'Hands on your hips. Gently tuck your tailbone under, then tip it back. Small, slow movement — it wakes up the muscles around the pelvis.',
      secs: 32,
      at: reps(8, 4, (t) => {
        const tilt = -Math.sin((TAU * t) / 4);
        return { floor: Math.max(0, -tilt) * 0.65, pose: pose({ tilt, arms: 'hips' }), cue: tilt < 0 ? 'Tuck your tailbone' : 'Tip it back' };
      }),
    },

    circles: {
      title: 'Hip circles',
      how: 'Hands on your hips, knees soft. Draw slow, easy circles with your hips — loose, not forced.',
      secs: 30,
      at: (t) => {
        const dir = t < 15 ? 1 : -1;
        const a = (TAU * t) / 5;
        return {
          floor: 0.15,
          pose: pose({ swayX: Math.sin(a) * dir, swayY: Math.cos(a) * 0.8, arms: 'hips' }),
          cue: dir > 0 ? 'Circle one way' : 'Now the other way',
        };
      },
    },

    march: {
      title: 'Standing march',
      how: 'March in place, lifting each knee a little. Stay tall and keep a light, steady lift in your pelvic floor.',
      secs: 30,
      at: (t) => ({
        floor: 0.45,
        pose: pose({ march: Math.sin(Math.PI * t / 1.1) * 0.85, arms: 'hang' }),
        cue: 'Lift your knees — stay tall',
      }),
    },

    release: {
      title: 'Let it all go',
      how: 'Sitting all day can leave these muscles tense. Breathe low into your belly and let the pelvic floor drop and soften completely.',
      secs: 24,
      at: (t) => {
        const c = t % 8;
        const inhale = c < 4;
        const floor = inhale ? -0.3 * ramp(c, 0, 3.5) : -0.3 + 0.3 * ramp(c, 4, 7.5);
        return { floor, pose: pose(), cue: inhale ? 'Breathe into your belly — soften' : 'Breathe out slowly' };
      },
    },
  };

  // ---- Stretches for people who sit all day --------------------------------------

  Object.assign(EXERCISES, {
    reach: {
      title: 'Overhead reach',
      focus: 'Spine & shoulders',
      how: 'Arms overhead, fingers long. Breathe in and grow taller; breathe out and let your shoulders slide away from your ears.',
      secs: 20,
      at: (t) => {
        const b = breath(t, 5);
        return { floor: 0, pose: pose({ arms: 'overhead', heel: 0.35 * b, focus: 'spine' }), cue: b > 0.5 ? 'Breathe in — reach tall' : 'Breathe out — shoulders down' };
      },
    },
    hipflexor: {
      title: 'Hip flexor stretch',
      focus: 'Hip flexors',
      how: 'Step one foot back, hands on hips. Tuck your tailbone and gently squeeze the back glute until you feel the front of that hip open. Hours of sitting shortens these muscles.',
      secs: 40,
      at: sides(40, (t, settle) => ({
        floor: 0.2,
        pose: pose({ stance: 0.85 * settle, sink: settle * (0.6 + 0.12 * breath(t, 6)), backHeel: settle, tilt: -0.6 * settle, arms: 'hips', focus: settle > 0.5 ? 'hipFront' : null }),
        cue: settle < 0.6 ? 'Step one foot back' : 'Tuck your tailbone — feel the front of the hip',
      })),
    },
    hamstring: {
      title: 'Hamstring hinge',
      focus: 'Back of the legs',
      how: 'Hands on the desk, soft knees. Push your hips back with a long, flat back until you feel the back of your legs. Breathe into it — no bouncing.',
      secs: 24,
      at: (t) => ({
        floor: 0,
        pose: pose({ hinge: ramp(t, 0, 3) * (0.68 + 0.1 * breath(t, 6)), arms: 'desk', focus: t > 2 ? 'backThigh' : null }),
        cue: t < 3 ? 'Hands on the desk, hinge back' : 'Long back — breathe into your hamstrings',
      }),
    },
    calf: {
      title: 'Calf stretch',
      focus: 'Calves',
      how: 'Hands on the desk, one foot back with the heel pressed down and the back leg straight. Lean in gently.',
      secs: 30,
      at: sides(30, (t, settle) => ({
        floor: 0,
        pose: pose({ stance: 0.85 * settle, sink: 0.12 * settle, hinge: 0.2 * settle + 0.04 * breath(t, 5), arms: 'desk', focus: settle > 0.5 ? 'calf' : null }),
        cue: settle < 0.6 ? 'Step one foot back' : 'Back heel down — lean in',
      })),
    },
    chest: {
      title: 'Chest opener',
      focus: 'Chest & posture',
      how: 'Clasp your hands behind you, draw the shoulder blades together and lift your chest. Undoes the forward hunch of the keyboard.',
      secs: 20,
      at: (t) => {
        const b = breath(t, 5);
        return { floor: 0, pose: pose({ arms: 'behind', lean: 0.25 + 0.25 * b, focus: 'chest' }), cue: b > 0.5 ? 'Breathe in — open the chest' : 'Breathe out — keep it open' };
      },
    },
    chin: {
      title: 'Chin tucks',
      focus: 'Neck',
      how: 'Glide your chin straight back — a small double chin — hold, then release. Counters the head drifting toward the screen.',
      secs: 24,
      at: reps(8, 3, (t) => {
        const headBack = ramp(t, 0, 0.8) * (1 - ramp(t, 2, 2.7));
        return { floor: 0, pose: pose({ headBack, focus: 'neck' }), cue: t < 0.8 ? 'Glide your chin back' : t < 2 ? 'Hold' : 'Release' };
      }),
    },
  });

  // ---- Desk set: small moves you can do while you keep working ------------------
  // Runs in the mini window. Nothing here needs your hands or your eyes for long.

  Object.assign(EXERCISES, {
    posture: {
      title: 'Posture reset',
      focus: 'Posture',
      how: 'Feet hip-width, weight spread over both feet, knees soft (not locked). Stack your ribs over your hips and let your shoulders drop.',
      secs: 20,
      at: (t) => {
        const b = breath(t, 5);
        return {
          floor: 0,
          pose: pose({ lean: 0.08 * b, focus: 'spine' }),
          cue: t < 10 ? 'Feet hip-width, knees soft' : 'Ribs over hips — shoulders down',
        };
      },
    },
    shift: {
      title: 'Weight shifts',
      focus: 'Feet & balance',
      how: 'Slowly rock your weight toward your toes, then back toward your heels. Standing still is tiring; small shifts keep the blood moving.',
      secs: 30,
      at: reps(6, 5, (t) => {
        const x = Math.sin((TAU * t) / 5);
        return {
          floor: 0.2,
          pose: pose({ swayX: 0.55 * x, heel: Math.max(0, x) * 0.25, focus: 'calf' }),
          cue: x >= 0 ? 'Toward your toes' : 'Back to your heels',
        };
      }),
    },
    knees: {
      title: 'Soft knee bends',
      focus: 'Pelvic floor',
      how: 'Bend your knees a few centimetres as you breathe in. Breathe out, lift your pelvic floor and straighten — without locking your knees.',
      secs: 30,
      at: reps(6, 5, (t) => {
        const down = t < 2.5;
        const squat = down ? 0.22 * ramp(t, 0, 2.2) : 0.22 * (1 - ramp(t, 2.5, 4.6));
        return { floor: down ? 0.05 : 0.8 * ramp(t, 2.5, 3.3), pose: pose({ squat }), cue: down ? 'Breathe in, knees soft' : 'Breathe out, lift & straighten' };
      }),
    },
    blades: {
      title: 'Shoulder-blade squeeze',
      focus: 'Upper back',
      how: 'Draw your shoulder blades back and down, as if tucking them into your back pockets. Hold, then let go. Hands can stay on the keyboard.',
      secs: 24,
      at: reps(6, 4, (t) => {
        const on = ramp(t, 0, 0.8) * (1 - ramp(t, 2.6, 3.4));
        return { floor: 0, pose: pose({ lean: 0.22 * on, focus: 'shoulders' }), cue: t < 0.8 ? 'Back and down' : t < 2.6 ? 'Hold' : 'Let go' };
      }),
    },
  });

  // Default focus for the pelvic-floor set.
  for (const id of ['find', 'elevator', 'squats', 'heels', 'tilts', 'circles', 'march', 'release']) {
    EXERCISES[id].focus = EXERCISES[id].focus || 'Pelvic floor';
  }

  const ROUTINES = {
    short: ['find', 'holds', 'flicks', 'squats', 'release'],
    full: ['find', 'holds', 'flicks', 'elevator', 'squats', 'heels', 'tilts', 'circles', 'march', 'release'],
    stretch: ['reach', 'hipflexor', 'hamstring', 'calf', 'chest', 'chin', 'release'],
    mix: ['find', 'holds', 'hipflexor', 'squats', 'chest', 'release'],
    // Mini window: keep working while you move.
    desk: ['posture', 'holds', 'heels', 'flicks', 'shift', 'elevator', 'knees', 'blades', 'release'],
  };

  // Exercises best shown with the pelvic-floor diagram (in the mini window); everything else shows the figure.
  const PELVIS_VIEW = new Set(['find', 'holds', 'flicks', 'elevator', 'release']);

  const ROUTINE_NAMES = {
    short: 'Pelvic floor',
    full: 'Pelvic floor',
    stretch: 'Stretch',
    mix: 'Pelvic floor & stretch',
    desk: 'Desk routine',
  };

  const GET_READY = 4; // seconds of "Next: …" before each exercise

  /** Resolve an exercise for a progression level (some exercises scale with level). */
  function getExercise(id, level = 1) {
    const ex = EXERCISES[id];
    const resolved = typeof ex === 'function' ? ex(LEVELS[level] ? level : 1) : ex;
    return { focus: 'Pelvic floor', ...resolved };
  }

  function routineLength(name, level = 1) {
    return (ROUTINES[name] || ROUTINES.short).reduce((a, id) => a + getExercise(id, level).secs + GET_READY, 0);
  }

  /** Level from completed standing sessions: 1 → 2 after 10 sessions, 3 after 25. */
  function levelFor(sessions) {
    if (sessions >= 25) return 3;
    if (sessions >= 10) return 2;
    return 1;
  }

  const api = { EXERCISES, ROUTINES, ROUTINE_NAMES, PELVIS_VIEW, LEVELS, GET_READY, getExercise, routineLength, levelFor };
  if (typeof window !== 'undefined') window.StandExercises = api;
  if (typeof module !== 'undefined') module.exports = api;
})();

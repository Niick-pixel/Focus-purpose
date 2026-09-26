// Pelvic floor guide: what it is, how to find it, how to lift (and let go) properly.
// Mounted as an overlay on the exercise screen and as its own window from Settings.
// General wellness information, not medical advice.
(function () {
  const { PelvisSide, PelvisDiagram } = window.StandVisuals;

  const SECTIONS = [
    {
      title: 'What it is',
      body: [
        'A sling of muscle at the base of your pelvis. It runs from the pubic bone at the front to the tailbone at the back, and between your sit bones side to side.',
        'It holds up the bladder and bowel (and uterus, if you have one), keeps you continent, and works with your deep belly and back muscles to steady your spine. It also plays a part in sexual function.',
      ],
    },
    {
      title: 'Why it matters when you sit all day',
      body: [
        'Long hours in a chair can push these muscles two ways: weak and “asleep”, or quietly clenched without you noticing — common when you’re focused or stressed.',
        'Both respond to the same training: gentle lifts, done well, each followed by a complete release.',
      ],
    },
    {
      title: 'Finding it',
      body: [
        'Imagine stopping the flow of urine and holding in wind at the same time. The gentle squeeze and lift inward you feel is your pelvic floor.',
        'Other images that help: drawing a marble up inside you; closing and lifting (vulva); shortening the penis or lifting the testicles slightly (penis).',
      ],
      note: 'Use “stop the flow” as an image, not as practice. Don’t exercise on the toilet — regularly stopping the stream can upset normal bladder emptying.',
    },
    {
      title: 'A good lift, step by step',
      steps: [
        ['Set up', 'Stand tall, feet hip-width, knees soft. Breathe normally.'],
        ['Breathe out and lift', 'Squeeze and draw in and up. Around a third to half of your maximum is plenty.'],
        ['Keep everything else quiet', 'Glutes, inner thighs, jaw and belly stay relaxed. A slight firming low in the belly is normal.'],
        ['Keep breathing', 'Breathe through the hold. If you couldn’t talk right now, you’re working too hard.'],
        ['Let go completely', 'Feel the muscles drop back down. Rest at least as long as you held.'],
      ],
    },
    {
      title: 'Common mistakes',
      list: [
        ['Holding your breath', 'Breath-holding raises pressure inside the belly and pushes down on the floor you’re trying to lift.'],
        ['Bearing down', 'If it feels like pushing out or your belly bulges, that’s the opposite movement. Stop, relax and try a smaller lift.'],
        ['Squeezing the wrong muscles', 'Clenched buttocks, pressed-together thighs or a hard-sucked-in belly are doing the work instead.'],
        ['Overdoing it', 'Quality beats quantity. When the muscles tire, form slips. A few good reps are worth more than many sloppy ones.'],
        ['Never letting go', 'A lift you don’t release fully just adds tension.'],
      ],
    },
    {
      title: 'Signs you’re doing it right',
      list: [
        ['Inside, not outside', 'You feel a lift and tightening around the back passage and the front. Nobody watching would notice anything.'],
        ['You can still breathe and talk', 'The rest of your body stays relaxed.'],
        ['It gets easier', 'Holds get longer and steadier over weeks. Real strength takes about three months of regular practice.'],
      ],
    },
    {
      title: 'Letting go is training too',
      body: [
        'A pelvic floor that’s always “on” can cause pain, urgency or trouble emptying. That’s why every rep ends with a full release, and each routine ends with belly breathing.',
        'The floor moves with your breath: as you breathe in, your diaphragm moves down and the pelvic floor gently lowers with it; as you breathe out, both rise.',
      ],
    },
    {
      title: 'The Knack',
      body: [
        'Lift your pelvic floor just before you cough, sneeze, laugh or pick something up, and hold until it’s over. Research shows this simple habit reduces leaks — it’s the everyday use of what you train here.',
      ],
    },
    {
      title: 'See a pelvic-health physiotherapist if…',
      list: [
        ['Something hurts', 'Pain in the pelvis, during or after exercises, or during sex.'],
        ['Leaks or urgency', 'Leaking, having to rush, or going very often.'],
        ['Heaviness', 'A heavy or dragging feeling, or trouble emptying.'],
        ['After surgery or birth', 'After childbirth or pelvic, bladder or prostate surgery.'],
        ['You can’t feel it', 'If nothing seems to happen when you try, a physio can check with you — sometimes using biofeedback.'],
      ],
    },
  ];

  function h(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  /**
   * Render the guide into `container`.
   * @param {{ onClose?: () => void, closeLabel?: string }} opts
   * @returns {{ destroy: () => void }}
   */
  function mount(container, { onClose, closeLabel = 'Close' } = {}) {
    container.replaceChildren();
    const root = h('article', 'guide');

    const head = h('header', 'guide-head');
    head.append(
      h('p', 'eyebrow', 'Pelvic floor guide'),
      h('h1', 'guide-title', 'Your pelvic floor, explained'),
      h('p', 'guide-lede', 'A small group of muscles you use all day without noticing. Here’s how to find them, use them well — and let them go.'),
    );
    root.append(head);

    // Live diagrams, breathing together: breathe in → soften, breathe out → lift, hold, release.
    const hero = h('section', 'guide-hero');
    const side = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const front = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const sideFig = h('figure', 'guide-fig');
    const frontFig = h('figure', 'guide-fig guide-fig-front');
    sideFig.append(side, h('figcaption', null, 'From the side'));
    frontFig.append(front, h('figcaption', null, 'From the front'));
    const cue = h('p', 'guide-cue', '');
    const phases = h('ol', 'guide-phases');
    const phaseEls = ['Breathe in · soften', 'Breathe out · lift', 'Hold · keep breathing', 'Let go'].map((t) => {
      const li = h('li', null, t);
      phases.append(li);
      return li;
    });
    const heroText = h('div', 'guide-hero-text');
    heroText.append(cue, phases);
    hero.append(sideFig, frontFig, heroText);
    root.append(hero);

    const sideView = new PelvisSide(side);
    const frontView = new PelvisDiagram(front);

    const grid = h('div', 'guide-grid');
    for (const sec of SECTIONS) {
      const card = h('section', 'guide-card');
      card.append(h('h2', null, sec.title));
      for (const p of sec.body || []) card.append(h('p', null, p));
      if (sec.steps) {
        const ol = h('ol', 'guide-steps');
        for (const [a, b] of sec.steps) {
          const li = h('li');
          li.append(h('strong', null, a), h('span', null, b));
          ol.append(li);
        }
        card.append(ol);
      }
      if (sec.list) {
        const ul = h('ul', 'guide-list');
        for (const [a, b] of sec.list) {
          const li = h('li');
          li.append(h('strong', null, a), h('span', null, b));
          ul.append(li);
        }
        card.append(ul);
      }
      if (sec.note) card.append(h('p', 'guide-note', sec.note));
      if (sec.list && sec.title.startsWith('See')) card.classList.add('guide-card-help');
      grid.append(card);
    }
    root.append(grid);

    const foot = h('footer', 'guide-foot');
    foot.append(h('p', 'guide-disclaimer', 'General wellness information, not medical advice. Stop if anything hurts.'));
    if (onClose) {
      const btn = h('button', 'btn primary guide-close', closeLabel);
      btn.addEventListener('click', onClose);
      foot.append(btn);
    }
    root.append(foot);
    container.append(root);

    // 11 s cycle: in 0–4 (soften), out & lift 4–6, hold 6–9, release 9–11.
    let raf = 0;
    const t0 = performance.now();
    let last = -1;
    const step = (now) => {
      const t = ((now - t0) / 1000) % 11;
      let lift;
      let phase;
      if (t < 4) { lift = -0.25 * Math.sin((Math.PI * t) / 4); phase = 0; }
      else if (t < 6) { lift = (t - 4) / 2; phase = 1; }
      else if (t < 9) { lift = 1; phase = 2; }
      else { lift = 1 - (t - 9) / 1.2; phase = 3; }
      sideView.set(lift);
      frontView.set(lift);
      if (phase !== last) {
        last = phase;
        cue.textContent = ['Breathe in — let it soften and lower', 'Breathe out — lift in and up', 'Hold gently, keep breathing', 'Let go completely'][phase];
        phaseEls.forEach((li, i) => li.classList.toggle('now', i === phase));
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);

    return {
      destroy() {
        cancelAnimationFrame(raf);
        container.replaceChildren();
      },
    };
  }

  window.PelvicGuide = { mount, SECTIONS };
})();

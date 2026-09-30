// Stand visuals: an animated side-view figure, a pelvic-floor diagram and a standing desk.
// Everything is drawn procedurally into inline SVG each frame — no image assets.
(function () {
  const NS = 'http://www.w3.org/2000/svg';
  const rad = (deg) => (deg * Math.PI) / 180;
  const lerp = (a, b, t) => a + (b - a) * t;
  const clamp = (v, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
  let uid = 0; // unique gradient/filter ids, so several diagrams can share a page

  function el(tag, attrs = {}, parent) {
    const node = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    if (parent) parent.append(node);
    return node;
  }

  // ---------------------------------------------------------------------------
  // Figure: side view, facing right. Pose parameters:
  //   squat 0..1   knees bend, hips sit back
  //   heel  0..1   rise onto the toes
  //   tilt -1..1   pelvic tilt (-1 = tuck tailbone under, +1 = tip it back)
  //   swayX, swayY -1..1  hip circles
  //   march -1..1  +: near knee up, -: far knee up
  //   arms  'hang' | 'forward' | 'hips'
  //   reach 0..1   how far the arms come forward (for 'forward')
  //   floor -0.3..1  pelvic floor lift (drives the glow at the pelvis)
  // ---------------------------------------------------------------------------
  const L = { shin: 108, thigh: 110, torso: 126, upper: 66, fore: 60, head: 19 };
  const GROUND = 408;

  class Figure {
    constructor(svg) {
      this.svg = svg;
      svg.setAttribute('viewBox', '0 0 300 440');
      const defs = el('defs', {}, svg);
      const glow = el('radialGradient', { id: 'pelvisGlow' }, defs);
      el('stop', { offset: '0%', 'stop-color': 'var(--accent)', 'stop-opacity': '0.95' }, glow);
      el('stop', { offset: '100%', 'stop-color': 'var(--accent)', 'stop-opacity': '0' }, glow);

      // Soft body shading: light from the top-left, like the rest of the UI.
      const body = el('linearGradient', { id: 'figBody', x1: '0', y1: '0', x2: '1', y2: '1' }, defs);
      el('stop', { offset: '0%', 'stop-color': 'var(--fig-hi)' }, body);
      el('stop', { offset: '100%', 'stop-color': 'var(--fig-lo)' }, body);
      const far = el('linearGradient', { id: 'figFar', x1: '0', y1: '0', x2: '1', y2: '1' }, defs);
      el('stop', { offset: '0%', 'stop-color': 'var(--fig-far-hi)' }, far);
      el('stop', { offset: '100%', 'stop-color': 'var(--fig-far-lo)' }, far);
      const blur = el('filter', { id: 'focusBlur', x: '-100%', y: '-100%', width: '300%', height: '300%' }, defs);
      el('feGaussianBlur', { stdDeviation: '9' }, blur);
      const shadow = el('radialGradient', { id: 'figShadow' }, defs);
      el('stop', { offset: '0%', 'stop-color': 'var(--text)', 'stop-opacity': '0.16' }, shadow);
      el('stop', { offset: '100%', 'stop-color': 'var(--text)', 'stop-opacity': '0' }, shadow);

      this.shadowEl = el('ellipse', { cx: 150, cy: GROUND + 4, rx: 110, ry: 10, fill: 'url(#figShadow)' }, svg);
      this.desk = el('line', { class: 'fig-desk' }, svg);
      this.far = this.#limbSet('fig-far');
      this.halo = el('circle', { r: 46, fill: 'url(#pelvisGlow)', opacity: 0 }, svg);
      this.torso = el('path', { class: 'fig-torso' }, svg);
      this.neck = el('path', { class: 'fig-torso' }, svg);
      this.near = this.#limbSet('fig-near');
      this.pelvis = el('ellipse', { rx: 22, ry: 17, class: 'fig-pelvis' }, svg);
      this.floorArc = el('path', { class: 'fig-floor' }, svg);
      this.head = el('circle', { r: L.head, class: 'fig-head' }, svg);
      // Muscle focus: a soft glow over the muscle a stretch is working.
      this.focus = el('ellipse', { rx: 22, ry: 13, class: 'fig-focus', filter: 'url(#focusBlur)', opacity: 0 }, svg);
      this.focusCore = el('ellipse', { rx: 9, ry: 5, class: 'fig-focus-core', opacity: 0 }, svg);
      this.focusW = 0;
      this.focusAt = null;
      this.pose = Figure.neutral();
      // Arm modes are blended so changes glide instead of snapping.
      this.armW = { hang: 1, forward: 0, hips: 0, overhead: 0, behind: 0, desk: 0 };
    }

    static neutral() {
      return {
        squat: 0, heel: 0, tilt: 0, swayX: 0, swayY: 0, march: 0, arms: 'hang', reach: 0, floor: 0,
        stance: 0, sink: 0, backHeel: 0, hinge: 0, lean: 0, headBack: 0,
      };
    }

    #limbSet(cls) {
      const g = el('g', { class: cls }, this.svg);
      return {
        thigh: el('path', {}, g), shin: el('path', {}, g), foot: el('path', {}, g),
        upper: el('path', {}, g), fore: el('path', {}, g),
      };
    }

    static #line(node, a, b) {
      node.setAttribute('x1', a[0].toFixed(1)); node.setAttribute('y1', a[1].toFixed(1));
      node.setAttribute('x2', b[0].toFixed(1)); node.setAttribute('y2', b[1].toFixed(1));
    }

    /** A tapered capsule from a (radius ra) to b (radius rb): the body's building block. */
    static #capsule(node, a, b, ra, rb) {
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const len = Math.hypot(dx, dy) || 0.001;
      const nx = -dy / len, ny = dx / len;
      const f = (v) => v.toFixed(1);
      const a1 = [a[0] + nx * ra, a[1] + ny * ra], a2 = [a[0] - nx * ra, a[1] - ny * ra];
      const b1 = [b[0] + nx * rb, b[1] + ny * rb], b2 = [b[0] - nx * rb, b[1] - ny * rb];
      node.setAttribute('d',
        `M${f(a1[0])},${f(a1[1])} L${f(b1[0])},${f(b1[1])} A${f(rb)},${f(rb)} 0 0 0 ${f(b2[0])},${f(b2[1])} ` +
        `L${f(a2[0])},${f(a2[1])} A${f(ra)},${f(ra)} 0 0 0 ${f(a1[0])},${f(a1[1])} Z`);
    }

    /**
     * Two-bone inverse kinematics: joint position between `a` and `b` for segment
     * lengths l1, l2. `prefer(p, q)` picks between the two mirror solutions.
     * If the target is out of reach, the limb points straight at it.
     */
    static #ik(a, b, l1, l2, prefer) {
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const dist = Math.hypot(dx, dy) || 0.001;
      const d = Math.min(dist, l1 + l2 - 0.5);
      const base = Math.atan2(dy, dx);
      const cosA = clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1);
      const off = Math.acos(cosA);
      const j1 = [a[0] + l1 * Math.cos(base + off), a[1] + l1 * Math.sin(base + off)];
      const j2 = [a[0] + l1 * Math.cos(base - off), a[1] + l1 * Math.sin(base - off)];
      const joint = prefer(j1, j2) ? j1 : j2;
      const end = dist > d ? [a[0] + (dx / dist) * (l1 + l2 - 0.5), a[1] + (dy / dist) * (l1 + l2 - 0.5)] : b;
      return { joint, end };
    }

    /** Smoothly move toward a target pose (k = 0..1 per frame). `target.focus` names a muscle to glow. */
    ease(target, k = 0.18) {
      this.focusTarget = target.focus || null;
      const p = this.pose;
      for (const key of ['squat', 'heel', 'tilt', 'swayX', 'swayY', 'march', 'reach', 'floor', 'stance', 'sink', 'backHeel', 'hinge', 'lean', 'headBack']) {
        p[key] = lerp(p[key], target[key] ?? 0, k);
      }
      const want = target.arms || 'hang';
      for (const mode of Object.keys(this.armW)) this.armW[mode] = lerp(this.armW[mode], mode === want ? 1 : 0, k * 0.8);
      this.draw();
    }

    draw() {
      const p = this.pose;
      const heelLift = p.heel * 22;

      // Hip height/position. Squats use the same forward kinematics as before (so they look
      // identical); `sink` lowers the hips between split feet, a hinge pushes them back.
      const ankle0 = [142, GROUND - 10 - heelLift];
      const shinA = rad(p.squat * 40);
      const thighA = rad(p.squat * 82);
      const kneeFk = [ankle0[0] + L.shin * Math.sin(shinA), ankle0[1] - L.shin * Math.cos(shinA)];
      let hip = [kneeFk[0] - L.thigh * Math.sin(thighA), kneeFk[1] - L.thigh * Math.cos(thighA)];
      hip = [
        hip[0] + p.swayX * 12 - p.stance * 10 - p.hinge * 28,
        hip[1] + p.swayY * 5 + p.sink * 34 + p.hinge * 8,
      ];

      // Foot targets: split stance moves the near foot forward and the far foot back.
      const nearAnkle = [142 + p.stance * 52, GROUND - 10 - heelLift];
      const farAnkle = [149 - p.stance * 84, GROUND - 10 - Math.max(heelLift, p.backHeel * 24)];
      const kneeForward = (j1, j2) => j1[0] >= j2[0];
      const legIk = (ankle, dx) => {
        const { joint, end } = Figure.#ik([hip[0] + dx, hip[1]], ankle, L.thigh, L.shin, kneeForward);
        const grounded = end[1] >= GROUND - 45; // raised heel: the toes stay on the floor
        return { knee: joint, ankle: end, toe: [end[0] + 30, grounded ? GROUND - 1 : end[1] + 10] };
      };
      // Marching: one leg hangs from the hip with the thigh lifted.
      const legFromHip = (lift, dx) => {
        const a = rad(lift * 78);
        const k = [hip[0] + dx + L.thigh * Math.sin(a), hip[1] + L.thigh * Math.cos(a)];
        const sh = rad(-lift * 12);
        const an = [k[0] + L.shin * Math.sin(sh), k[1] + L.shin * Math.cos(sh)];
        return { knee: k, ankle: an, toe: [an[0] + 30, an[1] + 2 - lift * 4] };
      };
      const nearLeg = p.march > 0.02 ? legFromHip(p.march, 0) : legIk(nearAnkle, 0);
      const farLeg = p.march < -0.02 ? legFromHip(-p.march, 7) : legIk(farAnkle, 7);

      // Torso: forward in a squat or hinge, slightly back when opening the chest.
      const lean = rad(p.squat * 30 + p.tilt * 5 - p.swayX * 3 + p.hinge * 64 - p.lean * 12);
      const shoulder = [hip[0] + L.torso * Math.sin(lean), hip[1] - L.torso * Math.cos(lean)];
      const headLean = lean + rad(6 - p.lean * 10);
      const headC = [
        shoulder[0] + 26 * Math.sin(headLean) - p.headBack * 13,
        shoulder[1] - 26 * Math.cos(headLean) - 6 + p.headBack * 2,
      ];

      // Arms
      const deskHand = [hip[0] + 112 + p.hinge * 30, hip[1] - 18 + p.hinge * 10];
      const armFor = (mode, dx) => {
        const sh = [shoulder[0] + dx, shoulder[1] + 6];
        if (mode === 'hips') {
          return { elbow: [sh[0] - 30, sh[1] + 46], hand: [hip[0] + 6 + dx, hip[1] - 14] };
        }
        if (mode === 'desk') {
          const { joint, end } = Figure.#ik(sh, [deskHand[0] + dx, deskHand[1]], L.upper, L.fore, (j1, j2) => j1[1] >= j2[1]);
          return { elbow: joint, hand: end };
        }
        let a;
        let bend;
        if (mode === 'overhead') { a = rad(172) + lean * 0.3; bend = rad(-4); }
        else if (mode === 'behind') { a = rad(-40) + lean * 0.3; bend = rad(-12); }
        else {
          const reach = mode === 'forward' ? p.reach : 0;
          a = rad(6 + reach * 78) + lean * 0.4;
          bend = rad(8 + reach * 6);
        }
        const elbow = [sh[0] + L.upper * Math.sin(a), sh[1] + L.upper * Math.cos(a)];
        const b = a + bend;
        return { elbow, hand: [elbow[0] + L.fore * Math.sin(b), elbow[1] + L.fore * Math.cos(b)] };
      };
      const blendArm = (dx) => {
        const total = Object.values(this.armW).reduce((a, b) => a + b, 0) || 1;
        const out = { elbow: [0, 0], hand: [0, 0] };
        for (const [mode, w] of Object.entries(this.armW)) {
          if (w < 0.001) continue;
          const a = armFor(mode, dx);
          for (const j of ['elbow', 'hand']) {
            out[j][0] += (a[j][0] * w) / total;
            out[j][1] += (a[j][1] * w) / total;
          }
        }
        return out;
      };
      const nearArm = blendArm(0);
      const farArm = blendArm(6);

      // A faint desk edge appears when the hands rest on it.
      Figure.#line(this.desk, [deskHand[0] - 18, deskHand[1] + 6], [deskHand[0] + 70, deskHand[1] + 6]);
      this.desk.style.opacity = String(clamp(this.armW.desk) * 0.9);

      // Legs and arms: tapered capsules (thick at the hip/shoulder, slimmer at the ankle/wrist).
      for (const [set, leg, dx] of [[this.far, farLeg, 7], [this.near, nearLeg, 0]]) {
        Figure.#capsule(set.thigh, [hip[0] + dx, hip[1]], leg.knee, 11, 7.5);
        Figure.#capsule(set.shin, leg.knee, leg.ankle, 7.5, 5);
        Figure.#capsule(set.foot, [leg.ankle[0] - 7, leg.ankle[1] + 3], leg.toe, 5.5, 3.5);
      }
      for (const [set, arm, dx] of [[this.far, farArm, 6], [this.near, nearArm, 0]]) {
        Figure.#capsule(set.upper, [shoulder[0] + dx, shoulder[1] + 6], arm.elbow, 6.5, 5);
        Figure.#capsule(set.fore, arm.elbow, arm.hand, 5, 3.8);
      }

      // Torso: slimmer at the waist than at the chest; a short neck to the head.
      Figure.#capsule(this.torso, hip, shoulder, 18, 21);
      const neckBase = [shoulder[0] + 4 * Math.sin(lean), shoulder[1] - 4 * Math.cos(lean)];
      Figure.#capsule(this.neck, neckBase, [headC[0], headC[1] + 8], 7, 6);
      this.head.setAttribute('cx', headC[0].toFixed(1));
      this.head.setAttribute('cy', headC[1].toFixed(1));

      // Muscle focus glow, placed on the named muscle.
      const mid = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
      const spots = {
        hipFront: mid([hip[0] + 7, hip[1]], farLeg.knee, 0.22).map((v, i) => v + (i === 0 ? 10 : 0)),
        backThigh: mid(hip, nearLeg.knee, 0.5).map((v, i) => v + (i === 0 ? -8 : 0)),
        calf: mid(farLeg.knee, farLeg.ankle, 0.4).map((v, i) => v + (i === 0 ? -5 : 0)),
        chest: mid(hip, shoulder, 0.78).map((v, i) => v + (i === 0 ? 14 : 0)),
        neck: [headC[0] - 12, headC[1] + 16],
        spine: mid(hip, shoulder, 0.55).map((v, i) => v + (i === 0 ? -14 : 0)),
        shoulders: [shoulder[0] - 8, shoulder[1] + 6],
      };
      const spot = spots[this.focusTarget];
      if (spot) this.focusAt = this.focusAt ? [lerp(this.focusAt[0], spot[0], 0.2), lerp(this.focusAt[1], spot[1], 0.2)] : spot;
      this.focusW = lerp(this.focusW, spot ? 1 : 0, 0.08);
      if (this.focusAt) {
        const pulse = 0.75 + 0.25 * Math.sin(performance.now() / 420);
        for (const node of [this.focus, this.focusCore]) {
          node.setAttribute('cx', this.focusAt[0].toFixed(1));
          node.setAttribute('cy', this.focusAt[1].toFixed(1));
        }
        this.focus.setAttribute('opacity', (this.focusW * 0.9 * pulse).toFixed(2));
        this.focusCore.setAttribute('opacity', (this.focusW * 0.55).toFixed(2));
      }

      const tiltDeg = (p.tilt * 16 + p.squat * 22 + p.hinge * 40).toFixed(1);
      this.pelvis.setAttribute('cx', hip[0].toFixed(1));
      this.pelvis.setAttribute('cy', (hip[1] + 2).toFixed(1));
      this.pelvis.setAttribute('transform', `rotate(${tiltDeg} ${hip[0].toFixed(1)} ${(hip[1] + 2).toFixed(1)})`);

      // Pelvic floor: a small hammock under the pelvis that lifts with the contraction.
      const lift = clamp(p.floor, -0.3, 1);
      const sag = 9 - lift * 11;
      const fx = hip[0], fy = hip[1] + 20;
      this.floorArc.setAttribute('d', `M${(fx - 15).toFixed(1)},${fy.toFixed(1)} Q${fx.toFixed(1)},${(fy + sag).toFixed(1)} ${(fx + 15).toFixed(1)},${fy.toFixed(1)}`);
      this.floorArc.setAttribute('transform', `rotate(${tiltDeg} ${fx.toFixed(1)} ${(hip[1] + 2).toFixed(1)})`);
      this.floorArc.style.opacity = String(0.45 + 0.55 * clamp(lift));
      this.halo.setAttribute('cx', fx.toFixed(1));
      this.halo.setAttribute('cy', (hip[1] + 6).toFixed(1));
      this.halo.setAttribute('opacity', (clamp(lift) * 0.85).toFixed(2));
    }
  }

  // ---------------------------------------------------------------------------
  // Pelvic floor diagram: a frontal, simplified pelvis. The pelvic floor is the
  // hammock of muscle between the sit bones; it rises and glows as you lift.
  // ---------------------------------------------------------------------------
  class PelvisDiagram {
    constructor(svg) {
      this.svg = svg;
      svg.setAttribute('viewBox', '0 0 320 260');
      const n = ++uid;
      const defs = el('defs', {}, svg);
      const grad = el('linearGradient', { id: `floorGrad${n}`, x1: '0', x2: '0', y1: '0', y2: '1' }, defs);
      el('stop', { offset: '0%', 'stop-color': 'var(--accent)', 'stop-opacity': '0.9' }, grad);
      el('stop', { offset: '100%', 'stop-color': 'var(--accent)', 'stop-opacity': '0.25' }, grad);
      const blur = el('filter', { id: `floorBlur${n}`, x: '-30%', y: '-80%', width: '160%', height: '260%' }, defs);
      el('feGaussianBlur', { stdDeviation: '9' }, blur);

      // Pelvic bones (stylized): two iliac wings, the sacrum, the pubic arch and sit bones.
      const bones = el('g', { class: 'pv-bones' }, svg);
      el('path', { d: 'M160 52 C120 40 72 34 44 52 C30 62 30 92 50 118 C66 140 92 150 108 172' }, bones);
      el('path', { d: 'M160 52 C200 40 248 34 276 52 C290 62 290 92 270 118 C254 140 228 150 212 172' }, bones);
      el('path', { d: 'M142 60 C140 90 146 112 160 128 C174 112 180 90 178 60', class: 'pv-sacrum' }, bones);
      el('path', { d: 'M108 172 C122 196 142 206 160 206 C178 206 198 196 212 172', class: 'pv-arch' }, bones);
      this.sitL = el('circle', { cx: 104, cy: 184, r: 7, class: 'pv-sit' }, bones);
      this.sitR = el('circle', { cx: 216, cy: 184, r: 7, class: 'pv-sit' }, bones);

      this.glow = el('path', { class: 'pv-glow', filter: `url(#floorBlur${n})` }, svg);
      this.fibers = [0, 1, 2].map((i) => el('path', { class: `pv-fiber pv-fiber-${i}` }, svg));
      this.floor = el('path', { class: 'pv-floor', fill: `url(#floorGrad${n})` }, svg);

      this.arrows = el('g', { class: 'pv-arrows' }, svg);
      for (const x of [134, 160, 186]) el('path', { d: `M${x - 7} 0 L${x} -8 L${x + 7} 0` }, this.arrows);
      this.label = el('text', { x: 160, y: 250, 'text-anchor': 'middle', class: 'pv-label' }, svg);
      this.label.textContent = 'Pelvic floor';
      this.lift = 0;
      this.t = 0;
    }

    /** lift: -0.3 (fully relaxed / descended) .. 1 (fully lifted) */
    set(targetLift, dt = 1 / 60) {
      this.lift = lerp(this.lift, clamp(targetLift, -0.3, 1), 0.14);
      this.t += dt;
      const lift = this.lift;
      const baseY = 190;
      const sag = 42 - lift * 50;              // released: deep hammock; lifted: almost flat, slightly domed
      const thick = 10 + (1 - clamp(lift)) * 4;
      const mid = baseY + sag;
      const top = `M104 ${baseY} C136 ${mid} 184 ${mid} 216 ${baseY}`;
      const bottom = `C184 ${mid + thick} 136 ${mid + thick} 104 ${baseY}`;
      this.floor.setAttribute('d', `${top} ${bottom} Z`);
      this.glow.setAttribute('d', `${top} ${bottom} Z`);
      this.glow.style.opacity = String(0.15 + 0.75 * clamp(lift));
      this.fibers.forEach((f, i) => {
        const o = (i - 1) * 4;
        f.setAttribute('d', `M${112 + i * 6} ${baseY + 2 + o * 0.2} C140 ${mid + 4 + o} 180 ${mid + 4 + o} ${208 - i * 6} ${baseY + 2 + o * 0.2}`);
      });
      const arrowsOn = clamp((lift - 0.25) * 2);
      this.arrows.setAttribute('transform', `translate(0 ${(mid - 18 - arrowsOn * 6 - Math.sin(this.t * 4) * 2).toFixed(1)})`);
      this.arrows.style.opacity = String(arrowsOn);
      this.sitL.style.opacity = this.sitR.style.opacity = String(0.5 + 0.5 * clamp(lift));
    }
  }

  // ---------------------------------------------------------------------------
  // Pelvic floor, side view (same orientation as the figure: front is to the right).
  // The sling of muscle runs from the tailbone to the pubic bone and supports the
  // bladder and bowel. Lifting shortens it "in and up"; releasing lets it soften down.
  // ---------------------------------------------------------------------------
  class PelvisSide {
    constructor(svg, { labels = true } = {}) {
      this.svg = svg;
      svg.setAttribute('viewBox', '0 0 340 270');
      const n = ++uid;
      const defs = el('defs', {}, svg);
      const sling = el('linearGradient', { id: `slingGrad${n}`, x1: '0', x2: '1', y1: '0', y2: '0' }, defs);
      el('stop', { offset: '0%', 'stop-color': 'var(--accent)', 'stop-opacity': '0.55' }, sling);
      el('stop', { offset: '50%', 'stop-color': 'var(--accent)', 'stop-opacity': '1' }, sling);
      el('stop', { offset: '100%', 'stop-color': 'var(--accent)', 'stop-opacity': '0.55' }, sling);
      const blur = el('filter', { id: `slingBlur${n}`, x: '-30%', y: '-120%', width: '160%', height: '340%' }, defs);
      el('feGaussianBlur', { stdDeviation: '8' }, blur);

      // Skeleton: lower spine + sacrum curving to the tailbone (left), pubic bone (right).
      const bones = el('g', { class: 'ps-bones' }, svg);
      el('path', { d: 'M58 18 C62 44 60 70 64 96 C70 132 82 160 104 184', class: 'ps-spine' }, bones);
      for (let i = 0; i < 4; i++) el('line', { x1: 52 + i * 1.5, y1: 24 + i * 22, x2: 70 + i * 2, y2: 22 + i * 22, class: 'ps-vert' }, bones);
      this.tail = el('circle', { cx: 106, cy: 186, r: 5, class: 'ps-joint' }, bones);
      el('path', { d: 'M262 150 C272 156 276 170 270 184 C264 196 250 198 244 190 C238 180 244 160 262 150 Z', class: 'ps-pubis' }, bones);

      // Organs resting on the sling.
      this.organs = el('g', { class: 'ps-organs' }, svg);
      // Bladder sits just behind the pubic bone; the bowel follows the sacrum and passes through the floor.
      el('path', { d: 'M190 150 C186 124 208 112 228 118 C246 124 250 148 240 166 C230 180 200 181 190 150 Z', class: 'ps-bladder' }, this.organs);
      el('path', { d: 'M118 70 C114 108 124 152 148 204 L161 199 C139 151 131 110 133 74 Z', class: 'ps-bowel' }, this.organs);

      this.glow = el('path', { class: 'ps-glow', filter: `url(#slingBlur${n})` }, svg);
      this.sling = el('path', { class: 'ps-sling', fill: `url(#slingGrad${n})` }, svg);
      this.fibers = [0, 1].map(() => el('path', { class: 'ps-fiber' }, svg));
      this.arrows = el('g', { class: 'ps-arrows' }, svg);
      for (const [x, y] of [[150, 0], [184, -4], [218, 0]]) el('path', { d: `M${x - 7} ${y + 4} L${x + 2} ${y - 6} L${x + 7} ${y + 5}` }, this.arrows);

      if (labels) {
        const lab = (x, y, text, cls = 'ps-label', anchor = 'middle') => {
          const t = el('text', { x, y, 'text-anchor': anchor, class: cls }, svg);
          t.textContent = text;
          return t;
        };
        lab(82, 212, 'Tailbone', 'ps-label', 'middle');
        lab(268, 216, 'Pubic bone', 'ps-label', 'middle');
        lab(220, 106, 'Bladder', 'ps-label ps-organ-label', 'middle');
        lab(126, 60, 'Bowel', 'ps-label ps-organ-label', 'middle');
        this.label = lab(176, 256, 'Pelvic floor', 'ps-title');
        lab(318, 110, 'front', 'ps-dir', 'end');
        lab(22, 110, 'back', 'ps-dir', 'start');
      }
      this.lift = 0;
      this.t = 0;
      this.set(0);
    }

    /** lift: -0.3 (softened/descended) .. 1 (fully lifted) */
    set(targetLift, dt = 1 / 60) {
      this.lift = lerp(this.lift, clamp(targetLift, -0.3, 1), 0.14);
      this.t += dt;
      const l = this.lift;
      const a = [106, 188];                   // tailbone end
      const b = [250, 192];                   // pubic bone end
      // Relaxed: a gentle hammock. Lifted: higher, slightly domed and drawn forward. Softened: a touch lower.
      const midY = 206 - l * 24;
      const c1 = [140 + l * 8, midY + 4];
      const c2 = [214 + l * 4, midY];
      const thick = 11 - clamp(l) * 3;
      const top = `M${a[0]} ${a[1]} C${c1[0]} ${c1[1]} ${c2[0]} ${c2[1]} ${b[0]} ${b[1]}`;
      const back = `C${c2[0]} ${c2[1] + thick} ${c1[0]} ${c1[1] + thick} ${a[0]} ${a[1] + 4}`;
      this.sling.setAttribute('d', `${top} ${back} Z`);
      this.glow.setAttribute('d', `${top} ${back} Z`);
      this.glow.style.opacity = String(0.12 + 0.8 * clamp(l));
      this.fibers.forEach((f, i) => {
        const o = 3 + i * 4;
        f.setAttribute('d', `M${a[0] + 6} ${a[1] + 2 + i} C${c1[0]} ${c1[1] + o} ${c2[0]} ${c2[1] + o} ${b[0] - 6} ${b[1] + 1 + i}`);
      });
      // Organs ride on the sling.
      this.organs.setAttribute('transform', `translate(${(l * 2).toFixed(1)} ${(-l * 7).toFixed(1)})`);
      const on = clamp((l - 0.25) * 2);
      this.arrows.setAttribute('transform', `translate(0 ${(midY - 24 - on * 6 - Math.sin(this.t * 4) * 2).toFixed(1)})`);
      this.arrows.style.opacity = String(on);
    }
  }

  // ---------------------------------------------------------------------------
  // Standing desk: the desktop glides up or down in a loop, with a soft chevron cue.
  // ---------------------------------------------------------------------------
  class Desk {
    // Front view, as you see it from your chair: two telescoping legs, the desktop,
    // a monitor facing you and a keyboard. The top glides up or down in a loop.
    constructor(svg, direction = 'up') {
      this.svg = svg;
      this.direction = direction;
      svg.setAttribute('viewBox', '0 0 320 300');
      el('line', { x1: 20, y1: 270, x2: 300, y2: 270, class: 'desk-floor' }, svg);
      // Feet and the fixed lower half of each leg.
      for (const x of [74, 246]) {
        el('rect', { x: x - 30, y: 262, width: 60, height: 8, rx: 4, class: 'desk-base' }, svg);
        el('rect', { x: x - 8, y: 196, width: 16, height: 68, rx: 3, class: 'desk-column' }, svg);
      }
      // Upper half of each leg slides out of the lower half.
      this.inners = [74, 246].map((x) => el('rect', { x: x - 5, width: 10, rx: 2, class: 'desk-column-inner' }, svg));
      this.chev = el('g', { class: 'desk-chevrons' }, svg);
      for (let i = 0; i < 3; i++) el('path', { d: `M-12 ${i * 13} L0 ${i * 13 - 11} L12 ${i * 13}` }, this.chev);

      this.top = el('g', {}, svg);
      el('rect', { x: 66, y: 12, width: 188, height: 6, rx: 2, class: 'desk-column' }, this.top);        // frame under the top
      el('rect', { x: 36, y: -7, width: 248, height: 8, rx: 3, class: 'desk-surface' }, this.top);        // top surface, seen slightly from above
      el('rect', { x: 28, y: 0, width: 264, height: 13, rx: 5, class: 'desk-top' }, this.top);            // front edge
      el('rect', { x: 146, y: -9, width: 28, height: 4, rx: 2, class: 'desk-stand' }, this.top);          // monitor foot
      el('rect', { x: 156, y: -22, width: 8, height: 14, rx: 2, class: 'desk-stand' }, this.top);         // monitor neck
      el('rect', { x: 102, y: -92, width: 116, height: 72, rx: 7, class: 'desk-monitor' }, this.top);     // bezel
      el('rect', { x: 109, y: -85, width: 102, height: 58, rx: 3, class: 'desk-screen' }, this.top);      // screen
      el('path', { d: 'M116 -80 L146 -80 L124 -40 L116 -40 Z', class: 'desk-glare' }, this.top);
      el('rect', { x: 118, y: -5, width: 84, height: 5, rx: 2, class: 'desk-keyboard' }, this.top);
      el('rect', { x: 216, y: -5, width: 10, height: 5, rx: 2.5, class: 'desk-keyboard' }, this.top);     // mouse
      this.t0 = performance.now();
    }

    frame(now) {
      const cycle = 3.6;
      const t = ((now - this.t0) / 1000) % cycle;
      const move = Math.min(1, t / 2.2);
      const e = move < 0.5 ? 4 * move ** 3 : 1 - (-2 * move + 2) ** 3 / 2; // ease in-out
      const k = this.direction === 'up' ? e : 1 - e;
      const y = lerp(172, 96, k);           // desktop height
      const fade = t > cycle - 0.5 ? (cycle - t) / 0.5 : Math.min(1, t / 0.3);
      this.top.setAttribute('transform', `translate(0 ${y.toFixed(1)})`);
      for (const inner of this.inners) {
        inner.setAttribute('y', (y + 13).toFixed(1));
        inner.setAttribute('height', (204 - y - 13).toFixed(1));
      }
      // Chevrons sit between the legs, under the desk, pointing the way it moves.
      const cy = this.direction === 'up' ? 236 - k * 22 : 206 + (1 - k) * 22;
      this.chev.setAttribute('transform', `translate(160 ${cy.toFixed(1)}) ${this.direction === 'up' ? '' : 'scale(1 -1)'}`);
      this.chev.style.opacity = String(0.9 * fade);
      this.svg.style.opacity = String(0.35 + 0.65 * fade);
    }
  }

  window.StandVisuals = { Figure, PelvisDiagram, PelvisSide, Desk, clamp, lerp };
})();

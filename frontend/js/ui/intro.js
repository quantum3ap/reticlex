/**
 * The start-up sequence: a reticle assembling itself, then the wordmark.
 *
 * The animation is CSS on an SVG, so it costs nothing to run and stays sharp at
 * any size. The sound is synthesised through the Web Audio API rather than
 * shipped as files: three short cues built from an oscillator and a noise
 * buffer, which keeps the download free of binary assets and the timing exact.
 *
 * It is skippable by any key or click, it honours the interface's animation
 * switch and the system's reduced-motion preference, and it never blocks
 * start-up: if anything here fails the application simply appears.
 */

/** Total run time, matched to the keyframes in intro.css. */
export const INTRO_DURATION_MS = 3000;

/** How long the fade to the application takes once the sequence ends. */
const FADE_MS = 420;

/**
 * The three cues, as offsets from the start of the sequence. They line up with
 * the moments the animation lands: arms arriving, ring snapping, dot punching.
 */
const CUES = [
  { at: 120, play: whoosh },
  { at: 780, play: lock },
  { at: 1180, play: impact },
];

class Audio {
  #context = null;
  #master = null;

  /** Lazily built: an audio context created before it is needed can be refused. */
  #ensure() {
    if (this.#context) return this.#context;
    const Ctor = globalThis.AudioContext ?? globalThis.webkitAudioContext;
    if (!Ctor) return null;
    try {
      this.#context = new Ctor();
      this.#master = this.#context.createGain();
      this.#master.gain.value = 0.32;
      this.#master.connect(this.#context.destination);
    } catch {
      this.#context = null;
    }
    return this.#context;
  }

  get context() { return this.#ensure(); }

  get destination() { return this.#master; }

  /**
   * Browsers may start the context suspended. Resuming is best-effort: the
   * desktop host allows playback without a gesture, a plain browser may not,
   * and a silent intro is not a failure worth reporting.
   */
  async resume() {
    const context = this.#ensure();
    if (!context) return false;
    if (context.state === 'suspended') {
      try { await context.resume(); } catch { return false; }
    }
    return context.state === 'running';
  }

  close() {
    if (!this.#context) return;
    try { this.#context.close(); } catch { /* already gone */ }
    this.#context = null;
    this.#master = null;
  }
}

/** A short band-passed noise sweep: the arms travelling in. */
function whoosh(audio) {
  const { context, destination } = audio;
  if (!context) return;
  const now = context.currentTime;
  const duration = 0.42;

  const noise = context.createBufferSource();
  const buffer = context.createBuffer(1, Math.ceil(context.sampleRate * duration), context.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
  noise.buffer = buffer;

  const filter = context.createBiquadFilter();
  filter.type = 'bandpass';
  filter.Q.value = 1.4;
  filter.frequency.setValueAtTime(320, now);
  filter.frequency.exponentialRampToValueAtTime(2600, now + duration);

  const gain = context.createGain();
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.5, now + 0.16);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

  noise.connect(filter).connect(gain).connect(destination);
  noise.start(now);
  noise.stop(now + duration);
}

/** Two clipped blips a fifth apart: the ring snapping into place. */
function lock(audio) {
  const { context, destination } = audio;
  if (!context) return;
  const now = context.currentTime;

  [[0, 880], [0.085, 1320]].forEach(([offset, frequency]) => {
    const osc = context.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(frequency, now + offset);

    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, now + offset);
    gain.gain.exponentialRampToValueAtTime(0.34, now + offset + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.09);

    osc.connect(gain).connect(destination);
    osc.start(now + offset);
    osc.stop(now + offset + 0.1);
  });
}

/** A low body with a click on top: the centre dot landing. */
function impact(audio) {
  const { context, destination } = audio;
  if (!context) return;
  const now = context.currentTime;

  const osc = context.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(180, now);
  osc.frequency.exponentialRampToValueAtTime(52, now + 0.28);

  const gain = context.createGain();
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.65, now + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.34);

  osc.connect(gain).connect(destination);
  osc.start(now);
  osc.stop(now + 0.35);

  const click = context.createBufferSource();
  const buffer = context.createBuffer(1, Math.ceil(context.sampleRate * 0.05), context.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i += 1) {
    data[i] = (Math.random() * 2 - 1) * (1 - i / data.length) ** 3;
  }
  click.buffer = buffer;

  const clickGain = context.createGain();
  clickGain.gain.value = 0.28;
  click.connect(clickGain).connect(destination);
  click.start(now);
}

/** The reticle and wordmark. Built here rather than in index.html so the
    element only exists while it is on screen. */
function build(doc, tagline) {
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const svgEl = (name, attrs) => {
    const node = doc.createElementNS(SVG_NS, name);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
    return node;
  };
  const el = (tag, className, text) => {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  const mark = svgEl('svg', { class: 'intro__mark', viewBox: '0 0 256 256', 'aria-hidden': 'true' });
  mark.append(
    svgEl('circle', { class: 'intro__ring', cx: 128, cy: 128, r: 78 }),
    svgEl('circle', { class: 'intro__pulse', cx: 128, cy: 128, r: 78 }),
  );

  const arms = svgEl('g', { class: 'intro__arms' });
  const ARMS = [
    ['top', 122, 26, 12, 52],
    ['bottom', 122, 178, 12, 52],
    ['left', 26, 122, 52, 12],
    ['right', 178, 122, 52, 12],
  ];
  for (const [side, x, y, width, height] of ARMS) {
    arms.append(svgEl('rect', {
      class: `intro__arm intro__arm--${side}`, x, y, width, height, rx: 4,
    }));
  }
  mark.append(arms, svgEl('circle', { class: 'intro__dot', cx: 128, cy: 128, r: 13 }));

  const wordmark = el('div', 'intro__wordmark');
  // Per letter so each can be staggered; the last carries the accent.
  [...'ReticleX'].forEach((character, index) => {
    const letter = el('span', index === 7 ? 'intro__letter intro__letter--x' : 'intro__letter', character);
    letter.style.setProperty('--i', String(index));
    wordmark.append(letter);
  });

  const scene = el('div', 'intro__scene');
  scene.append(mark, wordmark, el('p', 'intro__tagline', tagline));

  const host = el('div', 'intro');
  host.setAttribute('role', 'presentation');
  host.append(scene, el('div', 'intro__flash'));
  host.lastChild.setAttribute('aria-hidden', 'true');
  return host;
}

/**
 * Plays the start-up sequence and resolves when the application should appear.
 *
 * @param {object} options
 * @param {boolean} options.enabled   false skips the sequence entirely
 * @param {boolean} options.sound     false runs it silently
 * @param {string}  options.tagline   already-translated strapline
 * @param {Document} [options.document]
 * @returns {Promise<{played:boolean, skipped:boolean, heard:boolean}>}
 */
export async function playIntro({ enabled, sound, tagline, document: doc = document }) {
  const reduced = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ?? false;
  if (!enabled || reduced) return { played: false, skipped: false, heard: false };

  const host = build(doc, tagline);
  doc.body.append(host);
  // One frame before the class lands, so the keyframes always start from their
  // initial state rather than from wherever the layout happened to be.
  await new Promise((resolve) => requestAnimationFrame(() => resolve()));
  host.classList.add('is-running');

  const audio = new Audio();
  let heard = false;
  const timers = [];

  if (sound) {
    heard = await audio.resume();
    if (heard) {
      for (const cue of CUES) {
        timers.push(setTimeout(() => {
          try { cue.play(audio); } catch { /* a missed cue is not worth failing over */ }
        }, cue.at));
      }
    }
  }

  return new Promise((resolve) => {
    let done = false;

    const finish = (skipped) => {
      if (done) return;
      done = true;
      for (const timer of timers) clearTimeout(timer);
      doc.removeEventListener('keydown', onSkip, true);
      doc.removeEventListener('pointerdown', onSkip, true);

      host.classList.add('is-leaving');
      setTimeout(() => {
        host.remove();
        audio.close();
        resolve({ played: true, skipped, heard });
      }, FADE_MS);
    };

    const onSkip = () => finish(true);
    // Capture: nothing behind the intro should see the click that dismissed it.
    doc.addEventListener('keydown', onSkip, true);
    doc.addEventListener('pointerdown', onSkip, true);

    timers.push(setTimeout(() => finish(false), INTRO_DURATION_MS));
  });
}

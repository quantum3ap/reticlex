/**
 * The live preview surface.
 *
 * Owns its own canvas, background, grid and zoom, and redraws on an animation
 * frame so a fast slider drag never queues more work than the display can
 * show. The crosshair itself is drawn from geometry resolved by the native
 * core, exactly as the desktop host would draw it.
 */

import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { drawGeometry, resizeCanvas } from './renderer.js';
import { clamp, onFrame, rgbToHex } from '../core/util.js';

export const ZOOM = Object.freeze({ min: 1, max: 24, step: 1 });

/** Backgrounds that are drawn rather than loaded from a file. */
const SCENES = {
  dark: { base: '#0B0D10' },
  light: { base: '#E8ECEF' },
  contrast: { base: '#FFFFFF' },
  fps: { base: '#151A20' },
};

export class Preview {
  #canvas;
  #ctx;
  #scene;
  #config = null;
  #geometry = null;
  #image = null;
  #imageUrl = null;
  #sampler = null;
  #layoutWaits = 0;
  #imageWaits = 0;
  #observer = null;

  /**
   * @param {{core:object, i18n:object, onZoomChange?:Function}} options
   */
  constructor({ core, i18n, onZoomChange }) {
    this.core = core;
    this.i18n = i18n;
    this.onZoomChange = onZoomChange;

    this.zoom = 4;
    this.background = 'dark';
    this.showGrid = false;
    this.showInfo = true;

    this.#canvas = h('canvas', {
      class: 'preview__canvas',
      role: 'img',
      'aria-label': i18n.t('a11y.previewCanvas'),
    });
    this.#ctx = this.#canvas.getContext('2d');
    this.#scene = h('div', { class: 'preview__scene', dataset: { background: 'dark' } },
      h('div', { class: 'preview__grid', 'aria-hidden': 'true' }),
      this.#canvas);

    this.infoPanel = h('div', { class: 'preview__info' });
    this.element = h('div', { class: 'preview' }, this.#scene, this.infoPanel);

    this.render = onFrame(() => this.#draw());

    if (typeof ResizeObserver === 'function') {
      this.#observer = new ResizeObserver(() => this.render());
      this.#observer.observe(this.#scene);
    } else {
      window.addEventListener('resize', () => this.render());
    }

    // Ctrl/Cmd + wheel zooms, matching the rest of the app's shortcuts.
    this.#scene.addEventListener('wheel', (event) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      this.setZoom(this.zoom + (event.deltaY < 0 ? 1 : -1));
    }, { passive: false });
  }

  setConfig(config) {
    this.#config = config;
    this.#geometry = null;
    this.render();
  }

  setZoom(next, { silent = false } = {}) {
    const value = clamp(Math.round(next), ZOOM.min, ZOOM.max);
    if (value === this.zoom) return this.zoom;
    this.zoom = value;
    this.render();
    if (!silent) this.onZoomChange?.(value);
    return value;
  }

  setBackground(name, imageDataUrl = null) {
    this.background = SCENES[name] || name === 'custom' ? name : 'dark';
    this.#scene.dataset.background = this.background;
    if (name === 'custom' && imageDataUrl) this.setBackgroundImage(imageDataUrl);
    this.render();
  }

  setBackgroundImage(dataUrl) {
    this.#imageUrl = dataUrl;
    if (!dataUrl) {
      this.#image = null;
      this.#scene.style.removeProperty('--preview-image');
      this.render();
      return;
    }
    this.#scene.style.setProperty('--preview-image', `url("${dataUrl}")`);

    // Dropped now rather than when the replacement arrives. Whatever is drawn
    // in between is the new background, and measuring the reticle against the
    // old one would report a contrast for an image no longer on screen.
    this.#image = null;
    this.#imageWaits = 0;

    const image = new Image();

    const settle = () => {
      // Ignore an image that finished after a different one was asked for.
      if (this.#imageUrl !== dataUrl) return;
      this.#image = image;
      // A fresh budget for the layout retry: this is the draw that matters,
      // and it must not inherit one an earlier navigation already spent.
      this.#layoutWaits = 0;
      this.#imageWaits = 0;
      // Directly, for the same reason the waits above are: this is the draw
      // that turns the contrast readout from a placeholder into a measurement,
      // and it must not be left waiting on an animation frame that a view
      // which is not on screen yet may not get.
      this.#draw();
    };

    image.onload = settle;
    image.onerror = () => {
      if (this.#imageUrl !== dataUrl) return;
      this.#image = null;
      this.#scene.style.removeProperty('--preview-image');
      this.render();
    };
    image.src = dataUrl;

    // A data URL the browser has already decoded can be complete before the
    // load event would fire, and then it never fires at all. Without this the
    // contrast readout goes quiet the second time a background is reused.
    if (image.complete && image.naturalWidth > 0) settle();
  }

  setGrid(enabled) {
    this.showGrid = Boolean(enabled);
    this.#scene.classList.toggle('preview__scene--grid', this.showGrid);
    this.render();
  }

  setInfo(enabled) {
    this.showInfo = Boolean(enabled);
    this.infoPanel.hidden = !this.showInfo;
    this.render();
  }

  reset() {
    this.setZoom(4);
    this.setBackground('dark');
    this.setGrid(false);
    this.setInfo(true);
  }

  /** Background colour the crosshair is currently judged against. */
  backgroundHex() {
    if (this.background === 'custom') return '#808080';
    return SCENES[this.background]?.base ?? '#0B0D10';
  }

  /** Side of the square the sampler works in. Small: this runs on every draw. */
  static #SAMPLE_SIZE = 96;

  /** Below this the pixel is background showing through, not reticle. */
  static #COVERAGE_FLOOR = 96;

  /**
   * Contrast against a loaded screenshot, measured where the reticle actually
   * sits rather than against a single colour standing in for the whole image.
   *
   * One average is the wrong answer twice over. A reticle that averages well
   * can still vanish against the one bright patch it crosses, and averaging
   * the whole bounding box counts the empty middle, which nothing is drawn on.
   * So the reticle is rendered to a mask, only the covered pixels are read,
   * and the worst of them is what gets reported — that is the pixel that
   * decides whether you can see your crosshair against a sand wall.
   *
   * A reticle with an outline presents two colours to the background, and it
   * is visible if either of them separates — a black outline on a black wall
   * costs nothing while the line itself still reads. So each pixel is scored
   * on whichever of the two stands out more, not on the outline alone.
   *
   * @returns {{worst:number, median:number, samples:number}|null}
   */
  #measureAgainstImage(geometry) {
    if (this.background !== 'custom') return null;

    const image = this.#image;
    if (!image || !image.complete || !image.naturalWidth || !image.naturalHeight) {
      // The background has been asked for but has not arrived. Come back for
      // it rather than quietly settling on a figure for an image that is about
      // to replace it.
      //
      if (this.#imageUrl && this.#imageWaits < Preview.#WAIT_TRIES) {
        this.#imageWaits += 1;
        setTimeout(() => this.#draw(), Preview.#WAIT_MS);
      }
      return null;
    }

    const rect = this.#scene.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;

    const extent = Math.max(geometry.extentW, geometry.extentH, 1);
    const side = extent * this.zoom;            // the reticle's square, in CSS px
    if (side <= 0) return null;

    const size = Preview.#SAMPLE_SIZE;
    if (!this.#sampler) {
      this.#sampler = document.createElement('canvas');
      this.#sampler.width = size;
      this.#sampler.height = size;
    }
    const ctx = this.#sampler.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;

    // The scene paints the image with background-size: cover and centred, so
    // the same mapping is repeated here to read the pixels actually on screen.
    const scale = Math.max(rect.width / image.naturalWidth, rect.height / image.naturalHeight);
    const drawnW = image.naturalWidth * scale;
    const drawnH = image.naturalHeight * scale;
    const originX = (rect.width - drawnW) / 2;
    const originY = (rect.height - drawnH) / 2;

    const left = (rect.width - side) / 2;
    const top = (rect.height - side) / 2;
    const sx = clamp((left - originX) / scale, 0, image.naturalWidth);
    const sy = clamp((top - originY) / scale, 0, image.naturalHeight);
    const sw = clamp(side / scale, 1, image.naturalWidth - sx);
    const sh = clamp(side / scale, 1, image.naturalHeight - sy);

    let background;
    let mask;
    try {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, size, size);
      ctx.drawImage(image, sx, sy, sw, sh, 0, 0, size, size);
      background = ctx.getImageData(0, 0, size, size).data;

      // The same reticle, at the same scale, as a coverage mask.
      ctx.clearRect(0, 0, size, size);
      drawGeometry(ctx, geometry, {
        zoom: size / extent,
        originX: size / 2,
        originY: size / 2,
      });
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      mask = ctx.getImageData(0, 0, size, size).data;
    } catch {
      // A cross-origin image taints the canvas. Nothing here is worth an
      // exception escaping into the draw loop over.
      return null;
    }

    const inks = [rgbToHex({
      r: this.#config.color_r, g: this.#config.color_g, b: this.#config.color_b,
    })];
    if (this.#config.outline_enabled) {
      inks.push(rgbToHex({
        r: this.#config.outline_color_r,
        g: this.#config.outline_color_g,
        b: this.#config.outline_color_b,
      }));
    }

    // Repeated colours are common — a screenshot has large flat regions — and
    // the contrast of a pair only has to be worked out once.
    const cache = new Map();
    const ratioAt = (hex) => {
      let ratio = cache.get(hex);
      if (ratio === undefined) {
        ratio = Math.max(...inks.map((ink) => this.core.contrast(ink, hex)));
        cache.set(hex, ratio);
      }
      return ratio;
    };

    const ratios = [];
    for (let i = 0; i < mask.length; i += 4) {
      if (mask[i + 3] < Preview.#COVERAGE_FLOOR) continue;
      // getImageData is bytes; the core's colours, and so rgbToHex, are 0..1.
      ratios.push(ratioAt(rgbToHex({
        r: background[i] / 255,
        g: background[i + 1] / 255,
        b: background[i + 2] / 255,
      })));
    }
    if (ratios.length === 0) return null;

    ratios.sort((a, b) => a - b);
    return {
      worst: ratios[0],
      median: ratios[Math.floor(ratios.length / 2)],
      samples: ratios.length,
    };
  }

  destroy() {
    this.#observer?.disconnect();
  }

  /**
   * How long to keep coming back for something that has not arrived yet, and
   * how many times. Used for two waits: a scene that has no size because the
   * page is still being laid out, and a background that is still decoding.
   *
   * Both are timed rather than counted in animation frames. A draw asked for
   * while either is outstanding would otherwise be dropped, taking with it
   * whatever prompted it, and a frame clock the browser is free to throttle —
   * which it does precisely while an element is not yet on screen — is the
   * wrong one to count either wait on. Bounded, so a preview sitting on
   * another page, or an image that never loads, stops asking.
   */
  static #WAIT_MS = 50;

  static #WAIT_TRIES = 40;

  #draw() {
    const rect = this.#scene.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      if (this.#layoutWaits < Preview.#WAIT_TRIES) {
        this.#layoutWaits += 1;
        // Straight to the draw, not through render(): render() is throttled to
        // an animation frame, and an animation frame is exactly what a view
        // that is not on screen yet does not reliably get.
        setTimeout(() => this.#draw(), Preview.#WAIT_MS);
      }
      return;
    }
    this.#layoutWaits = 0;
    const { width, height, dpr } = resizeCanvas(this.#canvas, rect.width, rect.height);

    this.#ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.#ctx.clearRect(0, 0, width, height);

    if (this.background === 'fps') this.#drawFpsScene(width, height, dpr);

    if (!this.#config) return;
    this.#geometry = this.core.buildGeometry(this.#config);
    drawGeometry(this.#ctx, this.#geometry, {
      zoom: this.zoom * dpr,
      originX: width / 2,
      originY: height / 2,
    });
    this.#ctx.setTransform(1, 0, 0, 1, 0, 0);

    if (this.showInfo) this.#updateInfo();
  }

  /**
   * A stylised shooter frame: distant geometry, a horizon and a target block.
   * Drawn rather than shipped as an image so it scales to any window size and
   * costs nothing to download.
   */
  #drawFpsScene(width, height, dpr) {
    const ctx = this.#ctx;
    const sky = ctx.createLinearGradient(0, 0, 0, height);
    sky.addColorStop(0, '#1B2430');
    sky.addColorStop(0.55, '#131A22');
    sky.addColorStop(1, '#0C1015');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, width, height);

    const horizon = height * 0.58;
    ctx.fillStyle = '#0E1319';
    ctx.fillRect(0, horizon, width, height - horizon);

    ctx.strokeStyle = 'rgba(120, 150, 180, 0.10)';
    ctx.lineWidth = 1 * dpr;
    for (let i = 1; i < 8; i += 1) {
      const x = (width / 8) * i;
      ctx.beginPath();
      ctx.moveTo(x, horizon);
      ctx.lineTo(width / 2 + (x - width / 2) * 2.4, height);
      ctx.stroke();
    }

    // Blocked-out buildings along the horizon.
    ctx.fillStyle = 'rgba(28, 38, 50, 0.95)';
    const blocks = [0.06, 0.17, 0.3, 0.63, 0.76, 0.9];
    blocks.forEach((position, index) => {
      const blockWidth = width * (0.05 + (index % 3) * 0.02);
      const blockHeight = height * (0.1 + ((index * 37) % 11) / 60);
      ctx.fillRect(width * position, horizon - blockHeight, blockWidth, blockHeight);
    });

    // A mid-distance target so gap and thickness can be judged against
    // something the size of an actual opponent.
    const targetW = width * 0.055;
    const targetH = targetW * 2.4;
    ctx.fillStyle = 'rgba(190, 120, 90, 0.55)';
    ctx.fillRect(width / 2 - targetW / 2, horizon - targetH * 0.86, targetW, targetH);
    ctx.fillStyle = 'rgba(214, 158, 128, 0.62)';
    ctx.beginPath();
    ctx.arc(width / 2, horizon - targetH * 0.86 - targetW * 0.32, targetW * 0.31, 0, Math.PI * 2);
    ctx.fill();
  }

  #updateInfo() {
    const geometry = this.#geometry;
    if (!geometry) return;
    const lineHex = rgbToHex({
      r: this.#config.color_r, g: this.#config.color_g, b: this.#config.color_b,
    });
    // Against a screenshot the figure is the worst pixel the reticle covers,
    // and a worst case earns a higher bar than an average does: 3:1 is the
    // readable floor the randomizer already works to. A flat background keeps
    // the threshold it has always had.
    const measured = this.#measureAgainstImage(geometry);
    const contrast = measured ? measured.worst : this.core.contrast(lineHex, this.backgroundHex());
    const low = measured ? contrast < 3 : contrast < 2;

    const rows = [
      infoRow(this.i18n.t('preview.infoSize'),
        `${round1(geometry.extentW)} × ${round1(geometry.extentH)} ${this.i18n.t('units.px')}`),
      infoRow(this.i18n.t('preview.infoShapes'), String(geometry.shapes.length)),
      infoRow(this.i18n.t('preview.infoZoom'), `${this.zoom}×`),
      infoRow(
        this.i18n.t(measured ? 'preview.infoContrastWorst' : 'preview.infoContrast'),
        `${contrast.toFixed(1)}:1`,
        low,
      ),
    ];
    if (measured) {
      rows.push(infoRow(this.i18n.t('preview.infoContrastTypical'),
        `${measured.median.toFixed(1)}:1`));
    }
    if (low) {
      rows.push(h('p', { class: 'preview__warning' },
        icon('warning', { size: 14 }),
        h('span', null, this.i18n.t(measured ? 'preview.contrastLowImage' : 'preview.contrastLow'))));
    }
    // replaceChildren stringifies anything that is not a node, so the list is
    // built first rather than passing a conditional straight in.
    this.infoPanel.replaceChildren(...rows);
  }
}

function infoRow(label, value, warn = false) {
  return h('div', { class: ['preview__info-row', warn ? 'is-warning' : null] },
    h('span', { class: 'preview__info-label' }, label),
    h('span', { class: 'preview__info-value' }, value));
}

function round1(value) {
  return Math.round(value * 10) / 10;
}

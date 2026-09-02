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
    const image = new Image();
    image.onload = () => {
      this.#image = image;
      this.render();
    };
    image.onerror = () => {
      this.#image = null;
      this.#scene.style.removeProperty('--preview-image');
    };
    image.src = dataUrl;
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

  destroy() {
    this.#observer?.disconnect();
  }

  #draw() {
    const rect = this.#scene.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
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
    const contrast = this.core.contrast(lineHex, this.backgroundHex());
    const low = contrast < 2;

    const rows = [
      infoRow(this.i18n.t('preview.infoSize'),
        `${round1(geometry.extentW)} × ${round1(geometry.extentH)} ${this.i18n.t('units.px')}`),
      infoRow(this.i18n.t('preview.infoShapes'), String(geometry.shapes.length)),
      infoRow(this.i18n.t('preview.infoZoom'), `${this.zoom}×`),
      infoRow(this.i18n.t('preview.infoContrast'), `${contrast.toFixed(1)}:1`, low),
    ];
    if (low) {
      rows.push(h('p', { class: 'preview__warning' },
        icon('warning', { size: 14 }),
        h('span', null, this.i18n.t('preview.contrastLow'))));
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

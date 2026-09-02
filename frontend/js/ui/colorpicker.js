/**
 * Colour field and picker popover.
 *
 * HEX, RGB and HSL all edit the same value, and every conversion goes through
 * the native core so the picker, the randomizer and the exported file agree to
 * the last bit. The saturation/value plane is plain CSS gradients rather than a
 * canvas, which keeps it crisp at any interface scale.
 */

import { h } from './dom.js';
import { icon } from './icons.js';
import { normalizeHex, hexToRgb, rgbToHex, clamp } from '../core/util.js';

const SWATCHES = [
  '#FFFFFF', '#00FF88', '#22D3EE', '#00E5FF', '#A78BFA', '#F472B6',
  '#FBBF24', '#FF4D6D', '#A3E635', '#FF7A00', '#7DD3FC', '#111111',
];

export function createColorField({
  labelKey, tipKey, value = '#00FF88', onInput, onCommit, i18n, core,
}) {
  let current = normalizeHex(value) ?? '#00FF88';
  let popover = null;

  const swatch = h('span', { class: 'color-field__swatch', style: { background: current } });
  const readout = h('span', { class: 'color-field__hex' }, current);

  const button = h(
    'button',
    {
      type: 'button',
      class: 'color-field__button',
      'aria-haspopup': 'dialog',
      'aria-expanded': 'false',
      onClick: () => (popover ? closePopover() : openPopover()),
    },
    swatch,
    readout,
    icon('chevronDown', { size: 14, className: 'color-field__chevron' }),
  );

  const element = h(
    'div',
    { class: 'color-field' },
    labelKey ? h('span', { class: 'color-field__label', i18n: labelKey }, i18n.t(labelKey)) : null,
    button,
  );
  if (tipKey) element.dataset.tip = tipKey;

  const paint = (hex) => {
    current = hex;
    swatch.style.background = hex;
    readout.textContent = hex;
  };

  const emit = (hex, commit) => {
    paint(hex);
    onInput?.(hex);
    if (commit) onCommit?.(hex);
  };

  function closePopover() {
    if (!popover) return;
    popover.destroy();
    popover = null;
    button.setAttribute('aria-expanded', 'false');
  }

  function openPopover() {
    popover = buildPopover({
      anchor: button,
      value: current,
      i18n,
      core,
      onInput: (hex) => emit(hex, false),
      onCommit: (hex) => emit(hex, true),
      onClose: () => {
        popover = null;
        button.setAttribute('aria-expanded', 'false');
      },
    });
    button.setAttribute('aria-expanded', 'true');
  }

  return {
    element,
    set(next) {
      const hex = normalizeHex(next) ?? current;
      paint(hex);
      popover?.set(hex);
    },
    close: closePopover,
  };
}

function buildPopover({ anchor, value, i18n, core, onInput, onCommit, onClose }) {
  let hsv = core.hexToHsv(value);
  // A fully black or white colour has no meaningful hue; keep the last one so
  // dragging value back up does not snap the hue to red.
  let hue = hsv.h;

  const plane = h('div', { class: 'picker__plane', tabindex: '0', role: 'application', 'aria-label': i18n.t('a11y.colorPicker') });
  const planeHandle = h('span', { class: 'picker__handle' });
  plane.append(planeHandle);

  const hueRange = h('input', {
    class: 'picker__hue',
    type: 'range',
    min: '0',
    max: '359',
    step: '1',
    value: String(Math.round(hue)),
    'aria-label': i18n.t('color.hue'),
  });

  const hexInput = h('input', { class: 'picker__input picker__input--hex', type: 'text', maxlength: '7', spellcheck: 'false' });
  const rgbInputs = ['r', 'g', 'b'].map((channel) => h('input', {
    class: 'picker__input',
    type: 'number',
    min: '0',
    max: '255',
    step: '1',
    'aria-label': i18n.t(`color.${{ r: 'red', g: 'green', b: 'blue' }[channel]}`),
    dataset: { channel },
  }));
  const hslInputs = [
    { key: 'h', max: 359, label: 'color.hue' },
    { key: 's', max: 100, label: 'color.saturation' },
    { key: 'l', max: 100, label: 'color.lightness' },
  ].map((spec) => h('input', {
    class: 'picker__input',
    type: 'number',
    min: '0',
    max: String(spec.max),
    step: '1',
    'aria-label': i18n.t(spec.label),
    dataset: { channel: spec.key },
  }));

  const tabs = ['hex', 'rgb', 'hsl'];
  let activeTab = 'hex';
  const tabButtons = new Map();
  const panels = {
    hex: h('div', { class: 'picker__panel' }, hexInput),
    rgb: h('div', { class: 'picker__panel picker__panel--triple' }, ...rgbInputs),
    hsl: h('div', { class: 'picker__panel picker__panel--triple' }, ...hslInputs),
  };

  const tabBar = h('div', { class: 'picker__tabs', role: 'tablist' },
    ...tabs.map((tab) => {
      const button = h('button', {
        type: 'button',
        class: 'picker__tab',
        role: 'tab',
        'aria-selected': String(tab === activeTab),
        i18n: `color.${tab}`,
        onClick: () => selectTab(tab),
      }, i18n.t(`color.${tab}`));
      tabButtons.set(tab, button);
      return button;
    }));

  const swatchRow = h('div', { class: 'picker__swatches' },
    ...SWATCHES.map((hex) => h('button', {
      type: 'button',
      class: 'picker__swatch',
      style: { background: hex },
      'aria-label': hex,
      title: hex,
      onClick: () => {
        const next = core.hexToHsv(hex);
        hue = next.s > 0.001 ? next.h : hue;
        hsv = { h: hue, s: next.s, v: next.v };
        sync(true);
      },
    })));

  const popover = h(
    'div',
    { class: 'picker', role: 'dialog', 'aria-label': i18n.t('a11y.colorPicker') },
    plane,
    h('div', { class: 'picker__hue-shell' }, hueRange),
    tabBar,
    h('div', { class: 'picker__panels' }, panels.hex, panels.rgb, panels.hsl),
    h('div', { class: 'picker__swatches-label', i18n: 'color.swatches' }, i18n.t('color.swatches')),
    swatchRow,
  );

  function selectTab(tab) {
    activeTab = tab;
    for (const [key, button] of tabButtons) {
      button.setAttribute('aria-selected', String(key === tab));
      button.classList.toggle('is-active', key === tab);
    }
    for (const [key, panel] of Object.entries(panels)) panel.hidden = key !== tab;
  }

  function currentHex() {
    return core.hsvToHex(hue, hsv.s, hsv.v);
  }

  function sync(commit) {
    const hex = currentHex();
    plane.style.setProperty('--hue', core.hsvToHex(hue, 1, 1));
    planeHandle.style.insetInlineStart = `${hsv.s * 100}%`;
    planeHandle.style.top = `${(1 - hsv.v) * 100}%`;
    planeHandle.style.background = hex;
    hueRange.value = String(Math.round(hue));

    if (document.activeElement !== hexInput) hexInput.value = hex;
    const rgb = hexToRgb(hex);
    const channels = { r: rgb.r, g: rgb.g, b: rgb.b };
    for (const input of rgbInputs) {
      if (document.activeElement === input) continue;
      input.value = String(Math.round(channels[input.dataset.channel] * 255));
    }
    const hsl = core.hexToHsl(hex);
    const hslValues = { h: Math.round(hsl.h), s: Math.round(hsl.s * 100), l: Math.round(hsl.l * 100) };
    for (const input of hslInputs) {
      if (document.activeElement === input) continue;
      input.value = String(hslValues[input.dataset.channel]);
    }

    onInput(hex);
    if (commit) onCommit(hex);
  }

  // --- Saturation / value plane -------------------------------------------
  const updateFromPointer = (event) => {
    const rect = plane.getBoundingClientRect();
    const x = clamp((event.clientX - rect.left) / rect.width, 0, 1);
    const y = clamp((event.clientY - rect.top) / rect.height, 0, 1);
    // insetInlineStart mirrors under RTL, so mirror the input to match.
    const s = getComputedStyle(plane).direction === 'rtl' ? 1 - x : x;
    hsv = { h: hue, s, v: 1 - y };
    sync(false);
  };

  plane.addEventListener('pointerdown', (event) => {
    plane.setPointerCapture(event.pointerId);
    updateFromPointer(event);
  });
  plane.addEventListener('pointermove', (event) => {
    if (!plane.hasPointerCapture(event.pointerId)) return;
    updateFromPointer(event);
  });
  plane.addEventListener('pointerup', (event) => {
    if (plane.hasPointerCapture(event.pointerId)) plane.releasePointerCapture(event.pointerId);
    sync(true);
  });
  plane.addEventListener('keydown', (event) => {
    const stepSize = event.shiftKey ? 0.1 : 0.02;
    const moves = {
      ArrowLeft: [-stepSize, 0], ArrowRight: [stepSize, 0],
      ArrowUp: [0, stepSize], ArrowDown: [0, -stepSize],
    };
    const move = moves[event.key];
    if (!move) return;
    event.preventDefault();
    hsv = {
      h: hue,
      s: clamp(hsv.s + move[0], 0, 1),
      v: clamp(hsv.v + move[1], 0, 1),
    };
    sync(true);
  });

  hueRange.addEventListener('input', () => {
    hue = Number(hueRange.value);
    hsv = { ...hsv, h: hue };
    sync(false);
  });
  hueRange.addEventListener('change', () => sync(true));

  // --- Numeric entry -------------------------------------------------------
  hexInput.addEventListener('input', () => {
    const hex = normalizeHex(hexInput.value);
    hexInput.classList.toggle('is-invalid', hex === null && hexInput.value.length > 0);
    if (!hex) return;
    const next = core.hexToHsv(hex);
    if (next.s > 0.001 && next.v > 0.001) hue = next.h;
    hsv = { h: hue, s: next.s, v: next.v };
    sync(false);
  });
  hexInput.addEventListener('change', () => {
    const hex = normalizeHex(hexInput.value);
    if (!hex) {
      hexInput.value = currentHex();
      hexInput.classList.remove('is-invalid');
      return;
    }
    sync(true);
  });

  const readRgb = () => {
    const parts = rgbInputs.map((input) => clamp(Number(input.value), 0, 255) / 255);
    const hex = rgbToHex({ r: parts[0], g: parts[1], b: parts[2] });
    const next = core.hexToHsv(hex);
    if (next.s > 0.001 && next.v > 0.001) hue = next.h;
    hsv = { h: hue, s: next.s, v: next.v };
  };
  for (const input of rgbInputs) {
    input.addEventListener('input', () => { readRgb(); sync(false); });
    input.addEventListener('change', () => { readRgb(); sync(true); });
  }

  const readHsl = () => {
    const [hInput, sInput, lInput] = hslInputs;
    const hex = core.hslToHex(
      clamp(Number(hInput.value), 0, 359),
      clamp(Number(sInput.value), 0, 100) / 100,
      clamp(Number(lInput.value), 0, 100) / 100,
    );
    const next = core.hexToHsv(hex);
    if (next.s > 0.001 && next.v > 0.001) hue = next.h;
    hsv = { h: hue, s: next.s, v: next.v };
  };
  for (const input of hslInputs) {
    input.addEventListener('input', () => { readHsl(); sync(false); });
    input.addEventListener('change', () => { readHsl(); sync(true); });
  }

  // --- Mounting and dismissal ---------------------------------------------
  document.body.append(popover);
  selectTab('hex');
  sync(false);
  position(popover, anchor);
  requestAnimationFrame(() => popover.classList.add('picker--visible'));

  const onDocumentPointerDown = (event) => {
    if (popover.contains(event.target) || anchor.contains(event.target)) return;
    destroy();
  };
  const onKeyDown = (event) => {
    if (event.key !== 'Escape') return;
    event.stopPropagation();
    destroy();
    anchor.focus();
  };
  const onReflow = () => position(popover, anchor);

  setTimeout(() => document.addEventListener('pointerdown', onDocumentPointerDown), 0);
  document.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('resize', onReflow);
  window.addEventListener('scroll', onReflow, true);

  function destroy() {
    document.removeEventListener('pointerdown', onDocumentPointerDown);
    document.removeEventListener('keydown', onKeyDown, true);
    window.removeEventListener('resize', onReflow);
    window.removeEventListener('scroll', onReflow, true);
    popover.classList.remove('picker--visible');
    setTimeout(() => popover.remove(), 160);
    onClose?.();
  }

  return {
    destroy,
    set(hex) {
      const next = core.hexToHsv(hex);
      if (next.s > 0.001 && next.v > 0.001) hue = next.h;
      hsv = { h: hue, s: next.s, v: next.v };
      sync(false);
    },
  };
}

function position(popover, anchor) {
  const rect = anchor.getBoundingClientRect();
  const box = popover.getBoundingClientRect();
  const padding = 8;
  let top = rect.bottom + padding;
  if (top + box.height > window.innerHeight - padding) {
    top = Math.max(padding, rect.top - box.height - padding);
  }
  let left = rect.left;
  left = Math.min(Math.max(left, padding), window.innerWidth - box.width - padding);
  popover.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
}

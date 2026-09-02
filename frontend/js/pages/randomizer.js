/**
 * Randomizer.
 *
 * The generator itself lives in the native core, which biases each roll
 * towards one of several style archetypes instead of sampling every slider
 * uniformly. This page decides which properties are in play, shows the result,
 * and keeps the last few rolls so a good one is never lost to an extra click.
 */

import { h, clear } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { createChip, createSegmented } from '../ui/controls.js';
import { RandomField, RandomStyle } from '../core/wasm.js';
import { renderThumbnail, drawGeometry, resizeCanvas, fitZoom } from '../render/renderer.js';
import { createDocument } from '../core/schema.js';

const FIELDS = [
  { key: 'color', bit: RandomField.color, labelKey: 'randomizer.fieldColor', icon: 'palette' },
  { key: 'size', bit: RandomField.size, labelKey: 'randomizer.fieldSize', icon: 'designer' },
  { key: 'gap', bit: RandomField.gap, labelKey: 'randomizer.fieldGap', icon: 'minus' },
  { key: 'thickness', bit: RandomField.thickness, labelKey: 'randomizer.fieldThickness', icon: 'edit' },
  { key: 'dot', bit: RandomField.dot, labelKey: 'randomizer.fieldDot', icon: 'info' },
  { key: 'outline', bit: RandomField.outline, labelKey: 'randomizer.fieldOutline', icon: 'copy' },
  { key: 'shape', bit: RandomField.shape, labelKey: 'randomizer.fieldShape', icon: 'presets' },
  { key: 'opacity', bit: RandomField.opacity, labelKey: 'randomizer.fieldOpacity', icon: 'image' },
  { key: 'rotation', bit: RandomField.rotation, labelKey: 'randomizer.fieldRotation', icon: 'reset' },
];

const HISTORY_LIMIT = 6;

export function createRandomizerPage(app) {
  const { i18n, core } = app;

  let mask = app.settings.randomizerMask;
  let style = app.settings.randomizerStyle;
  let seed = null;
  let config = null;
  let rolling = false;
  const history = [];

  const stage = h('canvas', { class: 'roll__canvas', 'aria-label': i18n.t('a11y.previewCanvas'), role: 'img' });
  const stageWrap = h('div', { class: 'roll__stage' },
    h('div', { class: 'roll__glow', 'aria-hidden': 'true' }),
    stage,
    h('div', { class: 'roll__placeholder', i18n: 'randomizer.empty' }, i18n.t('randomizer.empty')));

  const seedLabel = h('button', {
    type: 'button',
    class: 'roll__seed',
    'data-tip': 'randomizer.seedTip',
    onClick: () => copySeed(),
  }, h('span', { i18n: 'randomizer.seed' }, i18n.t('randomizer.seed')), h('code', null, '—'));

  const generateButton = h('button', {
    type: 'button',
    class: 'btn btn--primary btn--hero',
    onClick: () => roll(),
  }, icon('dice', { size: 20 }), h('span', { i18n: 'randomizer.generate' }, i18n.t('randomizer.generate')));

  const againButton = h('button', {
    type: 'button', class: 'btn btn--soft', disabled: true, onClick: () => roll(),
  }, icon('refresh', { size: 16 }), h('span', { i18n: 'randomizer.again' }, i18n.t('randomizer.again')));

  const saveButton = h('button', {
    type: 'button', class: 'btn btn--ghost', disabled: true, onClick: () => saveRoll(),
  }, icon('save', { size: 16 }), h('span', { i18n: 'randomizer.save' }, i18n.t('randomizer.save')));

  const editButton = h('button', {
    type: 'button', class: 'btn btn--ghost', disabled: true, onClick: () => editRoll(),
  }, icon('edit', { size: 16 }), h('span', { i18n: 'randomizer.edit' }, i18n.t('randomizer.edit')));

  const chips = new Map();
  const chipRow = h('div', { class: 'chips chips--wrap' });
  for (const field of FIELDS) {
    const chip = createChip({
      i18n,
      labelKey: field.labelKey,
      iconName: field.icon,
      checked: (mask & field.bit) !== 0,
      onChange: (checked) => {
        mask = checked ? mask | field.bit : mask & ~field.bit;
        app.saveSettings({ randomizerMask: mask });
      },
    });
    chips.set(field.key, chip);
    chipRow.append(chip.element);
  }

  const styleControl = createSegmented({
    i18n,
    labelKey: 'randomizer.styleTitle',
    options: [
      { value: RandomStyle.any, labelKey: 'randomizer.styleAny' },
      { value: RandomStyle.precision, labelKey: 'randomizer.stylePrecision' },
      { value: RandomStyle.classic, labelKey: 'randomizer.styleClassic' },
      { value: RandomStyle.minimal, labelKey: 'randomizer.styleMinimal' },
      { value: RandomStyle.bold, labelKey: 'randomizer.styleBold' },
    ],
    value: style,
    onChange: (value) => {
      style = value;
      app.saveSettings({ randomizerStyle: value });
    },
  });

  const historyRow = h('div', { class: 'roll__history' });

  const element = h(
    'div',
    { class: 'page__inner page__inner--randomizer' },
    h('header', { class: 'page-head' },
      h('div', null,
        h('h2', { class: 'page-head__title', i18n: 'randomizer.title' }, i18n.t('randomizer.title')),
        h('p', { class: 'page-head__subtitle', i18n: 'randomizer.subtitle' }, i18n.t('randomizer.subtitle')))),
    h('div', { class: 'roll' },
      h('div', { class: 'roll__main' },
        stageWrap,
        seedLabel,
        h('div', { class: 'roll__actions' }, generateButton, againButton, saveButton, editButton),
        h('div', { class: 'roll__history-wrap' },
          h('p', { class: 'roll__history-label', i18n: 'randomizer.recent' }, i18n.t('randomizer.recent')),
          historyRow)),
      h('aside', { class: 'roll__side' },
        h('section', { class: 'card-panel' },
          h('h3', { class: 'card-panel__title', i18n: 'randomizer.lockTitle' }, i18n.t('randomizer.lockTitle')),
          h('p', { class: 'card-panel__body', i18n: 'randomizer.lockBody' }, i18n.t('randomizer.lockBody')),
          chipRow,
          h('div', { class: 'card-panel__actions' },
            h('button', {
              type: 'button', class: 'btn btn--ghost btn--sm', onClick: () => setMask(0x1FF),
            }, h('span', { i18n: 'randomizer.selectAll' }, i18n.t('randomizer.selectAll'))),
            h('button', {
              type: 'button', class: 'btn btn--ghost btn--sm', onClick: () => setMask(0),
            }, h('span', { i18n: 'randomizer.selectNone' }, i18n.t('randomizer.selectNone'))))),
        h('section', { class: 'card-panel' }, styleControl.element))),
  );

  function setMask(next) {
    mask = next;
    for (const field of FIELDS) chips.get(field.key).set((mask & field.bit) !== 0);
    app.saveSettings({ randomizerMask: mask });
  }

  function copySeed() {
    if (seed === null) return;
    navigator.clipboard?.writeText(String(seed)).then(
      () => app.toasts.success('toast.seedCopied'),
      () => app.toasts.warning('error.title'),
    );
  }

  function roll() {
    if (rolling) return;
    rolling = true;
    stageWrap.classList.add('is-rolling');
    generateButton.disabled = true;

    // A short shuffle before the result lands; the roll itself is instant, the
    // delay exists so the change registers as an event rather than a flicker.
    const start = performance.now();
    const DURATION = 420;
    const tick = () => {
      const elapsed = performance.now() - start;
      const previewSeed = (Math.random() * 0xFFFFFFFF) >>> 0;
      const shuffled = core.randomize(baseConfig(), previewSeed, mask || 0x1FF, style);
      draw(shuffled);
      if (elapsed < DURATION && app.settings.animations) {
        setTimeout(tick, 90);
        return;
      }
      finish();
    };

    const finish = () => {
      seed = (Math.random() * 0xFFFFFFFF) >>> 0;
      config = core.randomize(baseConfig(), seed, mask || 0x1FF, style);
      draw(config);
      seedLabel.querySelector('code').textContent = String(seed);
      stageWrap.classList.remove('is-rolling');
      stageWrap.classList.add('is-ready');
      generateButton.disabled = false;
      againButton.disabled = false;
      saveButton.disabled = false;
      editButton.disabled = false;
      rolling = false;
      pushHistory(config, seed);
      app.toasts.success('toast.randomGenerated');
    };

    if (app.settings.animations) tick();
    else finish();
  }

  /**
   * Unselected properties are taken from the crosshair currently being edited,
   * which is what makes partial rolls useful: lock the colour you like and
   * shuffle everything else around it.
   */
  function baseConfig() {
    return { ...app.session.config };
  }

  function draw(next) {
    const rect = stage.getBoundingClientRect();
    const width = rect.width || 420;
    const height = rect.height || 320;
    const { width: dw, height: dh, dpr } = resizeCanvas(stage, width, height);
    const ctx = stage.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, dw, dh);
    const geometry = core.buildGeometry(next);
    const zoom = Math.min(fitZoom(geometry, width, height, 48), 10) * dpr;
    drawGeometry(ctx, geometry, { zoom, originX: dw / 2, originY: dh / 2 });
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  function pushHistory(entryConfig, entrySeed) {
    history.unshift({ config: { ...entryConfig }, seed: entrySeed });
    if (history.length > HISTORY_LIMIT) history.length = HISTORY_LIMIT;
    renderHistory();
  }

  function renderHistory() {
    clear(historyRow);
    for (const entry of history) {
      const canvas = h('canvas', { class: 'roll__chip-canvas', 'aria-hidden': 'true' });
      const button = h('button', {
        type: 'button',
        class: 'roll__chip',
        title: `#${entry.seed}`,
        onClick: () => {
          config = entry.config;
          seed = entry.seed;
          seedLabel.querySelector('code').textContent = String(seed);
          stageWrap.classList.add('is-ready');
          draw(config);
        },
      }, canvas);
      historyRow.append(button);
      requestAnimationFrame(() => renderThumbnail(canvas, core, entry.config, 56));
    }
  }

  async function saveRoll() {
    if (!config) return;
    const doc = createDocument({
      name: `${i18n.t('randomizer.title')} #${seed}`,
      description: '',
      config,
    });
    const saved = await app.library.saveCrosshair(doc);
    app.session.load(saved);
    app.saveSettings({ lastDocumentId: saved.id });
    app.toasts.success('toast.savedAs', { name: saved.name });
  }

  function editRoll() {
    if (!config) return;
    app.session.replaceConfig(config, { reason: 'random' });
    app.session.seal();
    app.router.navigate('designer');
  }

  return {
    element,
    onEnter(params = {}) {
      styleControl.set(style);
      for (const field of FIELDS) chips.get(field.key).set((mask & field.bit) !== 0);
      if (config) draw(config);
      if (params.generate && !config) roll();
    },
  };
}

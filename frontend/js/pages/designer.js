/**
 * Designer: the live preview and every control that feeds it.
 *
 * Controls write straight into the session, which normalises the change in the
 * native core and pushes it onto the undo stack. The preview listens to the
 * session rather than to the controls, so a value that arrives from an undo, a
 * preset or the randomizer updates the screen through exactly the same path as
 * a slider drag.
 */

import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { createSlider, createToggle, createSegmented, createChip } from '../ui/controls.js';
import { createColorField } from '../ui/colorpicker.js';
import { Preview } from '../render/preview.js';
import { LIMITS, CAP_STYLES, DOT_SHAPES } from '../core/schema.js';
import { hexToRgb, rgbToHex } from '../core/util.js';

export function createDesignerPage(app) {
  const { i18n, core, session } = app;

  const controls = new Map();
  let linkAxes = true;
  let syncing = false;

  const preview = new Preview({
    core,
    i18n,
    onZoomChange: (zoom) => app.saveSettings({ previewZoom: zoom }),
  });

  // --- Helpers -------------------------------------------------------------

  /** Writes a config patch, collapsing a drag into a single undo entry. */
  const patch = (fields, { mergeKey = null } = {}) => {
    if (syncing) return;
    session.update(fields, { mergeKey });
    preview.setConfig(session.config);
  };

  const commit = () => session.seal();

  const colourPatch = (prefix, hex) => {
    const rgb = hexToRgb(hex);
    return { [`${prefix}_r`]: rgb.r, [`${prefix}_g`]: rgb.g, [`${prefix}_b`]: rgb.b };
  };

  const readColour = (prefix) => rgbToHex({
    r: session.config[`${prefix}_r`],
    g: session.config[`${prefix}_g`],
    b: session.config[`${prefix}_b`],
  });

  /**
   * Slider bound to one config field. When the axes are linked, the paired
   * field moves with it so a single control drives both.
   */
  function slider(field, labelKey, tipKey, { unitKey = 'units.px', pair = null } = {}) {
    const limit = LIMITS[field];
    const control = createSlider({
      i18n,
      labelKey,
      tipKey,
      min: limit.min,
      max: limit.max,
      step: limit.step,
      decimals: limit.decimals,
      unitKey,
      value: session.config[field],
      onInput: (value) => {
        const fields = { [field]: value };
        if (pair && linkAxes) fields[pair] = value;
        patch(fields, { mergeKey: field });
      },
      onCommit: commit,
    });
    controls.set(field, control);
    return control.element;
  }

  function toggle(field, labelKey, tipKey, extra = {}) {
    const control = createToggle({
      i18n,
      labelKey,
      tipKey,
      checked: Boolean(session.config[field]),
      onChange: (checked) => {
        patch({ [field]: checked ? 1 : 0 });
        commit();
        extra.onChange?.(checked);
      },
    });
    controls.set(field, control);
    return control.element;
  }

  function colour(prefix, labelKey, tipKey) {
    const control = createColorField({
      i18n,
      core,
      labelKey,
      tipKey,
      value: readColour(prefix),
      onInput: (hex) => patch(colourPatch(prefix, hex), { mergeKey: `${prefix}-colour` }),
      onCommit: () => commit(),
    });
    controls.set(`${prefix}_colour`, control);
    return control.element;
  }

  // --- Sections ------------------------------------------------------------

  function section(titleKey, iconName, children, { open = true } = {}) {
    const body = h('div', { class: 'panel-section__body' }, h('div', { class: 'panel-section__inner' }, ...children));
    const button = h(
      'button',
      {
        type: 'button',
        class: 'panel-section__head',
        'aria-expanded': String(open),
        onClick: () => {
          const next = button.getAttribute('aria-expanded') !== 'true';
          button.setAttribute('aria-expanded', String(next));
          wrapper.classList.toggle('is-open', next);
        },
      },
      h('span', { class: 'panel-section__icon' }, icon(iconName, { size: 16 })),
      h('span', { class: 'panel-section__title', i18n: titleKey }, i18n.t(titleKey)),
      icon('chevronDown', { size: 16, className: 'panel-section__chevron' }),
    );
    const wrapper = h('section', { class: ['panel-section', open ? 'is-open' : null] }, button, body);
    return wrapper;
  }

  const armChips = ['show_left', 'show_right', 'show_top', 'show_bottom'].map((field) => {
    const labelKey = {
      show_left: 'field.armLeft',
      show_right: 'field.armRight',
      show_top: 'field.armTop',
      show_bottom: 'field.armBottom',
    }[field];
    const control = createChip({
      i18n,
      labelKey,
      checked: Boolean(session.config[field]),
      onChange: (checked) => {
        patch({ [field]: checked ? 1 : 0 });
        commit();
      },
    });
    controls.set(field, control);
    return control.element;
  });

  const linkToggle = createToggle({
    i18n,
    labelKey: 'designer.linkAxes',
    tipKey: 'designer.tipLinkAxes',
    checked: linkAxes,
    onChange: (checked) => {
      linkAxes = checked;
      if (!checked) return;
      // Turning the link back on adopts the horizontal axis as the truth.
      patch({
        v_length: session.config.h_length,
        v_thickness: session.config.h_thickness,
        v_gap: session.config.h_gap,
      });
      commit();
      syncControls();
    },
  });

  const capStyle = createSegmented({
    i18n,
    labelKey: 'field.capStyle',
    tipKey: 'tip.capStyle',
    options: CAP_STYLES.map((name, index) => ({ value: index, labelKey: `capStyle.${name}` })),
    value: session.config.cap_style,
    onChange: (value) => {
      patch({ cap_style: value });
      commit();
    },
  });
  controls.set('cap_style', capStyle);

  const dotShape = createSegmented({
    i18n,
    labelKey: 'field.dotShape',
    tipKey: 'tip.dotShape',
    options: DOT_SHAPES.map((name, index) => ({ value: index, labelKey: `dotShape.${name}` })),
    value: session.config.dot_shape,
    onChange: (value) => {
      patch({ dot_shape: value });
      commit();
    },
  });
  controls.set('dot_shape', dotShape);

  const panel = h(
    'div',
    { class: 'panel' },
    h('div', { class: 'panel__scroll' },
      section('designer.sectionGeneral', 'settings', [
        colour('color', 'field.color', 'tip.color'),
        slider('scale', 'field.scale', 'tip.scale', { unitKey: null }),
        slider('rotation', 'field.rotation', 'tip.rotation', { unitKey: 'units.deg' }),
        slider('opacity', 'field.opacity', 'tip.opacity', { unitKey: null }),
      ]),
      section('designer.sectionLines', 'designer', [
        linkToggle.element,
        h('div', { class: 'panel-group' },
          h('p', { class: 'panel-group__label', i18n: 'designer.horizontal' }, i18n.t('designer.horizontal')),
          toggle('h_enabled', 'field.hEnabled', 'tip.hEnabled'),
          slider('h_length', 'field.hLength', 'tip.hLength', { pair: 'v_length' }),
          slider('h_thickness', 'field.hThickness', 'tip.hThickness', { pair: 'v_thickness' }),
          slider('h_gap', 'field.hGap', 'tip.hGap', { pair: 'v_gap' })),
        h('div', { class: 'panel-group', dataset: { role: 'vertical' } },
          h('p', { class: 'panel-group__label', i18n: 'designer.vertical' }, i18n.t('designer.vertical')),
          toggle('v_enabled', 'field.vEnabled', 'tip.vEnabled'),
          slider('v_length', 'field.vLength', 'tip.vLength'),
          slider('v_thickness', 'field.vThickness', 'tip.vThickness'),
          slider('v_gap', 'field.vGap', 'tip.vGap')),
      ]),
      section('designer.sectionShape', 'presets', [
        h('div', { class: 'field-block', dataset: { tip: 'tip.arms' } },
          h('p', { class: 'field-block__label', i18n: 'field.arms' }, i18n.t('field.arms')),
          h('div', { class: 'chips' }, ...armChips)),
        toggle('t_shape', 'field.tShape', 'tip.tShape'),
        capStyle.element,
      ]),
      section('designer.sectionOutline', 'copy', [
        toggle('outline_enabled', 'field.outlineEnabled', 'tip.outlineEnabled'),
        slider('outline_thickness', 'field.outlineThickness', 'tip.outlineThickness'),
        slider('outline_opacity', 'field.outlineOpacity', 'tip.outlineOpacity', { unitKey: null }),
        colour('outline_color', 'field.outlineColor', 'tip.outlineColor'),
      ]),
      section('designer.sectionDot', 'randomizer', [
        toggle('dot_enabled', 'field.dotEnabled', 'tip.dotEnabled'),
        slider('dot_size', 'field.dotSize', 'tip.dotSize'),
        slider('dot_opacity', 'field.dotOpacity', 'tip.dotOpacity', { unitKey: null }),
        dotShape.element,
        toggle('dot_inherit_color', 'field.dotInherit', 'tip.dotInherit', {
          onChange: () => syncControls(),
        }),
        colour('dot_color', 'field.dotColor', 'tip.dotColor'),
      ], { open: false }),
      section('designer.sectionDynamic', 'sparkle', [
        toggle('dynamic_enabled', 'field.dynamicEnabled', 'tip.dynamicEnabled'),
        slider('dynamic_spread', 'field.dynamicSpread', 'tip.dynamicSpread', { unitKey: null }),
        slider('dynamic_gap_boost', 'field.dynamicGapBoost', 'tip.dynamicGapBoost'),
      ], { open: false })),
    // One row: the panel is already tall, and a second row of buttons costs
    // sliders on a short window.
    h('div', { class: 'panel__foot' },
      h('button', {
        type: 'button', class: 'btn btn--primary panel__foot-primary', onClick: () => app.run('save'),
      }, icon('save', { size: 16 }), h('span', { i18n: 'common.save' }, i18n.t('common.save'))),
      h('button', {
        type: 'button', class: 'btn btn--ghost', onClick: () => app.run('saveAs'),
      }, h('span', { i18n: 'common.saveAs' }, i18n.t('common.saveAs'))),
      h('button', {
        type: 'button',
        class: 'icon-btn',
        'data-tip': 'presets.createFromCurrent',
        'aria-label': i18n.t('presets.createFromCurrent'),
        onClick: () => app.savePresetFromCurrent(),
      }, icon('presets', { size: 16 }))),
  );

  // --- Preview toolbar -----------------------------------------------------

  const zoomLabel = h('span', { class: 'toolbar__zoom' }, '4×');

  const backgroundControl = createSegmented({
    i18n,
    labelKey: 'preview.background',
    compact: true,
    options: [
      { value: 'dark', labelKey: 'preview.bgDark' },
      { value: 'light', labelKey: 'preview.bgLight' },
      { value: 'fps', labelKey: 'preview.bgFps' },
      { value: 'contrast', labelKey: 'preview.bgContrast' },
      { value: 'custom', labelKey: 'preview.bgCustom' },
    ],
    value: 'dark',
    onChange: async (value) => {
      if (value !== 'custom') {
        preview.setBackground(value);
        app.saveSettings({ previewBackground: value });
        return;
      }
      if (app.settings.previewImage) {
        preview.setBackground('custom', app.settings.previewImage);
        app.saveSettings({ previewBackground: 'custom' });
        return;
      }
      await chooseBackgroundImage();
    },
  });

  async function chooseBackgroundImage() {
    try {
      const result = await app.bridge.call('pickImage', {});
      if (!result?.ok) {
        backgroundControl.set(app.settings.previewBackground);
        return;
      }
      preview.setBackground('custom', result.dataUrl);
      app.saveSettings({ previewBackground: 'custom', previewImage: result.dataUrl });
    } catch (error) {
      app.toasts.error('import.errorRead', undefined, String(error.message ?? error));
      backgroundControl.set(app.settings.previewBackground);
    }
  }

  const gridToggle = toolbarButton('grid', 'preview.grid', () => {
    const next = !preview.showGrid;
    preview.setGrid(next);
    gridToggle.classList.toggle('is-active', next);
    app.saveSettings({ previewGrid: next });
  });

  const infoToggle = toolbarButton('info', 'preview.info', () => {
    const next = !preview.showInfo;
    preview.setInfo(next);
    infoToggle.classList.toggle('is-active', next);
    app.saveSettings({ previewInfo: next });
  });

  /**
   * @param {string} tipKey   the explanation shown on hover
   * @param {string} labelKey the short accessible name; defaults to the tip
   */
  function toolbarButton(iconName, tipKey, onSelect, labelKey = tipKey) {
    const button = h('button', {
      type: 'button',
      class: 'icon-btn',
      'data-tip': tipKey,
      i18nAttr: `aria-label:${labelKey}`,
      'aria-label': i18n.t(labelKey),
      onClick: onSelect,
    }, icon(iconName, { size: 16 }));
    return button;
  }

  const toolbar = h(
    'div',
    { class: 'toolbar' },
    h('div', { class: 'toolbar__group' },
      toolbarButton('zoomOut', 'preview.zoomOut', () => setZoom(preview.zoom - 1)),
      zoomLabel,
      toolbarButton('zoomIn', 'preview.zoomIn', () => setZoom(preview.zoom + 1)),
      toolbarButton('reset', 'preview.resetZoom', () => setZoom(4))),
    h('div', { class: 'toolbar__group toolbar__group--grow' }, backgroundControl.element),
    h('div', { class: 'toolbar__group' },
      gridToggle,
      infoToggle,
      toolbarButton('image', 'preview.chooseImage', () => chooseBackgroundImage()),
      toolbarButton('export', 'tip.exportPng', () => app.exportPng(), 'common.exportPng'),
      toolbarButton('refresh', 'preview.reset', () => {
        preview.reset();
        zoomLabel.textContent = `${preview.zoom}×`;
        backgroundControl.set('dark');
        gridToggle.classList.remove('is-active');
        infoToggle.classList.add('is-active');
        app.saveSettings({
          previewBackground: 'dark', previewGrid: false, previewInfo: true, previewZoom: 4,
        });
      })),
  );

  function setZoom(value) {
    const next = preview.setZoom(value);
    zoomLabel.textContent = `${next}×`;
  }

  const element = h(
    'div',
    { class: 'page__inner page__inner--designer' },
    h('div', { class: 'designer' },
      h('div', { class: 'designer__stage' }, toolbar, preview.element),
      panel),
  );

  // --- Synchronisation -----------------------------------------------------

  function syncControls() {
    syncing = true;
    try {
      const config = session.config;
      for (const [key, control] of controls) {
        if (key.endsWith('_colour')) {
          control.set(readColour(key.replace('_colour', '')));
        } else if (key in config) {
          control.set(config[key]);
        }
      }
      linkToggle.set(linkAxes);
      // A dot that follows the line colour has no colour of its own to edit.
      controls.get('dot_color_colour')?.element.classList.toggle(
        'is-disabled', Boolean(config.dot_inherit_color),
      );
      const dynamicOff = !config.dynamic_enabled;
      controls.get('dynamic_spread')?.setDisabled?.(dynamicOff);
      controls.get('dynamic_gap_boost')?.setDisabled?.(dynamicOff);
      const outlineOff = !config.outline_enabled;
      controls.get('outline_thickness')?.setDisabled?.(outlineOff);
      controls.get('outline_opacity')?.setDisabled?.(outlineOff);
      const dotOff = !config.dot_enabled;
      controls.get('dot_size')?.setDisabled?.(dotOff);
      controls.get('dot_opacity')?.setDisabled?.(dotOff);
      element.querySelector('[data-role="vertical"]')?.classList.toggle('is-linked', linkAxes);
    } finally {
      syncing = false;
    }
  }

  session.onChange((_, reason) => {
    // A change this page originated is already reflected in the control the
    // user is holding; writing it back mid-drag would fight the pointer.
    if (reason !== 'update') syncControls();
    preview.setConfig(session.config);
  });

  return {
    element,
    onEnter() {
      preview.setZoom(app.settings.previewZoom, { silent: true });
      preview.setGrid(app.settings.previewGrid);
      preview.setInfo(app.settings.previewInfo);
      preview.setBackground(app.settings.previewBackground, app.settings.previewImage);
      preview.setConfig(session.config);
      backgroundControl.set(app.settings.previewBackground);
      gridToggle.classList.toggle('is-active', app.settings.previewGrid);
      infoToggle.classList.toggle('is-active', app.settings.previewInfo);
      zoomLabel.textContent = `${preview.zoom}×`;
      syncControls();
      preview.render();
    },
    onLeave() {
      session.seal();
    },
  };
}

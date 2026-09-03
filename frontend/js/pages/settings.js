/**
 * Settings.
 *
 * Every control writes through app.saveSettings, which validates, applies and
 * persists in one step, so there is no "apply" button and no way for the
 * on-screen state to disagree with what is on disk.
 */

import { h, clear } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { createToggle, createSegmented, createSlider, createSelect } from '../ui/controls.js';
import { UI_SCALE } from '../core/settings.js';
import { SHORTCUTS } from '../shortcuts.js';

const REPOSITORY_URL = 'https://github.com/quantum3ap/reticlex';
const LICENSE_URL = 'https://github.com/quantum3ap/reticlex/blob/main/LICENSE';

export function createSettingsPage(app) {
  const { i18n } = app;

  const themeControl = createSegmented({
    i18n,
    labelKey: 'settings.theme',
    tipKey: 'settings.themeTip',
    options: [
      { value: 'dark', labelKey: 'settings.themeDark' },
      { value: 'midnight', labelKey: 'settings.themeMidnight' },
      { value: 'light', labelKey: 'settings.themeLight' },
    ],
    value: app.settings.theme,
    onChange: (value) => app.saveSettings({ theme: value }, { notify: true }),
  });

  const accentRow = h('div', { class: 'accents' },
    ...app.accents.map((accent) => h('button', {
      type: 'button',
      class: 'accents__swatch',
      style: { background: accent.hex },
      'aria-label': accent.id,
      title: accent.hex,
      dataset: { accent: accent.hex },
      onClick: () => {
        app.saveSettings({ accent: accent.hex });
        markAccent();
      },
    })));

  function markAccent() {
    for (const swatch of accentRow.children) {
      swatch.classList.toggle('is-active', swatch.dataset.accent === app.settings.accent);
    }
  }

  const animationsToggle = createToggle({
    i18n,
    labelKey: 'settings.animations',
    tipKey: 'settings.animationsTip',
    checked: app.settings.animations,
    onChange: (checked) => app.saveSettings({ animations: checked }, { notify: true }),
  });

  const scaleSlider = createSlider({
    i18n,
    labelKey: 'settings.uiScale',
    tipKey: 'settings.uiScaleTip',
    min: UI_SCALE.min,
    max: UI_SCALE.max,
    step: UI_SCALE.step,
    decimals: 2,
    value: app.settings.uiScale,
    onInput: (value) => document.documentElement.style.setProperty('--ui-scale', String(value)),
    onCommit: (value) => app.saveSettings({ uiScale: value }),
  });

  const languageSelect = createSelect({
    i18n,
    labelKey: 'settings.language',
    tipKey: 'settings.languageTip',
    options: app.locales.map((locale) => ({
      value: locale.code,
      label: `${locale.nativeName} — ${locale.name}`,
    })),
    value: app.settings.locale,
    onChange: (value) => app.setLocale(value),
  });

  const startupToggle = createToggle({
    i18n,
    labelKey: 'settings.startWithWindows',
    tipKey: 'settings.startWithWindowsTip',
    checked: app.settings.startWithWindows,
    onChange: async (checked) => {
      const applied = await app.setStartWithWindows(checked);
      startupToggle.set(applied);
    },
  });

  const autoSaveToggle = createToggle({
    i18n,
    labelKey: 'settings.autoSave',
    tipKey: 'settings.autoSaveTip',
    checked: app.settings.autoSave,
    onChange: (checked) => app.saveSettings({ autoSave: checked }, { notify: true }),
  });

  const aboutList = h('dl', { class: 'about' });
  const shortcutList = h('div', { class: 'shortcut-list' });

  const element = h(
    'div',
    { class: 'page__inner page__inner--settings' },
    h('header', { class: 'page-head' },
      h('div', null,
        h('h2', { class: 'page-head__title', i18n: 'settings.title' }, i18n.t('settings.title')))),

    settingsCard('settings.appearance', 'palette', [
      themeControl.element,
      labelledBlock('settings.accent', 'settings.accentTip', accentRow),
      animationsToggle.element,
      scaleSlider.element,
    ]),

    settingsCard('settings.languageSection', 'globe', [
      languageSelect.element,
      h('p', { class: 'settings__hint', i18n: 'settings.languageTip' }, i18n.t('settings.languageTip')),
    ]),

    settingsCard('settings.application', 'settings', [
      startupToggle.element,
      autoSaveToggle.element,
      h('div', { class: 'settings__row' },
        h('button', {
          type: 'button', class: 'btn btn--ghost', 'data-tip': 'settings.resetSettingsTip',
          onClick: () => app.resetSettings(),
        }, icon('reset', { size: 16 }),
        h('span', { i18n: 'settings.resetSettings' }, i18n.t('settings.resetSettings'))),
        h('button', {
          type: 'button', class: 'btn btn--danger', 'data-tip': 'settings.clearDataTip',
          onClick: () => app.clearAllData(),
        }, icon('trash', { size: 16 }),
        h('span', { i18n: 'settings.clearData' }, i18n.t('settings.clearData')))),
    ]),

    settingsCard('shortcuts.title', 'keyboard', [shortcutList]),

    settingsCard('settings.about', 'info', [
      aboutList,
      h('div', { class: 'settings__row' },
        h('button', {
          type: 'button', class: 'btn btn--ghost', onClick: () => app.openExternal(REPOSITORY_URL),
        }, icon('external', { size: 16 }),
        h('span', { i18n: 'settings.repository' }, i18n.t('settings.repository'))),
        h('button', {
          type: 'button', class: 'btn btn--ghost', onClick: () => app.openExternal(LICENSE_URL),
        }, icon('info', { size: 16 }),
        h('span', { i18n: 'settings.license' }, i18n.t('settings.license'))),
        app.hasHost
          ? h('button', {
            type: 'button',
            class: 'btn btn--ghost',
            onClick: () => app.bridge.call('openDataFolder', {}).catch(() => {}),
          }, icon('folder', { size: 16 }),
          h('span', { i18n: 'settings.openDataFolder' }, i18n.t('settings.openDataFolder')))
          : null),
    ]),
  );

  function settingsCard(titleKey, iconName, children) {
    return h('section', { class: 'settings-card' },
      h('header', { class: 'settings-card__head' },
        h('span', { class: 'settings-card__icon' }, icon(iconName, { size: 16 })),
        h('h3', { class: 'settings-card__title', i18n: titleKey }, i18n.t(titleKey))),
      h('div', { class: 'settings-card__body' }, ...children));
  }

  function labelledBlock(labelKey, tipKey, content) {
    return h('div', { class: 'field-block', dataset: { tip: tipKey } },
      h('p', { class: 'field-block__label', i18n: labelKey }, i18n.t(labelKey)),
      content);
  }

  function renderAbout() {
    clear(aboutList);
    const rows = [
      ['settings.version', `ReticleX ${app.appVersion}`],
      ['settings.coreVersion', `WebAssembly · ABI ${app.core.abiVersion} · schema ${app.core.schemaVersion}`],
      ['settings.runtime', app.hasHost ? i18n.t('settings.runtimeDesktop') : i18n.t('settings.runtimeBrowser')],
      ['settings.dataFolder', app.dataPath || '—'],
      ['settings.credits', i18n.t('settings.creditsBody')],
    ];
    for (const [key, value] of rows) {
      aboutList.append(
        h('dt', { i18n: key }, i18n.t(key)),
        h('dd', null, value),
      );
    }
  }

  function renderShortcuts() {
    clear(shortcutList);
    for (const shortcut of SHORTCUTS) {
      shortcutList.append(h('div', { class: 'shortcut-row' },
        h('span', { class: 'shortcut-row__label', i18n: shortcut.labelKey }, i18n.t(shortcut.labelKey)),
        h('kbd', { class: 'shortcut-row__keys' }, shortcut.display)));
    }
  }

  return {
    element,
    onEnter() {
      themeControl.set(app.settings.theme);
      animationsToggle.set(app.settings.animations);
      autoSaveToggle.set(app.settings.autoSave);
      startupToggle.set(app.settings.startWithWindows);
      scaleSlider.set(app.settings.uiScale);
      languageSelect.set(app.settings.locale);
      markAccent();
      renderAbout();
      renderShortcuts();
    },
  };
}

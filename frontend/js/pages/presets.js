/**
 * Presets: the shipped library plus everything the user has promoted.
 *
 * Search, filter and sort all run against the in-memory collection, which is
 * small enough that re-rendering the grid is cheaper and far simpler than
 * diffing it. Cards animate out before the collection is re-read so a delete
 * does not simply blink.
 */

import { h, clear } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { createCrosshairCard, createEmptyState } from '../ui/cards.js';
import { createSegmented, createSelect } from '../ui/controls.js';
import { debounce } from '../core/util.js';

const REMOVE_MS = 200;

export function createPresetsPage(app) {
  const { i18n } = app;

  let query = '';
  let filter = 'all';
  let sort = 'name';

  const grid = h('div', { class: 'grid grid--cards' });
  const countLabel = h('span', { class: 'presets__count' });

  const searchInput = h('input', {
    class: 'search__input',
    type: 'search',
    autocomplete: 'off',
    spellcheck: 'false',
  });
  searchInput.placeholder = i18n.t('presets.searchPlaceholder');
  searchInput.dataset.i18nAttr = 'placeholder:presets.searchPlaceholder';

  const runSearch = debounce(() => {
    query = searchInput.value;
    render();
  }, 140);
  searchInput.addEventListener('input', runSearch);
  searchInput.addEventListener('search', () => {
    query = searchInput.value;
    render();
  });

  const filterControl = createSegmented({
    i18n,
    labelKey: 'presets.filterAll',
    compact: true,
    options: [
      { value: 'all', labelKey: 'presets.filterAll' },
      { value: 'builtIn', labelKey: 'presets.filterBuiltIn' },
      { value: 'custom', labelKey: 'presets.filterCustom' },
    ],
    value: 'all',
    onChange: (value) => {
      filter = value;
      render();
    },
  });

  const sortControl = createSelect({
    i18n,
    labelKey: 'presets.sortLabel',
    options: [
      { value: 'name', label: i18n.t('presets.sortName') },
      { value: 'recent', label: i18n.t('presets.sortRecent') },
    ],
    value: 'name',
    onChange: (value) => {
      sort = value;
      render();
    },
  });

  const toolbar = h(
    'div',
    { class: 'presets__toolbar' },
    h('div', { class: 'search' }, icon('search', { size: 16, className: 'search__icon' }), searchInput),
    filterControl.element,
    sortControl.element,
    h('div', { class: 'presets__actions' },
      h('button', {
        type: 'button', class: 'btn btn--soft', onClick: () => app.savePresetFromCurrent(),
      }, icon('plus', { size: 16 }),
      h('span', { i18n: 'presets.createFromCurrent' }, i18n.t('presets.createFromCurrent'))),
      h('button', {
        type: 'button', class: 'btn btn--ghost', 'data-tip': 'presets.importPack', onClick: () => app.run('import'),
      }, icon('import', { size: 16 }),
      h('span', { i18n: 'presets.importPack' }, i18n.t('presets.importPack'))),
      h('button', {
        type: 'button',
        class: 'btn btn--ghost',
        'data-tip': 'presets.exportAll',
        onClick: () => app.exportPresets(visiblePresets()),
      }, icon('export', { size: 16 }),
      h('span', { i18n: 'presets.exportAll' }, i18n.t('presets.exportAll')))),
  );

  const element = h(
    'div',
    { class: 'page__inner' },
    h('header', { class: 'page-head' },
      h('div', null,
        h('h2', { class: 'page-head__title', i18n: 'presets.title' }, i18n.t('presets.title')),
        h('p', { class: 'page-head__subtitle', i18n: 'presets.subtitle' }, i18n.t('presets.subtitle'))),
      countLabel),
    toolbar,
    grid,
  );

  function visiblePresets() {
    return app.library.searchPresets({
      query,
      filter,
      sort,
      nameFor: (preset) => app.presetName(preset),
    });
  }

  /** Fades a card out before the collection re-renders, so deletes read well. */
  async function removeWithAnimation(id, action) {
    const card = grid.querySelector(`.card[data-id="${CSS.escape(id)}"]`);
    if (card) card.classList.add('card--leaving');
    await new Promise((resolve) => setTimeout(resolve, card ? REMOVE_MS : 0));
    await action();
  }

  function render() {
    const presets = visiblePresets();
    countLabel.textContent = presets.length === 1
      ? i18n.t('presets.countOne')
      : i18n.t('presets.count', { count: presets.length });

    clear(grid);
    if (presets.length === 0) {
      grid.append(createEmptyState({
        i18n,
        titleKey: 'presets.empty',
        bodyKey: 'presets.emptyBody',
        iconName: 'presets',
        action: {
          labelKey: 'presets.createFromCurrent',
          onSelect: () => app.savePresetFromCurrent(),
        },
      }));
      return;
    }

    for (const preset of presets) {
      const actions = [
        { icon: 'copy', tipKey: 'common.duplicate', onSelect: () => app.duplicatePreset(preset.id) },
        { icon: 'export', tipKey: 'common.export', onSelect: () => app.exportPresets([preset]) },
      ];
      if (!preset.builtIn) {
        actions.unshift({
          icon: 'edit', tipKey: 'common.rename', onSelect: () => app.renamePreset(preset.id),
        });
        actions.push({
          icon: 'trash',
          tipKey: 'common.delete',
          danger: true,
          onSelect: () => removeWithAnimation(preset.id, () => app.deletePreset(preset.id)),
        });
      }

      grid.append(createCrosshairCard({
        app,
        doc: preset,
        title: app.presetName(preset),
        subtitle: app.presetDescription(preset),
        badge: preset.builtIn ? i18n.t('presets.builtIn') : null,
        accent: preset.accent,
        primary: { labelKey: 'common.apply', onSelect: () => app.applyPreset(preset.id) },
        onOpen: () => app.applyPreset(preset.id),
        actions,
      }));
    }
  }

  return {
    element,
    onEnter() {
      // Option labels are built from strings, so they need rebuilding when the
      // language changes rather than a data-i18n sweep.
      sortControl.setOptions([
        { value: 'name', label: i18n.t('presets.sortName') },
        { value: 'recent', label: i18n.t('presets.sortRecent') },
      ], sort);
      render();
    },
  };
}

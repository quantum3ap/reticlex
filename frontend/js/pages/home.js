/**
 * Home: a dashboard rather than a splash screen.
 *
 * Everything here is a shortcut into real work — the hero starts a new
 * crosshair, the cards reopen recent ones, and the quick actions cover the
 * four things people do most often after launching.
 */

import { h, clear } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { createCrosshairCard, createEmptyState, sectionHeader } from '../ui/cards.js';
import { renderThumbnail } from '../render/renderer.js';

export function createHomePage(app) {
  const { i18n } = app;

  const heroCanvas = h('canvas', { class: 'hero__canvas', 'aria-hidden': 'true' });
  const recentGrid = h('div', { class: 'grid grid--cards' });
  const statsRow = h('div', { class: 'stats' });

  const hero = h(
    'section',
    { class: 'hero' },
    h('div', { class: 'hero__content' },
      h('span', { class: 'hero__eyebrow' },
        icon('sparkle', { size: 14 }),
        h('span', { i18n: 'app.tagline' }, i18n.t('app.tagline'))),
      h('h2', { class: 'hero__title', i18n: 'home.welcomeTitle' }, i18n.t('home.welcomeTitle')),
      h('p', { class: 'hero__body', i18n: 'home.welcomeBody' }, i18n.t('home.welcomeBody')),
      h('div', { class: 'hero__actions' },
        h('button', {
          type: 'button',
          class: 'btn btn--primary btn--lg',
          onClick: () => app.newCrosshair(),
        }, icon('plus', { size: 18 }), h('span', { i18n: 'home.createButton' }, i18n.t('home.createButton'))),
        h('button', {
          type: 'button',
          class: 'btn btn--ghost btn--lg',
          onClick: () => app.router.navigate('presets'),
        }, icon('presets', { size: 18 }), h('span', { i18n: 'home.quickPresets' }, i18n.t('home.quickPresets')))),
      statsRow),
    h('div', { class: 'hero__stage' }, h('div', { class: 'hero__glow', 'aria-hidden': 'true' }), heroCanvas),
  );

  const quickActions = h('div', { class: 'quick' },
    quickAction('plus', 'home.quickNew', 'home.quickNewBody', () => app.newCrosshair()),
    quickAction('dice', 'home.quickRandom', 'home.quickRandomBody', () => {
      app.router.navigate('randomizer', { generate: true });
    }),
    quickAction('presets', 'home.quickPresets', 'home.quickPresetsBody', () => app.router.navigate('presets')),
    quickAction('import', 'home.quickImport', 'home.quickImportBody', () => app.run('import')));

  const element = h(
    'div',
    { class: 'page__inner page__inner--home' },
    hero,
    h('section', { class: 'section' },
      sectionHeader({
        i18n,
        titleKey: 'home.quickActions',
      }),
      quickActions),
    h('section', { class: 'section' },
      sectionHeader({
        i18n,
        titleKey: 'home.recentTitle',
        subtitleKey: 'home.recentSubtitle',
      }),
      recentGrid),
  );

  function quickAction(iconName, titleKey, bodyKey, onSelect) {
    return h('button', { type: 'button', class: 'quick__item', onClick: onSelect },
      h('span', { class: 'quick__icon' }, icon(iconName, { size: 18 })),
      h('span', { class: 'quick__text' },
        h('span', { class: 'quick__title', i18n: titleKey }, i18n.t(titleKey)),
        h('span', { class: 'quick__body', i18n: bodyKey }, i18n.t(bodyKey))),
      icon('chevronRight', { size: 16, className: 'quick__chevron' }));
  }

  function renderStats() {
    const crosshairs = app.library.crosshairs;
    const presets = app.library.presets;
    const latest = crosshairs.length
      ? crosshairs.reduce((a, b) => (a.updatedAt > b.updatedAt ? a : b))
      : null;

    clear(statsRow);
    statsRow.append(
      stat(String(crosshairs.length), 'home.statCrosshairs'),
      stat(String(presets.length), 'home.statPresets'),
      stat(latest ? i18n.relativeDate(latest.updatedAt) : i18n.t('common.never'), 'home.statEdited'),
    );
  }

  function stat(value, labelKey) {
    return h('div', { class: 'stats__item' },
      h('span', { class: 'stats__value' }, value),
      h('span', { class: 'stats__label', i18n: labelKey }, i18n.t(labelKey)));
  }

  function renderRecent() {
    const recent = app.library.recentCrosshairs(8);
    clear(recentGrid);
    if (recent.length === 0) {
      recentGrid.append(createEmptyState({
        i18n,
        titleKey: 'home.recentEmpty',
        bodyKey: 'home.recentEmptyBody',
        iconName: 'designer',
        action: { labelKey: 'home.createButton', onSelect: () => app.newCrosshair() },
      }));
      return;
    }
    for (const doc of recent) {
      recentGrid.append(createCrosshairCard({
        app,
        doc,
        title: doc.name,
        subtitle: i18n.t('home.modified', { date: i18n.relativeDate(doc.updatedAt) }),
        onOpen: () => app.openDocument(doc.id),
        primary: { labelKey: 'common.edit', onSelect: () => app.openDocument(doc.id) },
        actions: [
          { icon: 'copy', tipKey: 'common.duplicate', onSelect: () => app.duplicateCrosshair(doc.id) },
          { icon: 'export', tipKey: 'common.export', onSelect: () => app.exportDocument(doc) },
          { icon: 'trash', tipKey: 'common.delete', danger: true, onSelect: () => app.deleteCrosshair(doc.id) },
        ],
      }));
    }
  }

  return {
    element,
    onEnter() {
      renderStats();
      renderRecent();
      // The page is un-hidden in this same task, so the canvas has no box to
      // measure until the next frame.
      requestAnimationFrame(() => renderThumbnail(heroCanvas, app.core, app.session.config, 260));
    },
  };
}

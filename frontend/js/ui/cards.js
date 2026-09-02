/**
 * Crosshair cards used on Home and Presets.
 *
 * A card owns a small canvas thumbnail rendered from the same geometry as the
 * live preview, so what a card shows and what the designer shows can never
 * drift. Cards are cheap to build and are rebuilt on every render rather than
 * diffed; the collections are small and the code stays obvious.
 */

import { h } from './dom.js';
import { icon } from './icons.js';
import { renderThumbnail } from '../render/renderer.js';

/**
 * @param {{app:object, doc:object, title:string, subtitle?:string,
 *          badge?:string, accent?:string, actions:Array,
 *          primary?:{labelKey:string, onSelect:Function},
 *          onOpen?:Function}} options
 */
export function createCrosshairCard({
  app, doc, title, subtitle = '', badge = null, accent = null,
  actions = [], primary = null, onOpen = null,
}) {
  const canvas = h('canvas', { class: 'card__canvas', 'aria-hidden': 'true' });

  const actionButtons = actions.map((action) => h(
    'button',
    {
      type: 'button',
      class: ['icon-btn', 'icon-btn--sm', action.danger ? 'icon-btn--danger' : null],
      'data-tip': action.tipKey,
      'aria-label': app.i18n.t(action.tipKey),
      onClick: (event) => {
        event.stopPropagation();
        action.onSelect(doc);
      },
    },
    icon(action.icon, { size: 15 }),
  ));

  const card = h(
    'article',
    {
      class: 'card',
      dataset: { id: doc.id },
      style: accent ? { '--card-accent': accent } : undefined,
      tabindex: onOpen ? '0' : null,
      role: onOpen ? 'button' : null,
      onClick: onOpen ? () => onOpen(doc) : null,
      onKeydown: onOpen
        ? (event) => {
          if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          onOpen(doc);
        }
        : null,
    },
    h('div', { class: 'card__preview' },
      canvas,
      badge ? h('span', { class: 'card__badge' }, badge) : null),
    h('div', { class: 'card__body' },
      h('h3', { class: 'card__title', title }, title),
      subtitle ? h('p', { class: 'card__subtitle' }, subtitle) : null),
    h('footer', { class: 'card__foot' },
      primary
        ? h('button', {
          type: 'button',
          class: 'btn btn--soft btn--sm',
          onClick: (event) => {
            event.stopPropagation();
            primary.onSelect(doc);
          },
        }, app.i18n.t(primary.labelKey))
        : h('span', { class: 'card__spacer' }),
      h('div', { class: 'card__actions' }, ...actionButtons)),
  );

  // The canvas has no layout until the card is in the document.
  requestAnimationFrame(() => renderThumbnail(canvas, app.core, doc.config, 132));

  return card;
}

/** Placeholder shown when a collection is empty. */
export function createEmptyState({ i18n, titleKey, bodyKey, iconName = 'sparkle', action = null }) {
  return h(
    'div',
    { class: 'empty' },
    h('span', { class: 'empty__icon' }, icon(iconName, { size: 26 })),
    h('h3', { class: 'empty__title', i18n: titleKey }, i18n.t(titleKey)),
    h('p', { class: 'empty__body', i18n: bodyKey }, i18n.t(bodyKey)),
    action
      ? h('button', { type: 'button', class: 'btn btn--primary', onClick: action.onSelect },
        icon(action.icon ?? 'plus', { size: 16 }),
        h('span', { i18n: action.labelKey }, i18n.t(action.labelKey)))
      : null,
  );
}

/** Section header with an optional trailing control. */
export function sectionHeader({ i18n, titleKey, subtitleKey, trailing = null }) {
  return h(
    'header',
    { class: 'section__head' },
    h('div', null,
      h('h2', { class: 'section__title', i18n: titleKey }, i18n.t(titleKey)),
      subtitleKey
        ? h('p', { class: 'section__subtitle', i18n: subtitleKey }, i18n.t(subtitleKey))
        : null),
    trailing,
  );
}

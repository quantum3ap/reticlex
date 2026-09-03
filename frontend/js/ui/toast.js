/**
 * Toast notifications.
 *
 * Toasts slide in from the trailing edge, hold, then fade out. The stack is
 * capped so a burst of imports cannot bury the interface, and identical
 * messages fired in quick succession are merged into a counter rather than
 * repeated.
 */

import { h, clear } from './dom.js';
import { icon } from './icons.js';

const DEFAULT_DURATION = 3600;
const MAX_VISIBLE = 4;
const EXIT_MS = 260;

const TYPE_ICON = {
  success: 'check',
  error: 'warning',
  warning: 'warning',
  info: 'info',
};

export class Toasts {
  #container;
  #items = new Map();
  #counter = 0;

  constructor(container, i18n) {
    this.#container = container;
    this.i18n = i18n;
    this.#container.setAttribute('role', 'status');
    this.#container.setAttribute('aria-live', 'polite');
  }

  /**
   * @param {{messageKey?:string, message?:string, params?:object,
   *          type?:'success'|'error'|'warning'|'info', duration?:number,
   *          detail?:string}} options
   */
  show(options) {
    const {
      messageKey, message, params, type = 'info',
      duration = DEFAULT_DURATION, detail = '',
    } = options;

    const text = messageKey ? this.i18n.t(messageKey, params) : String(message ?? '');
    if (!text) return null;

    // Merge a repeat of the message currently on top into a count badge.
    const existing = [...this.#items.values()].find((item) => item.text === text && item.type === type);
    if (existing) {
      existing.count += 1;
      existing.countNode.textContent = `×${existing.count}`;
      existing.countNode.hidden = false;
      this.#restartTimer(existing, duration);
      existing.element.classList.remove('toast--pulse');
      void existing.element.offsetWidth;   // restart the pulse animation
      existing.element.classList.add('toast--pulse');
      return existing.id;
    }

    const id = ++this.#counter;
    const countNode = h('span', { class: 'toast__count', hidden: true });
    const element = h(
      'div',
      { class: ['toast', `toast--${type}`], role: type === 'error' ? 'alert' : undefined },
      h('span', { class: 'toast__icon' }, icon(TYPE_ICON[type] ?? 'info', { size: 18 })),
      h(
        'div',
        { class: 'toast__body' },
        h('p', { class: 'toast__text' }, text),
        detail ? h('p', { class: 'toast__detail' }, detail) : null,
      ),
      countNode,
      h(
        'button',
        {
          class: 'toast__close',
          type: 'button',
          i18nAttr: 'aria-label:a11y.dismissToast',
          'aria-label': this.i18n.t('a11y.dismissToast'),
          onClick: () => this.dismiss(id),
        },
        icon('close', { size: 14 }),
      ),
    );

    const item = { id, element, text, type, count: 1, countNode, timer: null };
    this.#items.set(id, item);
    this.#container.append(element);

    // Force a frame so the entry transition actually runs.
    requestAnimationFrame(() => element.classList.add('toast--visible'));

    this.#restartTimer(item, duration);
    this.#trim();
    return id;
  }

  success(messageKey, params) { return this.show({ messageKey, params, type: 'success' }); }
  error(messageKey, params, detail) {
    return this.show({ messageKey, params, type: 'error', duration: 5200, detail });
  }
  warning(messageKey, params) { return this.show({ messageKey, params, type: 'warning', duration: 4600 }); }
  info(messageKey, params) { return this.show({ messageKey, params, type: 'info' }); }

  dismiss(id) {
    const item = this.#items.get(id);
    if (!item) return;
    this.#items.delete(id);
    if (item.timer) clearTimeout(item.timer);
    item.element.classList.remove('toast--visible');
    item.element.classList.add('toast--leaving');
    setTimeout(() => item.element.remove(), EXIT_MS);
  }

  clear() {
    for (const id of [...this.#items.keys()]) this.dismiss(id);
    clear(this.#container);
  }

  #restartTimer(item, duration) {
    if (item.timer) clearTimeout(item.timer);
    if (duration <= 0) return;
    item.timer = setTimeout(() => this.dismiss(item.id), duration);
  }

  #trim() {
    const ids = [...this.#items.keys()];
    while (ids.length > MAX_VISIBLE) this.dismiss(ids.shift());
  }
}

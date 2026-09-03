/**
 * Tooltips.
 *
 * One floating element is shared by every trigger, positioned on demand. A
 * control opts in with data-tip="<translation key>"; the text is resolved at
 * show time so switching language never leaves a stale tooltip behind.
 * Tooltips appear on hover after a short delay and immediately on focus, which
 * keeps them out of the way while dragging a slider.
 */

import { h } from './dom.js';

const SHOW_DELAY = 420;
const EDGE_PADDING = 10;

export class Tooltips {
  #element;
  #timer = null;
  #current = null;

  constructor(i18n, root = document.body) {
    this.i18n = i18n;
    this.#element = h('div', { class: 'tooltip', role: 'tooltip', 'aria-hidden': 'true' });
    root.append(this.#element);

    document.addEventListener('pointerover', (event) => this.#onPointerOver(event));
    document.addEventListener('pointerout', (event) => this.#onPointerOut(event));
    document.addEventListener('focusin', (event) => this.#onFocusIn(event));
    document.addEventListener('focusout', () => this.hide());
    // Any of these can move the anchor out from under the tooltip.
    document.addEventListener('pointerdown', () => this.hide(), true);
    window.addEventListener('scroll', () => this.hide(), true);
    window.addEventListener('resize', () => this.hide());
  }

  #trigger(target) {
    if (!(target instanceof Element)) return null;
    return target.closest('[data-tip]');
  }

  #onPointerOver(event) {
    const trigger = this.#trigger(event.target);
    if (!trigger || trigger === this.#current) return;
    this.#schedule(trigger);
  }

  #onPointerOut(event) {
    const trigger = this.#trigger(event.target);
    if (!trigger) return;
    if (event.relatedTarget instanceof Node && trigger.contains(event.relatedTarget)) return;
    this.hide();
  }

  #onFocusIn(event) {
    const trigger = this.#trigger(event.target);
    if (!trigger) {
      this.hide();
      return;
    }
    this.#show(trigger);
  }

  #schedule(trigger) {
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = setTimeout(() => this.#show(trigger), SHOW_DELAY);
  }

  #show(trigger) {
    const key = trigger.dataset.tip;
    if (!key) return;
    const text = trigger.dataset.tipRaw === 'true' ? key : this.i18n.t(key);
    if (!text) return;

    this.#current = trigger;
    this.#element.textContent = text;
    this.#element.setAttribute('aria-hidden', 'false');
    this.#element.classList.add('tooltip--visible');
    this.#position(trigger);
  }

  #position(trigger) {
    const anchor = trigger.getBoundingClientRect();
    // Measure after the text is set but before the transform settles.
    const tip = this.#element.getBoundingClientRect();

    let top = anchor.top - tip.height - 10;
    let placement = 'top';
    if (top < EDGE_PADDING) {
      top = anchor.bottom + 10;
      placement = 'bottom';
    }

    let left = anchor.left + anchor.width / 2 - tip.width / 2;
    left = Math.min(
      Math.max(left, EDGE_PADDING),
      window.innerWidth - tip.width - EDGE_PADDING,
    );

    this.#element.dataset.placement = placement;
    this.#element.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
  }

  hide() {
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
    this.#current = null;
    this.#element.classList.remove('tooltip--visible');
    this.#element.setAttribute('aria-hidden', 'true');
  }
}

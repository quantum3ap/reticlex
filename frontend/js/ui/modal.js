/**
 * Modal dialogs.
 *
 * Everything destructive routes through here, so the dialog handles the parts
 * that are easy to get wrong: focus is trapped while open, Escape and the
 * backdrop both cancel, focus returns to whatever opened the dialog, and the
 * promise always settles exactly once.
 */

import { h, focusFirst, trapFocus } from './dom.js';
import { icon } from './icons.js';

const EXIT_MS = 200;

export class Modals {
  #root;
  #active = null;

  constructor(root, i18n) {
    this.#root = root;
    this.i18n = i18n;
  }

  get isOpen() { return this.#active !== null; }

  /**
   * Opens a dialog and resolves with whatever `close(value)` is called with,
   * or null when cancelled.
   *
   * @param {{title:string, body?:Node|string, actions:Array,
   *          size?:'sm'|'md', onMount?:(root:HTMLElement, close:Function)=>void}} options
   */
  open({ title, body = null, actions = [], size = 'sm', onMount }) {
    this.close(null);

    return new Promise((resolve) => {
      const opener = document.activeElement;
      let settled = false;

      const finish = (value) => {
        if (settled) return;
        settled = true;
        detachFocus();
        document.removeEventListener('keydown', onKeyDown, true);
        overlay.classList.remove('modal-overlay--visible');
        dialog.classList.add('modal--leaving');
        setTimeout(() => {
          overlay.remove();
          if (opener instanceof HTMLElement && document.contains(opener)) opener.focus();
        }, EXIT_MS);
        this.#active = null;
        resolve(value);
      };

      const buttons = actions.map((action) => h(
        'button',
        {
          type: 'button',
          class: ['btn', `btn--${action.variant ?? 'ghost'}`],
          onClick: () => {
            const result = action.onSelect ? action.onSelect() : action.value ?? null;
            // An action may veto closing by returning the symbol below.
            if (result === Modals.KEEP_OPEN) return;
            finish(result);
          },
        },
        action.icon ? icon(action.icon, { size: 16 }) : null,
        h('span', null, action.label),
      ));

      const dialog = h(
        'div',
        {
          class: ['modal', `modal--${size}`],
          role: 'dialog',
          'aria-modal': 'true',
          'aria-label': title,
        },
        h(
          'header',
          { class: 'modal__head' },
          h('h2', { class: 'modal__title' }, title),
          h(
            'button',
            {
              type: 'button',
              class: 'modal__close',
              'aria-label': this.i18n.t('a11y.closeDialog'),
              onClick: () => finish(null),
            },
            icon('close', { size: 16 }),
          ),
        ),
        body ? h('div', { class: 'modal__body' }, body) : null,
        buttons.length ? h('footer', { class: 'modal__foot' }, buttons) : null,
      );

      const overlay = h(
        'div',
        {
          class: 'modal-overlay',
          onPointerDown: (event) => {
            if (event.target === overlay) finish(null);
          },
        },
        dialog,
      );

      const onKeyDown = (event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          finish(null);
        }
      };

      this.#root.append(overlay);
      const detachFocus = trapFocus(dialog);
      document.addEventListener('keydown', onKeyDown, true);

      requestAnimationFrame(() => overlay.classList.add('modal-overlay--visible'));

      this.#active = { finish };
      onMount?.(dialog, finish);
      if (!focusFirst(dialog.querySelector('.modal__body') ?? dialog)) {
        buttons[buttons.length - 1]?.focus();
      }
    });
  }

  close(value = null) {
    this.#active?.finish(value);
  }

  /** Yes/no confirmation. Resolves true only when confirmed. */
  async confirm({ title, body, confirmLabel, variant = 'danger' }) {
    const result = await this.open({
      title,
      body: body ? h('p', { class: 'modal__text' }, body) : null,
      actions: [
        { label: this.i18n.t('common.cancel'), value: false, variant: 'ghost' },
        { label: confirmLabel ?? this.i18n.t('common.confirm'), value: true, variant },
      ],
    });
    return result === true;
  }

  /**
   * Single-line (or line + description) text entry.
   * Resolves {name, description} or null.
   */
  async prompt({ title, label, value = '', description, descriptionLabel, placeholder, confirmLabel }) {
    const nameInput = h('input', {
      class: 'field__input',
      type: 'text',
      maxlength: '80',
      value,
      placeholder: placeholder ?? '',
      autocomplete: 'off',
      spellcheck: 'false',
    });
    const descriptionInput = descriptionLabel
      ? h('textarea', {
        class: 'field__input field__input--area',
        rows: '3',
        maxlength: '240',
        placeholder: this.i18n.t('dialog.descriptionPlaceholder'),
      })
      : null;
    if (descriptionInput) descriptionInput.value = description ?? '';

    const body = h(
      'div',
      { class: 'stack' },
      h('label', { class: 'field' },
        h('span', { class: 'field__label' }, label),
        nameInput),
      descriptionInput
        ? h('label', { class: 'field' },
          h('span', { class: 'field__label' }, descriptionLabel),
          descriptionInput)
        : null,
    );

    const read = () => {
      const name = nameInput.value.trim();
      if (!name) {
        nameInput.classList.add('field__input--invalid');
        nameInput.focus();
        return Modals.KEEP_OPEN;
      }
      return { name, description: descriptionInput?.value.trim() ?? '' };
    };

    return this.open({
      title,
      body,
      actions: [
        { label: this.i18n.t('common.cancel'), value: null, variant: 'ghost' },
        { label: confirmLabel ?? this.i18n.t('common.save'), variant: 'primary', onSelect: read },
      ],
      onMount: (dialog, close) => {
        nameInput.addEventListener('input', () => nameInput.classList.remove('field__input--invalid'));
        nameInput.addEventListener('keydown', (event) => {
          if (event.key !== 'Enter') return;
          event.preventDefault();
          const result = read();
          if (result !== Modals.KEEP_OPEN) close(result);
        });
        requestAnimationFrame(() => {
          nameInput.focus();
          nameInput.select();
        });
      },
    });
  }

  /** Presents arbitrary content with a single dismiss button. */
  info({ title, body }) {
    return this.open({
      title,
      body,
      size: 'md',
      actions: [{ label: this.i18n.t('common.close'), value: null, variant: 'primary' }],
    });
  }
}

/** Returned by an action's onSelect to keep the dialog open (validation). */
Modals.KEEP_OPEN = Symbol('keep-open');

/**
 * Reusable form controls.
 *
 * The sliders and toggles are built on native input elements and then styled
 * out of recognition. That keeps keyboard support, screen-reader semantics and
 * pointer capture working exactly as users expect, while the visuals live
 * entirely in CSS. Every control returns an object with a `set` method so the
 * designer can push state back in after an undo without re-rendering the page.
 */

import { h } from './dom.js';
import { icon } from './icons.js';

let sequence = 0;
const uid = (prefix) => `${prefix}-${++sequence}`;

/**
 * Slider with an editable numeric read-out.
 *
 * onInput fires continuously while dragging (the preview follows it);
 * onCommit fires once the interaction ends, which is where an undo entry is
 * recorded so a drag becomes one history step rather than sixty.
 */
export function createSlider({
  labelKey, tipKey, min, max, step = 1, decimals = 0, unitKey = null,
  value = 0, onInput, onCommit, i18n,
}) {
  const id = uid('slider');
  const range = h('input', {
    id,
    class: 'slider__range',
    type: 'range',
    min: String(min),
    max: String(max),
    step: String(step),
    value: String(value),
  });

  const number = h('input', {
    class: 'slider__number',
    type: 'number',
    min: String(min),
    max: String(max),
    step: String(step),
    value: format(value, decimals),
    'aria-label': i18n.t(labelKey),
    inputmode: 'decimal',
  });

  const label = h('label', { class: 'slider__label', for: id, i18n: labelKey }, i18n.t(labelKey));
  const unit = unitKey
    ? h('span', { class: 'slider__unit', i18n: unitKey }, i18n.t(unitKey))
    : null;

  const element = h(
    'div',
    { class: 'slider', dataset: tipKey ? { tip: tipKey } : undefined },
    h('div', { class: 'slider__head' }, label, h('div', { class: 'slider__value' }, number, unit)),
    h('div', { class: 'slider__track' }, range, h('span', { class: 'slider__fill' })),
  );
  if (tipKey) element.dataset.tip = tipKey;

  const paint = (next) => {
    const ratio = max === min ? 0 : (next - min) / (max - min);
    element.style.setProperty('--fill', `${Math.round(ratio * 1000) / 10}%`);
  };

  const apply = (next, { fromNumber = false, commit = false } = {}) => {
    const clamped = clampStep(next, min, max, step);
    if (!fromNumber) number.value = format(clamped, decimals);
    range.value = String(clamped);
    paint(clamped);
    onInput?.(clamped);
    if (commit) onCommit?.(clamped);
    return clamped;
  };

  range.addEventListener('input', () => apply(Number(range.value)));
  range.addEventListener('change', () => apply(Number(range.value), { commit: true }));
  // A keyboard arrow fires input but not always change in every engine.
  range.addEventListener('keyup', () => onCommit?.(Number(range.value)));
  range.addEventListener('pointerup', () => onCommit?.(Number(range.value)));

  number.addEventListener('input', () => {
    const parsed = Number(number.value);
    if (!Number.isFinite(parsed)) return;
    apply(parsed, { fromNumber: true });
  });
  number.addEventListener('change', () => {
    const parsed = Number(number.value);
    apply(Number.isFinite(parsed) ? parsed : Number(range.value), { commit: true });
  });
  number.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    number.blur();
  });

  paint(value);

  return {
    element,
    /** Updates the control without firing callbacks. */
    set(next) {
      const clamped = clampStep(next, min, max, step);
      range.value = String(clamped);
      if (document.activeElement !== number) number.value = format(clamped, decimals);
      paint(clamped);
    },
    setDisabled(disabled) {
      range.disabled = disabled;
      number.disabled = disabled;
      element.classList.toggle('is-disabled', disabled);
    },
  };
}

/** Animated on/off switch. */
export function createToggle({ labelKey, tipKey, checked = false, onChange, i18n, description }) {
  const id = uid('toggle');
  const input = h('input', { id, class: 'toggle__input', type: 'checkbox', checked });
  const element = h(
    'div',
    { class: 'toggle' },
    h(
      'label',
      { class: 'toggle__label', for: id },
      h('span', { class: 'toggle__text' },
        h('span', { class: 'toggle__title', i18n: labelKey }, i18n.t(labelKey)),
        description ? h('span', { class: 'toggle__description', i18n: description }, i18n.t(description)) : null),
      input,
      h('span', { class: 'toggle__switch', 'aria-hidden': 'true' }, h('span', { class: 'toggle__knob' })),
    ),
  );
  if (tipKey) element.dataset.tip = tipKey;

  input.addEventListener('change', () => onChange?.(input.checked));

  return {
    element,
    set(next) { input.checked = Boolean(next); },
    setDisabled(disabled) {
      input.disabled = disabled;
      element.classList.toggle('is-disabled', disabled);
    },
  };
}

/**
 * Segmented control with a sliding indicator.
 * @param {{options:{value:*, labelKey:string, icon?:string}[]}} config
 */
/**
 * @param {{options:{value:*, labelKey:string, icon?:string}[], wrap?:boolean}} config
 *        wrap lays the options out on as many rows as they need, for narrow
 *        columns where five equal segments would clip their labels. The
 *        sliding indicator only makes sense on a single row, so the wrapped
 *        variant highlights the active option directly instead.
 */
export function createSegmented({
  labelKey, tipKey, options, value, onChange, i18n, compact = false, wrap = false,
}) {
  const buttons = new Map();
  const indicator = h('span', { class: 'segmented__indicator', 'aria-hidden': 'true' });

  const group = h('div', {
    class: [
      'segmented__group',
      compact ? 'segmented__group--compact' : null,
      wrap ? 'segmented__group--wrap' : null,
    ],
    role: 'radiogroup',
    'aria-label': i18n.t(labelKey),
  }, wrap ? null : indicator);

  const moveIndicator = (selected) => {
    if (wrap) return;
    const button = buttons.get(selected);
    if (!button) return;
    // Percentages keep the indicator correct in both writing directions.
    const index = [...buttons.keys()].indexOf(selected);
    const width = 100 / buttons.size;
    indicator.style.width = `${width}%`;
    indicator.style.insetInlineStart = `${index * width}%`;
  };

  for (const option of options) {
    const button = h(
      'button',
      {
        type: 'button',
        class: 'segmented__option',
        role: 'radio',
        'aria-checked': String(option.value === value),
        dataset: { value: String(option.value) },
        onClick: () => {
          if (current === option.value) return;
          set(option.value);
          onChange?.(option.value);
        },
      },
      option.icon ? icon(option.icon, { size: 16 }) : null,
      h('span', { class: 'segmented__text', i18n: option.labelKey }, i18n.t(option.labelKey)),
    );
    buttons.set(option.value, button);
    group.append(button);
  }

  let current = value;
  const set = (next) => {
    current = next;
    for (const [key, button] of buttons) {
      button.setAttribute('aria-checked', String(key === next));
      button.classList.toggle('is-active', key === next);
    }
    moveIndicator(next);
  };

  const element = h(
    'div',
    { class: 'segmented' },
    labelKey && !compact
      ? h('span', { class: 'segmented__label', i18n: labelKey }, i18n.t(labelKey))
      : null,
    group,
  );
  if (tipKey) element.dataset.tip = tipKey;

  set(value);
  // The group has no width until it is in the document; correct once it does.
  requestAnimationFrame(() => moveIndicator(current));

  return { element, set, get value() { return current; } };
}

/** Checkbox styled as a selectable chip, used by the randomizer field list. */
export function createChip({ labelKey, checked = false, onChange, i18n, iconName }) {
  const id = uid('chip');
  const input = h('input', { id, class: 'chip__input', type: 'checkbox', checked });
  const element = h(
    'label',
    { class: 'chip', for: id },
    input,
    h('span', { class: 'chip__mark', 'aria-hidden': 'true' }, icon('check', { size: 13 })),
    iconName ? icon(iconName, { size: 15, className: 'chip__icon' }) : null,
    h('span', { class: 'chip__text', i18n: labelKey }, i18n.t(labelKey)),
  );
  input.addEventListener('change', () => onChange?.(input.checked));
  return {
    element,
    set(next) { input.checked = Boolean(next); },
    get checked() { return input.checked; },
  };
}

/** Labelled text input. */
export function createTextField({ labelKey, value = '', placeholderKey, onInput, i18n, maxlength = 80 }) {
  const input = h('input', {
    class: 'field__input',
    type: 'text',
    value,
    maxlength: String(maxlength),
    autocomplete: 'off',
    spellcheck: 'false',
  });
  if (placeholderKey) {
    input.placeholder = i18n.t(placeholderKey);
    input.dataset.i18nAttr = `placeholder:${placeholderKey}`;
  }
  input.addEventListener('input', () => onInput?.(input.value));
  const element = h(
    'label',
    { class: 'field' },
    labelKey ? h('span', { class: 'field__label', i18n: labelKey }, i18n.t(labelKey)) : null,
    input,
  );
  return { element, input, set(next) { input.value = next ?? ''; } };
}

/** Native select, restyled. Used for language and other long option lists. */
export function createSelect({ labelKey, tipKey, options, value, onChange, i18n }) {
  const select = h('select', { class: 'select__control' });
  for (const option of options) {
    const node = h('option', { value: String(option.value) }, option.label);
    if (option.value === value) node.selected = true;
    select.append(node);
  }
  select.addEventListener('change', () => onChange?.(select.value));

  const element = h(
    'div',
    { class: 'select' },
    labelKey ? h('span', { class: 'select__label', i18n: labelKey }, i18n.t(labelKey)) : null,
    h('div', { class: 'select__shell' }, select, icon('chevronDown', { size: 16, className: 'select__chevron' })),
  );
  if (tipKey) element.dataset.tip = tipKey;

  return {
    element,
    set(next) { select.value = String(next); },
    setOptions(nextOptions, nextValue) {
      select.replaceChildren(...nextOptions.map((option) => {
        const node = h('option', { value: String(option.value) }, option.label);
        if (option.value === nextValue) node.selected = true;
        return node;
      }));
    },
  };
}

function format(value, decimals) {
  return Number(value).toFixed(decimals);
}

function clampStep(value, min, max, step) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return min;
  const snapped = step > 0 ? Math.round((numeric - min) / step) * step + min : numeric;
  const clamped = Math.min(max, Math.max(min, snapped));
  // Snapping in floating point leaves 0.30000000000000004 style values behind.
  return Math.round(clamped * 1e6) / 1e6;
}

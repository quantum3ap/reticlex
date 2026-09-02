/**
 * A very small element builder.
 *
 * The UI is written against the DOM directly rather than a framework: the app
 * has five pages and a handful of controls, and hand-built nodes keep the
 * bundle at zero dependencies and the rendering path obvious. This helper only
 * removes the repetitive parts.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';
const SVG_TAGS = new Set(['svg', 'path', 'circle', 'rect', 'g', 'line', 'polyline', 'polygon', 'defs', 'linearGradient', 'stop', 'ellipse', 'text']);

/**
 * @param {string} tag element name; SVG names are namespaced automatically
 * @param {object} [props] see below
 * @param {...(Node|string|null|undefined|Array)} children
 *
 * Supported props:
 *   class / className   string or array of strings
 *   style               object of CSS properties (camelCase or kebab-case)
 *   dataset             object copied onto element.dataset
 *   on<Event>           listener, e.g. onClick, onPointerDown
 *   i18n                shorthand for data-i18n
 *   i18nAttr            shorthand for data-i18n-attr
 *   anything else       set as an attribute (or property for value/checked)
 */
export function h(tag, props = null, ...children) {
  const element = SVG_TAGS.has(tag)
    ? document.createElementNS(SVG_NS, tag)
    : document.createElement(tag);

  if (props) {
    for (const [key, value] of Object.entries(props)) {
      if (value === null || value === undefined || value === false) continue;
      if (key === 'class' || key === 'className') {
        const list = Array.isArray(value) ? value.filter(Boolean) : [value];
        if (list.length) element.setAttribute('class', list.join(' '));
      } else if (key === 'style' && typeof value === 'object') {
        for (const [property, css] of Object.entries(value)) {
          if (css === null || css === undefined) continue;
          element.style.setProperty(toKebab(property), String(css));
        }
      } else if (key === 'dataset') {
        for (const [name, data] of Object.entries(value)) {
          if (data === null || data === undefined) continue;
          element.dataset[name] = String(data);
        }
      } else if (key === 'i18n') {
        element.dataset.i18n = value;
      } else if (key === 'i18nAttr') {
        element.dataset.i18nAttr = value;
      } else if (key.startsWith('on') && typeof value === 'function') {
        element.addEventListener(key.slice(2).toLowerCase(), value);
      } else if (key === 'value' || key === 'checked' || key === 'disabled') {
        element[key] = value;
      } else if (value === true) {
        element.setAttribute(key, '');
      } else {
        element.setAttribute(key, String(value));
      }
    }
  }

  append(element, children);
  return element;
}

export function append(parent, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    parent.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return parent;
}

export function clear(node) {
  while (node.firstChild) node.firstChild.remove();
  return node;
}

export function frag(...children) {
  return append(document.createDocumentFragment(), children);
}

/** Finds the nearest ancestor (inclusive) matching a selector. */
export function closest(target, selector) {
  return target instanceof Element ? target.closest(selector) : null;
}

/** Focuses the first focusable descendant, used when a dialog opens. */
export function focusFirst(root) {
  const candidate = root?.querySelector(
    'input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"])',
  );
  candidate?.focus();
  return candidate ?? null;
}

/**
 * Keeps Tab inside a container. Returns a detach function.
 * Dialogs use this so keyboard users cannot wander behind the overlay.
 */
export function trapFocus(container) {
  const handler = (event) => {
    if (event.key !== 'Tab') return;
    const focusable = [...container.querySelectorAll(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    )].filter((node) => node.offsetParent !== null || node === document.activeElement);
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };
  container.addEventListener('keydown', handler);
  return () => container.removeEventListener('keydown', handler);
}

function toKebab(name) {
  return name.startsWith('--') ? name : name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
}

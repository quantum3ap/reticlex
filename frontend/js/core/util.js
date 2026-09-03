/** Small helpers shared across the UI layer. */

/** Collision-resistant enough for local documents, and readable in filenames. */
export function createId(prefix = 'cx') {
  const random = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now().toString(36)}_${random}`;
}

export function clamp(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return n < min ? min : n > max ? max : n;
}

export function round(value, decimals = 2) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/** Trailing-edge debounce; the returned function exposes cancel/flush. */
export function debounce(fn, wait = 120) {
  let timer = null;
  let lastArgs = null;
  const wrapped = (...args) => {
    lastArgs = args;
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn(...lastArgs);
    }, wait);
  };
  wrapped.cancel = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  wrapped.flush = () => {
    if (timer === null) return;
    clearTimeout(timer);
    timer = null;
    fn(...lastArgs);
  };
  return wrapped;
}

/** Coalesces bursts of calls onto one animation frame. */
export function onFrame(fn) {
  let queued = false;
  let lastArgs = null;
  const raf = typeof requestAnimationFrame === 'function'
    ? requestAnimationFrame
    : (cb) => setTimeout(cb, 16);
  return (...args) => {
    lastArgs = args;
    if (queued) return;
    queued = true;
    raf(() => {
      queued = false;
      fn(...lastArgs);
    });
  };
}

export function deepClone(value) {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(deepClone);
  const out = {};
  for (const key of Object.keys(value)) out[key] = deepClone(value[key]);
  return out;
}

export function shallowEqual(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  const keysA = Object.keys(a);
  if (keysA.length !== Object.keys(b).length) return false;
  return keysA.every((key) => a[key] === b[key]);
}

/** Normalises any accepted colour notation to "#RRGGBB", or null. */
export function normalizeHex(input) {
  if (typeof input !== 'string') return null;
  const text = input.trim().replace(/^#/, '');
  if (/^[0-9a-fA-F]{3}$/.test(text)) {
    return `#${text.split('').map((c) => c + c).join('').toUpperCase()}`;
  }
  if (/^[0-9a-fA-F]{6}$/.test(text)) return `#${text.toUpperCase()}`;
  return null;
}

export function hexToRgb(hex) {
  const normalized = normalizeHex(hex) ?? '#000000';
  return {
    r: parseInt(normalized.slice(1, 3), 16) / 255,
    g: parseInt(normalized.slice(3, 5), 16) / 255,
    b: parseInt(normalized.slice(5, 7), 16) / 255,
  };
}

export function rgbToHex({ r, g, b }) {
  const channel = (v) => Math.round(clamp(v, 0, 1) * 255).toString(16).padStart(2, '0');
  return `#${channel(r)}${channel(g)}${channel(b)}`.toUpperCase();
}

/** Case- and accent-insensitive substring match, used by the preset search. */
export function fuzzyMatch(haystack, needle) {
  if (!needle) return true;
  const fold = (s) => String(s).toLocaleLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return fold(haystack).includes(fold(needle));
}

export function sortBy(items, selector, direction = 'asc') {
  const sign = direction === 'desc' ? -1 : 1;
  return [...items].sort((a, b) => {
    const left = selector(a);
    const right = selector(b);
    if (left === right) return 0;
    return left < right ? -sign : sign;
  });
}

/** Turns "MyCrosshair!" into "mycrosshair", suitable for a filename stem. */
export function toFileStem(name, fallback = 'crosshair') {
  const stem = String(name ?? '')
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}\-_ ]/gu, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 60);
  return stem.length > 0 ? stem : fallback;
}

/**
 * Localization.
 *
 * Every string the user can read comes from here. Catalogues are flat JSON
 * files in /localization keyed with dot notation; a missing key falls back to
 * English and is reported once so gaps are visible during development rather
 * than shipping as blank labels.
 */

export const LOCALES = Object.freeze([
  { code: 'en', name: 'English', nativeName: 'English', dir: 'ltr' },
  { code: 'ar', name: 'Arabic', nativeName: 'العربية', dir: 'rtl' },
  { code: 'es', name: 'Spanish', nativeName: 'Español', dir: 'ltr' },
  { code: 'fr', name: 'French', nativeName: 'Français', dir: 'ltr' },
  { code: 'de', name: 'German', nativeName: 'Deutsch', dir: 'ltr' },
  { code: 'pt', name: 'Portuguese', nativeName: 'Português', dir: 'ltr' },
  { code: 'tr', name: 'Turkish', nativeName: 'Türkçe', dir: 'ltr' },
  { code: 'ru', name: 'Russian', nativeName: 'Русский', dir: 'ltr' },
  { code: 'zh', name: 'Chinese', nativeName: '简体中文', dir: 'ltr' },
  { code: 'ja', name: 'Japanese', nativeName: '日本語', dir: 'ltr' },
]);

export const DEFAULT_LOCALE = 'en';

const LOCALE_CODES = new Set(LOCALES.map((locale) => locale.code));

/** Maps a Windows or browser tag such as "pt-BR" onto a supported catalogue. */
export function resolveLocale(tag) {
  if (typeof tag !== 'string' || tag.length === 0) return DEFAULT_LOCALE;
  const lower = tag.toLowerCase();
  if (LOCALE_CODES.has(lower)) return lower;
  const primary = lower.split(/[-_]/)[0];
  if (LOCALE_CODES.has(primary)) return primary;
  // Windows reports Chinese as zh-Hans / zh-CN / zh-TW; all map to the one catalogue.
  if (primary === 'zh') return 'zh';
  return DEFAULT_LOCALE;
}

export function localeInfo(code) {
  return LOCALES.find((locale) => locale.code === code) ?? LOCALES[0];
}

export class I18n {
  #catalogues = new Map();
  #locale = DEFAULT_LOCALE;
  #listeners = new Set();
  #missing = new Set();

  constructor({ loader } = {}) {
    // Injectable so tests can supply catalogues without a network or a DOM.
    this.loader = loader ?? (async (code) => {
      const response = await fetch(`../localization/${code}.json`);
      if (!response.ok) throw new Error(`Missing catalogue for ${code}`);
      return response.json();
    });
  }

  get locale() { return this.#locale; }
  get dir() { return localeInfo(this.#locale).dir; }
  get isRtl() { return this.dir === 'rtl'; }
  get missingKeys() { return [...this.#missing]; }

  async preload(code) {
    const resolved = resolveLocale(code);
    if (this.#catalogues.has(resolved)) return this.#catalogues.get(resolved);
    const catalogue = await this.loader(resolved);
    this.#catalogues.set(resolved, catalogue);
    return catalogue;
  }

  /** Loads a catalogue and switches to it. English is always kept resident. */
  async use(code) {
    const resolved = resolveLocale(code);
    await this.preload(DEFAULT_LOCALE);
    await this.preload(resolved);
    this.#locale = resolved;
    this.#emit();
    return resolved;
  }

  onChange(listener) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #emit() {
    for (const listener of [...this.#listeners]) {
      try {
        listener(this.#locale, this.dir);
      } catch (error) {
        console.error('[i18n] listener failed', error);
      }
    }
  }

  has(key) {
    return typeof this.#catalogues.get(this.#locale)?.[key] === 'string';
  }

  /**
   * Looks up a key, substituting {placeholders}.
   * @param {string} key dot-notation key
   * @param {object} params values for {name} placeholders
   */
  t(key, params) {
    const active = this.#catalogues.get(this.#locale);
    const english = this.#catalogues.get(DEFAULT_LOCALE);
    let template = active?.[key];
    if (typeof template !== 'string') {
      template = english?.[key];
      if (typeof template === 'string' && this.#locale !== DEFAULT_LOCALE) {
        this.#noteMissing(key);
      }
    }
    if (typeof template !== 'string') {
      this.#noteMissing(key);
      return key;
    }
    if (!params) return template;
    return template.replace(/\{(\w+)\}/g, (match, name) => (
      Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match
    ));
  }

  #noteMissing(key) {
    const tag = `${this.#locale}:${key}`;
    if (this.#missing.has(tag)) return;
    this.#missing.add(tag);
    console.warn(`[i18n] missing translation ${tag}`);
  }

  /** Locale-aware number formatting for slider read-outs. */
  number(value, decimals = 0) {
    return new Intl.NumberFormat(this.#locale, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(value);
  }

  /** "Today", "Yesterday", or a locale date for anything older. */
  relativeDate(isoString) {
    const date = new Date(isoString);
    if (Number.isNaN(date.getTime())) return this.t('common.never');
    const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const days = Math.round((startOfDay(new Date()) - startOfDay(date)) / 86_400_000);
    if (days <= 0) return this.t('common.today');
    if (days === 1) return this.t('common.yesterday');
    if (days < 7) return this.t('common.daysAgo', { count: days });
    return new Intl.DateTimeFormat(this.#locale, { dateStyle: 'medium' }).format(date);
  }
}

/**
 * Applies translations to a DOM subtree.
 *
 * Elements opt in with data-i18n="key" for text content, or
 * data-i18n-attr="title:key;aria-label:key" for attributes. Called after every
 * render and whenever the language changes, so switching is instant.
 */
export function applyTranslations(root, i18n) {
  if (!root) return;
  const scope = root.querySelectorAll ? root : document;
  for (const node of scope.querySelectorAll('[data-i18n]')) {
    const params = node.dataset.i18nParams ? safeParse(node.dataset.i18nParams) : undefined;
    node.textContent = i18n.t(node.dataset.i18n, params);
  }
  for (const node of scope.querySelectorAll('[data-i18n-attr]')) {
    for (const pair of node.dataset.i18nAttr.split(';')) {
      const [attribute, key] = pair.split(':').map((part) => part.trim());
      if (!attribute || !key) continue;
      node.setAttribute(attribute, i18n.t(key));
    }
  }
}

function safeParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

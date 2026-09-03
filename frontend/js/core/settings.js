/**
 * Application preferences: defaults, validation and the code that turns them
 * into CSS custom properties on the document root.
 *
 * Everything here survives a restart, so every value is validated on the way
 * in. A settings file that has been hand-edited or truncated must never stop
 * the application from starting.
 */

import { clamp, normalizeHex } from './util.js';
import { DEFAULT_LOCALE, resolveLocale, localeInfo } from './i18n.js';

export const THEMES = ['dark', 'midnight', 'light'];

export const ACCENTS = Object.freeze([
  { id: 'mint', hex: '#00FF88' },
  { id: 'cyan', hex: '#22D3EE' },
  { id: 'violet', hex: '#A78BFA' },
  { id: 'magenta', hex: '#F472B6' },
  { id: 'amber', hex: '#FBBF24' },
  { id: 'coral', hex: '#FB7185' },
  { id: 'lime', hex: '#A3E635' },
  { id: 'ice', hex: '#7DD3FC' },
]);

export const PREVIEW_BACKGROUNDS = ['dark', 'light', 'fps', 'contrast', 'custom'];

export const UI_SCALE = Object.freeze({ min: 0.85, max: 1.3, step: 0.05 });

/** A custom preview background larger than this is dropped rather than saved. */
const MAX_BACKGROUND_BYTES = 2_000_000;

export const SETTINGS_VERSION = 1;

export function defaultSettings() {
  return {
    version: SETTINGS_VERSION,
    locale: DEFAULT_LOCALE,
    localeChosen: false,
    theme: 'dark',
    accent: ACCENTS[0].hex,
    animations: true,
    uiScale: 1,
    autoSave: true,
    startWithWindows: false,
    lastPage: 'home',
    lastDocumentId: null,
    previewBackground: 'dark',
    previewGrid: false,
    previewInfo: true,
    previewZoom: 4,
    previewImage: null,
    randomizerMask: 0x1FF,
    randomizerStyle: 0,
  };
}

/**
 * Coerces anything into a usable settings object.
 * @param {*} raw parsed settings.json, possibly corrupt or from a future build
 * @returns {{settings:object, repaired:boolean}}
 */
export function normalizeSettings(raw) {
  const defaults = defaultSettings();
  if (!raw || typeof raw !== 'object') return { settings: defaults, repaired: raw != null };

  let repaired = false;
  const take = (key, value) => {
    if (value === undefined || value === null) {
      repaired = true;
      return defaults[key];
    }
    return value;
  };

  const settings = { ...defaults };

  settings.locale = resolveLocale(take('locale', raw.locale));
  if (settings.locale !== raw.locale) repaired = true;
  settings.localeChosen = Boolean(raw.localeChosen);

  settings.theme = THEMES.includes(raw.theme) ? raw.theme : defaults.theme;
  if (settings.theme !== raw.theme) repaired = true;

  settings.accent = normalizeHex(raw.accent) ?? defaults.accent;
  if (settings.accent !== raw.accent) repaired = true;

  settings.animations = typeof raw.animations === 'boolean' ? raw.animations : defaults.animations;
  settings.autoSave = typeof raw.autoSave === 'boolean' ? raw.autoSave : defaults.autoSave;
  settings.startWithWindows = typeof raw.startWithWindows === 'boolean'
    ? raw.startWithWindows : defaults.startWithWindows;

  settings.uiScale = Number.isFinite(Number(raw.uiScale))
    ? clamp(Number(raw.uiScale), UI_SCALE.min, UI_SCALE.max)
    : defaults.uiScale;

  settings.lastPage = typeof raw.lastPage === 'string' ? raw.lastPage : defaults.lastPage;
  settings.lastDocumentId = typeof raw.lastDocumentId === 'string' ? raw.lastDocumentId : null;

  settings.previewBackground = PREVIEW_BACKGROUNDS.includes(raw.previewBackground)
    ? raw.previewBackground : defaults.previewBackground;
  settings.previewGrid = typeof raw.previewGrid === 'boolean' ? raw.previewGrid : defaults.previewGrid;
  settings.previewInfo = typeof raw.previewInfo === 'boolean' ? raw.previewInfo : defaults.previewInfo;
  settings.previewZoom = clamp(Number(raw.previewZoom) || defaults.previewZoom, 1, 24);

  settings.previewImage = typeof raw.previewImage === 'string'
    && raw.previewImage.startsWith('data:image/')
    && raw.previewImage.length <= MAX_BACKGROUND_BYTES
    ? raw.previewImage
    : null;
  if (raw.previewImage && settings.previewImage === null) repaired = true;
  // A background that was dropped must not leave the preview pointing at it.
  if (settings.previewBackground === 'custom' && !settings.previewImage) {
    settings.previewBackground = 'dark';
  }

  settings.randomizerMask = Number.isInteger(raw.randomizerMask)
    ? clamp(raw.randomizerMask, 0, 0x1FF) : defaults.randomizerMask;
  settings.randomizerStyle = Number.isInteger(raw.randomizerStyle)
    ? clamp(raw.randomizerStyle, 0, 4) : defaults.randomizerStyle;

  if (raw.version !== SETTINGS_VERSION) repaired = true;
  settings.version = SETTINGS_VERSION;

  return { settings, repaired };
}

/** True when the stored image is small enough to be worth writing back. */
export function canPersistBackground(dataUrl) {
  return typeof dataUrl === 'string'
    && dataUrl.startsWith('data:image/')
    && dataUrl.length <= MAX_BACKGROUND_BYTES;
}

/**
 * Pushes appearance settings onto the document.
 *
 * Theme, accent and scale are all expressed as custom properties so the CSS
 * needs no per-theme selectors beyond the palette definitions themselves.
 */
export function applyAppearance(settings, root = document.documentElement) {
  if (!root) return;
  root.dataset.theme = settings.theme;
  root.dataset.animations = settings.animations ? 'on' : 'off';
  root.style.setProperty('--accent', settings.accent);
  root.style.setProperty('--accent-soft', withAlpha(settings.accent, 0.16));
  root.style.setProperty('--accent-glow', withAlpha(settings.accent, 0.42));
  root.style.setProperty('--accent-line', withAlpha(settings.accent, 0.55));
  root.style.setProperty('--ui-scale', String(settings.uiScale));
}

/** Applies language direction and the lang attribute. */
export function applyLocale(locale, root = document.documentElement) {
  if (!root) return;
  const info = localeInfo(locale);
  root.lang = info.code;
  root.dir = info.dir;
  root.dataset.locale = info.code;
}

function withAlpha(hex, alpha) {
  const normalized = normalizeHex(hex) ?? '#00FF88';
  const r = parseInt(normalized.slice(1, 3), 16);
  const g = parseInt(normalized.slice(3, 5), 16);
  const b = parseInt(normalized.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

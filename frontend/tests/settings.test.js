/** Settings validation: a corrupt file must never stop the app from starting. */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ACCENTS, DEFAULT_OVERLAY_HOTKEY, OVERLAY_HOTKEYS, OVERLAY_OFFSET,
  PREVIEW_BACKGROUNDS, SETTINGS_VERSION, THEMES, UI_SCALE,
  canPersistBackground, defaultSettings, normalizeSettings,
} from '../js/core/settings.js';

test('defaults are self-consistent', () => {
  const settings = defaultSettings();
  assert.equal(settings.version, SETTINGS_VERSION);
  assert.ok(THEMES.includes(settings.theme));
  assert.ok(PREVIEW_BACKGROUNDS.includes(settings.previewBackground));
  assert.equal(settings.accent, ACCENTS[0].hex);
  assert.equal(normalizeSettings(settings).repaired, false, 'defaults need no repair');
});

test('missing or corrupt input falls back to the defaults', () => {
  for (const input of [null, undefined, 'a string', 42, []]) {
    const { settings } = normalizeSettings(input);
    assert.equal(settings.theme, 'dark');
    assert.equal(settings.locale, 'en');
    assert.equal(settings.version, SETTINGS_VERSION);
  }
});

test('rejects unknown enumerated values', () => {
  const { settings, repaired } = normalizeSettings({
    theme: 'neon-hologram',
    previewBackground: 'nebula',
    locale: 'klingon',
  });
  assert.equal(settings.theme, 'dark');
  assert.equal(settings.previewBackground, 'dark');
  assert.equal(settings.locale, 'en');
  assert.equal(repaired, true);
});

test('maps a regional Windows locale onto a supported catalogue', () => {
  assert.equal(normalizeSettings({ locale: 'pt-BR' }).settings.locale, 'pt');
  assert.equal(normalizeSettings({ locale: 'zh-Hans-CN' }).settings.locale, 'zh');
  assert.equal(normalizeSettings({ locale: 'ar-SA' }).settings.locale, 'ar');
  assert.equal(normalizeSettings({ locale: 'EN-GB' }).settings.locale, 'en');
});

test('clamps numeric preferences into their published range', () => {
  const { settings } = normalizeSettings({ uiScale: 99, previewZoom: -4 });
  assert.equal(settings.uiScale, UI_SCALE.max);
  assert.ok(settings.previewZoom >= 1);
  assert.equal(normalizeSettings({ uiScale: 'big' }).settings.uiScale, 1);
});

test('accepts any well-formed accent and repairs the rest', () => {
  assert.equal(normalizeSettings({ accent: '#abc' }).settings.accent, '#AABBCC');
  assert.equal(normalizeSettings({ accent: 'rebeccapurple' }).settings.accent, ACCENTS[0].hex);
});

test('keeps booleans and ignores non-booleans', () => {
  const { settings } = normalizeSettings({ animations: false, autoSave: 'yes', previewGrid: true });
  assert.equal(settings.animations, false);
  assert.equal(settings.autoSave, true, 'a non-boolean falls back to the default');
  assert.equal(settings.previewGrid, true);
});

test('drops an oversized or non-image preview background', () => {
  const huge = `data:image/png;base64,${'A'.repeat(2_000_001)}`;
  const { settings, repaired } = normalizeSettings({
    previewBackground: 'custom',
    previewImage: huge,
  });
  assert.equal(settings.previewImage, null);
  assert.equal(settings.previewBackground, 'dark', 'the preview must not point at a dropped image');
  assert.equal(repaired, true);

  assert.equal(normalizeSettings({ previewImage: 'javascript:alert(1)' }).settings.previewImage, null);
  assert.equal(canPersistBackground('data:image/png;base64,AAAA'), true);
  assert.equal(canPersistBackground(huge), false);
  assert.equal(canPersistBackground(null), false);
});

test('keeps a small custom background', () => {
  const image = 'data:image/png;base64,iVBORw0KGgo=';
  const { settings } = normalizeSettings({ previewBackground: 'custom', previewImage: image });
  assert.equal(settings.previewImage, image);
  assert.equal(settings.previewBackground, 'custom');
});

test('clamps the randomizer mask and style', () => {
  const { settings } = normalizeSettings({ randomizerMask: 0xFFFF, randomizerStyle: 99 });
  assert.equal(settings.randomizerMask, 0x1FF);
  assert.equal(settings.randomizerStyle, 4);
  assert.equal(normalizeSettings({ randomizerMask: 1.5 }).settings.randomizerMask, 0x1FF);
});

test('normalising twice changes nothing the second time', () => {
  const messy = { theme: 'x', uiScale: 44, accent: 'nope', locale: 'fr-CA', previewZoom: 900 };
  const once = normalizeSettings(messy).settings;
  const twice = normalizeSettings(once);
  assert.deepEqual(twice.settings, once);
  assert.equal(twice.repaired, false);
});

test('remembers whether the language was chosen deliberately', () => {
  assert.equal(normalizeSettings({}).settings.localeChosen, false);
  assert.equal(normalizeSettings({ localeChosen: true }).settings.localeChosen, true);
});


// --- Overlay ---------------------------------------------------------------

test('the overlay is off by default and bound to a usable shortcut', () => {
  const settings = defaultSettings();
  assert.equal(settings.overlayEnabled, false);
  assert.equal(settings.overlayMonitor, '');
  assert.equal(settings.overlayOffsetX, 0);
  assert.equal(settings.overlayOffsetY, 0);
  assert.equal(settings.overlayHotkey, DEFAULT_OVERLAY_HOTKEY);
  assert.ok(OVERLAY_HOTKEYS.includes(settings.overlayHotkey));
});

test('every offered shortcut has a modifier, which Windows requires', () => {
  for (const hotkey of OVERLAY_HOTKEYS) {
    const parts = hotkey.split('+');
    assert.ok(parts.length >= 2, `${hotkey} has no modifier`);
    assert.ok(parts.slice(0, -1).every((part) => ['Ctrl', 'Alt', 'Shift', 'Win'].includes(part)),
      `${hotkey} has an unexpected modifier`);
  }
});

test('the overlay only turns on for a literal true', () => {
  for (const value of ['true', 1, 'yes', {}, [], 'on']) {
    assert.equal(normalizeSettings({ overlayEnabled: value }).settings.overlayEnabled, false);
  }
  assert.equal(normalizeSettings({ overlayEnabled: true }).settings.overlayEnabled, true);
});

test('overlay offsets are clamped and rounded to whole pixels', () => {
  const cases = [
    [1e9, OVERLAY_OFFSET.max],
    [-1e9, OVERLAY_OFFSET.min],
    [12.6, 13],
    ['40', 40],
    [Number.NaN, 0],
    [Number.POSITIVE_INFINITY, 0],
    [undefined, 0],
    [null, 0],
  ];
  for (const [input, expected] of cases) {
    const { settings } = normalizeSettings({ overlayOffsetX: input, overlayOffsetY: input });
    assert.equal(settings.overlayOffsetX, expected, `offsetX for ${String(input)}`);
    assert.equal(settings.overlayOffsetY, expected, `offsetY for ${String(input)}`);
    assert.ok(Number.isInteger(settings.overlayOffsetX));
  }
});

test('an unknown shortcut falls back to the default', () => {
  assert.equal(normalizeSettings({ overlayHotkey: 'Ctrl+Q' }).settings.overlayHotkey,
    DEFAULT_OVERLAY_HOTKEY);
  assert.equal(normalizeSettings({ overlayHotkey: 42 }).settings.overlayHotkey,
    DEFAULT_OVERLAY_HOTKEY);
  assert.equal(normalizeSettings({ overlayHotkey: 'Alt+F9' }).settings.overlayHotkey, 'Alt+F9');
});

test('a monitor identifier survives but a non-string does not', () => {
  assert.equal(normalizeSettings({ overlayMonitor: '\\\\.\\DISPLAY2' }).settings.overlayMonitor,
    '\\\\.\\DISPLAY2');
  assert.equal(normalizeSettings({ overlayMonitor: 7 }).settings.overlayMonitor, '');
});

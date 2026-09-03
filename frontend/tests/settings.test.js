/** Settings validation: a corrupt file must never stop the app from starting. */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ACCENTS, PREVIEW_BACKGROUNDS, SETTINGS_VERSION, THEMES, UI_SCALE,
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

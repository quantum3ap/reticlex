/**
 * Localization coverage.
 *
 * These run against the shipped catalogues, so a missing key or a mistyped
 * placeholder fails the build rather than showing up as a blank label.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { loadCatalogue, readJson } from './helpers.js';
import { DEFAULT_LOCALE, I18n, LOCALES, localeInfo, resolveLocale } from '../js/core/i18n.js';

const catalogues = new Map();
for (const locale of LOCALES) catalogues.set(locale.code, await loadCatalogue(locale.code));

const english = catalogues.get('en');
const englishKeys = Object.keys(english);

const placeholders = (value) => [...String(value).matchAll(/\{(\w+)\}/g)]
  .map((match) => match[1]).sort().join(',');

test('every advertised language ships a catalogue', () => {
  assert.equal(LOCALES.length, 10);
  for (const locale of LOCALES) {
    assert.ok(catalogues.get(locale.code), `${locale.code} has no catalogue`);
    assert.ok(locale.nativeName.length > 0);
    assert.ok(['ltr', 'rtl'].includes(locale.dir));
  }
  assert.equal(localeInfo('ar').dir, 'rtl');
  assert.equal(localeInfo('en').dir, 'ltr');
});

test('the English catalogue is substantial and has no blanks', () => {
  assert.ok(englishKeys.length > 300, `only ${englishKeys.length} keys`);
  for (const key of englishKeys) {
    assert.equal(typeof english[key], 'string', `${key} is not a string`);
    assert.ok(english[key].trim().length > 0, `${key} is empty`);
  }
});

for (const locale of LOCALES) {
  test(`${locale.code} covers every key with matching placeholders`, () => {
    const catalogue = catalogues.get(locale.code);
    const keys = Object.keys(catalogue);

    const missing = englishKeys.filter((key) => !(key in catalogue));
    assert.deepEqual(missing, [], `${locale.code} is missing keys`);

    const extra = keys.filter((key) => !(key in english));
    assert.deepEqual(extra, [], `${locale.code} has keys English does not`);

    for (const key of englishKeys) {
      assert.ok(catalogue[key].trim().length > 0, `${locale.code}:${key} is empty`);
      assert.equal(
        placeholders(catalogue[key]),
        placeholders(english[key]),
        `${locale.code}:${key} placeholders differ`,
      );
    }

    assert.equal(catalogue['meta.dir'], locale.dir, `${locale.code} declares the wrong direction`);
  });
}

test('every built-in preset has a localized name and description', async () => {
  const builtIn = await readJson('presets/builtin.json');
  assert.ok(builtIn.presets.length >= 8);
  for (const locale of LOCALES) {
    const catalogue = catalogues.get(locale.code);
    for (const preset of builtIn.presets) {
      assert.ok(catalogue[`preset.${preset.id}.name`], `${locale.code} lacks a name for ${preset.id}`);
      assert.ok(
        catalogue[`preset.${preset.id}.description`],
        `${locale.code} lacks a description for ${preset.id}`,
      );
    }
  }
});

test('resolves regional and unknown tags onto supported catalogues', () => {
  assert.equal(resolveLocale('fr-CA'), 'fr');
  assert.equal(resolveLocale('de_DE'), 'de');
  assert.equal(resolveLocale('zh-Hant-TW'), 'zh');
  assert.equal(resolveLocale('sv-SE'), DEFAULT_LOCALE);
  assert.equal(resolveLocale(''), DEFAULT_LOCALE);
  assert.equal(resolveLocale(null), DEFAULT_LOCALE);
  assert.equal(resolveLocale('JA'), 'ja');
});

test('translates, substitutes and reports direction', async () => {
  const i18n = new I18n({ loader: async (code) => catalogues.get(code) });
  await i18n.use('en');
  assert.equal(i18n.t('nav.home'), 'Home');
  assert.equal(i18n.t('toast.savedAs', { name: 'Mine' }), 'Saved as "Mine"');
  assert.equal(i18n.isRtl, false);

  await i18n.use('ar');
  assert.equal(i18n.dir, 'rtl');
  assert.equal(i18n.isRtl, true);
  assert.equal(i18n.t('nav.home'), catalogues.get('ar')['nav.home']);
  assert.ok(i18n.t('toast.savedAs', { name: 'ريتيكل' }).includes('ريتيكل'));
});

test('falls back to English and reports the gap', async () => {
  const partial = { 'nav.home': 'Startseite' };
  const i18n = new I18n({
    loader: async (code) => (code === 'en' ? english : partial),
  });
  await i18n.use('de');
  assert.equal(i18n.t('nav.home'), 'Startseite');
  assert.equal(i18n.t('nav.settings'), english['nav.settings'], 'falls back to English');
  assert.ok(i18n.missingKeys.includes('de:nav.settings'));
  assert.equal(i18n.has('nav.settings'), false);
  assert.equal(i18n.has('nav.home'), true);
});

test('an unknown key returns the key itself rather than blank text', async () => {
  const i18n = new I18n({ loader: async () => english });
  await i18n.use('en');
  assert.equal(i18n.t('nothing.here'), 'nothing.here');
});

test('leaves an unmatched placeholder in place instead of printing undefined', async () => {
  const i18n = new I18n({ loader: async () => ({ 'x.y': 'Hello {name} and {other}' }) });
  await i18n.use('en');
  assert.equal(i18n.t('x.y', { name: 'A' }), 'Hello A and {other}');
});

test('formats numbers and relative dates per locale', async () => {
  const i18n = new I18n({ loader: async (code) => catalogues.get(code) });
  await i18n.use('en');
  assert.equal(i18n.number(1.5, 2), '1.50');
  assert.equal(i18n.relativeDate(new Date().toISOString()), 'Today');
  const yesterday = new Date(Date.now() - 86_400_000);
  assert.equal(i18n.relativeDate(yesterday.toISOString()), 'Yesterday');
  assert.equal(i18n.relativeDate('not a date'), 'Never');
});

test('switching language does not require a reload', async () => {
  const i18n = new I18n({ loader: async (code) => catalogues.get(code) });
  const seen = [];
  i18n.onChange((code, dir) => seen.push(`${code}:${dir}`));
  await i18n.use('ja');
  await i18n.use('ar');
  await i18n.use('en');
  assert.deepEqual(seen, ['ja:ltr', 'ar:rtl', 'en:ltr']);
});

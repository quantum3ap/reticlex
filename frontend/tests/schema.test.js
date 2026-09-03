/** Document format: conversion, tolerant reading, and import validation. */

import test from 'node:test';
import assert from 'node:assert/strict';

import { loadCore } from './helpers.js';
import {
  CAP_STYLES, DOCUMENT_FORMAT, DOT_SHAPES, LIMITS, PRESET_PACK_FORMAT,
  createDocument, crosshairToJson, documentToJson, jsonToCrosshair,
  parseImport, toPresetPack,
} from '../js/core/schema.js';

const core = await loadCore();
const defaults = core.defaults();

test('published slider limits match what the core enforces', () => {
  // If these ever drift, the UI would let a user pick a value the core silently
  // clamps, and the read-out would lie.
  for (const [field, limit] of Object.entries(LIMITS)) {
    for (const bound of [limit.min, limit.max]) {
      const { config } = core.normalize({ ...defaults, [field]: bound });
      assert.ok(
        Math.abs(config[field] - bound) < 1e-4,
        `${field} bound ${bound} was clamped to ${config[field]}`,
      );
    }
  }
});

test('round-trips a configuration through the nested document format', () => {
  const source = core.randomize(defaults, 1234, 0x1FF, 0);
  const json = crosshairToJson(source);
  const { config, warnings } = jsonToCrosshair(json, defaults);
  assert.deepEqual(warnings, []);
  assert.ok(core.equals(source, config), 'a round trip changed the reticle');
});

test('writes enums as readable names', () => {
  const json = crosshairToJson({ ...defaults, cap_style: 2, dot_shape: 1 });
  assert.equal(json.arms.capStyle, CAP_STYLES[2]);
  assert.equal(json.dot.shape, DOT_SHAPES[1]);
  assert.match(json.color, /^#[0-9A-F]{6}$/);
});

test('reads a partial document by filling in defaults', () => {
  const { config } = jsonToCrosshair({ color: '#FF0000', horizontal: { length: 20 } }, defaults);
  assert.equal(config.h_length, 20);
  assert.equal(config.v_length, defaults.v_length, 'untouched fields keep their default');
  assert.equal(Math.round(config.color_r * 255), 255);
  assert.equal(Math.round(config.color_g * 255), 0);
});

test('accepts a flat config from the host without translating it', () => {
  const { config } = jsonToCrosshair({ ...defaults, h_length: 17 }, defaults);
  assert.equal(config.h_length, 17);
});

test('reports an unreadable colour rather than dropping it silently', () => {
  const { config, warnings } = jsonToCrosshair({ color: 'not-a-colour' }, defaults);
  assert.ok(warnings.includes('invalidColor'));
  assert.equal(config.color_g, defaults.color_g, 'falls back to the previous colour');
});

test('exports a document with the format marker and metadata', () => {
  const doc = createDocument({ name: 'Mine', description: 'Notes', config: defaults });
  const json = documentToJson(doc, '1.2.3');
  assert.equal(json.format, DOCUMENT_FORMAT);
  assert.equal(json.version, 1);
  assert.equal(json.name, 'Mine');
  assert.equal(json.app.version, '1.2.3');
  assert.ok(json.crosshair.horizontal);
});

test('imports a document it just exported', () => {
  const doc = createDocument({ name: 'Round trip', config: core.randomize(defaults, 7, 0x1FF, 0) });
  const text = JSON.stringify(documentToJson(doc));
  const result = parseImport(text, core);
  assert.ok(result.ok, result.errorKey);
  assert.equal(result.documents.length, 1);
  assert.equal(result.documents[0].name, 'Round trip');
  assert.ok(core.equals(result.documents[0].config, doc.config));
});

test('imports a preset pack as presets', () => {
  const pack = toPresetPack([
    createDocument({ name: 'One', config: defaults, kind: 'preset' }),
    createDocument({ name: 'Two', config: defaults, kind: 'preset' }),
  ]);
  assert.equal(pack.format, PRESET_PACK_FORMAT);
  const result = parseImport(JSON.stringify(pack), core);
  assert.ok(result.ok);
  assert.equal(result.documents.length, 2);
  assert.ok(result.documents.every((doc) => doc.kind === 'preset'));
});

test('imports a bare array of crosshairs', () => {
  const text = JSON.stringify([{ name: 'A', crosshair: crosshairToJson(defaults) }, { name: 'B' }]);
  const result = parseImport(text, core);
  assert.ok(result.ok);
  assert.equal(result.documents.length, 2);
  assert.equal(result.documents[1].name, 'B');
});

test('rejects malformed input with a translatable reason', () => {
  const cases = [
    ['', 'import.errorEmpty'],
    ['   ', 'import.errorEmpty'],
    ['{ not json', 'import.errorJson'],
    ['"a string"', 'import.errorShape'],
    ['{"hello":"world"}', 'import.errorShape'],
    ['[]', 'import.errorEmpty'],
    ['null', 'import.errorShape'],
  ];
  for (const [text, expected] of cases) {
    const result = parseImport(text, core);
    assert.equal(result.ok, false, `"${text.slice(0, 20)}" should not import`);
    assert.equal(result.errorKey, expected, `for input "${text.slice(0, 20)}"`);
  }
});

test('rejects an unknown format and a future version', () => {
  const base = { crosshair: crosshairToJson(defaults) };
  assert.equal(
    parseImport(JSON.stringify({ ...base, format: 'someone-elses' }), core).errorKey,
    'import.errorFormat',
  );
  assert.equal(
    parseImport(JSON.stringify({ ...base, format: DOCUMENT_FORMAT, version: 99 }), core).errorKey,
    'import.errorVersion',
  );
});

test('refuses an implausibly large payload before parsing it', () => {
  const huge = `{"crosshair":{},"pad":"${'x'.repeat(4_000_001)}"}`;
  assert.equal(parseImport(huge, core).errorKey, 'import.errorTooLarge');
  const many = JSON.stringify(Array.from({ length: 501 }, () => ({ name: 'x' })));
  assert.equal(parseImport(many, core).errorKey, 'import.errorTooMany');
});

test('clamps out-of-range imports and says so', () => {
  const text = JSON.stringify({
    format: DOCUMENT_FORMAT,
    version: 1,
    name: 'Extreme',
    crosshair: { ...crosshairToJson(defaults), scale: 500, horizontal: { length: 9999 } },
  });
  const result = parseImport(text, core);
  assert.ok(result.ok);
  assert.ok(result.warnings.includes('clamped'));
  assert.equal(result.documents[0].config.scale, 4);
  assert.equal(core.validate(result.documents[0].config), 0);
});

test('never throws on adversarial structures', () => {
  const nasty = [
    '{"crosshair":{"horizontal":null,"dot":42,"arms":"nope"}}',
    '{"crosshair":{"scale":{"$ref":"x"},"color":{"nested":true}}}',
    '{"h_length":"NaN","color_r":null}',
    `{"crosshair":${JSON.stringify({ horizontal: { length: Number.MAX_VALUE } })}}`,
  ];
  for (const text of nasty) {
    const result = parseImport(text, core);
    if (result.ok) {
      for (const doc of result.documents) {
        assert.equal(typeof doc.config.h_length, 'number');
        assert.ok(Number.isFinite(doc.config.h_length));
      }
    } else {
      assert.ok(result.errorKey.startsWith('import.'));
    }
  }
});

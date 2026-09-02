/** The WebAssembly core as the front end sees it, plus ABI conformance. */

import test from 'node:test';
import assert from 'node:assert/strict';

import { loadCore, readJson } from './helpers.js';
import { RxStatus, RandomField, RandomStyle } from '../js/core/wasm.js';

const core = await loadCore();

test('reports a layout the marshalling code can rely on', () => {
  assert.equal(core.abiVersion, 1);
  assert.equal(core.schemaVersion, 1);
  assert.equal(core.configSize, core.fieldCount * 4);
  assert.equal(core.fieldCount, 38);
  assert.equal(core.maxShapes, 32);
});

test('exposes a field table with unique names and known types', () => {
  assert.equal(core.fields.length, core.fieldCount);
  const names = core.fields.map((field) => field.name);
  assert.equal(new Set(names).size, names.length);
  for (const field of core.fields) {
    assert.ok(field.name.length > 0, 'field name must not be empty');
    assert.ok(['int', 'float'].includes(field.type));
    assert.equal(field.offset, field.index * 4);
  }
  assert.equal(core.fields[0].name, 'schema_version');
});

test('round-trips a configuration through linear memory unchanged', () => {
  const defaults = core.defaults();
  core.writeConfig(defaults);
  assert.deepEqual(core.readConfig(), defaults);
});

test('defaults are valid and draw something', () => {
  const defaults = core.defaults();
  assert.equal(core.validate(defaults), RxStatus.OK);
  const geometry = core.buildGeometry(defaults);
  assert.equal(geometry.status, RxStatus.OK);
  assert.equal(geometry.shapes.length, 8);
  assert.ok(geometry.extentW > 0);
});

test('normalize repairs hostile values instead of failing', () => {
  const broken = {
    ...core.defaults(),
    scale: 9999,
    h_length: -40,
    opacity: Number.NaN,
    cap_style: 77,
    dot_enabled: 5,
  };
  const { config, adjusted } = core.normalize(broken);
  assert.ok(adjusted >= 4, `expected several repairs, got ${adjusted}`);
  assert.equal(config.scale, 4);
  assert.equal(config.h_length, 0);
  assert.equal(config.opacity, 0);
  assert.equal(config.cap_style, 2);
  assert.equal(config.dot_enabled, 1);
  // Clamping opacity to zero leaves a reticle that draws nothing, which the
  // core reports separately from a malformed file.
  assert.equal(core.validate(config), RxStatus.EMPTY);
  assert.equal(core.validate({ ...config, opacity: 1 }), RxStatus.OK);
});

test('validate distinguishes a broken file from an invisible one', () => {
  const defaults = core.defaults();
  assert.equal(core.validate({ ...defaults, schema_version: 42 }), RxStatus.SCHEMA);
  assert.equal(core.validate({ ...defaults, h_gap: 900 }), RxStatus.RANGE);
  assert.equal(
    core.validate({ ...defaults, h_enabled: 0, v_enabled: 0, dot_enabled: 0 }),
    RxStatus.EMPTY,
  );
});

test('fingerprints ignore encoding differences', () => {
  const a = core.defaults();
  const b = { ...a, dot_enabled: 0 };
  assert.equal(core.fingerprint(a), core.fingerprint({ ...a }));
  assert.ok(core.equals(a, { ...a, dot_enabled: false }));
  assert.equal(core.fingerprint(a), core.fingerprint(b));   // both already off
  assert.notEqual(core.fingerprint(a), core.fingerprint({ ...a, h_length: 12 }));
  assert.match(core.fingerprint(a), /^[0-9a-f]{16}$/);
});

test('geometry honours the T shape and individual arms', () => {
  const base = { ...core.defaults(), outline_enabled: 0 };
  assert.equal(core.buildGeometry(base).shapes.length, 4);
  assert.equal(core.buildGeometry({ ...base, t_shape: 1 }).shapes.length, 3);
  assert.equal(core.buildGeometry({ ...base, show_left: 0, show_top: 0 }).shapes.length, 2);
});

test('rasterises to a transparent RGBA buffer', () => {
  const config = { ...core.defaults(), h_gap: 6, h_length: 12, outline_enabled: 0 };
  const pixels = core.rasterize(config, 64, 64, 2);
  assert.equal(pixels.length, 64 * 64 * 4);
  const alphaAt = (x, y) => pixels[(y * 64 + x) * 4 + 3];
  assert.equal(alphaAt(32, 32), 0, 'the gap stays empty');
  assert.ok(alphaAt(32 + 20, 32) > 200, 'the arm is opaque');
  assert.equal(alphaAt(1, 1), 0, 'nothing outside the reticle');
});

test('rasterizeFit picks a zoom that keeps the reticle inside the buffer', () => {
  const small = core.rasterizeFit({ ...core.defaults(), h_length: 3, v_length: 3 }, 64, 64, 6);
  const large = core.rasterizeFit({ ...core.defaults(), h_length: 90, v_length: 90 }, 64, 64, 6);
  assert.ok(small.zoom > large.zoom);
  for (let x = 0; x < 64; x += 1) {
    assert.equal(large.pixels[x * 4 + 3], 0, 'top margin stays clear');
  }
});

test('rejects raster requests larger than the module can hold', () => {
  assert.throws(() => core.rasterize(core.defaults(), 4096, 4096, 1), /scratch capacity/);
  assert.throws(() => core.rasterize(core.defaults(), 0, 10, 1), /positive integers/);
});

test('randomizer is reproducible and only touches selected fields', () => {
  const base = { ...core.defaults(), h_length: 9, h_gap: 7 };
  const a = core.randomize(base, 4242, RandomField.color, RandomStyle.classic);
  const b = core.randomize(base, 4242, RandomField.color, RandomStyle.classic);
  assert.deepEqual(a, b);
  assert.equal(a.h_length, 9, 'size was not selected');
  assert.equal(a.h_gap, 7, 'gap was not selected');
});

test('randomizer always produces a usable crosshair', () => {
  for (let seed = 1; seed <= 400; seed += 1) {
    const config = core.randomize(core.defaults(), seed, 0x1FF, RandomStyle.any);
    assert.equal(core.validate(config), RxStatus.OK, `seed ${seed} produced an invalid config`);
    assert.ok(core.buildGeometry(config).shapes.length > 0, `seed ${seed} drew nothing`);
    assert.ok(config.opacity >= 0.6, `seed ${seed} was too faint`);
  }
});

test('colour helpers agree with the core in both directions', () => {
  assert.equal(core.hsvToHex(150, 1, 1), '#00FF80');
  const hsv = core.hexToHsv('#00FF88');
  assert.ok(Math.abs(hsv.h - 152) < 2, `hue was ${hsv.h}`);
  assert.ok(Math.abs(hsv.s - 1) < 1e-3);
  assert.ok(Math.abs(core.contrast('#000000', '#FFFFFF') - 21) < 0.1);
  assert.ok(core.contrast('#00FF88', '#0B0B0F') > 10);
});

test('matches the golden geometry generated by the native build', async () => {
  const golden = await readJson('frontend/tests/fixtures/geometry-golden.json');

  assert.equal(golden.abiVersion, core.abiVersion);
  assert.equal(golden.configSize, core.configSize);
  assert.equal(golden.configFields, core.fieldCount);
  assert.deepEqual(
    golden.fields.map((field) => field.name),
    core.fields.map((field) => field.name),
    'the native field table and the wasm field table disagree',
  );

  for (const testCase of golden.cases) {
    const config = {};
    core.fields.forEach((field, index) => { config[field.name] = testCase.config[index]; });

    assert.equal(core.fingerprint(config), testCase.fingerprint, `${testCase.name}: fingerprint`);

    const geometry = core.buildGeometry(config);
    assert.equal(geometry.status, testCase.status, `${testCase.name}: status`);
    assert.equal(geometry.shapes.length, testCase.shapes.length, `${testCase.name}: shape count`);
    assert.ok(Math.abs(geometry.extentW - testCase.extent[0]) < 1e-4, `${testCase.name}: extent w`);
    assert.ok(Math.abs(geometry.extentH - testCase.extent[1]) < 1e-4, `${testCase.name}: extent h`);

    geometry.shapes.forEach((shape, index) => {
      const expected = testCase.shapes[index];
      const actual = [shape.cx, shape.cy, shape.hw, shape.hh, shape.angle, shape.radius,
        shape.r, shape.g, shape.b, shape.a];
      actual.forEach((value, component) => {
        assert.ok(
          Math.abs(value - expected[component]) < 1e-4,
          `${testCase.name}: shape ${index} component ${component}: ${value} vs ${expected[component]}`,
        );
      });
      assert.equal(shape.kind, expected[10], `${testCase.name}: shape ${index} kind`);
      assert.equal(shape.layer, expected[11], `${testCase.name}: shape ${index} layer`);
    });
  }
});

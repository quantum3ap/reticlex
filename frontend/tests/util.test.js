/** The small shared helpers, tested where they have real edge cases. */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  clamp, createId, debounce, deepClone, fuzzyMatch, hexToRgb, normalizeHex,
  rgbToHex, round, shallowEqual, sortBy, toFileStem,
} from '../js/core/util.js';

test('clamp keeps values in range and rejects non-numbers', () => {
  assert.equal(clamp(5, 0, 10), 5);
  assert.equal(clamp(-1, 0, 10), 0);
  assert.equal(clamp(99, 0, 10), 10);
  assert.equal(clamp(Number.NaN, 3, 10), 3);
  assert.equal(clamp('abc', 3, 10), 3);
  assert.equal(clamp('7', 0, 10), 7);
});

test('normalizeHex accepts the notations a user might type', () => {
  assert.equal(normalizeHex('#00ff88'), '#00FF88');
  assert.equal(normalizeHex('00ff88'), '#00FF88');
  assert.equal(normalizeHex('  #0f8  '), '#00FF88');
  assert.equal(normalizeHex('#0F8'), '#00FF88');
  for (const bad of ['#gggggg', '#12345', 'red', '', null, undefined, 42, '#1234567']) {
    assert.equal(normalizeHex(bad), null, `${bad} should be rejected`);
  }
});

test('colour conversion round-trips through 8-bit hex', () => {
  for (const hex of ['#000000', '#FFFFFF', '#00FF88', '#123456', '#FF00AA']) {
    assert.equal(rgbToHex(hexToRgb(hex)), hex);
  }
  assert.equal(rgbToHex({ r: -1, g: 2, b: 0.5 }), '#00FF80');
});

test('ids are unique and prefixed', () => {
  const ids = new Set(Array.from({ length: 500 }, () => createId('cx')));
  assert.equal(ids.size, 500);
  assert.ok([...ids][0].startsWith('cx_'));
});

test('toFileStem produces a safe, non-empty filename', () => {
  assert.equal(toFileStem('My Crosshair'), 'My-Crosshair');
  assert.equal(toFileStem('reticle/../../etc/passwd'), 'reticleetcpasswd');
  assert.equal(toFileStem('  '), 'crosshair');
  assert.equal(toFileStem(''), 'crosshair');
  assert.equal(toFileStem(null), 'crosshair');
  assert.equal(toFileStem('<>:"|?*'), 'crosshair');
  assert.ok(toFileStem('x'.repeat(200)).length <= 60);
  // Non-Latin names survive rather than being stripped to nothing.
  assert.equal(toFileStem('نقطة تصويب'), 'نقطة-تصويب');
  assert.equal(toFileStem('準星'), '準星');
});

test('fuzzyMatch ignores case and accents', () => {
  assert.ok(fuzzyMatch('Précision Dot', 'precision'));
  assert.ok(fuzzyMatch('Classic Cross', 'CROSS'));
  assert.ok(fuzzyMatch('anything', ''));
  assert.equal(fuzzyMatch('Classic Cross', 'sniper'), false);
});

test('debounce fires once and can be cancelled or flushed', async () => {
  let calls = 0;
  const fn = debounce((value) => { calls += 1; assert.equal(value, 'last'); }, 10);
  fn('first');
  fn('middle');
  fn('last');
  await new Promise((resolve) => { setTimeout(resolve, 30); });
  assert.equal(calls, 1);

  const cancelled = debounce(() => { throw new Error('should not run'); }, 10);
  cancelled();
  cancelled.cancel();
  await new Promise((resolve) => { setTimeout(resolve, 30); });

  let flushed = 0;
  const flushable = debounce(() => { flushed += 1; }, 1_000);
  flushable();
  flushable.flush();
  assert.equal(flushed, 1);
  flushable.flush();
  assert.equal(flushed, 1, 'flushing twice must not re-run');
});

test('deepClone and shallowEqual behave as the state layer expects', () => {
  const source = { a: 1, nested: { list: [1, 2, { deep: true }] } };
  const copy = deepClone(source);
  copy.nested.list[2].deep = false;
  assert.equal(source.nested.list[2].deep, true);
  assert.ok(shallowEqual({ a: 1 }, { a: 1 }));
  assert.equal(shallowEqual({ a: 1 }, { a: 1, b: 2 }), false);
  assert.equal(shallowEqual(null, { a: 1 }), false);
});

test('sortBy is stable in both directions and does not mutate', () => {
  const items = [{ n: 3 }, { n: 1 }, { n: 2 }];
  assert.deepEqual(sortBy(items, (i) => i.n).map((i) => i.n), [1, 2, 3]);
  assert.deepEqual(sortBy(items, (i) => i.n, 'desc').map((i) => i.n), [3, 2, 1]);
  assert.deepEqual(items.map((i) => i.n), [3, 1, 2], 'the input is untouched');
});

test('round trims floating point noise', () => {
  assert.equal(round(0.1 + 0.2, 2), 0.3);
  assert.equal(round(1.005, 1), 1);
  assert.equal(round(12.3456, 3), 12.346);
});

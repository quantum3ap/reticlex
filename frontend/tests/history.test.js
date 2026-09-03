/** Undo/redo, including the coalescing that keeps a slider drag to one step. */

import test from 'node:test';
import assert from 'node:assert/strict';

import { History } from '../js/core/history.js';

test('starts empty and reports what it can do', () => {
  const history = new History();
  history.reset('a');
  assert.equal(history.current, 'a');
  assert.equal(history.canUndo, false);
  assert.equal(history.canRedo, false);
  assert.equal(history.undo(), null);
  assert.equal(history.redo(), null);
});

test('walks backwards and forwards through the timeline', () => {
  const history = new History();
  history.reset('a');
  history.push('b');
  history.push('c');
  assert.equal(history.current, 'c');
  assert.equal(history.undo(), 'b');
  assert.equal(history.undo(), 'a');
  assert.equal(history.canUndo, false);
  assert.equal(history.redo(), 'b');
  assert.equal(history.redo(), 'c');
  assert.equal(history.canRedo, false);
});

test('a new edit after undo discards the redo branch', () => {
  const history = new History();
  history.reset('a');
  history.push('b');
  history.undo();
  history.push('c');
  assert.equal(history.canRedo, false);
  assert.equal(history.current, 'c');
  assert.equal(history.undo(), 'a');
});

test('collapses a run of edits that share a merge key', () => {
  const history = new History({ coalesceMs: 500 });
  history.reset(0);
  let now = 1_000;
  for (let value = 1; value <= 20; value += 1) {
    history.push(value, { mergeKey: 'h_gap', now: now += 16 });
  }
  assert.equal(history.current, 20);
  assert.equal(history.depth, 1, 'a whole drag should be one entry');
  assert.equal(history.undo(), 0);
});

test('starts a new entry once the merge window lapses', () => {
  const history = new History({ coalesceMs: 500 });
  history.reset(0);
  history.push(1, { mergeKey: 'h_gap', now: 1_000 });
  history.push(2, { mergeKey: 'h_gap', now: 2_000 });
  assert.equal(history.depth, 2);
});

test('a different control never merges into the previous one', () => {
  const history = new History({ coalesceMs: 500 });
  history.reset(0);
  history.push(1, { mergeKey: 'h_gap', now: 1_000 });
  history.push(2, { mergeKey: 'h_length', now: 1_010 });
  assert.equal(history.depth, 2);
});

test('seal ends the merge window explicitly', () => {
  const history = new History({ coalesceMs: 500 });
  history.reset(0);
  history.push(1, { mergeKey: 'h_gap', now: 1_000 });
  history.seal();
  history.push(2, { mergeKey: 'h_gap', now: 1_010 });
  assert.equal(history.depth, 2);
});

test('drops the oldest entries past the limit', () => {
  const history = new History({ limit: 5 });
  history.reset('start');
  for (let i = 0; i < 50; i += 1) history.push(`v${i}`);
  assert.equal(history.depth, 5);
  for (let i = 0; i < 5; i += 1) history.undo();
  assert.equal(history.canUndo, false);
  assert.equal(history.current, 'v44');
});

test('undo and redo clear the merge window', () => {
  const history = new History({ coalesceMs: 5_000 });
  history.reset(0);
  history.push(1, { mergeKey: 'x', now: 1_000 });
  history.undo();
  history.redo();
  history.push(2, { mergeKey: 'x', now: 1_050 });
  assert.equal(history.depth, 2, 'an edit after redo must not merge into it');
});

test('reset clears both directions', () => {
  const history = new History();
  history.reset('a');
  history.push('b');
  history.undo();
  history.reset('fresh');
  assert.equal(history.current, 'fresh');
  assert.equal(history.canUndo, false);
  assert.equal(history.canRedo, false);
});

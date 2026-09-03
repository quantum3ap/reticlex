/** The editing session: dirty tracking, undo integration and document identity. */

import test from 'node:test';
import assert from 'node:assert/strict';

import { loadCore } from './helpers.js';
import { Session } from '../js/core/session.js';
import { createDocument } from '../js/core/schema.js';

const core = await loadCore();

test('a new session is unsaved and dirty', () => {
  const session = new Session(core);
  assert.equal(session.isSaved, false);
  assert.equal(session.dirty, true);
  assert.ok(core.equals(session.config, core.defaults()));
});

test('loading a document clears the dirty flag', () => {
  const session = new Session(core);
  const doc = createDocument({ name: 'Saved', config: core.defaults() });
  session.load(doc);
  assert.equal(session.documentId, doc.id);
  assert.equal(session.name, 'Saved');
  assert.equal(session.dirty, false);
  assert.equal(session.isSaved, true);
});

test('an edit marks the session dirty and returning to the value clears it', () => {
  const session = new Session(core);
  session.load(createDocument({ name: 'X', config: core.defaults() }));
  const original = session.config.h_length;

  session.update({ h_length: original + 6 });
  assert.equal(session.dirty, true);

  session.update({ h_length: original });
  assert.equal(session.dirty, false, 'undoing by hand should count as clean again');
});

test('a change that normalises to the same reticle records no history', () => {
  const session = new Session(core);
  session.load(createDocument({ name: 'X', config: core.defaults() }));
  session.update({ scale: 1e9 });          // clamps to the maximum
  const depthAfterFirst = session.canUndo;
  session.update({ scale: 1e12 });         // clamps to the same maximum
  assert.equal(depthAfterFirst, true);
  session.undo();
  assert.equal(session.canUndo, false, 'the second no-op edit should not be on the stack');
});

test('undo and redo move the configuration', () => {
  const session = new Session(core);
  const start = session.config.h_gap;
  session.update({ h_gap: start + 10 });
  assert.equal(session.config.h_gap, start + 10);
  session.undo();
  assert.equal(session.config.h_gap, start);
  session.redo();
  assert.equal(session.config.h_gap, start + 10);
});

test('a drag collapses into one undo step', () => {
  const session = new Session(core);
  const start = session.config.h_gap;
  for (let i = 1; i <= 15; i += 1) session.update({ h_gap: start + i }, { mergeKey: 'h_gap' });
  session.seal();
  session.undo();
  assert.equal(session.config.h_gap, start);
});

test('replaceConfig keeps the document identity so save still overwrites', () => {
  const session = new Session(core);
  const doc = createDocument({ name: 'Preset target', config: core.defaults() });
  session.load(doc);
  session.replaceConfig(core.randomize(core.defaults(), 99, 0x1FF, 0));
  assert.equal(session.documentId, doc.id);
  assert.equal(session.dirty, true);
  assert.equal(session.toDocument('fallback').id, doc.id);
});

test('toDocument names an untitled crosshair from the fallback', () => {
  const session = new Session(core);
  const doc = session.toDocument('Untitled crosshair');
  assert.equal(doc.name, 'Untitled crosshair');
  assert.equal(doc.kind, 'crosshair');
  assert.ok(doc.id.startsWith('cx_'));
});

test('markSaved adopts the stored identity and clears dirty', () => {
  const session = new Session(core);
  session.update({ h_gap: 12 });
  const stored = { ...session.toDocument('X'), name: 'Stored' };
  session.markSaved(stored);
  assert.equal(session.dirty, false);
  assert.equal(session.name, 'Stored');
  assert.equal(session.documentId, stored.id);
});

test('detach forgets a document that no longer exists', () => {
  const session = new Session(core);
  session.load(createDocument({ name: 'Gone', config: core.defaults() }));
  session.detach();
  assert.equal(session.documentId, null);
  assert.equal(session.dirty, true);
});

test('reset returns to the defaults with an empty history', () => {
  const session = new Session(core);
  session.update({ h_gap: 30 });
  session.reset('Fresh');
  assert.equal(session.name, 'Fresh');
  assert.equal(session.canUndo, false);
  assert.ok(core.equals(session.config, core.defaults()));
});

test('notifies listeners with the reason for the change', () => {
  const session = new Session(core);
  const reasons = [];
  session.onChange((_, reason) => reasons.push(reason));
  session.update({ h_gap: 9 });
  session.undo();
  session.redo();
  session.reset();
  assert.deepEqual(reasons, ['update', 'undo', 'redo', 'reset']);
});

test('a listener that throws does not break the session', () => {
  const session = new Session(core);
  session.onChange(() => { throw new Error('boom'); });
  let reached = false;
  session.onChange(() => { reached = true; });
  session.update({ h_gap: 5 });
  assert.equal(reached, true);
});

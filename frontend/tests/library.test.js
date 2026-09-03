/**
 * The library and its persistence path.
 *
 * A fake bridge stands in for the desktop host so the whole save/load/delete
 * cycle, including what actually reaches storage, can be asserted.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { loadCore, readJson } from './helpers.js';
import { Library } from '../js/core/library.js';
import { createDocument } from '../js/core/schema.js';

const core = await loadCore();
const builtIn = await readJson('presets/builtin.json');

/** Records every call and keeps state, the way the real host would. */
function fakeBridge() {
  const state = { crosshairs: [], presets: [] };
  const calls = [];
  return {
    state,
    calls,
    hasHost: true,
    async call(method, params) {
      calls.push({ method, params });
      const upsert = (list, doc) => {
        const index = list.findIndex((item) => item.id === doc.id);
        if (index >= 0) list[index] = doc; else list.push(doc);
      };
      switch (method) {
        case 'saveCrosshair': upsert(state.crosshairs, params.document); return { id: params.document.id };
        case 'savePreset': upsert(state.presets, params.document); return { id: params.document.id };
        case 'deleteCrosshair':
          state.crosshairs = state.crosshairs.filter((d) => d.id !== params.id); return { id: params.id };
        case 'deletePreset':
          state.presets = state.presets.filter((d) => d.id !== params.id); return { id: params.id };
        case 'clearData': state.crosshairs = []; state.presets = []; return { ok: true };
        default: throw new Error(`unexpected host call ${method}`);
      }
    },
  };
}

function newLibrary() {
  const bridge = fakeBridge();
  const library = new Library(bridge, core);
  library.hydrate([], [], builtIn);
  return { bridge, library };
}

test('hydrates the shipped presets as read-only entries', () => {
  const { library } = newLibrary();
  assert.equal(library.presets.length, builtIn.presets.length);
  assert.ok(library.presets.every((preset) => preset.builtIn));
  assert.equal(library.customPresets.length, 0);
  const classic = library.preset('classic-cross');
  assert.ok(classic);
  assert.equal(core.validate(classic.config), 0);
  assert.equal(classic.accent, '#00FF88');
});

test('discards stored records that are not usable', () => {
  const { library } = newLibrary();
  library.hydrate(
    [null, 'nope', { name: 'no id' }, { id: 'cx_ok', name: 'Fine', config: core.defaults() }],
    [],
    builtIn,
  );
  assert.equal(library.crosshairs.length, 1);
  assert.equal(library.crosshairs[0].name, 'Fine');
});

test('repairs a stored crosshair whose values are out of range', () => {
  const { library } = newLibrary();
  library.hydrate(
    [{ id: 'cx_bad', name: 'Broken', config: { ...core.defaults(), scale: 1e9, h_gap: -50 } }],
    [],
    builtIn,
  );
  const doc = library.crosshair('cx_bad');
  assert.equal(doc.config.scale, 4);
  assert.equal(doc.config.h_gap, 0);
});

test('saving writes through to the host and updates in place', async () => {
  const { bridge, library } = newLibrary();
  const doc = createDocument({ name: 'First', config: core.defaults() });
  const saved = await library.saveCrosshair(doc);
  assert.equal(bridge.state.crosshairs.length, 1);
  assert.equal(library.crosshairs.length, 1);

  await library.saveCrosshair({ ...saved, name: 'Renamed' });
  assert.equal(bridge.state.crosshairs.length, 1, 'a re-save must not duplicate');
  assert.equal(library.crosshair(saved.id).name, 'Renamed');
});

test('what reaches storage is a plain, complete record', async () => {
  const { bridge, library } = newLibrary();
  await library.saveCrosshair(createDocument({ name: 'Payload', config: core.defaults() }));
  const written = bridge.calls.at(-1).params.document;
  assert.deepEqual(
    Object.keys(written).sort(),
    ['config', 'createdAt', 'description', 'id', 'kind', 'name', 'updatedAt'],
  );
  assert.equal(written.kind, 'crosshair');
  assert.equal(typeof written.config.h_length, 'number');
});

test('saving stamps the update time', async () => {
  const { library } = newLibrary();
  const doc = createDocument({ name: 'Stamped', config: core.defaults() });
  doc.updatedAt = '2000-01-01T00:00:00.000Z';
  const saved = await library.saveCrosshair(doc);
  assert.ok(saved.updatedAt > doc.createdAt || saved.updatedAt !== '2000-01-01T00:00:00.000Z');
});

test('deleting removes the record everywhere', async () => {
  const { bridge, library } = newLibrary();
  const saved = await library.saveCrosshair(createDocument({ name: 'Doomed', config: core.defaults() }));
  await library.deleteCrosshair(saved.id);
  assert.equal(library.crosshair(saved.id), null);
  assert.equal(bridge.state.crosshairs.length, 0);
});

test('duplicating copies the reticle under a new identity', async () => {
  const { library } = newLibrary();
  const saved = await library.saveCrosshair(
    createDocument({ name: 'Original', config: core.randomize(core.defaults(), 5, 0x1FF, 0) }),
  );
  const copy = await library.duplicateCrosshair(saved.id, 'Copy');
  assert.notEqual(copy.id, saved.id);
  assert.equal(copy.name, 'Copy');
  assert.ok(core.equals(copy.config, saved.config));
  assert.equal(library.crosshairs.length, 2);
});

test('a built-in preset can be duplicated but never edited or deleted', async () => {
  const { library } = newLibrary();
  await assert.rejects(() => library.deletePreset('classic-cross'), /cannot be deleted/);
  await assert.rejects(
    () => library.savePreset(library.preset('classic-cross')),
    /read-only/,
  );
  const copy = await library.duplicatePreset('classic-cross', 'My Classic');
  assert.equal(copy.builtIn, false);
  assert.equal(library.customPresets.length, 1);
  await library.deletePreset(copy.id);
  assert.equal(library.customPresets.length, 0);
});

test('search filters by name, description and origin', async () => {
  const { library } = newLibrary();
  await library.savePreset(createDocument({
    name: 'My Sniper', description: 'long range', config: core.defaults(), kind: 'preset',
  }));
  const named = (preset) => (preset.builtIn ? preset.id.replace(/-/g, ' ') : preset.name);

  assert.equal(library.searchPresets({ filter: 'custom' }).length, 1);
  assert.equal(library.searchPresets({ filter: 'builtIn' }).length, builtIn.presets.length);
  assert.equal(library.searchPresets({ query: 'sniper', nameFor: named }).length, 1);
  assert.equal(library.searchPresets({ query: 'long range', nameFor: named }).length, 1);
  assert.equal(library.searchPresets({ query: 'SNIPER', nameFor: named }).length, 1);
  assert.equal(library.searchPresets({ query: 'nothing at all', nameFor: named }).length, 0);
});

test('search sorts by name and by recency', async () => {
  const { library } = newLibrary();
  const named = (preset) => (preset.builtIn ? preset.id : preset.name);
  const byName = library.searchPresets({ sort: 'name', nameFor: named }).map(named);
  assert.deepEqual(byName, [...byName].sort());

  await library.savePreset(createDocument({ name: 'Newest', config: core.defaults(), kind: 'preset' }));
  const byRecent = library.searchPresets({ sort: 'recent', nameFor: named });
  assert.equal(byRecent[0].name, 'Newest');
});

test('recent crosshairs come back newest first', async () => {
  const { library } = newLibrary();
  for (const name of ['A', 'B', 'C']) {
    // eslint-disable-next-line no-await-in-loop
    await library.saveCrosshair(createDocument({ name, config: core.defaults() }));
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => { setTimeout(resolve, 2); });
  }
  const recent = library.recentCrosshairs(2);
  assert.equal(recent.length, 2);
  assert.equal(recent[0].name, 'C');
});

test('clearing removes user data but restores the built-ins', async () => {
  const { bridge, library } = newLibrary();
  await library.saveCrosshair(createDocument({ name: 'Gone', config: core.defaults() }));
  await library.savePreset(createDocument({ name: 'Gone too', config: core.defaults(), kind: 'preset' }));
  await library.clear(builtIn);
  assert.equal(library.crosshairs.length, 0);
  assert.equal(library.customPresets.length, 0);
  assert.equal(library.presets.length, builtIn.presets.length);
  assert.equal(bridge.state.crosshairs.length, 0);
});

test('notifies subscribers on every mutation', async () => {
  const { library } = newLibrary();
  let notifications = 0;
  const stop = library.onChange(() => { notifications += 1; });
  const saved = await library.saveCrosshair(createDocument({ name: 'X', config: core.defaults() }));
  await library.deleteCrosshair(saved.id);
  assert.equal(notifications, 2);
  stop();
  await library.saveCrosshair(createDocument({ name: 'Y', config: core.defaults() }));
  assert.equal(notifications, 2, 'unsubscribed listeners stop hearing about it');
});

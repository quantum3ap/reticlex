/**
 * Start-up loading: the shape of it, not the speed.
 *
 * Timing is not something a test can assert without being flaky on a busy
 * machine, so what is checked here is the structure the speed comes from —
 * that every module is hinted, that the fetches start early, and that nothing
 * has quietly gone back to loading one thing at a time.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';

import { ROOT } from './helpers.js';

const read = (relative) => readFile(resolve(ROOT, relative), 'utf8');

async function modulePaths(directory = 'frontend/js', prefix = 'js') {
  const entries = await readdir(resolve(ROOT, directory), { withFileTypes: true });
  const found = [];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      found.push(...await modulePaths(`${directory}/${entry.name}`, `${prefix}/${entry.name}`));
    } else if (entry.name.endsWith('.js')) {
      found.push(`${prefix}/${entry.name}`);
    }
  }
  return found;
}

test('every module is hinted to the browser, so none is discovered late', async () => {
  const html = await read('frontend/index.html');
  const hinted = new Set(
    [...html.matchAll(/<link rel="modulepreload" href="([^"]+)">/g)].map((m) => m[1]),
  );

  // preload.js has its own script tag, which is a stronger hint than a
  // preload: it has to run before the rest, not merely arrive with it.
  assert.ok(html.includes('<script type="module" src="js/preload.js"></script>'));

  const missing = (await modulePaths())
    .filter((path) => path !== 'js/preload.js' && !hinted.has(path));

  assert.deepEqual(missing, [],
    'these modules are not in the modulepreload list in index.html, so the browser '
    + 'will not find them until something imports them');
});

test('the scripts run from the head, not the end of the body', async () => {
  const html = await read('frontend/index.html');
  const head = html.indexOf('</head>');
  const preload = html.indexOf('src="js/preload.js"');
  const app = html.indexOf('src="js/app.js"');

  assert.ok(preload > 0 && preload < head, 'preload.js should be in the head');
  assert.ok(app > 0 && app < head, 'app.js should be in the head');
  assert.ok(preload < app, 'preload.js has to run first or its requests start late');
});

test('preload asks for the three things start-up cannot begin without', async () => {
  const source = await read('frontend/js/preload.js');
  for (const asset of ['assets/reticlex_core.wasm', '../localization/en.json', '../presets/builtin.json']) {
    assert.ok(source.includes(asset), `preload.js no longer fetches ${asset}`);
  }
});

test('start-up does not wait on one thing before asking for the next', async () => {
  const source = await read('frontend/js/app.js');

  // The three are started together and awaited later. If any of them is ever
  // awaited on the line that starts it, the waterfall is back.
  for (const started of [
    'const corePromise = ReticleCore.load(coreResponse);',
    'const presetsPromise = this.#loadBuiltInPresets();',
    'const bootPromise = this.#bootstrapHost();',
  ]) {
    assert.ok(source.includes(started), `start-up no longer begins with: ${started}`);
  }
});

test('the two catalogues are fetched together', async () => {
  const source = await read('frontend/js/core/i18n.js');
  assert.match(source, /Promise\.all\(\[this\.#preload\(DEFAULT_LOCALE\), this\.#preload\(resolved\)\]\)|Promise\.all\(\[this\.preload\(DEFAULT_LOCALE\), this\.preload\(resolved\)\]\)/,
    'use() should load English and the chosen language at the same time');
});

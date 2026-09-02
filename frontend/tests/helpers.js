/**
 * Shared test fixtures.
 *
 * The tests run the real WebAssembly core rather than a stub: it is the piece
 * most likely to break silently, and instantiating it costs a few
 * milliseconds.
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { ReticleCore } from '../js/core/wasm.js';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

let cached = null;

/** Instantiates the wasm core once and shares it across the suite. */
export async function loadCore() {
  if (!cached) {
    const bytes = await readFile(resolve(ROOT, 'frontend/assets/reticlex_core.wasm'));
    cached = await ReticleCore.instantiate(bytes);
  }
  return cached;
}

export async function readJson(relativePath) {
  return JSON.parse(await readFile(resolve(ROOT, relativePath), 'utf8'));
}

export async function loadCatalogue(code) {
  return readJson(`localization/${code}.json`);
}

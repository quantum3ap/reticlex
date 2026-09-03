/**
 * The saved-crosshair and preset collections.
 *
 * Two collections with the same shape: crosshairs the user is working on, and
 * presets (built-in ones shipped with the app plus anything the user promoted
 * to a preset). Every mutation is written through the bridge immediately, so
 * a crash never costs more than the change in flight.
 */

import { createDocument, jsonToCrosshair } from './schema.js';
import { createId, fuzzyMatch, sortBy } from './util.js';

export class Library {
  #crosshairs = new Map();
  #presets = new Map();
  #listeners = new Set();

  constructor(bridge, core) {
    this.bridge = bridge;
    this.core = core;
  }

  onChange(listener) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #emit() {
    for (const listener of [...this.#listeners]) {
      try {
        listener(this);
      } catch (error) {
        console.error('[library] listener failed', error);
      }
    }
  }

  /**
   * Seeds both collections.
   * @param {object[]} crosshairs stored user documents
   * @param {object[]} presets    stored user presets
   * @param {object}   builtIn    the shipped preset pack
   */
  hydrate(crosshairs, presets, builtIn) {
    this.#crosshairs.clear();
    this.#presets.clear();

    for (const entry of builtIn?.presets ?? []) {
      const doc = this.#materializeBuiltIn(entry);
      if (doc) this.#presets.set(doc.id, doc);
    }
    for (const raw of presets ?? []) {
      const doc = this.#materialize(raw, 'preset');
      // A stored preset never overrides a built-in of the same id; ids differ
      // by construction, but a hand-edited file could collide.
      if (doc && !doc.builtIn) this.#presets.set(doc.id, doc);
    }
    for (const raw of crosshairs ?? []) {
      const doc = this.#materialize(raw, 'crosshair');
      if (doc) this.#crosshairs.set(doc.id, doc);
    }
    this.#emit();
  }

  #materializeBuiltIn(entry) {
    if (!entry?.id) return null;
    const defaults = this.core.defaults();
    const { config } = jsonToCrosshair(entry.crosshair, defaults);
    const { config: normalized } = this.core.normalize(config);
    return {
      id: entry.id,
      kind: 'preset',
      builtIn: true,
      accent: entry.accent ?? null,
      // Built-in names and descriptions are localized at render time from
      // preset.<id>.name / .description; these are only fallbacks.
      name: entry.id,
      description: '',
      createdAt: '1970-01-01T00:00:00.000Z',
      updatedAt: '1970-01-01T00:00:00.000Z',
      config: normalized,
    };
  }

  /** Rebuilds a stored record, discarding anything unusable. */
  #materialize(raw, kind) {
    if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string') return null;
    const defaults = this.core.defaults();
    const source = raw.config ?? raw.crosshair;
    const { config } = jsonToCrosshair(source, defaults);
    const { config: normalized } = this.core.normalize(config);
    return {
      id: raw.id,
      kind: raw.kind === 'preset' ? 'preset' : kind,
      builtIn: false,
      accent: null,
      name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.slice(0, 80) : 'Untitled',
      description: typeof raw.description === 'string' ? raw.description.slice(0, 240) : '',
      createdAt: isoOr(raw.createdAt),
      updatedAt: isoOr(raw.updatedAt),
      config: normalized,
    };
  }

  get crosshairs() { return [...this.#crosshairs.values()]; }
  get presets() { return [...this.#presets.values()]; }
  get customPresets() { return this.presets.filter((preset) => !preset.builtIn); }

  crosshair(id) { return this.#crosshairs.get(id) ?? null; }
  preset(id) { return this.#presets.get(id) ?? null; }

  /** Most recently updated first; used by the Home page. */
  recentCrosshairs(limit = 6) {
    return sortBy(this.crosshairs, (doc) => doc.updatedAt, 'desc').slice(0, limit);
  }

  /**
   * @param {{query?:string, filter?:'all'|'builtIn'|'custom', sort?:'name'|'recent',
   *          nameFor?:(doc:object)=>string}} options
   */
  searchPresets({ query = '', filter = 'all', sort = 'name', nameFor = (doc) => doc.name } = {}) {
    let list = this.presets;
    if (filter === 'builtIn') list = list.filter((preset) => preset.builtIn);
    if (filter === 'custom') list = list.filter((preset) => !preset.builtIn);
    if (query.trim()) {
      list = list.filter((preset) => fuzzyMatch(nameFor(preset), query)
        || fuzzyMatch(preset.description ?? '', query));
    }
    return sort === 'recent'
      ? sortBy(list, (preset) => preset.updatedAt, 'desc')
      : sortBy(list, (preset) => nameFor(preset).toLocaleLowerCase(), 'asc');
  }

  async saveCrosshair(doc) {
    const stored = { ...doc, kind: 'crosshair', updatedAt: new Date().toISOString() };
    await this.bridge.call('saveCrosshair', { document: serialize(stored) });
    this.#crosshairs.set(stored.id, stored);
    this.#emit();
    return stored;
  }

  async deleteCrosshair(id) {
    await this.bridge.call('deleteCrosshair', { id });
    this.#crosshairs.delete(id);
    this.#emit();
  }

  async duplicateCrosshair(id, name) {
    const source = this.crosshair(id);
    if (!source) throw new Error(`No crosshair with id ${id}`);
    const copy = createDocument({
      name: name ?? `${source.name} copy`,
      description: source.description,
      config: { ...source.config },
      kind: 'crosshair',
    });
    return this.saveCrosshair(copy);
  }

  async savePreset(doc) {
    if (doc.builtIn) throw new Error('Built-in presets are read-only');
    const stored = { ...doc, kind: 'preset', builtIn: false, updatedAt: new Date().toISOString() };
    await this.bridge.call('savePreset', { document: serialize(stored) });
    this.#presets.set(stored.id, stored);
    this.#emit();
    return stored;
  }

  async deletePreset(id) {
    const preset = this.preset(id);
    if (!preset) return;
    if (preset.builtIn) throw new Error('Built-in presets cannot be deleted');
    await this.bridge.call('deletePreset', { id });
    this.#presets.delete(id);
    this.#emit();
  }

  /** Copies a preset (including a built-in) into the user's own presets. */
  async duplicatePreset(id, name) {
    const source = this.preset(id);
    if (!source) throw new Error(`No preset with id ${id}`);
    const copy = createDocument({
      name: name ?? `${source.name} copy`,
      description: source.description,
      config: { ...source.config },
      kind: 'preset',
      id: createId('ps'),
    });
    return this.savePreset(copy);
  }

  /** Wipes every user document; built-in presets are restored afterwards. */
  async clear(builtIn) {
    await this.bridge.call('clearData', {});
    this.hydrate([], [], builtIn);
  }
}

function serialize(doc) {
  return {
    id: doc.id,
    kind: doc.kind,
    name: doc.name,
    description: doc.description ?? '',
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    config: doc.config,
  };
}

function isoOr(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

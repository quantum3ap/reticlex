/**
 * The crosshair currently being edited.
 *
 * Wraps the working configuration, its identity in the library, and the undo
 * stack. Every mutation goes through here so undo/redo, the dirty flag and the
 * preview can never disagree about what the user is looking at.
 */

import { History } from './history.js';
import { createDocument } from './schema.js';

export class Session {
  #core;
  #history;
  #listeners = new Set();
  #savedFingerprint = null;

  constructor(core, { historyLimit = 120 } = {}) {
    this.#core = core;
    this.#history = new History({ limit: historyLimit, coalesceMs: 500 });
    this.documentId = null;
    this.name = '';
    this.description = '';
    this.createdAt = new Date().toISOString();
    this.#history.reset(core.defaults());
    this.#savedFingerprint = null;
  }

  get config() { return this.#history.current; }
  get canUndo() { return this.#history.canUndo; }
  get canRedo() { return this.#history.canRedo; }
  get isSaved() { return this.documentId !== null; }

  /** True when the working copy differs from what is on disk. */
  get dirty() {
    if (this.#savedFingerprint === null) return true;
    return this.#core.fingerprint(this.config) !== this.#savedFingerprint;
  }

  onChange(listener) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #emit(reason) {
    for (const listener of [...this.#listeners]) {
      try {
        listener(this, reason);
      } catch (error) {
        console.error('[session] listener failed', error);
      }
    }
  }

  /** Starts a brand new, unsaved crosshair. */
  reset(name = '') {
    this.documentId = null;
    this.name = name;
    this.description = '';
    this.createdAt = new Date().toISOString();
    this.#history.reset(this.#core.defaults());
    this.#savedFingerprint = null;
    this.#emit('reset');
    return this.config;
  }

  /** Opens a stored document for editing. */
  load(doc) {
    this.documentId = doc.id ?? null;
    this.name = doc.name ?? '';
    this.description = doc.description ?? '';
    this.createdAt = doc.createdAt ?? new Date().toISOString();
    const { config } = this.#core.normalize(doc.config);
    this.#history.reset(config);
    this.#savedFingerprint = this.#core.fingerprint(config);
    this.#emit('load');
    return this.config;
  }

  /**
   * Replaces the configuration wholesale, e.g. applying a preset or a
   * randomizer result. Keeps the current identity so "save" still overwrites
   * the same document.
   */
  replaceConfig(config, { mergeKey = null, reason = 'replace' } = {}) {
    const { config: normalized } = this.#core.normalize(config);
    this.#history.push(normalized, { mergeKey });
    this.#emit(reason);
    return this.config;
  }

  /**
   * Applies a partial change to the flat config.
   * @param {object} patch  fields to overwrite
   * @param {{mergeKey?:string}} options mergeKey collapses a slider drag into
   *        one undo entry; pass the field name while dragging.
   */
  update(patch, { mergeKey = null } = {}) {
    const next = { ...this.config, ...patch };
    const { config: normalized } = this.#core.normalize(next);
    // Normalisation can land back on the current reticle (a slider nudged
    // past its limit, a flag re-set to the value it already had). Recording
    // that would fill the undo stack with steps that change nothing.
    if (this.#core.fingerprint(normalized) === this.#core.fingerprint(this.config)) {
      return this.config;
    }
    this.#history.push(normalized, { mergeKey });
    this.#emit('update');
    return this.config;
  }

  /** Ends the current coalescing window so the next edit starts a new entry. */
  seal() { this.#history.seal(); }

  undo() {
    const previous = this.#history.undo();
    if (previous === null) return null;
    this.#emit('undo');
    return previous;
  }

  redo() {
    const next = this.#history.redo();
    if (next === null) return null;
    this.#emit('redo');
    return next;
  }

  setMeta({ name, description }) {
    if (name !== undefined) this.name = String(name).slice(0, 80);
    if (description !== undefined) this.description = String(description).slice(0, 240);
    this.#emit('meta');
  }

  /** Builds the document that should be written to the library. */
  toDocument(fallbackName) {
    const name = this.name.trim() || fallbackName;
    if (this.documentId) {
      return {
        id: this.documentId,
        kind: 'crosshair',
        builtIn: false,
        name,
        description: this.description,
        createdAt: this.createdAt,
        updatedAt: new Date().toISOString(),
        config: this.config,
      };
    }
    return createDocument({ name, description: this.description, config: this.config });
  }

  /** Records that the working copy now matches storage. */
  markSaved(doc) {
    this.documentId = doc.id;
    this.name = doc.name;
    this.description = doc.description ?? '';
    this.createdAt = doc.createdAt ?? this.createdAt;
    this.#savedFingerprint = this.#core.fingerprint(doc.config);
    this.#emit('saved');
  }

  /** Forgets the link to a document that no longer exists. */
  detach() {
    this.documentId = null;
    this.#savedFingerprint = null;
    this.#emit('detach');
  }
}

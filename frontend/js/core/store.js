/**
 * Minimal observable state container.
 *
 * The app has one store; pages subscribe to the slices they care about.
 * Listeners run synchronously so the preview updates in the same task as the
 * input event that caused it, which is what makes editing feel immediate.
 */

export class Store {
  #state;
  #listeners = new Set();
  #keyed = new Map();

  constructor(initial = {}) {
    this.#state = { ...initial };
  }

  get state() { return this.#state; }

  /** Shallow-merges a patch and notifies only the affected subscribers. */
  set(patch) {
    const changed = [];
    for (const [key, value] of Object.entries(patch)) {
      if (this.#state[key] !== value) {
        this.#state[key] = value;
        changed.push(key);
      }
    }
    if (changed.length === 0) return this.#state;
    this.#emit(changed);
    return this.#state;
  }

  /** Forces listeners to run even when object identity did not change. */
  touch(...keys) {
    this.#emit(keys.length > 0 ? keys : Object.keys(this.#state));
  }

  subscribe(listener) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** Subscribes to a single key; the listener receives the new value. */
  on(key, listener) {
    if (!this.#keyed.has(key)) this.#keyed.set(key, new Set());
    this.#keyed.get(key).add(listener);
    return () => this.#keyed.get(key)?.delete(listener);
  }

  #emit(changed) {
    for (const key of changed) {
      const listeners = this.#keyed.get(key);
      if (!listeners) continue;
      for (const listener of [...listeners]) {
        try {
          listener(this.#state[key], this.#state);
        } catch (error) {
          console.error(`[store] listener for "${key}" failed`, error);
        }
      }
    }
    for (const listener of [...this.#listeners]) {
      try {
        listener(this.#state, changed);
      } catch (error) {
        console.error('[store] listener failed', error);
      }
    }
  }
}

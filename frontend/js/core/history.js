/**
 * Bounded undo/redo stack.
 *
 * Dragging a slider produces a value per animation frame, so consecutive
 * entries carrying the same merge key inside a short window collapse into one.
 * Without that, a single drag would swallow the entire undo history.
 */

export class History {
  #past = [];
  #future = [];
  #present = null;
  #lastKey = null;
  #lastAt = 0;

  constructor({ limit = 100, coalesceMs = 500 } = {}) {
    this.limit = limit;
    this.coalesceMs = coalesceMs;
  }

  /** Replaces the entire timeline, e.g. when a different document is opened. */
  reset(state) {
    this.#past = [];
    this.#future = [];
    this.#present = state;
    this.#lastKey = null;
    this.#lastAt = 0;
    return this.#present;
  }

  get current() { return this.#present; }
  get canUndo() { return this.#past.length > 0; }
  get canRedo() { return this.#future.length > 0; }
  get depth() { return this.#past.length; }

  /**
   * @param {*} state the new present value
   * @param {{mergeKey?:string, now?:number}} options mergeKey groups a drag
   */
  push(state, { mergeKey = null, now = Date.now() } = {}) {
    if (this.#present === null) return this.reset(state);

    const mergeable = mergeKey !== null
      && mergeKey === this.#lastKey
      && now - this.#lastAt <= this.coalesceMs;

    if (!mergeable) {
      this.#past.push(this.#present);
      if (this.#past.length > this.limit) this.#past.shift();
    }

    this.#present = state;
    this.#future.length = 0;
    this.#lastKey = mergeKey;
    this.#lastAt = now;
    return this.#present;
  }

  /** Ends any open coalescing window, so the next edit starts a fresh entry. */
  seal() {
    this.#lastKey = null;
    this.#lastAt = 0;
  }

  undo() {
    if (!this.canUndo) return null;
    this.#future.push(this.#present);
    this.#present = this.#past.pop();
    this.seal();
    return this.#present;
  }

  redo() {
    if (!this.canRedo) return null;
    this.#past.push(this.#present);
    this.#present = this.#future.pop();
    this.seal();
    return this.#present;
  }
}

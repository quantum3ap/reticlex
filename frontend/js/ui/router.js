/**
 * Page router.
 *
 * Pages are created once and kept alive, so returning to the designer restores
 * scroll position and control state instead of rebuilding everything. The
 * outgoing page fades and lifts while the incoming one settles in; when the
 * user has turned animations off the swap is instant.
 */

const TRANSITION_MS = 220;

export class Router {
  #pages = new Map();
  #current = null;
  #listeners = new Set();
  #transitioning = false;

  /**
   * @param {HTMLElement} outlet container the pages are mounted into
   */
  constructor(outlet) {
    this.outlet = outlet;
  }

  /**
   * Wraps the page's content in its own scroll container.
   *
   * The wrapper is what gets positioned and animated; the page's own element
   * stays a plain in-flow block so its grid rows size from their content
   * rather than being squeezed into the viewport height.
   *
   * @param {string} id
   * @param {{element:HTMLElement, onEnter?:Function, onLeave?:Function}} page
   */
  register(id, page) {
    const host = document.createElement('div');
    host.className = 'page';
    host.hidden = true;
    host.append(page.element);
    page.host = host;
    this.#pages.set(id, page);
    this.outlet.append(host);
    return page;
  }

  get current() { return this.#current; }
  get ids() { return [...this.#pages.keys()]; }

  onNavigate(listener) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  has(id) { return this.#pages.has(id); }

  /**
   * @param {string} id target page
   * @param {object} [params] passed through to the page's onEnter
   */
  navigate(id, params = {}) {
    if (!this.#pages.has(id)) {
      console.warn(`[router] unknown page "${id}"`);
      return false;
    }
    if (id === this.#current && !params.force) return false;

    const next = this.#pages.get(id);
    const previous = this.#current ? this.#pages.get(this.#current) : null;
    const animate = document.documentElement.dataset.animations !== 'off';

    // Guard against a second navigation landing mid-transition and leaving two
    // pages visible at once.
    this.#transitioning = true;

    const reveal = () => {
      next.host.hidden = false;
      next.host.classList.remove('page--leaving');
      next.host.classList.add('page--entering');
      next.onEnter?.(params);
      requestAnimationFrame(() => {
        next.host.classList.remove('page--entering');
        next.host.classList.add('page--active');
        this.#transitioning = false;
      });
    };

    if (previous) {
      previous.onLeave?.();
      previous.host.classList.remove('page--active');
      if (animate) {
        previous.host.classList.add('page--leaving');
        setTimeout(() => {
          previous.host.hidden = true;
          previous.host.classList.remove('page--leaving');
        }, TRANSITION_MS);
      } else {
        previous.host.hidden = true;
      }
    }

    this.#current = id;
    reveal();

    for (const listener of [...this.#listeners]) {
      try {
        listener(id, params);
      } catch (error) {
        console.error('[router] navigation listener failed', error);
      }
    }
    return true;
  }

  /** Re-runs onEnter for the visible page, e.g. after the library changes. */
  refresh(params = {}) {
    if (!this.#current) return;
    this.#pages.get(this.#current)?.onEnter?.({ ...params, refresh: true });
  }
}

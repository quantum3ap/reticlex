/**
 * Starts the three fetches start-up cannot begin without, as early as the
 * browser will let us.
 *
 * Without this they are discovered one at a time: the module graph has to
 * finish downloading before app.js runs, app.js then asks for the core, the
 * core has to arrive before the catalogue is asked for, and so on. Four round
 * trips in a line, each one waiting on the last, for files that have nothing
 * to do with each other.
 *
 * This module is loaded by its own script tag ahead of app.js, so it runs the
 * moment it arrives rather than waiting for the rest of the graph. app.js then
 * imports it and gets the same module instance — and so the same promises,
 * already in flight — because a module is only ever evaluated once.
 *
 * Paths are relative to the document, not to this file: that is how fetch
 * resolves, and it is the same base app.js was written against.
 */

/**
 * Attaches a no-op handler so a failure here is never an unhandled rejection.
 * The promise itself is unchanged, so whoever awaits it still sees the error
 * and still decides what it means — a missing catalogue is fatal, a missing
 * preset pack is not.
 */
function quiet(promise) {
  promise.catch(() => {});
  return promise;
}

/** The WebAssembly core, as a live response for streaming compilation. */
export const coreResponse = quiet(fetch('assets/reticlex_core.wasm'));

/** English, which is always resident: every lookup falls back to it. */
export const englishCatalogue = quiet(
  fetch('../localization/en.json').then((response) => {
    if (!response.ok) throw new Error(`Missing catalogue for en: ${response.status}`);
    return response.json();
  }),
);

/** The built-in preset pack. */
export const builtInPresets = quiet(
  fetch('../presets/builtin.json').then((response) => {
    if (!response.ok) throw new Error(`Built-in presets unavailable: ${response.status}`);
    return response.json();
  }),
);

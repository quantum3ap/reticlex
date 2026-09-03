/**
 * The boundary between the user interface and whatever is hosting it.
 *
 * In the shipped application that host is the C# WPF shell, reached over the
 * WebView2 message channel. Opened directly in a browser (which is how the UI
 * is developed and tested) the same interface is served by a local fallback
 * backed by localStorage and ordinary file inputs, so every screen stays
 * usable and nothing has to branch on "are we in the app".
 */

const REQUEST_TIMEOUT_MS = 30_000;
const STORAGE_KEY = 'reticlex.local.v1';

/** Thrown when the host rejects a call or never answers. */
export class BridgeError extends Error {
  constructor(message, method) {
    super(message);
    this.name = 'BridgeError';
    this.method = method;
  }
}

class WebViewBridge {
  #pending = new Map();
  #listeners = new Map();
  #nextId = 1;

  constructor(webview) {
    this.webview = webview;
    this.hasHost = true;
    this.webview.addEventListener('message', (event) => this.#receive(event.data));
  }

  #receive(message) {
    if (!message || typeof message !== 'object') return;
    if (message.event) {
      for (const listener of this.#listeners.get(message.event) ?? []) {
        try {
          listener(message.payload);
        } catch (error) {
          console.error(`[bridge] handler for "${message.event}" failed`, error);
        }
      }
      return;
    }
    const entry = this.#pending.get(message.id);
    if (!entry) return;
    this.#pending.delete(message.id);
    clearTimeout(entry.timer);
    if (message.ok) entry.resolve(message.result);
    else entry.reject(new BridgeError(message.error ?? 'Host call failed', entry.method));
  }

  on(event, listener) {
    if (!this.#listeners.has(event)) this.#listeners.set(event, new Set());
    this.#listeners.get(event).add(listener);
    return () => this.#listeners.get(event)?.delete(listener);
  }

  call(method, params = {}) {
    const id = this.#nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new BridgeError(`Host did not answer "${method}" in time`, method));
      }, REQUEST_TIMEOUT_MS);
      this.#pending.set(id, { resolve, reject, timer, method });
      try {
        this.webview.postMessage({ id, method, params });
      } catch (error) {
        clearTimeout(timer);
        this.#pending.delete(id);
        reject(new BridgeError(error.message, method));
      }
    });
  }
}

/**
 * Browser-only stand-in for the desktop host.
 *
 * It is a genuine implementation rather than a stub: the UI is fully usable
 * without the shell, which is what makes the front end testable on its own.
 */
class LocalBridge {
  #listeners = new Map();

  constructor() {
    this.hasHost = false;
  }

  on(event, listener) {
    if (!this.#listeners.has(event)) this.#listeners.set(event, new Set());
    this.#listeners.get(event).add(listener);
    return () => this.#listeners.get(event)?.delete(listener);
  }

  #read() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return { settings: null, crosshairs: [], presets: [] };
      const parsed = JSON.parse(raw);
      return {
        settings: parsed.settings ?? null,
        crosshairs: Array.isArray(parsed.crosshairs) ? parsed.crosshairs : [],
        presets: Array.isArray(parsed.presets) ? parsed.presets : [],
      };
    } catch (error) {
      console.warn('[bridge] local store unreadable, starting fresh', error);
      return { settings: null, crosshairs: [], presets: [] };
    }
  }

  #write(state) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (error) {
      throw new BridgeError(`Local storage rejected the write: ${error.message}`, 'write');
    }
  }

  #upsert(collection, doc) {
    const state = this.#read();
    const list = state[collection];
    const index = list.findIndex((item) => item.id === doc.id);
    if (index >= 0) list[index] = doc;
    else list.push(doc);
    this.#write(state);
    return { id: doc.id };
  }

  #remove(collection, id) {
    const state = this.#read();
    state[collection] = state[collection].filter((item) => item.id !== id);
    this.#write(state);
    return { id };
  }

  async call(method, params = {}) {
    switch (method) {
      case 'bootstrap': {
        const state = this.#read();
        return {
          appVersion: '1.0.0',
          systemLocale: navigator.language ?? 'en',
          dataPath: 'localStorage',
          hasHost: false,
          startWithWindows: false,
          settings: state.settings,
          crosshairs: state.crosshairs,
          presets: state.presets,
        };
      }
      case 'saveSettings': {
        const state = this.#read();
        state.settings = params.settings;
        this.#write(state);
        return { ok: true };
      }
      case 'saveCrosshair':
        return this.#upsert('crosshairs', params.document);
      case 'deleteCrosshair':
        return this.#remove('crosshairs', params.id);
      case 'savePreset':
        return this.#upsert('presets', params.document);
      case 'deletePreset':
        return this.#remove('presets', params.id);
      case 'clearData':
        this.#write({ settings: this.#read().settings, crosshairs: [], presets: [] });
        return { ok: true };
      case 'openImportDialog':
        return pickTextFile(params.accept ?? '.json,application/json');
      case 'saveExportDialog':
        downloadText(params.suggestedName ?? 'crosshair.json', params.text ?? '');
        return { ok: true, fileName: params.suggestedName ?? 'crosshair.json' };
      case 'savePng':
        downloadDataUrl(params.suggestedName ?? 'crosshair.png', params.dataUrl);
        return { ok: true, fileName: params.suggestedName ?? 'crosshair.png' };
      case 'pickImage':
        return pickImageFile();
      case 'setStartWithWindows':
        // Only the desktop host can register a startup entry.
        return { ok: false, enabled: false, unsupported: true };
      case 'openExternal':
        window.open(params.url, '_blank', 'noopener,noreferrer');
        return { ok: true };
      case 'openDataFolder':
        return { ok: false, unsupported: true };
      case 'window':
        return { ok: false, unsupported: true };
      // The overlay is a real window drawn over the desktop, so a browser
      // cannot provide it. Reporting "not supported" rather than throwing keeps
      // the settings page rendering with the controls explained and disabled.
      case 'overlayInfo':
      case 'overlaySet':
        return {
          supported: false,
          enabled: false,
          monitor: '',
          offsetX: 0,
          offsetY: 0,
          hotkey: 'Ctrl+Shift+X',
          hotkeyRegistered: false,
          maxOffset: 4000,
          monitors: [],
        };
      case 'overlayConfig':
        return { ok: false, unsupported: true };
      default:
        throw new BridgeError(`Unknown host method "${method}"`, method);
    }
  }
}

function pickTextFile(accept) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.style.display = 'none';
    // A cancelled picker fires no change event in most browsers; the focus
    // handler is the only reliable way to notice and settle the promise.
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      input.remove();
      resolve(value);
    };
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (!file) return finish({ ok: false, cancelled: true });
      const reader = new FileReader();
      reader.onload = () => finish({ ok: true, fileName: file.name, text: String(reader.result) });
      reader.onerror = () => finish({ ok: false, error: 'read' });
      reader.readAsText(file);
    });
    window.addEventListener('focus', () => {
      setTimeout(() => {
        if (!input.files || input.files.length === 0) finish({ ok: false, cancelled: true });
      }, 400);
    }, { once: true });
    document.body.append(input);
    input.click();
  });
}

function pickImageFile() {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.style.display = 'none';
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      input.remove();
      resolve(value);
    };
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (!file) return finish({ ok: false, cancelled: true });
      const reader = new FileReader();
      reader.onload = () => finish({ ok: true, fileName: file.name, dataUrl: String(reader.result) });
      reader.onerror = () => finish({ ok: false, error: 'read' });
      reader.readAsDataURL(file);
    });
    window.addEventListener('focus', () => {
      setTimeout(() => {
        if (!input.files || input.files.length === 0) finish({ ok: false, cancelled: true });
      }, 400);
    }, { once: true });
    document.body.append(input);
    input.click();
  });
}

function downloadText(fileName, text) {
  const blob = new Blob([text], { type: 'application/json' });
  triggerDownload(fileName, URL.createObjectURL(blob), true);
}

function downloadDataUrl(fileName, dataUrl) {
  triggerDownload(fileName, dataUrl, false);
}

function triggerDownload(fileName, href, revoke) {
  const anchor = document.createElement('a');
  anchor.href = href;
  anchor.download = fileName;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  if (revoke) setTimeout(() => URL.revokeObjectURL(href), 10_000);
}

/**
 * Picks the right transport for the current environment.
 * @returns {{hasHost:boolean, call:Function, on:Function}}
 */
export function createBridge() {
  const webview = globalThis.chrome?.webview;
  if (webview && typeof webview.postMessage === 'function') {
    return new WebViewBridge(webview);
  }
  return new LocalBridge();
}

export { LocalBridge, WebViewBridge };

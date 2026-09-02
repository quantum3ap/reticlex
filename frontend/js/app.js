/**
 * Application entry point.
 *
 * Loads the native core, restores state through the host bridge, wires the
 * shell and hands a single `app` object to the pages. Everything a page needs
 * — services, the editing session, and the actions that mutate state — hangs
 * off that object, so no page reaches for a global.
 */

import { ReticleCore } from './core/wasm.js';
import { createBridge } from './core/bridge.js';
import { I18n, LOCALES, applyTranslations, localeInfo, resolveLocale } from './core/i18n.js';
import { Library } from './core/library.js';
import { Session } from './core/session.js';
import { Store } from './core/store.js';
import {
  ACCENTS, THEMES, applyAppearance, applyLocale, canPersistBackground,
  defaultSettings, normalizeSettings,
} from './core/settings.js';
import {
  documentToJson, parseImport, toPresetPack, createDocument,
} from './core/schema.js';
import { debounce, toFileStem } from './core/util.js';

import { Toasts } from './ui/toast.js';
import { Tooltips } from './ui/tooltip.js';
import { Modals } from './ui/modal.js';
import { Router } from './ui/router.js';
import { h } from './ui/dom.js';
import { icon } from './ui/icons.js';

import { createHomePage } from './pages/home.js';
import { createDesignerPage } from './pages/designer.js';
import { createPresetsPage } from './pages/presets.js';
import { createRandomizerPage } from './pages/randomizer.js';
import { createSettingsPage } from './pages/settings.js';

import { SHORTCUTS, registerShortcuts } from './shortcuts.js';

const AUTOSAVE_DELAY = 1200;

class App {
  constructor() {
    this.store = new Store({ page: 'home' });
    this.settings = defaultSettings();
    this.appVersion = '1.0.0';
    this.hasHost = false;
    this.dataPath = '';
  }

  async boot() {
    this.bridge = createBridge();
    this.hasHost = this.bridge.hasHost;

    this.core = await ReticleCore.load('assets/reticlex_core.wasm');

    this.i18n = new I18n({
      loader: async (code) => {
        const response = await fetch(`../localization/${code}.json`);
        if (!response.ok) throw new Error(`Missing catalogue for ${code}`);
        return response.json();
      },
    });

    const boot = await this.#bootstrapHost();
    const { settings } = normalizeSettings(boot.settings);
    this.settings = settings;
    this.appVersion = boot.appVersion ?? '1.0.0';
    this.dataPath = boot.dataPath ?? '';

    // First launch: follow Windows (or the browser) rather than defaulting to
    // English for someone who never asked for it.
    if (!this.settings.localeChosen) {
      this.settings.locale = resolveLocale(boot.systemLocale);
    }
    if (typeof boot.startWithWindows === 'boolean') {
      this.settings.startWithWindows = boot.startWithWindows;
    }

    await this.i18n.use(this.settings.locale);
    applyAppearance(this.settings);
    applyLocale(this.settings.locale);

    this.session = new Session(this.core);
    this.library = new Library(this.bridge, this.core);
    this.library.hydrate(boot.crosshairs ?? [], boot.presets ?? [], await this.#loadBuiltInPresets());

    this.toasts = new Toasts(document.getElementById('toasts'), this.i18n);
    this.modals = new Modals(document.body, this.i18n);
    this.tooltips = new Tooltips(this.i18n);

    this.#hydrateIcons(document);
    this.#buildRouter();
    this.#wireShell();
    this.#wireSession();
    this.#wireShortcuts();

    applyTranslations(document.body, this.i18n);

    // Reopen whatever was being edited last, when it still exists.
    const last = this.settings.lastDocumentId
      ? this.library.crosshair(this.settings.lastDocumentId)
      : null;
    if (last) this.session.load(last);
    else this.session.reset();

    const startPage = this.router.has(this.settings.lastPage) ? this.settings.lastPage : 'home';
    this.router.navigate(startPage);

    document.getElementById('boot').hidden = true;
    document.getElementById('app').hidden = false;
    document.getElementById('app-version').textContent = `v${this.appVersion}`;

    if (!this.hasHost) {
      this.toasts.show({ messageKey: 'error.hostUnavailable', type: 'info', duration: 5200 });
    }
  }

  async #bootstrapHost() {
    try {
      return await this.bridge.call('bootstrap', {});
    } catch (error) {
      console.error('[app] bootstrap failed', error);
      return { settings: null, crosshairs: [], presets: [], appVersion: '1.0.0' };
    }
  }

  async #loadBuiltInPresets() {
    try {
      const response = await fetch('../presets/builtin.json');
      if (!response.ok) throw new Error(String(response.status));
      return await response.json();
    } catch (error) {
      // Missing built-ins degrade the Presets page but must not stop start-up.
      console.error('[app] built-in presets unavailable', error);
      return { presets: [] };
    }
  }

  /** Replaces every [data-icon] placeholder with its inline SVG. */
  #hydrateIcons(root) {
    for (const node of root.querySelectorAll('[data-icon]')) {
      const name = node.dataset.icon;
      node.replaceChildren(icon(name, { size: node.dataset.iconSize ? Number(node.dataset.iconSize) : 18 }));
    }
  }

  #buildRouter() {
    this.router = new Router(document.getElementById('outlet'));
    this.router.register('home', createHomePage(this));
    this.router.register('designer', createDesignerPage(this));
    this.router.register('presets', createPresetsPage(this));
    this.router.register('randomizer', createRandomizerPage(this));
    this.router.register('settings', createSettingsPage(this));

    this.router.onNavigate((id) => {
      document.getElementById('page-title').dataset.i18n = `nav.${id}`;
      document.getElementById('page-title').textContent = this.i18n.t(`nav.${id}`);
      for (const button of document.querySelectorAll('.nav__item')) {
        const active = button.dataset.page === id;
        button.classList.toggle('is-active', active);
        button.setAttribute('aria-current', active ? 'page' : 'false');
      }
      this.#moveNavIndicator(id);
      document.getElementById('topbar-actions').dataset.context = id;
      if (this.settings.lastPage !== id) this.saveSettings({ lastPage: id });
    });
  }

  #moveNavIndicator(id) {
    const indicator = document.getElementById('nav-indicator');
    const button = document.querySelector(`.nav__item[data-page="${id}"]`);
    if (!indicator || !button) return;
    const sidebar = button.parentElement;
    const top = button.offsetTop - sidebar.scrollTop;
    indicator.style.transform = `translateY(${top}px)`;
    indicator.style.height = `${button.offsetHeight}px`;
    indicator.style.opacity = '1';
  }

  #wireShell() {
    for (const button of document.querySelectorAll('.nav__item')) {
      button.addEventListener('click', () => this.router.navigate(button.dataset.page));
    }
    for (const button of document.querySelectorAll('[data-window-action]')) {
      button.addEventListener('click', () => {
        this.bridge.call('window', { action: button.dataset.windowAction }).catch(() => {});
      });
    }
    for (const button of document.querySelectorAll('[data-action]')) {
      const action = button.dataset.action;
      button.addEventListener('click', () => this.run(action));
    }
    window.addEventListener('resize', () => this.#moveNavIndicator(this.router.current));

    // The host tells us when the window state changes so the restore glyph and
    // the rounded corners can follow.
    this.bridge.on?.('window-state', (payload) => {
      document.getElementById('app').classList.toggle('is-maximized', Boolean(payload?.maximized));
      const button = document.querySelector('[data-window-action="maximize"]');
      if (!button) return;
      const key = payload?.maximized ? 'titlebar.restore' : 'titlebar.maximize';
      button.dataset.i18nAttr = `aria-label:${key};title:${key}`;
      button.setAttribute('aria-label', this.i18n.t(key));
      button.setAttribute('title', this.i18n.t(key));
    });
  }

  #wireSession() {
    this.autoSave = debounce(() => {
      if (!this.settings.autoSave) return;
      if (!this.session.isSaved || !this.session.dirty) return;
      this.saveCurrent({ silent: true }).catch((error) => {
        console.error('[app] auto-save failed', error);
      });
    }, AUTOSAVE_DELAY);

    this.session.onChange(() => {
      this.#refreshDocumentLine();
      this.autoSave();
    });
    this.library.onChange(() => this.router.refresh());
    this.#refreshDocumentLine();
  }

  #refreshDocumentLine() {
    const line = document.getElementById('doc-line');
    const name = document.getElementById('doc-name');
    const dirty = document.getElementById('doc-dirty');
    const undoButton = document.querySelector('[data-action="undo"]');
    const redoButton = document.querySelector('[data-action="redo"]');

    const label = this.session.name.trim() || this.i18n.t('designer.untitled');
    name.textContent = label;
    line.hidden = false;
    dirty.hidden = !this.session.dirty;
    if (undoButton) undoButton.disabled = !this.session.canUndo;
    if (redoButton) redoButton.disabled = !this.session.canRedo;
  }

  #wireShortcuts() {
    this.detachShortcuts = registerShortcuts({
      new: () => this.run('new'),
      save: () => this.run('save'),
      saveAs: () => this.run('saveAs'),
      import: () => this.run('import'),
      export: () => this.run('export'),
      undo: () => this.run('undo'),
      redo: () => this.run('redo'),
      help: () => this.run('shortcuts'),
    }, { isBlocked: () => this.modals.isOpen });
  }

  /** Single dispatch point for every shell action and shortcut. */
  run(action) {
    const handlers = {
      new: () => this.newCrosshair(),
      save: () => this.saveCurrent(),
      saveAs: () => this.saveCurrentAs(),
      import: () => this.importFromFile(),
      export: () => this.exportCurrent(),
      undo: () => this.undo(),
      redo: () => this.redo(),
      shortcuts: () => this.showShortcuts(),
    };
    const handler = handlers[action];
    if (!handler) return;
    Promise.resolve(handler()).catch((error) => {
      console.error(`[app] action "${action}" failed`, error);
      this.toasts.error('error.title', undefined, String(error.message ?? error).slice(0, 160));
    });
  }

  // --- Editing ------------------------------------------------------------

  newCrosshair() {
    this.session.reset();
    this.saveSettings({ lastDocumentId: null });
    this.router.navigate('designer');
    this.toasts.info('designer.newCrosshair');
  }

  async openDocument(id) {
    const doc = this.library.crosshair(id);
    if (!doc) {
      this.toasts.error('error.loadFailed');
      return;
    }
    this.session.load(doc);
    this.saveSettings({ lastDocumentId: id });
    this.router.navigate('designer');
  }

  undo() {
    if (this.session.undo() === null) {
      this.toasts.info('toast.nothingToUndo');
      return;
    }
    this.router.refresh();
  }

  redo() {
    if (this.session.redo() === null) {
      this.toasts.info('toast.nothingToRedo');
      return;
    }
    this.router.refresh();
  }

  // --- Storage ------------------------------------------------------------

  async saveCurrent({ silent = false } = {}) {
    if (!this.session.isSaved) return this.saveCurrentAs();
    const doc = this.session.toDocument(this.i18n.t('designer.untitled'));
    const saved = await this.library.saveCrosshair(doc);
    this.session.markSaved(saved);
    this.saveSettings({ lastDocumentId: saved.id });
    if (!silent) this.toasts.success('toast.saved');
    else this.toasts.show({ messageKey: 'toast.autoSaved', type: 'info', duration: 1600 });
    return saved;
  }

  async saveCurrentAs() {
    const result = await this.modals.prompt({
      title: this.i18n.t('dialog.saveAsTitle'),
      label: this.i18n.t('common.name'),
      value: this.session.name || this.i18n.t('dialog.namePlaceholder'),
      placeholder: this.i18n.t('dialog.namePlaceholder'),
      descriptionLabel: this.i18n.t('common.description'),
      description: this.session.description,
    });
    if (!result) return null;

    const doc = createDocument({
      name: result.name,
      description: result.description,
      config: this.session.config,
    });
    const saved = await this.library.saveCrosshair(doc);
    this.session.markSaved(saved);
    this.saveSettings({ lastDocumentId: saved.id });
    this.toasts.success('toast.savedAs', { name: saved.name });
    return saved;
  }

  async renameCrosshair(id) {
    const doc = this.library.crosshair(id);
    if (!doc) return null;
    const result = await this.modals.prompt({
      title: this.i18n.t('dialog.renameTitle'),
      label: this.i18n.t('common.name'),
      value: doc.name,
      descriptionLabel: this.i18n.t('common.description'),
      description: doc.description,
      confirmLabel: this.i18n.t('common.rename'),
    });
    if (!result) return null;
    const saved = await this.library.saveCrosshair({
      ...doc, name: result.name, description: result.description,
    });
    if (this.session.documentId === id) this.session.markSaved(saved);
    this.toasts.success('toast.renamed', { name: saved.name });
    return saved;
  }

  async duplicateCrosshair(id) {
    const source = this.library.crosshair(id);
    if (!source) return null;
    const copy = await this.library.duplicateCrosshair(id, `${source.name} ✦`);
    this.toasts.success('toast.duplicated', { name: copy.name });
    return copy;
  }

  async deleteCrosshair(id) {
    const doc = this.library.crosshair(id);
    if (!doc) return;
    const confirmed = await this.modals.confirm({
      title: this.i18n.t('dialog.deleteTitle', { name: doc.name }),
      body: this.i18n.t('dialog.deleteBody'),
      confirmLabel: this.i18n.t('common.delete'),
    });
    if (!confirmed) return;
    await this.library.deleteCrosshair(id);
    if (this.session.documentId === id) {
      this.session.detach();
      this.saveSettings({ lastDocumentId: null });
    }
    this.toasts.success('toast.deleted');
  }

  // --- Presets ------------------------------------------------------------

  /** Built-in preset names live in the catalogue; user presets carry their own. */
  presetName(preset) {
    if (!preset.builtIn) return preset.name;
    const key = `preset.${preset.id}.name`;
    return this.i18n.has(key) ? this.i18n.t(key) : preset.name;
  }

  presetDescription(preset) {
    if (!preset.builtIn) return preset.description ?? '';
    const key = `preset.${preset.id}.description`;
    return this.i18n.has(key) ? this.i18n.t(key) : '';
  }

  applyPreset(id) {
    const preset = this.library.preset(id);
    if (!preset) return;
    this.session.replaceConfig(preset.config, { reason: 'preset' });
    this.session.seal();
    this.toasts.success('toast.presetApplied', { name: this.presetName(preset) });
    this.router.navigate('designer');
  }

  async savePresetFromCurrent() {
    const result = await this.modals.prompt({
      title: this.i18n.t('dialog.presetTitle'),
      label: this.i18n.t('common.name'),
      value: this.session.name || '',
      placeholder: this.i18n.t('dialog.namePlaceholder'),
      descriptionLabel: this.i18n.t('common.description'),
      description: this.session.description,
      confirmLabel: this.i18n.t('common.create'),
    });
    if (!result) return null;
    const preset = createDocument({
      name: result.name,
      description: result.description,
      config: this.session.config,
      kind: 'preset',
    });
    const saved = await this.library.savePreset(preset);
    this.toasts.success('toast.presetCreated', { name: saved.name });
    return saved;
  }

  async duplicatePreset(id) {
    const source = this.library.preset(id);
    if (!source) return null;
    const copy = await this.library.duplicatePreset(id, `${this.presetName(source)} ✦`);
    this.toasts.success('toast.duplicated', { name: copy.name });
    return copy;
  }

  async renamePreset(id) {
    const preset = this.library.preset(id);
    if (!preset || preset.builtIn) {
      this.toasts.warning('presets.builtInReadOnly');
      return null;
    }
    const result = await this.modals.prompt({
      title: this.i18n.t('dialog.renameTitle'),
      label: this.i18n.t('common.name'),
      value: preset.name,
      descriptionLabel: this.i18n.t('common.description'),
      description: preset.description,
      confirmLabel: this.i18n.t('common.rename'),
    });
    if (!result) return null;
    const saved = await this.library.savePreset({
      ...preset, name: result.name, description: result.description,
    });
    this.toasts.success('toast.renamed', { name: saved.name });
    return saved;
  }

  async deletePreset(id) {
    const preset = this.library.preset(id);
    if (!preset) return;
    if (preset.builtIn) {
      this.toasts.warning('presets.builtInReadOnly');
      return;
    }
    const confirmed = await this.modals.confirm({
      title: this.i18n.t('dialog.deleteTitle', { name: preset.name }),
      body: this.i18n.t('dialog.deleteBody'),
      confirmLabel: this.i18n.t('common.delete'),
    });
    if (!confirmed) return;
    await this.library.deletePreset(id);
    this.toasts.success('toast.presetDeleted');
  }

  // --- Import and export --------------------------------------------------

  async importFromFile() {
    let picked;
    try {
      picked = await this.bridge.call('openImportDialog', { accept: '.json' });
    } catch (error) {
      this.toasts.error('import.errorRead', undefined, String(error.message ?? error));
      return;
    }
    if (!picked?.ok) {
      if (picked && !picked.cancelled) this.toasts.error('import.errorRead');
      return;
    }
    this.importFromText(picked.text, picked.fileName);
  }

  /** Shared by the file picker and by files opened through the host. */
  async importFromText(text, fileName = '') {
    const result = parseImport(text, this.core);
    if (!result.ok) {
      this.toasts.error(result.errorKey, { detail: result.detail ?? '' }, result.detail);
      return null;
    }

    for (const warning of result.warnings ?? []) {
      const key = {
        clamped: 'import.warnClamped',
        empty: 'import.warnEmpty',
        invalidColor: 'import.warnInvalidColor',
        missingCrosshair: 'import.errorShape',
      }[warning];
      if (key) this.toasts.warning(key);
    }

    const documents = result.documents ?? [];
    const presets = documents.filter((doc) => doc.kind === 'preset');
    const crosshairs = documents.filter((doc) => doc.kind !== 'preset');

    for (const preset of presets) await this.library.savePreset(preset);
    for (const doc of crosshairs) await this.library.saveCrosshair(doc);

    if (documents.length === 1) {
      const only = documents[0];
      this.toasts.success('toast.importOk', { name: only.name });
      if (only.kind !== 'preset') {
        this.session.load(only);
        this.saveSettings({ lastDocumentId: only.id });
        this.router.navigate('designer');
      } else {
        this.router.navigate('presets');
      }
    } else {
      this.toasts.success('toast.importOkMany', { count: documents.length });
      this.router.navigate(presets.length > crosshairs.length ? 'presets' : 'home');
    }
    return documents;
  }

  async exportCurrent() {
    const name = this.session.name.trim() || this.i18n.t('designer.untitled');
    const payload = documentToJson(
      {
        name,
        description: this.session.description,
        createdAt: this.session.createdAt,
        updatedAt: new Date().toISOString(),
        config: this.session.config,
      },
      this.appVersion,
    );
    return this.#writeExport(`${toFileStem(name)}.json`, payload);
  }

  async exportDocument(doc) {
    return this.#writeExport(`${toFileStem(doc.name)}.json`, documentToJson(doc, this.appVersion));
  }

  async exportPresets(presets) {
    const pack = toPresetPack(
      presets.map((preset) => ({ ...preset, name: this.presetName(preset), description: this.presetDescription(preset) })),
      this.appVersion,
    );
    return this.#writeExport('reticlex-presets.json', pack);
  }

  async #writeExport(fileName, payload) {
    try {
      const result = await this.bridge.call('saveExportDialog', {
        suggestedName: fileName,
        text: `${JSON.stringify(payload, null, 2)}\n`,
      });
      if (!result?.ok) {
        this.toasts.info('toast.exportCancelled');
        return false;
      }
      this.toasts.success('toast.exportOk', { name: result.fileName ?? fileName });
      return true;
    } catch (error) {
      this.toasts.error('error.exportFailed', undefined, String(error.message ?? error));
      return false;
    }
  }

  // --- Settings -----------------------------------------------------------

  /** Merges a patch into settings, applies it, and persists it. */
  saveSettings(patch, { notify = false } = {}) {
    const next = { ...this.settings, ...patch };
    const { settings } = normalizeSettings(next);
    // previewImage is validated separately: it is the only oversized field.
    if ('previewImage' in patch) {
      settings.previewImage = canPersistBackground(patch.previewImage) ? patch.previewImage : null;
    }
    this.settings = settings;
    applyAppearance(this.settings);
    this.store.set({ settingsRevision: Date.now() });
    this.bridge.call('saveSettings', { settings: this.settings }).catch((error) => {
      console.error('[app] settings not persisted', error);
      this.toasts.error('error.saveFailed');
    });
    if (notify) this.toasts.success('toast.settingsChanged');
    return this.settings;
  }

  async setLocale(code) {
    const resolved = await this.i18n.use(code);
    this.saveSettings({ locale: resolved, localeChosen: true });
    applyLocale(resolved);
    applyTranslations(document.body, this.i18n);
    document.getElementById('page-title').textContent = this.i18n.t(`nav.${this.router.current}`);
    this.router.refresh({ locale: resolved });
    this.#refreshDocumentLine();
    // Layout direction can flip, so the indicator has to be measured again.
    requestAnimationFrame(() => this.#moveNavIndicator(this.router.current));
    return resolved;
  }

  async resetSettings() {
    const confirmed = await this.modals.confirm({
      title: this.i18n.t('dialog.resetSettingsTitle'),
      body: this.i18n.t('dialog.resetSettingsBody'),
      confirmLabel: this.i18n.t('common.reset'),
      variant: 'danger',
    });
    if (!confirmed) return false;
    const defaults = defaultSettings();
    this.settings = defaults;
    applyAppearance(defaults);
    await this.setLocale(defaults.locale);
    this.bridge.call('saveSettings', { settings: defaults }).catch(() => {});
    this.toasts.success('toast.settingsReset');
    this.router.refresh();
    return true;
  }

  async clearAllData() {
    const confirmed = await this.modals.confirm({
      title: this.i18n.t('dialog.clearDataTitle'),
      body: this.i18n.t('dialog.clearDataBody'),
      confirmLabel: this.i18n.t('common.delete'),
      variant: 'danger',
    });
    if (!confirmed) return false;
    await this.library.clear(await this.#loadBuiltInPresets());
    this.session.reset();
    this.saveSettings({ lastDocumentId: null });
    this.toasts.success('toast.dataCleared');
    this.router.refresh();
    return true;
  }

  async setStartWithWindows(enabled) {
    try {
      const result = await this.bridge.call('setStartWithWindows', { enabled });
      if (result?.unsupported) {
        this.toasts.warning('error.hostUnavailable');
        return false;
      }
      this.saveSettings({ startWithWindows: Boolean(result?.enabled ?? enabled) });
      this.toasts.success(enabled ? 'toast.startWithWindowsOn' : 'toast.startWithWindowsOff');
      return Boolean(result?.enabled ?? enabled);
    } catch (error) {
      this.toasts.error('error.saveFailed', undefined, String(error.message ?? error));
      return false;
    }
  }

  openExternal(url) {
    this.bridge.call('openExternal', { url }).catch(() => {});
  }

  // --- Shortcuts dialog ---------------------------------------------------

  showShortcuts() {
    const rows = SHORTCUTS.map((shortcut) => h(
      'div',
      { class: 'shortcut-row' },
      h('span', { class: 'shortcut-row__label' }, this.i18n.t(shortcut.labelKey)),
      h('kbd', { class: 'shortcut-row__keys' }, shortcut.display),
    ));
    return this.modals.info({
      title: this.i18n.t('shortcuts.title'),
      body: h('div', { class: 'shortcut-list' }, ...rows),
    });
  }

  /** Exposed for pages that need the locale list, e.g. Settings. */
  get locales() { return LOCALES; }
  get themes() { return THEMES; }
  get accents() { return ACCENTS; }
  localeInfo(code) { return localeInfo(code); }
}

// --- Start-up ---------------------------------------------------------------

const app = new App();

app.boot().catch((error) => {
  console.error('[app] start-up failed', error);
  const banner = document.getElementById('boot-error');
  if (banner) {
    banner.hidden = false;
    banner.textContent = `${error.message ?? error}`;
  }
  document.getElementById('boot')?.classList.add('boot--failed');
});

// Handy while developing in a browser; harmless in the shipped app.
globalThis.reticlex = app;

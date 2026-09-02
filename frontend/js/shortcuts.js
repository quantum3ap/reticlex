/**
 * Global keyboard shortcuts.
 *
 * The list is data so the same definitions drive the handler, the shortcuts
 * dialog and the hints shown in tooltips — they cannot drift apart.
 */

export const SHORTCUTS = Object.freeze([
  { id: 'new', labelKey: 'shortcuts.new', combo: { key: 'n', ctrl: true }, display: 'Ctrl + N' },
  { id: 'save', labelKey: 'shortcuts.save', combo: { key: 's', ctrl: true }, display: 'Ctrl + S' },
  { id: 'saveAs', labelKey: 'shortcuts.saveAs', combo: { key: 's', ctrl: true, shift: true }, display: 'Ctrl + Shift + S' },
  { id: 'import', labelKey: 'shortcuts.import', combo: { key: 'o', ctrl: true }, display: 'Ctrl + O' },
  { id: 'export', labelKey: 'shortcuts.export', combo: { key: 'e', ctrl: true }, display: 'Ctrl + E' },
  { id: 'undo', labelKey: 'shortcuts.undo', combo: { key: 'z', ctrl: true }, display: 'Ctrl + Z' },
  { id: 'redo', labelKey: 'shortcuts.redo', combo: { key: 'y', ctrl: true }, display: 'Ctrl + Y' },
  { id: 'help', labelKey: 'shortcuts.help', combo: { key: '/', ctrl: true }, display: 'Ctrl + /' },
]);

/** Ctrl+Shift+Z is the other muscle memory for redo; accepted but not listed. */
const ALIASES = [
  { id: 'redo', combo: { key: 'z', ctrl: true, shift: true } },
];

function matches(event, combo) {
  if (event.key.toLowerCase() !== combo.key) return false;
  const ctrl = event.ctrlKey || event.metaKey;
  if (Boolean(combo.ctrl) !== ctrl) return false;
  if (Boolean(combo.shift) !== event.shiftKey) return false;
  if (event.altKey) return false;
  return true;
}

/** True while the user is typing, where editing shortcuts must not fire. */
function inTextEntry(target) {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === 'TEXTAREA') return true;
  if (tag !== 'INPUT') return false;
  return ['text', 'search', 'number', 'email', 'url', 'password'].includes(target.type);
}

/**
 * @param {Record<string, Function>} handlers keyed by shortcut id
 * @param {{isBlocked?:() => boolean}} options
 * @returns {Function} detach
 */
export function registerShortcuts(handlers, { isBlocked } = {}) {
  const all = [
    ...SHORTCUTS.map(({ id, combo }) => ({ id, combo })),
    ...ALIASES,
  ];

  const onKeyDown = (event) => {
    if (isBlocked?.()) return;
    for (const { id, combo } of all) {
      if (!matches(event, combo)) continue;
      // Ctrl+Z inside a text field must stay the browser's own undo.
      if (inTextEntry(event.target) && ['undo', 'redo'].includes(id)) return;
      const handler = handlers[id];
      if (!handler) return;
      event.preventDefault();
      handler(event);
      return;
    }
  };

  document.addEventListener('keydown', onKeyDown);
  return () => document.removeEventListener('keydown', onKeyDown);
}

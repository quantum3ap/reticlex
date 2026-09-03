/**
 * Inline SVG icons.
 *
 * Kept as path data rather than an icon font or sprite sheet so they inherit
 * currentColor, scale cleanly with the interface, and cost no extra request.
 * All icons share a 24x24 viewBox and a 1.75 stroke.
 */

const PATHS = {
  home: 'M3 10.5 12 3l9 7.5M5.5 9.5V20a1 1 0 0 0 1 1H10v-5.5h4V21h3.5a1 1 0 0 0 1-1V9.5',
  designer: 'M12 3v4m0 10v4M3 12h4m10 0h4M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z',
  presets: 'M4 6.5A1.5 1.5 0 0 1 5.5 5h5L12 7h6.5A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5Z',
  randomizer: 'M4.5 4.5h15v15h-15zM9 9h.01M15 9h.01M9 15h.01M15 15h.01M12 12h.01',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm8.4-3a8.4 8.4 0 0 0-.13-1.45l2-1.55-2-3.46-2.35.95a8.5 8.5 0 0 0-2.5-1.45L15 2h-4l-.42 2.54a8.5 8.5 0 0 0-2.5 1.45L5.73 5.04l-2 3.46 2 1.55A8.4 8.4 0 0 0 5.6 12c0 .49.05.97.13 1.45l-2 1.55 2 3.46 2.35-.95c.74.62 1.58 1.12 2.5 1.45L11 22h4l.42-2.54a8.5 8.5 0 0 0 2.5-1.45l2.35.95 2-3.46-2-1.55c.08-.48.13-.96.13-1.45Z',
  plus: 'M12 5v14M5 12h14',
  edit: 'M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17v3ZM14.5 6.5l3 3',
  copy: 'M9 9h9a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1ZM6 15H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v1',
  trash: 'M4.5 7h15M9.5 7V5.5A1.5 1.5 0 0 1 11 4h2a1.5 1.5 0 0 1 1.5 1.5V7M6.5 7l.8 12a1.5 1.5 0 0 0 1.5 1.4h6.4a1.5 1.5 0 0 0 1.5-1.4L17.5 7M10 11v6M14 11v6',
  save: 'M5 4h11l3 3v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1ZM8 4v5h7V4M8 20v-6h8v6',
  import: 'M12 3v11m0 0-4-4m4 4 4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2',
  export: 'M12 15V4m0 0-4 4m4-4 4 4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2',
  undo: 'M9 8H5V4M5.5 8.5A7.5 7.5 0 1 1 4.6 14',
  redo: 'M15 8h4V4M18.5 8.5A7.5 7.5 0 1 0 19.4 14',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14ZM16 16l4.5 4.5',
  close: 'M6 6l12 12M18 6 6 18',
  check: 'M5 12.5 9.5 17 19 7.5',
  chevronDown: 'M6 9.5 12 15.5l6-6',
  chevronRight: 'M9.5 6 15.5 12l-6 6',
  minus: 'M5 12h14',
  zoomIn: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14ZM16 16l4.5 4.5M11 8v6M8 11h6',
  zoomOut: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14ZM16 16l4.5 4.5M8 11h6',
  reset: 'M4 10a8 8 0 1 1 .8 5M4 5v5h5',
  refresh: 'M3.5 12A8.5 8.5 0 0 1 18 6M20.5 12A8.5 8.5 0 0 1 6 18M18 2.5V6h-3.5M6 21.5V18h3.5',
  grid: 'M4 9.5h16M4 14.5h16M9.5 4v16M14.5 4v16M4.5 4h15a.5.5 0 0 1 .5.5v15a.5.5 0 0 1-.5.5h-15a.5.5 0 0 1-.5-.5v-15a.5.5 0 0 1 .5-.5Z',
  image: 'M4.5 5h15a.5.5 0 0 1 .5.5v13a.5.5 0 0 1-.5.5h-15a.5.5 0 0 1-.5-.5v-13a.5.5 0 0 1 .5-.5ZM4 16l4.5-4.5 3.5 3.5 3-3L20 16M9 9.5h.01',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 11v5M12 7.5h.01',
  warning: 'M12 4 2.5 20h19L12 4ZM12 10v4.5M12 17.5h.01',
  globe: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM3.5 9h17M3.5 15h17M12 3c2.5 2.5 3.5 5.5 3.5 9s-1 6.5-3.5 9c-2.5-2.5-3.5-5.5-3.5-9s1-6.5 3.5-9Z',
  palette: 'M12 21a9 9 0 1 1 9-9c0 1.7-1.3 3-3 3h-1.5a2 2 0 0 0-1.4 3.4c.6.6.2 1.6-.6 1.6H12ZM7.5 12h.01M9.5 8h.01M14.5 8h.01',
  sparkle: 'M12 3.5 13.8 9l5.5 1.8-5.5 1.8L12 18l-1.8-5.4L4.7 10.8 10.2 9 12 3.5ZM18.5 16l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7.7-2Z',
  external: 'M14 5h5v5M19 5l-8 8M17 14v4.5a1.5 1.5 0 0 1-1.5 1.5h-10A1.5 1.5 0 0 1 4 18.5v-10A1.5 1.5 0 0 1 5.5 7H10',
  folder: 'M4 7.5A1.5 1.5 0 0 1 5.5 6h4L11 8h7.5A1.5 1.5 0 0 1 20 9.5v8a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5Z',
  keyboard: 'M4 6.5h16a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1ZM7 10h.01M10 10h.01M13 10h.01M16 10h.01M8 14h8',
  monitor: 'M3.5 5h17a.5.5 0 0 1 .5.5v10a.5.5 0 0 1-.5.5h-17a.5.5 0 0 1-.5-.5v-10a.5.5 0 0 1 .5-.5ZM9 20h6M12 16v4M12 8.5v3M10.5 10h3',
  lock: 'M7 10.5V8a5 5 0 0 1 10 0v2.5M5.5 10.5h13a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1h-13a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1Z',
  dice: 'M12 2.5l8.5 4.75v9.5L12 21.5 3.5 16.75v-9.5L12 2.5ZM12 12l8.5-4.75M12 12v9.5M12 12 3.5 7.25M8 14.5h.01M15.5 10h.01',
};

/**
 * @param {keyof PATHS} name
 * @param {{size?:number, className?:string, strokeWidth?:number}} [options]
 */
export function icon(name, { size = 20, className = 'icon', strokeWidth = 1.75 } = {}) {
  const data = PATHS[name];
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', String(strokeWidth));
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  if (className) svg.setAttribute('class', className);
  if (!data) {
    console.warn(`[icons] unknown icon "${name}"`);
    return svg;
  }
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', data);
  svg.append(path);
  return svg;
}

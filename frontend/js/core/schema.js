/**
 * The on-disk and on-the-wire crosshair document format.
 *
 * Internally a crosshair is the core's flat, snake_case field map so it can be
 * handed straight to WebAssembly. On disk it is a nested, human-editable JSON
 * document. This module is the only place that knows how to travel between
 * the two, and it is deliberately forgiving when reading: anything missing
 * falls back to a default and anything out of range is clamped by the core.
 */

import { createId, hexToRgb, normalizeHex, rgbToHex } from './util.js';

export const DOCUMENT_FORMAT = 'reticlex-crosshair';
export const PRESET_PACK_FORMAT = 'reticlex-preset-pack';
export const DOCUMENT_VERSION = 1;

export const CAP_STYLES = ['flat', 'round', 'tapered'];
export const DOT_SHAPES = ['square', 'round'];

/**
 * Slider metadata for the designer. The ranges mirror the limits enforced in
 * core/cpp/include/reticlex/config.h; schema.test.js proves they agree by
 * checking that the core leaves every bound untouched.
 */
export const LIMITS = Object.freeze({
  scale: { min: 0.25, max: 4, step: 0.05, decimals: 2 },
  rotation: { min: -180, max: 179, step: 1, decimals: 0 },
  opacity: { min: 0, max: 1, step: 0.01, decimals: 2 },
  h_length: { min: 0, max: 120, step: 0.5, decimals: 1 },
  v_length: { min: 0, max: 120, step: 0.5, decimals: 1 },
  h_thickness: { min: 0.5, max: 20, step: 0.5, decimals: 1 },
  v_thickness: { min: 0.5, max: 20, step: 0.5, decimals: 1 },
  h_gap: { min: 0, max: 60, step: 0.5, decimals: 1 },
  v_gap: { min: 0, max: 60, step: 0.5, decimals: 1 },
  outline_thickness: { min: 0, max: 8, step: 0.25, decimals: 2 },
  outline_opacity: { min: 0, max: 1, step: 0.01, decimals: 2 },
  dot_size: { min: 0, max: 24, step: 0.5, decimals: 1 },
  dot_opacity: { min: 0, max: 1, step: 0.01, decimals: 2 },
  dynamic_spread: { min: 0, max: 1, step: 0.01, decimals: 2 },
  dynamic_gap_boost: { min: 0, max: 40, step: 0.5, decimals: 1 },
});

const bool = (value, fallback) => (typeof value === 'boolean' ? value : Boolean(fallback));
const num = (value, fallback) => (Number.isFinite(Number(value)) ? Number(value) : fallback);

function enumValue(list, value, fallback) {
  if (typeof value === 'string') {
    const index = list.indexOf(value.toLowerCase());
    if (index >= 0) return index;
  }
  const asNumber = Number(value);
  if (Number.isInteger(asNumber) && asNumber >= 0 && asNumber < list.length) return asNumber;
  return fallback;
}

/** Flat config -> nested, human-readable JSON. */
export function crosshairToJson(config) {
  const colour = (r, g, b) => rgbToHex({ r: config[r], g: config[g], b: config[b] });
  return {
    scale: config.scale,
    rotation: config.rotation,
    opacity: config.opacity,
    color: colour('color_r', 'color_g', 'color_b'),
    horizontal: {
      enabled: Boolean(config.h_enabled),
      length: config.h_length,
      thickness: config.h_thickness,
      gap: config.h_gap,
    },
    vertical: {
      enabled: Boolean(config.v_enabled),
      length: config.v_length,
      thickness: config.v_thickness,
      gap: config.v_gap,
    },
    arms: {
      left: Boolean(config.show_left),
      right: Boolean(config.show_right),
      top: Boolean(config.show_top),
      bottom: Boolean(config.show_bottom),
      tShape: Boolean(config.t_shape),
      capStyle: CAP_STYLES[config.cap_style] ?? 'flat',
    },
    outline: {
      enabled: Boolean(config.outline_enabled),
      thickness: config.outline_thickness,
      opacity: config.outline_opacity,
      color: colour('outline_color_r', 'outline_color_g', 'outline_color_b'),
    },
    dot: {
      enabled: Boolean(config.dot_enabled),
      size: config.dot_size,
      opacity: config.dot_opacity,
      inheritColor: Boolean(config.dot_inherit_color),
      shape: DOT_SHAPES[config.dot_shape] ?? 'square',
      color: colour('dot_color_r', 'dot_color_g', 'dot_color_b'),
    },
    dynamic: {
      enabled: Boolean(config.dynamic_enabled),
      spread: config.dynamic_spread,
      gapBoost: config.dynamic_gap_boost,
    },
  };
}

/**
 * Nested JSON -> flat config, tolerant of missing sections.
 * Also accepts an already-flat config, which is what the host bridge sends.
 * @returns {{config:object, warnings:string[]}}
 */
export function jsonToCrosshair(input, defaults) {
  const warnings = [];
  const base = { ...defaults };
  if (!input || typeof input !== 'object') {
    warnings.push('missingCrosshair');
    return { config: base, warnings };
  }

  // A flat map from the host or an older export needs no translation.
  if ('h_length' in input || 'color_r' in input) {
    for (const key of Object.keys(base)) {
      if (key in input) base[key] = num(input[key], base[key]);
    }
    return { config: base, warnings };
  }

  const applyColour = (hex, keys, fallbackHex) => {
    const normalized = normalizeHex(hex);
    if (hex !== undefined && normalized === null) warnings.push('invalidColor');
    const rgb = hexToRgb(normalized ?? fallbackHex);
    base[keys[0]] = rgb.r;
    base[keys[1]] = rgb.g;
    base[keys[2]] = rgb.b;
  };

  base.scale = num(input.scale, base.scale);
  base.rotation = num(input.rotation, base.rotation);
  base.opacity = num(input.opacity, base.opacity);
  applyColour(input.color, ['color_r', 'color_g', 'color_b'],
    rgbToHex({ r: base.color_r, g: base.color_g, b: base.color_b }));

  const h = input.horizontal ?? {};
  base.h_enabled = bool(h.enabled, base.h_enabled) ? 1 : 0;
  base.h_length = num(h.length, base.h_length);
  base.h_thickness = num(h.thickness, base.h_thickness);
  base.h_gap = num(h.gap, base.h_gap);

  const v = input.vertical ?? {};
  base.v_enabled = bool(v.enabled, base.v_enabled) ? 1 : 0;
  base.v_length = num(v.length, base.v_length);
  base.v_thickness = num(v.thickness, base.v_thickness);
  base.v_gap = num(v.gap, base.v_gap);

  const arms = input.arms ?? {};
  base.show_left = bool(arms.left, base.show_left) ? 1 : 0;
  base.show_right = bool(arms.right, base.show_right) ? 1 : 0;
  base.show_top = bool(arms.top, base.show_top) ? 1 : 0;
  base.show_bottom = bool(arms.bottom, base.show_bottom) ? 1 : 0;
  base.t_shape = bool(arms.tShape, base.t_shape) ? 1 : 0;
  base.cap_style = enumValue(CAP_STYLES, arms.capStyle, base.cap_style);

  const outline = input.outline ?? {};
  base.outline_enabled = bool(outline.enabled, base.outline_enabled) ? 1 : 0;
  base.outline_thickness = num(outline.thickness, base.outline_thickness);
  base.outline_opacity = num(outline.opacity, base.outline_opacity);
  applyColour(outline.color, ['outline_color_r', 'outline_color_g', 'outline_color_b'],
    rgbToHex({ r: base.outline_color_r, g: base.outline_color_g, b: base.outline_color_b }));

  const dot = input.dot ?? {};
  base.dot_enabled = bool(dot.enabled, base.dot_enabled) ? 1 : 0;
  base.dot_size = num(dot.size, base.dot_size);
  base.dot_opacity = num(dot.opacity, base.dot_opacity);
  base.dot_inherit_color = bool(dot.inheritColor, base.dot_inherit_color) ? 1 : 0;
  base.dot_shape = enumValue(DOT_SHAPES, dot.shape, base.dot_shape);
  applyColour(dot.color, ['dot_color_r', 'dot_color_g', 'dot_color_b'],
    rgbToHex({ r: base.dot_color_r, g: base.dot_color_g, b: base.dot_color_b }));

  const dynamic = input.dynamic ?? {};
  base.dynamic_enabled = bool(dynamic.enabled, base.dynamic_enabled) ? 1 : 0;
  base.dynamic_spread = num(dynamic.spread, base.dynamic_spread);
  base.dynamic_gap_boost = num(dynamic.gapBoost, base.dynamic_gap_boost);

  return { config: base, warnings };
}

export function createDocument({ name, description = '', config, id, kind = 'crosshair' }) {
  const now = new Date().toISOString();
  return {
    id: id ?? createId(kind === 'preset' ? 'ps' : 'cx'),
    kind,
    name: String(name ?? 'Untitled').slice(0, 80),
    description: String(description ?? '').slice(0, 240),
    createdAt: now,
    updatedAt: now,
    builtIn: false,
    config,
  };
}

/** Serialises a document for export or for the library file on disk. */
export function documentToJson(doc, appVersion = '1.0.0') {
  return {
    format: DOCUMENT_FORMAT,
    version: DOCUMENT_VERSION,
    name: doc.name,
    description: doc.description ?? '',
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    exportedAt: new Date().toISOString(),
    app: { name: 'ReticleX', version: appVersion },
    crosshair: crosshairToJson(doc.config),
  };
}

/**
 * Parses imported text into one or more documents.
 *
 * Never throws for content reasons: callers get a structured result they can
 * surface as a toast. The only throw path is a programming error.
 *
 * @param {string} text raw file contents
 * @param {object} core the loaded ReticleCore, used to clamp and validate
 * @returns {{ok:boolean, errorKey?:string, detail?:string,
 *            documents?:object[], warnings?:string[]}}
 */
export function parseImport(text, core) {
  if (typeof text !== 'string' || text.trim().length === 0) {
    return { ok: false, errorKey: 'import.errorEmpty' };
  }
  if (text.length > 4_000_000) {
    return { ok: false, errorKey: 'import.errorTooLarge' };
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return { ok: false, errorKey: 'import.errorJson', detail: String(error.message).slice(0, 160) };
  }
  if (!parsed || typeof parsed !== 'object') {
    return { ok: false, errorKey: 'import.errorShape' };
  }

  const defaults = core.defaults();
  const warnings = [];
  const documents = [];

  const readOne = (entry, fallbackName) => {
    const source = entry?.crosshair ?? entry;
    const { config, warnings: fieldWarnings } = jsonToCrosshair(source, defaults);
    warnings.push(...fieldWarnings);
    const { config: normalized, adjusted } = core.normalize(config);
    if (adjusted > 0) warnings.push('clamped');
    const status = core.validate(normalized);
    if (status === 5) warnings.push('empty');
    return createDocument({
      name: entry?.name ?? fallbackName,
      description: entry?.description ?? '',
      config: normalized,
      kind: entry?.kind === 'preset' ? 'preset' : 'crosshair',
    });
  };

  if (Array.isArray(parsed)) {
    if (parsed.length === 0) return { ok: false, errorKey: 'import.errorEmpty' };
    if (parsed.length > 500) return { ok: false, errorKey: 'import.errorTooMany' };
    parsed.forEach((entry, index) => documents.push(readOne(entry, `Imported ${index + 1}`)));
  } else if (parsed.format === PRESET_PACK_FORMAT || Array.isArray(parsed.presets)) {
    const list = Array.isArray(parsed.presets) ? parsed.presets : [];
    if (list.length === 0) return { ok: false, errorKey: 'import.errorEmpty' };
    if (list.length > 500) return { ok: false, errorKey: 'import.errorTooMany' };
    list.forEach((entry, index) => {
      const doc = readOne(entry, `Imported ${index + 1}`);
      doc.kind = 'preset';
      documents.push(doc);
    });
  } else if (parsed.crosshair || parsed.horizontal || 'h_length' in parsed) {
    if (parsed.format && parsed.format !== DOCUMENT_FORMAT) {
      return { ok: false, errorKey: 'import.errorFormat', detail: String(parsed.format).slice(0, 60) };
    }
    if (parsed.version && Number(parsed.version) > DOCUMENT_VERSION) {
      return { ok: false, errorKey: 'import.errorVersion', detail: String(parsed.version) };
    }
    documents.push(readOne(parsed, 'Imported crosshair'));
  } else {
    return { ok: false, errorKey: 'import.errorShape' };
  }

  return { ok: true, documents, warnings: [...new Set(warnings)] };
}

/** Bundles several documents into one exportable preset pack. */
export function toPresetPack(documents, appVersion = '1.0.0') {
  return {
    format: PRESET_PACK_FORMAT,
    version: DOCUMENT_VERSION,
    exportedAt: new Date().toISOString(),
    app: { name: 'ReticleX', version: appVersion },
    presets: documents.map((doc) => ({
      name: doc.name,
      description: doc.description ?? '',
      kind: 'preset',
      crosshair: crosshairToJson(doc.config),
    })),
  };
}

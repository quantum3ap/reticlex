/**
 * Regenerates presets/builtin.json.
 *
 * The presets are defined here as intent and written out through the core, so
 * every shipped preset is guaranteed to normalise cleanly and to draw
 * something. Run with: node scripts/build-presets.mjs
 */
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { ReticleCore } from '../frontend/js/core/wasm.js';
import { crosshairToJson, jsonToCrosshair } from '../frontend/js/core/schema.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Each entry's id doubles as the localization key: preset.<id>.name */
const DEFINITIONS = [
  {
    id: 'classic-cross',
    accent: '#00FF88',
    crosshair: {
      color: '#00FF88',
      horizontal: { enabled: true, length: 8, thickness: 2, gap: 4 },
      vertical: { enabled: true, length: 8, thickness: 2, gap: 4 },
      outline: { enabled: true, thickness: 1, opacity: 0.85, color: '#000000' },
    },
  },
  {
    id: 'precision-dot',
    accent: '#00E5FF',
    crosshair: {
      color: '#00E5FF',
      horizontal: { enabled: false, length: 0, thickness: 1, gap: 0 },
      vertical: { enabled: false, length: 0, thickness: 1, gap: 0 },
      outline: { enabled: true, thickness: 1, opacity: 1, color: '#000000' },
      dot: { enabled: true, size: 3, opacity: 1, inheritColor: true, shape: 'round' },
    },
  },
  {
    id: 'tight-mint',
    accent: '#4CFFB0',
    crosshair: {
      color: '#4CFFB0',
      horizontal: { enabled: true, length: 4, thickness: 1.5, gap: 2 },
      vertical: { enabled: true, length: 4, thickness: 1.5, gap: 2 },
      outline: { enabled: true, thickness: 0.5, opacity: 0.9, color: '#000000' },
      dot: { enabled: true, size: 1.5, opacity: 1, inheritColor: true, shape: 'square' },
    },
  },
  {
    id: 'wide-hunter',
    accent: '#FFD400',
    crosshair: {
      color: '#FFD400',
      horizontal: { enabled: true, length: 16, thickness: 2.5, gap: 10 },
      vertical: { enabled: true, length: 16, thickness: 2.5, gap: 10 },
      outline: { enabled: true, thickness: 1, opacity: 0.8, color: '#050505' },
    },
  },
  {
    id: 't-tactical',
    accent: '#FF4D6D',
    crosshair: {
      color: '#FF4D6D',
      horizontal: { enabled: true, length: 9, thickness: 2, gap: 5 },
      vertical: { enabled: true, length: 9, thickness: 2, gap: 5 },
      arms: { left: true, right: true, top: true, bottom: true, tShape: true, capStyle: 'flat' },
      outline: { enabled: true, thickness: 1, opacity: 0.9, color: '#000000' },
    },
  },
  {
    id: 'neon-ring',
    accent: '#B36BFF',
    crosshair: {
      color: '#B36BFF',
      horizontal: { enabled: true, length: 7, thickness: 3, gap: 6 },
      vertical: { enabled: true, length: 7, thickness: 3, gap: 6 },
      arms: { left: true, right: true, top: true, bottom: true, tShape: false, capStyle: 'round' },
      outline: { enabled: true, thickness: 1.25, opacity: 0.7, color: '#0A0014' },
      dot: { enabled: true, size: 2.5, opacity: 1, inheritColor: true, shape: 'round' },
    },
  },
  {
    id: 'heavy-duty',
    accent: '#FFFFFF',
    crosshair: {
      color: '#FFFFFF',
      horizontal: { enabled: true, length: 14, thickness: 6, gap: 6 },
      vertical: { enabled: true, length: 14, thickness: 6, gap: 6 },
      outline: { enabled: true, thickness: 2, opacity: 1, color: '#000000' },
    },
  },
  {
    id: 'dynamic-spread',
    accent: '#00C8FF',
    crosshair: {
      color: '#00C8FF',
      horizontal: { enabled: true, length: 10, thickness: 2, gap: 3 },
      vertical: { enabled: true, length: 10, thickness: 2, gap: 3 },
      arms: { left: true, right: true, top: true, bottom: true, tShape: false, capStyle: 'tapered' },
      outline: { enabled: true, thickness: 1, opacity: 0.85, color: '#000000' },
      dynamic: { enabled: true, spread: 0.35, gapBoost: 14 },
    },
  },

  // --- The ringed set ----------------------------------------------------
  // Six silhouettes that were impossible before schema 2 gave the core a ring
  // and a diagonal pair. Colours are drawn from the same palette so the set
  // reads as a family in the preset list.
  {
    id: 'halo-target',
    accent: '#FFFFFF',
    crosshair: {
      color: '#FFFFFF',
      horizontal: { enabled: true, length: 13, thickness: 2.5, gap: 0 },
      vertical: { enabled: true, length: 13, thickness: 2.5, gap: 0 },
      outline: { enabled: true, thickness: 1, opacity: 0.9, color: '#000000' },
      dot: { enabled: true, size: 3.5, opacity: 1, inheritColor: true, shape: 'round' },
      ring: { enabled: true, radius: 9, thickness: 2, opacity: 1, inheritColor: true },
    },
  },
  {
    id: 'ring-ticks',
    accent: '#4FE9F0',
    crosshair: {
      color: '#4FE9F0',
      horizontal: { enabled: true, length: 5, thickness: 1.8, gap: 3.5 },
      vertical: { enabled: true, length: 5, thickness: 1.8, gap: 3.5 },
      outline: { enabled: true, thickness: 1, opacity: 0.85, color: '#000000' },
      dot: { enabled: true, size: 2, opacity: 1, inheritColor: true, shape: 'round' },
      ring: { enabled: true, radius: 9.5, thickness: 1.8, opacity: 1, inheritColor: true },
    },
  },
  {
    id: 'quartered',
    accent: '#4BE94B',
    crosshair: {
      color: '#4BE94B',
      horizontal: { enabled: true, length: 11, thickness: 1.8, gap: 0 },
      vertical: { enabled: true, length: 11, thickness: 1.8, gap: 0 },
      outline: { enabled: true, thickness: 1, opacity: 0.85, color: '#000000' },
      ring: { enabled: true, radius: 10, thickness: 1.8, opacity: 1, inheritColor: true },
    },
  },
  {
    id: 'ring-plus',
    accent: '#FF5EE6',
    crosshair: {
      color: '#FF5EE6',
      horizontal: { enabled: true, length: 5.5, thickness: 2.5, gap: 0 },
      vertical: { enabled: true, length: 5.5, thickness: 2.5, gap: 0 },
      outline: { enabled: true, thickness: 1, opacity: 0.85, color: '#000000' },
      ring: { enabled: true, radius: 11, thickness: 3, opacity: 1, inheritColor: true },
    },
  },
  {
    id: 'plain-plus',
    accent: '#FAFA96',
    crosshair: {
      color: '#FAFA96',
      horizontal: { enabled: true, length: 8, thickness: 2.5, gap: 0 },
      vertical: { enabled: true, length: 8, thickness: 2.5, gap: 0 },
      outline: { enabled: true, thickness: 1, opacity: 0.9, color: '#000000' },
    },
  },
  {
    id: 'signal-dot',
    accent: '#FF3B30',
    crosshair: {
      color: '#FF3B30',
      horizontal: { enabled: false, length: 0, thickness: 1, gap: 0 },
      vertical: { enabled: false, length: 0, thickness: 1, gap: 0 },
      outline: { enabled: true, thickness: 1.25, opacity: 1, color: '#000000' },
      dot: { enabled: true, size: 4, opacity: 1, inheritColor: true, shape: 'round' },
    },
  },
  {
    id: 'eight-point',
    accent: '#5B5BE8',
    crosshair: {
      color: '#5B5BE8',
      horizontal: { enabled: true, length: 7, thickness: 2, gap: 4 },
      vertical: { enabled: true, length: 7, thickness: 2, gap: 4 },
      outline: { enabled: true, thickness: 1, opacity: 0.85, color: '#000000' },
      diagonal: { enabled: true, length: 4.5, thickness: 1.5, gap: 4 },
      dot: { enabled: true, size: 2, opacity: 1, inheritColor: true, shape: 'round' },
    },
  },
];

const wasm = await readFile(resolve(root, 'frontend/assets/reticlex_core.wasm'));
const core = await ReticleCore.instantiate(wasm);
const defaults = core.defaults();

const presets = DEFINITIONS.map((definition) => {
  const { config } = jsonToCrosshair(definition.crosshair, defaults);
  const { config: normalized, adjusted } = core.normalize(config);
  const status = core.validate(normalized);
  if (status !== 0) {
    throw new Error(`Preset "${definition.id}" is invalid (status ${status})`);
  }
  const geometry = core.buildGeometry(normalized);
  if (geometry.shapes.length === 0) {
    throw new Error(`Preset "${definition.id}" draws nothing`);
  }
  if (adjusted > 0) {
    console.warn(`  note: "${definition.id}" had ${adjusted} field(s) clamped`);
  }
  return {
    id: definition.id,
    accent: definition.accent,
    shapes: geometry.shapes.length,
    crosshair: crosshairToJson(normalized),
  };
});

const output = {
  format: 'reticlex-preset-pack',
  version: 1,
  note: 'Generated by scripts/build-presets.mjs - do not edit by hand.',
  builtIn: true,
  presets: presets.map(({ shapes, ...rest }) => rest),
};

await writeFile(
  resolve(root, 'presets/builtin.json'),
  `${JSON.stringify(output, null, 2)}\n`,
  'utf8',
);

console.log(`build-presets: wrote ${presets.length} preset(s)`);
for (const preset of presets) {
  console.log(`  ${preset.id.padEnd(16)} ${preset.shapes} shapes  ${preset.accent}`);
}

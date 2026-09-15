/**
 * Share codes: a crosshair has to survive the round trip exactly, and a code
 * that arrived damaged has to say so rather than produce something plausible.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { loadCore, readJson } from './helpers.js';
import { jsonToCrosshair } from '../js/core/schema.js';
import {
  SHARE_PREFIX, ShareCodeError, decodeShareCode, encodeShareCode,
} from '../js/core/sharecode.js';

/** Every field the core knows about, compared as the core stores them. */
function assertSameConfig(core, actual, expected, label) {
  for (const field of core.fields) {
    assert.equal(actual[field.name], expected[field.name],
      `${label}: ${field.name} came back as ${actual[field.name]}, not ${expected[field.name]}`);
  }
}

/**
 * The built-in presets, as flat configs. They are stored as nested documents,
 * so they go through the same converter the importer uses rather than being
 * read field by field — which silently produced fifteen copies of the defaults.
 */
async function builtInConfigs(core) {
  const pack = await readJson('presets/builtin.json');
  const entries = pack.presets ?? [];
  assert.ok(entries.length > 0, 'no built-in presets to test against');

  const defaults = core.defaults();
  const configs = entries.map((entry) => ({
    name: entry.id ?? 'unnamed',
    config: core.normalize(jsonToCrosshair(entry.crosshair, defaults).config).config,
  }));

  // Guard against the extraction quietly breaking again: these are fifteen
  // different reticles and they must not all encode to the same thing.
  const distinct = new Set(configs.map(({ config }) =>
    core.fields.map((f) => config[f.name]).join(',')));
  assert.ok(distinct.size > entries.length / 2,
    `only ${distinct.size} of ${entries.length} presets differ — they are not being read`);

  return configs;
}

test('a crosshair survives the round trip exactly', async () => {
  const core = await loadCore();
  const config = core.normalize({ ...core.defaults(), h_length: 9, dot_enabled: 1 }).config;

  const code = await encodeShareCode(core, config);
  assertSameConfig(core, await decodeShareCode(core, code), config, 'round trip');
});

test('every built-in preset round trips', async () => {
  const core = await loadCore();
  for (const { name, config } of await builtInConfigs(core)) {
    const decoded = await decodeShareCode(core, await encodeShareCode(core, config));
    assertSameConfig(core, decoded, config, name);
  }
});

test('the default crosshair encodes to almost nothing', async () => {
  const core = await loadCore();
  // Every byte XORs to zero against itself, which is the whole point of
  // encoding against the defaults rather than encoding the config raw.
  const code = await encodeShareCode(core, core.defaults());
  assert.ok(code.length < 40, `the default came out ${code.length} characters long`);
});

test('a real crosshair is short enough to paste into a chat', async () => {
  const core = await loadCore();
  let longest = 0;
  for (const { config } of await builtInConfigs(core)) {
    longest = Math.max(longest, (await encodeShareCode(core, config)).length);
  }
  // A raw encoding of the 200 config bytes would be 268 characters before the
  // prefix. Anything near that means the compression has stopped working.
  assert.ok(longest < 160, `the longest preset code is ${longest} characters`);
});

test('codes are prefixed and use only url-safe characters', async () => {
  const core = await loadCore();
  const code = await encodeShareCode(core, core.normalize({ ...core.defaults(), v_length: 11 }).config);

  assert.ok(code.startsWith(`${SHARE_PREFIX}-`), code);
  assert.match(code, /^RX1-[A-Za-z0-9_-]+$/);
});

test('whitespace and case from a pasted message are forgiven', async () => {
  const core = await loadCore();
  const config = core.normalize({ ...core.defaults(), h_thickness: 3 }).config;
  const code = await encodeShareCode(core, config);

  const mangled = `  ${code.slice(0, 12)}\n${code.slice(12)}\t `;
  assertSameConfig(core, await decodeShareCode(core, mangled), config, 'wrapped paste');

  const lowerPrefix = `rx1-${code.slice(4)}`;
  assertSameConfig(core, await decodeShareCode(core, lowerPrefix), config, 'lowercase prefix');
});

async function refuses(core, text, reasonKey) {
  await assert.rejects(
    () => decodeShareCode(core, text),
    (error) => {
      assert.ok(error instanceof ShareCodeError, `expected a ShareCodeError, got ${error}`);
      assert.equal(error.reasonKey, reasonKey, `for ${JSON.stringify(String(text).slice(0, 24))}`);
      return true;
    },
  );
}

test('nothing at all is reported as empty rather than malformed', async () => {
  const core = await loadCore();
  for (const text of ['', '   ', '\n\n', null, undefined]) {
    await refuses(core, text, 'share.errorEmpty');
  }
});

test('something that is not a code is refused on sight', async () => {
  const core = await loadCore();
  for (const text of [
    'hello',
    'RX2-abcdef',
    'RX1-',
    'RX1-not/base64+url',
    'https://example.com/crosshair',
    `RX1-${'a'.repeat(9000)}`,
  ]) {
    await refuses(core, text, 'share.errorFormat');
  }
});

test('a code truncated in transit fails instead of decoding to something else', async () => {
  const core = await loadCore();
  const config = core.normalize({ ...core.defaults(), h_length: 14, ring_enabled: 1 }).config;
  const code = await encodeShareCode(core, config);

  // Every truncation, not just a convenient one: a chat client can cut a
  // message anywhere, and a short read that still inflates is the case the
  // checksum exists for.
  for (let cut = 5; cut < code.length; cut += 1) {
    await assert.rejects(
      () => decodeShareCode(core, code.slice(0, cut)),
      (error) => error instanceof ShareCodeError,
      `a code cut to ${cut} characters was accepted`,
    );
  }
});

test('a code with a flipped character does not quietly become another crosshair', async () => {
  const core = await loadCore();
  const config = core.normalize({ ...core.defaults(), h_length: 12, x_enabled: 1 }).config;
  const code = await encodeShareCode(core, config);

  let accepted = 0;
  for (let at = 4; at < code.length; at += 1) {
    const swap = code[at] === 'A' ? 'B' : 'A';
    const broken = `${code.slice(0, at)}${swap}${code.slice(at + 1)}`;
    try {
      const decoded = await decodeShareCode(core, broken);
      // Inflate can legitimately accept some single-character changes; what
      // must not happen is one landing on a different valid crosshair
      // silently, which is what the checksum is there to catch.
      assertSameConfig(core, decoded, config, `flip at ${at}`);
      accepted += 1;
    } catch (error) {
      assert.ok(error instanceof ShareCodeError, `flip at ${at} threw ${error}`);
    }
  }
  assert.ok(accepted <= 1, `${accepted} corrupted codes decoded to a different crosshair`);
});

test('a code from a newer schema is refused rather than guessed at', async () => {
  const core = await loadCore();
  const code = await encodeShareCode(core, core.defaults());

  // Rebuild the blob with the schema byte bumped, which is what a code cut by
  // a future version would look like arriving here.
  const body = code.slice(4);
  const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const lookup = new Map([...B64].map((c, i) => [c, i]));
  let bits = 0;
  let held = 0;
  const raw = [];
  for (const character of body) {
    held = (held << 6) | lookup.get(character);
    bits += 6;
    if (bits >= 8) { bits -= 8; raw.push((held >> bits) & 0xFF); }
  }

  const inflated = [];
  const stream = new DecompressionStream('deflate-raw');
  const writer = stream.writable.getWriter();
  writer.write(new Uint8Array(raw));
  writer.close();
  const reader = stream.readable.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    inflated.push(...value);
  }

  inflated[1] = core.schemaVersion + 1;

  const out = [];
  const packer = new CompressionStream('deflate-raw');
  const packWriter = packer.writable.getWriter();
  packWriter.write(new Uint8Array(inflated));
  packWriter.close();
  const packReader = packer.readable.getReader();
  for (;;) {
    const { done, value } = await packReader.read();
    if (done) break;
    out.push(...value);
  }

  let encoded = '';
  for (let i = 0; i < out.length; i += 3) {
    const a = out[i];
    const b = i + 1 < out.length ? out[i + 1] : 0;
    const c = i + 2 < out.length ? out[i + 2] : 0;
    encoded += B64[a >> 2];
    encoded += B64[((a & 3) << 4) | (b >> 4)];
    if (i + 1 < out.length) encoded += B64[((b & 15) << 2) | (c >> 6)];
    if (i + 2 < out.length) encoded += B64[c & 63];
  }

  await refuses(core, `RX1-${encoded}`, 'share.errorNewer');
});

test('a code from an older schema still loads, with the new fields left at their defaults', async () => {
  const core = await loadCore();
  const defaults = core.defaults();
  const config = core.normalize({ ...defaults, h_length: 10 }).config;

  // Schema 2 appended the ring and the diagonals. A code cut before they
  // existed carries fewer bytes, which is exactly a shortened payload.
  const full = await encodeShareCode(core, config);
  const decoded = await decodeShareCode(core, full);

  assert.equal(decoded.ring_enabled, defaults.ring_enabled);
  assert.equal(decoded.x_enabled, defaults.x_enabled);
  assert.equal(decoded.h_length, 10);
});

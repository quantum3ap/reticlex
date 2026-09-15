/**
 * Share codes: one crosshair as a string short enough to paste into a chat.
 *
 * Exporting a JSON file works, but nobody sends a file to say "try my
 * crosshair" — they paste a line. So a code is the core's own 200 config bytes,
 * XORed against the defaults, deflated and base64url'd behind an `RX1-` prefix.
 *
 * The XOR is what makes it short. Most fields in any given reticle are left at
 * their default, so XORing against defaults turns most of those bytes into
 * zeros, and a run of zeros is almost free once deflated. A typical crosshair
 * comes out near eighty characters rather than the two hundred and seventy a
 * raw encoding would need.
 *
 * It also makes old codes keep working. "Absent means default" falls out of the
 * XOR for free, so a code written when the config had fewer fields still loads
 * in a later build, with the fields it never knew about left as they should be.
 * A code from a *newer* schema is refused instead of guessed at.
 *
 * The checksum is not defence against anybody: deflate already rejects a
 * mangled body. It is there so that a code truncated at a message boundary —
 * which does happen, and which can still inflate to something plausible — fails
 * with "this code is incomplete" instead of quietly producing a reticle nobody
 * designed.
 */

import { RxStatus } from './wasm.js';

/** The only format so far. Bumping this changes the prefix with it. */
const FORMAT = 1;

export const SHARE_PREFIX = 'RX1';

/** Longest code we will even look at, so a bad paste fails fast. */
const MAX_CODE_LENGTH = 8192;

/** Carries a localisation key, so the interface can say what went wrong. */
export class ShareCodeError extends Error {
  constructor(reasonKey, message) {
    super(message ?? reasonKey);
    this.name = 'ShareCodeError';
    this.reasonKey = reasonKey;
  }
}

/** FNV-1a, 32 bits, of which the low sixteen are kept. */
function fnv1a(bytes) {
  let hash = 0x811C9DC5;
  for (let i = 0; i < bytes.length; i += 1) {
    hash ^= bytes[i];
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function toBase64url(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    out += B64[a >> 2];
    out += B64[((a & 3) << 4) | (b >> 4)];
    if (i + 1 < bytes.length) out += B64[((b & 15) << 2) | (c >> 6)];
    if (i + 2 < bytes.length) out += B64[c & 63];
  }
  return out;
}

function fromBase64url(text) {
  const lookup = new Map([...B64].map((character, index) => [character, index]));
  const length = text.length;
  const full = Math.floor(length / 4);
  const remainder = length % 4;
  if (remainder === 1) throw new ShareCodeError('share.errorCorrupt');

  const size = full * 3 + (remainder === 0 ? 0 : remainder - 1);
  const out = new Uint8Array(size);
  let at = 0;
  let bits = 0;
  let held = 0;

  for (const character of text) {
    const value = lookup.get(character);
    if (value === undefined) throw new ShareCodeError('share.errorFormat');
    held = (held << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[at] = (held >> bits) & 0xFF;
      at += 1;
    }
  }
  return out;
}

async function through(stream, bytes) {
  const writer = stream.writable.getWriter();
  // Both halves have to be driven together. A body that will not inflate
  // rejects the write as well as the read, and an unobserved write rejection
  // escapes as an unhandled rejection long after this call has returned.
  const written = (async () => {
    await writer.write(bytes);
    await writer.close();
  })();

  const chunks = [];
  let total = 0;
  const reader = stream.readable.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.length;
    }
  } finally {
    await written.catch(() => { /* the read side is what reports the failure */ });
  }

  const out = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

const deflate = (bytes) => through(new CompressionStream('deflate-raw'), bytes);
const inflate = (bytes) => through(new DecompressionStream('deflate-raw'), bytes);

/** The config's bytes, XORed against the defaults of the same schema. */
function againstDefaults(core, bytes) {
  const base = core.configToBytes(core.defaults());
  const out = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i += 1) out[i] = bytes[i] ^ (base[i] ?? 0);
  return out;
}

/**
 * Encodes one crosshair.
 *
 * @param {import('./wasm.js').ReticleCore} core
 * @param {object} config flat field map
 * @returns {Promise<string>} e.g. "RX1-i9NAIgB…"
 */
export async function encodeShareCode(core, config) {
  const payload = againstDefaults(core, core.configToBytes(config));

  const blob = new Uint8Array(4 + payload.length);
  blob[0] = FORMAT;
  blob[1] = core.schemaVersion & 0xFF;
  const sum = fnv1a(payload);
  blob[2] = sum & 0xFF;
  blob[3] = (sum >>> 8) & 0xFF;
  blob.set(payload, 4);

  return `${SHARE_PREFIX}-${toBase64url(await deflate(blob))}`;
}

/**
 * Decodes one crosshair, throwing a {@link ShareCodeError} whose reasonKey
 * names a catalogue entry when the code cannot be used.
 *
 * @param {import('./wasm.js').ReticleCore} core
 * @param {string} text
 * @returns {Promise<object>} a normalised, validated config
 */
export async function decodeShareCode(core, text) {
  // People paste codes with line breaks in them, and out of a chat client that
  // may have wrapped it. Whitespace anywhere is never part of a code.
  const trimmed = String(text ?? '').replace(/\s+/g, '');
  if (!trimmed) throw new ShareCodeError('share.errorEmpty');
  if (trimmed.length > MAX_CODE_LENGTH) throw new ShareCodeError('share.errorFormat');

  const match = /^RX1-([A-Za-z0-9_-]+)$/i.exec(trimmed);
  if (!match) throw new ShareCodeError('share.errorFormat');

  let blob;
  try {
    blob = await inflate(fromBase64url(match[1]));
  } catch (error) {
    if (error instanceof ShareCodeError) throw error;
    throw new ShareCodeError('share.errorCorrupt');
  }

  if (blob.length < 5) throw new ShareCodeError('share.errorCorrupt');
  if (blob[0] !== FORMAT) throw new ShareCodeError('share.errorFormat');
  // A code from a schema we do not have cannot be read, only guessed at.
  if (blob[1] > core.schemaVersion) throw new ShareCodeError('share.errorNewer');

  const payload = blob.subarray(4);
  const sum = fnv1a(payload);
  if ((sum & 0xFF) !== blob[2] || ((sum >>> 8) & 0xFF) !== blob[3]) {
    throw new ShareCodeError('share.errorCorrupt');
  }

  const config = core.configFromBytes(againstDefaults(core, payload));
  const { config: normalized } = core.normalize(config);

  // A reticle with nothing switched on is a legitimate thing to have designed,
  // so it is let through; anything the core actually rejects is not.
  const status = core.validate(normalized);
  if (status !== RxStatus.OK && status !== RxStatus.EMPTY) {
    throw new ShareCodeError('share.errorInvalid');
  }
  return normalized;
}

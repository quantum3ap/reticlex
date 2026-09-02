/**
 * Loader and typed facade for the ReticleX native core compiled to WebAssembly.
 *
 * The same C/C++ sources are compiled to reticlex_core.dll for the Windows
 * host, so geometry, validation and the randomizer behave identically in the
 * preview and in anything the host renders. The field table is read out of the
 * module at load time rather than mirrored here, which makes an ABI change a
 * loud failure instead of silent corruption.
 */

const SHAPE_FLOATS = 10;   // cx cy hw hh angle radius r g b a
const SHAPE_BYTES = 48;
const GEOMETRY_HEADER_BYTES = 16;

export const RxStatus = Object.freeze({
  OK: 0,
  NULL: 1,
  SCHEMA: 2,
  NOT_FINITE: 3,
  RANGE: 4,
  EMPTY: 5,
  CAPACITY: 6,
  DIMENSIONS: 7,
});

export const RxStatusKey = Object.freeze({
  0: 'ok',
  1: 'nullArgument',
  2: 'schema',
  3: 'notFinite',
  4: 'range',
  5: 'empty',
  6: 'capacity',
  7: 'dimensions',
});

export const RandomField = Object.freeze({
  color: 1 << 0,
  size: 1 << 1,
  gap: 1 << 2,
  thickness: 1 << 3,
  dot: 1 << 4,
  outline: 1 << 5,
  shape: 1 << 6,
  opacity: 1 << 7,
  rotation: 1 << 8,
});

export const RandomStyle = Object.freeze({
  any: 0,
  precision: 1,
  classic: 2,
  minimal: 3,
  bold: 4,
});

export class CoreError extends Error {
  constructor(message, status = null) {
    super(message);
    this.name = 'CoreError';
    this.status = status;
  }
}

export class ReticleCore {
  #exports;
  #memory;

  constructor(instance) {
    this.#exports = instance.exports;
    this.#memory = instance.exports.memory;

    if (this.#exports.rx_abi_version() !== 1) {
      throw new CoreError('Unsupported core ABI version');
    }

    this.abiVersion = this.#exports.rx_abi_version();
    this.configSize = this.#exports.rx_config_size();
    this.fieldCount = this.#exports.rx_config_fields();
    this.maxShapes = this.#exports.rx_max_shapes();
    this.schemaVersion = this.#exports.rx_config_schema();

    if (this.#exports.rx_shape_size() !== SHAPE_BYTES) {
      throw new CoreError('Unexpected shape size reported by the core');
    }
    if (this.configSize !== this.fieldCount * 4) {
      throw new CoreError('Core config layout is not densely packed');
    }

    this.fields = [];
    this.fieldIndex = new Map();
    for (let i = 0; i < this.fieldCount; i += 1) {
      const name = this.#readCString(this.#exports.rx_field_name_at(i));
      const type = this.#exports.rx_field_type_at(i) === 0 ? 'int' : 'float';
      const field = { name, type, offset: i * 4, index: i };
      this.fields.push(field);
      this.fieldIndex.set(name, field);
    }

    this.configPtr = this.#exports.rx_scratch_config();
    this.geometryPtr = this.#exports.rx_scratch_geometry();
    this.pixelsPtr = this.#exports.rx_scratch_pixels();
    this.pixelCapacity = this.#exports.rx_scratch_pixels_capacity();
    this.valuesPtr = this.#exports.rx_scratch_values();
  }

  static async instantiate(bytes) {
    const { instance } = await WebAssembly.instantiate(bytes, {});
    return new ReticleCore(instance);
  }

  static async load(url = 'assets/reticlex_core.wasm') {
    const response = await fetch(url);
    if (!response.ok) throw new CoreError(`Failed to fetch ${url}: ${response.status}`);
    const bytes = await response.arrayBuffer();
    return ReticleCore.instantiate(bytes);
  }

  /* The buffer is detached and replaced whenever the module grows its memory,
     so every accessor re-reads it rather than caching a view. */
  get #view() {
    return new DataView(this.#memory.buffer);
  }

  #readCString(pointer) {
    if (!pointer) return '';
    const bytes = new Uint8Array(this.#memory.buffer);
    let end = pointer;
    while (bytes[end] !== 0) end += 1;
    return new TextDecoder().decode(bytes.subarray(pointer, end));
  }

  /** Writes a flat field map into the module's scratch config slot. */
  writeConfig(config, pointer = this.configPtr) {
    const view = this.#view;
    for (const field of this.fields) {
      const raw = config?.[field.name];
      if (field.type === 'int') {
        const value = raw === true ? 1 : raw === false ? 0 : Number(raw);
        view.setInt32(pointer + field.offset, Number.isFinite(value) ? value | 0 : 0, true);
      } else {
        const value = Number(raw);
        view.setFloat32(pointer + field.offset, Number.isFinite(value) ? value : 0, true);
      }
    }
    return pointer;
  }

  readConfig(pointer = this.configPtr) {
    const view = this.#view;
    const out = {};
    for (const field of this.fields) {
      out[field.name] = field.type === 'int'
        ? view.getInt32(pointer + field.offset, true)
        : view.getFloat32(pointer + field.offset, true);
    }
    return out;
  }

  defaults() {
    this.#exports.rx_config_defaults(this.configPtr);
    return this.readConfig();
  }

  /** Always succeeds: returns the repaired config and how much was changed. */
  normalize(config) {
    this.writeConfig(config);
    const adjusted = this.#exports.rx_config_normalize(this.configPtr);
    return { config: this.readConfig(), adjusted };
  }

  /** Returns an rx_status without modifying the input. */
  validate(config) {
    this.writeConfig(config);
    return this.#exports.rx_config_validate(this.configPtr);
  }

  /** Stable 16-character content hash; equal reticles hash equally. */
  fingerprint(config) {
    this.writeConfig(config);
    const value = this.#exports.rx_config_fingerprint(this.configPtr);
    return BigInt.asUintN(64, BigInt(value)).toString(16).padStart(16, '0');
  }

  equals(a, b) {
    return this.fingerprint(a) === this.fingerprint(b);
  }

  /**
   * Resolves a configuration into drawable shapes.
   * @returns {{status:number, extentW:number, extentH:number, shapes:Array}}
   */
  buildGeometry(config) {
    this.writeConfig(config);
    const status = this.#exports.rx_build_geometry(this.configPtr, this.geometryPtr);
    const view = this.#view;
    const count = view.getInt32(this.geometryPtr, true);
    const extentW = view.getFloat32(this.geometryPtr + 8, true);
    const extentH = view.getFloat32(this.geometryPtr + 12, true);
    const shapes = [];
    for (let i = 0; i < count; i += 1) {
      const base = this.geometryPtr + GEOMETRY_HEADER_BYTES + i * SHAPE_BYTES;
      shapes.push({
        cx: view.getFloat32(base, true),
        cy: view.getFloat32(base + 4, true),
        hw: view.getFloat32(base + 8, true),
        hh: view.getFloat32(base + 12, true),
        angle: view.getFloat32(base + 16, true),
        radius: view.getFloat32(base + 20, true),
        r: view.getFloat32(base + 24, true),
        g: view.getFloat32(base + 28, true),
        b: view.getFloat32(base + 32, true),
        a: view.getFloat32(base + 36, true),
        kind: view.getInt32(base + SHAPE_FLOATS * 4, true),
        layer: view.getInt32(base + SHAPE_FLOATS * 4 + 4, true),
      });
    }
    return { status, extentW, extentH, shapes };
  }

  /**
   * Rasterises into a fresh RGBA buffer sized width * height * 4.
   * Sizes above the module's scratch capacity are rejected rather than
   * silently truncated; the host renders anything larger.
   */
  rasterize(config, width, height, zoom = 1) {
    const needed = width * height * 4;
    if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
      throw new CoreError('Raster dimensions must be positive integers', RxStatus.DIMENSIONS);
    }
    if (needed > this.pixelCapacity) {
      throw new CoreError('Raster request exceeds core scratch capacity', RxStatus.DIMENSIONS);
    }
    this.writeConfig(config);
    const status = this.#exports.rx_rasterize(this.configPtr, width, height, zoom, this.pixelsPtr);
    if (status !== RxStatus.OK) {
      throw new CoreError(`Rasterisation failed (${RxStatusKey[status] ?? status})`, status);
    }
    return new Uint8ClampedArray(this.#memory.buffer, this.pixelsPtr, needed).slice();
  }

  /** Fits the reticle to the buffer; returns pixels plus the zoom chosen. */
  rasterizeFit(config, width, height, margin = 6) {
    const needed = width * height * 4;
    if (needed > this.pixelCapacity) {
      throw new CoreError('Raster request exceeds core scratch capacity', RxStatus.DIMENSIONS);
    }
    this.writeConfig(config);
    const zoomPtr = this.valuesPtr;
    const status = this.#exports.rx_rasterize_fit(
      this.configPtr, width, height, margin, this.pixelsPtr, zoomPtr,
    );
    if (status !== RxStatus.OK) {
      throw new CoreError(`Rasterisation failed (${RxStatusKey[status] ?? status})`, status);
    }
    const zoom = this.#view.getFloat32(zoomPtr, true);
    return {
      pixels: new Uint8ClampedArray(this.#memory.buffer, this.pixelsPtr, needed).slice(),
      zoom,
    };
  }

  /**
   * Mutates only the selected fields, so locked controls survive a reroll.
   * @param {object} config base configuration
   * @param {number} seed   any 32-bit value; the same seed always reproduces
   * @param {number} mask   bitwise OR of RandomField values
   * @param {number} style  RandomStyle value
   */
  randomize(config, seed, mask, style = RandomStyle.any) {
    this.writeConfig(config);
    const status = this.#exports.rx_randomize(this.configPtr, seed >>> 0, mask | 0, style | 0);
    if (status !== RxStatus.OK) {
      throw new CoreError(`Randomizer failed (${RxStatusKey[status] ?? status})`, status);
    }
    return this.readConfig();
  }

  hsvToHex(h, s, v) {
    return `#${(this.#exports.rx_color_hsv_to_hex(h, s, v) >>> 0).toString(16).padStart(6, '0').toUpperCase()}`;
  }

  hslToHex(h, s, l) {
    return `#${(this.#exports.rx_color_hsl_to_hex(h, s, l) >>> 0).toString(16).padStart(6, '0').toUpperCase()}`;
  }

  hexToHsv(hex) {
    const scratch = this.valuesPtr;
    this.#exports.rx_color_hex_to_hsv(parseInt(String(hex).replace('#', ''), 16) >>> 0, scratch);
    const view = this.#view;
    return { h: view.getFloat32(scratch, true), s: view.getFloat32(scratch + 4, true), v: view.getFloat32(scratch + 8, true) };
  }

  hexToHsl(hex) {
    const scratch = this.valuesPtr;
    this.#exports.rx_color_hex_to_hsl(parseInt(String(hex).replace('#', ''), 16) >>> 0, scratch);
    const view = this.#view;
    return { h: view.getFloat32(scratch, true), s: view.getFloat32(scratch + 4, true), l: view.getFloat32(scratch + 8, true) };
  }

  /** WCAG contrast ratio between two "#RRGGBB" colours. */
  contrast(a, b) {
    const parse = (hex) => parseInt(String(hex).replace('#', ''), 16) >>> 0;
    return this.#exports.rx_color_contrast(parse(a), parse(b));
  }
}

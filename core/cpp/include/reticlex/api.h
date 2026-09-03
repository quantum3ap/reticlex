/*
 * api.h - The exported C ABI of the ReticleX core.
 *
 * Every symbol here is available from three places: the Windows DLL loaded by
 * the C# host, the wasm module loaded by the front end, and the native test
 * binary. Keep the surface small and keep every entry point total: no entry
 * point may crash on hostile input, because imported JSON reaches these
 * functions after only shallow parsing.
 */
#ifndef RETICLEX_API_H
#define RETICLEX_API_H

#include <stdint.h>
#include "reticlex/config.h"
#include "reticlex/geometry.h"

#if defined(_WIN32)
#  if defined(RETICLEX_BUILD_SHARED)
#    define RX_API __declspec(dllexport)
#  else
#    define RX_API
#  endif
#elif defined(__wasm__)
#  define RX_API __attribute__((used, visibility("default")))
#else
#  define RX_API __attribute__((visibility("default")))
#endif

#ifdef __cplusplus
extern "C" {
#endif

/* --- Layout probes -------------------------------------------------------
   The managed and JavaScript layers assert against these at start-up so a
   struct change can never silently corrupt marshalling. */
RX_API int32_t rx_abi_version(void);
RX_API int32_t rx_config_schema(void);
RX_API int32_t rx_config_size(void);
RX_API int32_t rx_config_fields(void);
RX_API int32_t rx_shape_size(void);
RX_API int32_t rx_geometry_size(void);
RX_API int32_t rx_max_shapes(void);

/* --- Field table ---------------------------------------------------------
   The single source of truth for the flat ABI layout. The JavaScript loader
   builds its marshalling table by walking these at start-up rather than
   hard-coding a mirror, and the managed layer asserts against them. */
enum rx_field_type { RX_FIELD_INT = 0, RX_FIELD_FLOAT = 1 };
RX_API int32_t     rx_field_type_at(int32_t index);  /* -1 when out of range */
RX_API const char *rx_field_name_at(int32_t index);  /* null when out of range */

/* --- Configuration ------------------------------------------------------- */
RX_API void     rx_config_defaults(rx_config *out);
/* Clamps every field into its documented range and canonicalises flags.
   Returns the number of fields that had to be adjusted, or -1 on a null
   pointer. Always succeeds otherwise, which is what makes import safe. */
RX_API int32_t  rx_config_normalize(rx_config *cfg);
/* Reports the first problem found without modifying the input. */
RX_API int32_t  rx_config_validate(const rx_config *cfg);
/* Stable content hash; equal configs always hash equally. */
RX_API uint64_t rx_config_fingerprint(const rx_config *cfg);
RX_API int32_t  rx_config_equals(const rx_config *a, const rx_config *b);

/* --- Geometry ------------------------------------------------------------ */
RX_API int32_t rx_build_geometry(const rx_config *cfg, rx_geometry *out);

/* --- Rasterisation -------------------------------------------------------
   Renders into a caller-owned, non-premultiplied RGBA8 buffer of
   width*height*4 bytes. The reticle is centred and scaled by `zoom`. The
   buffer is cleared to transparent first. Reentrant: no global state. */
RX_API int32_t rx_rasterize(const rx_config *cfg, int32_t width, int32_t height,
                            float zoom, uint8_t *out_rgba);
/* Fits the reticle to the buffer with a small margin, returning the zoom used
   in *out_zoom. Used for preset thumbnails, where sizes vary wildly. */
RX_API int32_t rx_rasterize_fit(const rx_config *cfg, int32_t width, int32_t height,
                                float margin, uint8_t *out_rgba, float *out_zoom);

/* --- Randomizer ---------------------------------------------------------- */
enum rx_random_field {
    RX_RAND_COLOR     = 1 << 0,
    RX_RAND_SIZE      = 1 << 1,
    RX_RAND_GAP       = 1 << 2,
    RX_RAND_THICKNESS = 1 << 3,
    RX_RAND_DOT       = 1 << 4,
    RX_RAND_OUTLINE   = 1 << 5,
    RX_RAND_SHAPE     = 1 << 6,
    RX_RAND_OPACITY   = 1 << 7,
    RX_RAND_ROTATION  = 1 << 8,
    RX_RAND_ALL       = 0x1FF
};

/* Style archetypes the generator biases towards, so results look designed
   rather than merely random. */
enum rx_random_style {
    RX_STYLE_ANY       = 0,
    RX_STYLE_PRECISION = 1,  /* thin, tight, small gap */
    RX_STYLE_CLASSIC   = 2,  /* balanced four-arm cross */
    RX_STYLE_MINIMAL   = 3,  /* dot-led, short or absent arms */
    RX_STYLE_BOLD      = 4,  /* thick, high contrast, heavy outline */
    RX_STYLE_COUNT     = 5
};

/* Mutates only the fields selected by `field_mask`, leaving the rest intact so
   the user can lock parts of a design. Returns rx_status. */
RX_API int32_t rx_randomize(rx_config *cfg, uint32_t seed, int32_t field_mask,
                            int32_t style);

/* --- Colour helpers re-exported for the front end ------------------------ */
RX_API uint32_t rx_color_hsv_to_hex(float h, float s, float v);
RX_API void     rx_color_hex_to_hsv(uint32_t hex, float *out_hsv3);
RX_API uint32_t rx_color_hsl_to_hex(float h, float s, float l);
RX_API void     rx_color_hex_to_hsl(uint32_t hex, float *out_hsl3);
/* WCAG contrast between a crosshair colour and a background colour. */
RX_API float    rx_color_contrast(uint32_t a_hex, uint32_t b_hex);

/* --- Scratch memory ------------------------------------------------------
   The freestanding wasm build has no allocator, so the module hands the
   JavaScript side fixed slots to marshal through instead. Single threaded by
   construction; the managed host ignores these and owns its own buffers. */
RX_API rx_config   *rx_scratch_config(void);
RX_API rx_geometry *rx_scratch_geometry(void);
RX_API uint8_t     *rx_scratch_pixels(void);
RX_API int32_t      rx_scratch_pixels_capacity(void);
/* Eight floats for small out-parameters such as a fitted zoom or an HSV
   triple, so callers never have to borrow one of the larger slots. */
RX_API float       *rx_scratch_values(void);

#ifdef __cplusplus
}
#endif
#endif /* RETICLEX_API_H */

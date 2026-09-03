#include "reticlex/api.h"
#include "reticlex/rx_math.h"

/* Colour helpers are re-exported so the front end's picker and the host's
   thumbnail pipeline agree to the last bit with the randomizer. */

uint32_t rx_color_hsv_to_hex(float h, float s, float v) {
    rx_hsv hsv{ h, s, v };
    return rx_rgb_to_hex(rx_hsv_to_rgb(hsv));
}

void rx_color_hex_to_hsv(uint32_t hex, float *out_hsv3) {
    if (!out_hsv3) return;
    rx_hsv hsv = rx_rgb_to_hsv(rx_hex_to_rgb(hex));
    out_hsv3[0] = hsv.h;
    out_hsv3[1] = hsv.s;
    out_hsv3[2] = hsv.v;
}

uint32_t rx_color_hsl_to_hex(float h, float s, float l) {
    rx_hsl hsl{ h, s, l };
    return rx_rgb_to_hex(rx_hsl_to_rgb(hsl));
}

void rx_color_hex_to_hsl(uint32_t hex, float *out_hsl3) {
    if (!out_hsl3) return;
    rx_hsl hsl = rx_rgb_to_hsl(rx_hex_to_rgb(hex));
    out_hsl3[0] = hsl.h;
    out_hsl3[1] = hsl.s;
    out_hsl3[2] = hsl.l;
}

float rx_color_contrast(uint32_t a_hex, uint32_t b_hex) {
    return rx_contrast_ratio(rx_hex_to_rgb(a_hex), rx_hex_to_rgb(b_hex));
}

/* --- Scratch slots ------------------------------------------------------- */

/* 512 x 512 RGBA is the largest preview the front end ever asks the module to
   rasterise; anything bigger is exported through the managed host, which
   supplies its own buffer. */
#define RX_SCRATCH_PIXELS (512 * 512 * 4)

namespace {
rx_config   g_scratchConfig;
rx_geometry g_scratchGeometry;
uint8_t     g_scratchPixels[RX_SCRATCH_PIXELS];
float       g_scratchValues[8];
}

rx_config   *rx_scratch_config(void)   { return &g_scratchConfig; }
rx_geometry *rx_scratch_geometry(void) { return &g_scratchGeometry; }
uint8_t     *rx_scratch_pixels(void)   { return g_scratchPixels; }
int32_t      rx_scratch_pixels_capacity(void) { return RX_SCRATCH_PIXELS; }
float       *rx_scratch_values(void)   { return g_scratchValues; }

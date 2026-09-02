/*
 * rx_color.h - Colour space conversion and contrast maths.
 *
 * Shared by the randomizer (which needs perceptually sane colour choices),
 * the colour picker bridge, and the preview's readability warnings.
 */
#ifndef RETICLEX_RX_COLOR_H
#define RETICLEX_RX_COLOR_H

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/* Linear-free sRGB components in [0, 1]. */
typedef struct rx_rgb { float r, g, b; } rx_rgb;
/* h in [0, 360), s and v/l in [0, 1]. */
typedef struct rx_hsv { float h, s, v; } rx_hsv;
typedef struct rx_hsl { float h, s, l; } rx_hsl;

rx_rgb rx_hsv_to_rgb(rx_hsv hsv);
rx_hsv rx_rgb_to_hsv(rx_rgb rgb);
rx_rgb rx_hsl_to_rgb(rx_hsl hsl);
rx_hsl rx_rgb_to_hsl(rx_rgb rgb);

/* Packs to 0xRRGGBB. */
uint32_t rx_rgb_to_hex(rx_rgb rgb);
rx_rgb   rx_hex_to_rgb(uint32_t hex);

/* Parses "#RGB", "#RRGGBB" or the same without the hash. Returns 1 on success. */
int rx_parse_hex(const char *text, int length, rx_rgb *out);
/* Writes exactly 7 characters ("#RRGGBB") plus a NUL. Buffer must hold 8. */
void rx_format_hex(rx_rgb rgb, char *out);

/* WCAG relative luminance. */
float rx_luminance(rx_rgb rgb);
/* WCAG contrast ratio in [1, 21]. */
float rx_contrast_ratio(rx_rgb a, rx_rgb b);

rx_rgb rx_rgb_clamp(rx_rgb c);
rx_rgb rx_rgb_mix(rx_rgb a, rx_rgb b, float t);

#ifdef __cplusplus
}
#endif
#endif /* RETICLEX_RX_COLOR_H */

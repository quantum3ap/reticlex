#include "reticlex/rx_color.h"
#include "reticlex/rx_math.h"

rx_rgb rx_rgb_clamp(rx_rgb c) {
    rx_rgb o;
    o.r = rx_clampf(c.r, 0.0f, 1.0f);
    o.g = rx_clampf(c.g, 0.0f, 1.0f);
    o.b = rx_clampf(c.b, 0.0f, 1.0f);
    return o;
}

rx_rgb rx_rgb_mix(rx_rgb a, rx_rgb b, float t) {
    float k = rx_clampf(t, 0.0f, 1.0f);
    rx_rgb o;
    o.r = rx_lerpf(a.r, b.r, k);
    o.g = rx_lerpf(a.g, b.g, k);
    o.b = rx_lerpf(a.b, b.b, k);
    return o;
}

rx_rgb rx_hsv_to_rgb(rx_hsv hsv) {
    float h = rx_wrapf(hsv.h, 0.0f, 360.0f) / 60.0f;
    float s = rx_clampf(hsv.s, 0.0f, 1.0f);
    float v = rx_clampf(hsv.v, 0.0f, 1.0f);
    int sector = (int)rx_floorf(h);
    float f = h - (float)sector;
    float p = v * (1.0f - s);
    float q = v * (1.0f - s * f);
    float t = v * (1.0f - s * (1.0f - f));
    rx_rgb o;
    switch (sector % 6) {
        case 0:  o.r = v; o.g = t; o.b = p; break;
        case 1:  o.r = q; o.g = v; o.b = p; break;
        case 2:  o.r = p; o.g = v; o.b = t; break;
        case 3:  o.r = p; o.g = q; o.b = v; break;
        case 4:  o.r = t; o.g = p; o.b = v; break;
        default: o.r = v; o.g = p; o.b = q; break;
    }
    return o;
}

rx_hsv rx_rgb_to_hsv(rx_rgb rgb) {
    rx_rgb c = rx_rgb_clamp(rgb);
    float max = rx_maxf(c.r, rx_maxf(c.g, c.b));
    float min = rx_minf(c.r, rx_minf(c.g, c.b));
    float delta = max - min;
    rx_hsv o;
    o.v = max;
    o.s = (max <= 0.0f) ? 0.0f : delta / max;
    if (delta <= 0.0f) {
        o.h = 0.0f;
    } else if (max == c.r) {
        o.h = 60.0f * rx_wrapf((c.g - c.b) / delta, 0.0f, 6.0f);
    } else if (max == c.g) {
        o.h = 60.0f * (((c.b - c.r) / delta) + 2.0f);
    } else {
        o.h = 60.0f * (((c.r - c.g) / delta) + 4.0f);
    }
    o.h = rx_wrapf(o.h, 0.0f, 360.0f);
    return o;
}

rx_rgb rx_hsl_to_rgb(rx_hsl hsl) {
    float s = rx_clampf(hsl.s, 0.0f, 1.0f);
    float l = rx_clampf(hsl.l, 0.0f, 1.0f);
    /* HSL and HSV share a hue; convert through the common cone geometry. */
    float v = l + s * rx_minf(l, 1.0f - l);
    rx_hsv hsv;
    hsv.h = hsl.h;
    hsv.v = v;
    hsv.s = (v <= 0.0f) ? 0.0f : 2.0f * (1.0f - l / v);
    return rx_hsv_to_rgb(hsv);
}

rx_hsl rx_rgb_to_hsl(rx_rgb rgb) {
    rx_rgb c = rx_rgb_clamp(rgb);
    float max = rx_maxf(c.r, rx_maxf(c.g, c.b));
    float min = rx_minf(c.r, rx_minf(c.g, c.b));
    float delta = max - min;
    rx_hsl o;
    o.l = 0.5f * (max + min);
    if (delta <= 0.0f) {
        o.h = 0.0f;
        o.s = 0.0f;
        return o;
    }
    float denom = 1.0f - rx_absf(2.0f * o.l - 1.0f);
    o.s = (denom <= 0.0f) ? 0.0f : rx_clampf(delta / denom, 0.0f, 1.0f);
    o.h = rx_rgb_to_hsv(c).h;
    return o;
}

uint32_t rx_rgb_to_hex(rx_rgb rgb) {
    rx_rgb c = rx_rgb_clamp(rgb);
    uint32_t r = (uint32_t)rx_roundf(c.r * 255.0f);
    uint32_t g = (uint32_t)rx_roundf(c.g * 255.0f);
    uint32_t b = (uint32_t)rx_roundf(c.b * 255.0f);
    return (r << 16) | (g << 8) | b;
}

rx_rgb rx_hex_to_rgb(uint32_t hex) {
    rx_rgb o;
    o.r = (float)((hex >> 16) & 0xFFu) / 255.0f;
    o.g = (float)((hex >> 8) & 0xFFu) / 255.0f;
    o.b = (float)(hex & 0xFFu) / 255.0f;
    return o;
}

static int rx_hex_digit(char c) {
    if (c >= '0' && c <= '9') return c - '0';
    if (c >= 'a' && c <= 'f') return c - 'a' + 10;
    if (c >= 'A' && c <= 'F') return c - 'A' + 10;
    return -1;
}

int rx_parse_hex(const char *text, int length, rx_rgb *out) {
    if (!text || !out) return 0;
    int start = 0;
    if (length > 0 && text[0] == '#') { start = 1; }
    int digits = length - start;
    if (digits != 3 && digits != 6) return 0;
    int v[6];
    for (int i = 0; i < digits; ++i) {
        v[i] = rx_hex_digit(text[start + i]);
        if (v[i] < 0) return 0;
    }
    if (digits == 3) {
        out->r = (float)(v[0] * 17) / 255.0f;
        out->g = (float)(v[1] * 17) / 255.0f;
        out->b = (float)(v[2] * 17) / 255.0f;
    } else {
        out->r = (float)(v[0] * 16 + v[1]) / 255.0f;
        out->g = (float)(v[2] * 16 + v[3]) / 255.0f;
        out->b = (float)(v[4] * 16 + v[5]) / 255.0f;
    }
    return 1;
}

void rx_format_hex(rx_rgb rgb, char *out) {
    static const char digits[] = "0123456789ABCDEF";
    if (!out) return;
    uint32_t hex = rx_rgb_to_hex(rgb);
    out[0] = '#';
    for (int i = 0; i < 6; ++i) {
        int shift = 20 - i * 4;
        out[1 + i] = digits[(hex >> shift) & 0xFu];
    }
    out[7] = '\0';
}

static float rx_srgb_to_linear(float c) {
    if (c <= 0.03928f) return c / 12.92f;
    return rx_powf((c + 0.055f) / 1.055f, 2.4f);
}

float rx_luminance(rx_rgb rgb) {
    rx_rgb c = rx_rgb_clamp(rgb);
    return 0.2126f * rx_srgb_to_linear(c.r)
         + 0.7152f * rx_srgb_to_linear(c.g)
         + 0.0722f * rx_srgb_to_linear(c.b);
}

float rx_contrast_ratio(rx_rgb a, rx_rgb b) {
    float la = rx_luminance(a);
    float lb = rx_luminance(b);
    float hi = rx_maxf(la, lb);
    float lo = rx_minf(la, lb);
    return (hi + 0.05f) / (lo + 0.05f);
}

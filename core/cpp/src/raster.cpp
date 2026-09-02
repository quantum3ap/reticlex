#include "reticlex/api.h"
#include "reticlex/rx_math.h"

/*
 * Software rasteriser used for PNG export and preset thumbnails.
 *
 * Shapes are resolved to signed distance fields and sampled once per pixel,
 * which gives clean analytic anti-aliasing without supersampling. Work is
 * tiled so the only scratch memory is a small stack buffer; that keeps the
 * function reentrant, which matters because the host renders preset
 * thumbnails in parallel.
 */

namespace {

constexpr int   kTile = 32;
constexpr float kMaxZoom = 64.0f;

struct Vec2 { float x, y; };

/* Signed distance to an oriented rounded box, in the same units as the inputs. */
inline float sd_round_box(Vec2 p, float hw, float hh, float radius) {
    const float r = rx_minf(radius, rx_minf(hw, hh));
    const float qx = rx_absf(p.x) - hw + r;
    const float qy = rx_absf(p.y) - hh + r;
    const float outsideX = rx_maxf(qx, 0.0f);
    const float outsideY = rx_maxf(qy, 0.0f);
    const float outside = rx_sqrtf(outsideX * outsideX + outsideY * outsideY);
    const float inside = rx_minf(rx_maxf(qx, qy), 0.0f);
    return outside + inside - r;
}

/* Exact for circles, which is the only case the centre dot produces; the
   general ellipse falls back to the standard scaled approximation. */
inline float sd_ellipse(Vec2 p, float hw, float hh) {
    if (hw <= 0.0f || hh <= 0.0f) return 1e9f;
    const float nx = p.x / hw;
    const float ny = p.y / hh;
    const float k = rx_sqrtf(nx * nx + ny * ny);
    return (k - 1.0f) * rx_minf(hw, hh);
}

struct DeviceShape {
    float cx, cy, hw, hh, radius;
    float cosA, sinA;
    int32_t kind;
    /* Inclusive pixel bounds this shape can possibly touch. */
    int x0, y0, x1, y1;
};

inline float coverage(const DeviceShape &s, float px, float py) {
    const float dx = px - s.cx;
    const float dy = py - s.cy;
    /* Rotate the sample into shape-local space (inverse rotation). */
    Vec2 local{ dx * s.cosA + dy * s.sinA, -dx * s.sinA + dy * s.cosA };
    const float d = (s.kind == RX_SHAPE_ELLIPSE)
                  ? sd_ellipse(local, s.hw, s.hh)
                  : sd_round_box(local, s.hw, s.hh, s.radius);
    return rx_clampf(0.5f - d, 0.0f, 1.0f);
}

} // namespace

int32_t rx_rasterize(const rx_config *cfg, int32_t width, int32_t height,
                     float zoom, uint8_t *out_rgba) {
    if (!cfg || !out_rgba) return RX_ERR_NULL;
    if (width <= 0 || height <= 0 || width > RX_MAX_RASTER_DIM || height > RX_MAX_RASTER_DIM)
        return RX_ERR_DIMENSIONS;
    if (!rx_is_finite(zoom) || zoom <= 0.0f) return RX_ERR_DIMENSIONS;
    zoom = rx_clampf(zoom, 0.01f, kMaxZoom);

    for (int32_t i = 0, n = width * height * 4; i < n; ++i) out_rgba[i] = 0;

    rx_geometry geo;
    const int32_t status = rx_build_geometry(cfg, &geo);
    if (status != RX_OK) return status;
    if (geo.count == 0) return RX_OK;

    const float originX = (float)width * 0.5f;
    const float originY = (float)height * 0.5f;

    DeviceShape shapes[RX_MAX_SHAPES];
    for (int32_t i = 0; i < geo.count; ++i) {
        const rx_shape &s = geo.shapes[i];
        DeviceShape &d = shapes[i];
        d.cx = s.cx * zoom + originX;
        d.cy = s.cy * zoom + originY;
        d.hw = s.hw * zoom;
        d.hh = s.hh * zoom;
        d.radius = s.radius * zoom;
        d.cosA = rx_cosf(s.angle);
        d.sinA = rx_sinf(s.angle);
        d.kind = s.kind;

        const float halfX = d.hw * rx_absf(d.cosA) + d.hh * rx_absf(d.sinA) + 1.5f;
        const float halfY = d.hw * rx_absf(d.sinA) + d.hh * rx_absf(d.cosA) + 1.5f;
        d.x0 = rx_clampi((int)rx_floorf(d.cx - halfX), 0, width - 1);
        d.x1 = rx_clampi((int)rx_ceilf(d.cx + halfX), 0, width - 1);
        d.y0 = rx_clampi((int)rx_floorf(d.cy - halfY), 0, height - 1);
        d.y1 = rx_clampi((int)rx_ceilf(d.cy + halfY), 0, height - 1);
    }

    float cov[kTile * kTile];
    float acc[kTile * kTile * 4];

    for (int32_t tileY = 0; tileY < height; tileY += kTile) {
        const int32_t tileH = (height - tileY < kTile) ? height - tileY : kTile;
        for (int32_t tileX = 0; tileX < width; tileX += kTile) {
            const int32_t tileW = (width - tileX < kTile) ? width - tileX : kTile;
            const int32_t pixels = tileW * tileH;

            for (int32_t i = 0; i < pixels * 4; ++i) acc[i] = 0.0f;
            bool touched = false;

            /* One pass per paint group. Coverage inside a group is unioned with
               max() before compositing, so overlapping arms never darken each
               other at partial opacity. */
            for (int32_t group = 0; group < RX_LAYER_COUNT; ++group) {
                float gr = 0.0f, gg = 0.0f, gb = 0.0f, ga = 0.0f;
                bool any = false;

                for (int32_t i = 0; i < pixels; ++i) cov[i] = 0.0f;

                for (int32_t i = 0; i < geo.count; ++i) {
                    if (geo.shapes[i].layer != group) continue;
                    const DeviceShape &d = shapes[i];
                    const int32_t x0 = (d.x0 > tileX) ? d.x0 : tileX;
                    const int32_t x1 = (d.x1 < tileX + tileW - 1) ? d.x1 : tileX + tileW - 1;
                    const int32_t y0 = (d.y0 > tileY) ? d.y0 : tileY;
                    const int32_t y1 = (d.y1 < tileY + tileH - 1) ? d.y1 : tileY + tileH - 1;
                    if (x0 > x1 || y0 > y1) continue;

                    if (!any) {
                        const rx_shape &s = geo.shapes[i];
                        gr = s.r; gg = s.g; gb = s.b; ga = s.a;
                        any = true;
                    }
                    for (int32_t y = y0; y <= y1; ++y) {
                        float *row = cov + (y - tileY) * tileW;
                        for (int32_t x = x0; x <= x1; ++x) {
                            const float c = coverage(d, (float)x + 0.5f, (float)y + 0.5f);
                            float &slot = row[x - tileX];
                            if (c > slot) slot = c;
                        }
                    }
                }

                if (!any || ga <= 0.0f) continue;
                touched = true;

                for (int32_t i = 0; i < pixels; ++i) {
                    const float a = cov[i] * ga;
                    if (a <= 0.0f) continue;
                    float *px = acc + i * 4;
                    const float inv = 1.0f - a;
                    const float dstA = px[3];
                    const float outA = a + dstA * inv;
                    if (outA <= 0.0f) continue;
                    px[0] = (gr * a + px[0] * dstA * inv) / outA;
                    px[1] = (gg * a + px[1] * dstA * inv) / outA;
                    px[2] = (gb * a + px[2] * dstA * inv) / outA;
                    px[3] = outA;
                }
            }

            if (!touched) continue;

            for (int32_t y = 0; y < tileH; ++y) {
                uint8_t *dst = out_rgba + (((int32_t)(tileY + y) * width) + tileX) * 4;
                const float *src = acc + y * tileW * 4;
                for (int32_t x = 0; x < tileW; ++x) {
                    dst[x * 4 + 0] = (uint8_t)rx_roundf(rx_clampf(src[x * 4 + 0], 0.0f, 1.0f) * 255.0f);
                    dst[x * 4 + 1] = (uint8_t)rx_roundf(rx_clampf(src[x * 4 + 1], 0.0f, 1.0f) * 255.0f);
                    dst[x * 4 + 2] = (uint8_t)rx_roundf(rx_clampf(src[x * 4 + 2], 0.0f, 1.0f) * 255.0f);
                    dst[x * 4 + 3] = (uint8_t)rx_roundf(rx_clampf(src[x * 4 + 3], 0.0f, 1.0f) * 255.0f);
                }
            }
        }
    }

    return RX_OK;
}

int32_t rx_rasterize_fit(const rx_config *cfg, int32_t width, int32_t height,
                         float margin, uint8_t *out_rgba, float *out_zoom) {
    if (!cfg || !out_rgba) return RX_ERR_NULL;
    if (width <= 0 || height <= 0 || width > RX_MAX_RASTER_DIM || height > RX_MAX_RASTER_DIM)
        return RX_ERR_DIMENSIONS;

    rx_geometry geo;
    const int32_t status = rx_build_geometry(cfg, &geo);
    if (status != RX_OK) return status;

    const float pad = rx_clampf(margin, 0.0f, (float)rx_clampi(width < height ? width : height, 1, RX_MAX_RASTER_DIM) * 0.4f);
    const float availableW = rx_maxf((float)width - pad * 2.0f, 1.0f);
    const float availableH = rx_maxf((float)height - pad * 2.0f, 1.0f);

    float zoom = 1.0f;
    if (geo.extent_w > 0.0f || geo.extent_h > 0.0f) {
        const float zx = (geo.extent_w > 0.0f) ? availableW / geo.extent_w : kMaxZoom;
        const float zy = (geo.extent_h > 0.0f) ? availableH / geo.extent_h : kMaxZoom;
        zoom = rx_clampf(rx_minf(zx, zy), 0.05f, kMaxZoom);
    }

    if (out_zoom) *out_zoom = zoom;
    return rx_rasterize(cfg, width, height, zoom, out_rgba);
}

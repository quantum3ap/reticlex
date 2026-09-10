#include "reticlex/api.h"
#include "reticlex/rx_math.h"

namespace {

/* Fill primitives before the outline pass expands them. */
struct Part {
    float cx, cy, hw, hh, radius;
    float angle;      /* local orientation, added to the global rotation */
    int32_t kind;
    int32_t group;
};

constexpr int kMaxParts = RX_MAX_SHAPES / 2;

/* Thickness multipliers along a tapered arm, inner segment first. */
constexpr float kTaper[3] = { 1.0f, 0.70f, 0.45f };

struct Builder {
    Part parts[kMaxParts];
    int  count = 0;

    bool add(float cx, float cy, float hw, float hh, float radius, int32_t kind, int32_t group,
             float angle = 0.0f) {
        if (hw <= 0.0f || hh <= 0.0f) return true;   /* nothing to draw, not an error */
        if (count >= kMaxParts) return false;
        parts[count++] = Part{ cx, cy, hw, hh, radius, angle, kind, group };
        return true;
    }
};

/* Lays down one arm pointing along `angle`, measured from +x, for arms that are
   not axis-aligned. The axis-aligned pair keeps its own routine below: it
   describes the same rectangles without a rotation, which is what keeps every
   reticle built before diagonals existed resolving to identical geometry. */
bool add_angled_arm(Builder &b, float angle, float gap, float length,
                    float thickness, int32_t cap_style) {
    if (length <= 0.0f || thickness <= 0.0f) return true;

    const int segments = (cap_style == RX_CAP_TAPERED) ? 3 : 1;
    const float segLength = length / (float)segments;
    const float ca = rx_cosf(angle);
    const float sa = rx_sinf(angle);

    for (int i = 0; i < segments; ++i) {
        const float mult = (segments == 1) ? 1.0f : kTaper[i];
        const float segThickness = thickness * mult;
        if (segThickness <= 0.0f) continue;

        const float centreOffset = gap + segLength * ((float)i + 0.5f);
        const float halfLength = segLength * 0.5f;
        const float halfThickness = segThickness * 0.5f;

        const float radius = (cap_style == RX_CAP_ROUND)
                           ? rx_minf(halfLength, halfThickness) : 0.0f;

        if (!b.add(ca * centreOffset, sa * centreOffset, halfLength, halfThickness,
                   radius, RX_SHAPE_RECT, RX_LAYER_LINES, angle)) return false;
    }
    return true;
}

/* Lays down one axis-aligned arm. `axis` 0 = horizontal, 1 = vertical; `dir` is
   +1 or -1 along that axis. */
bool add_arm(Builder &b, int axis, float dir, float gap, float length,
             float thickness, int32_t cap_style) {
    if (length <= 0.0f || thickness <= 0.0f) return true;

    const int segments = (cap_style == RX_CAP_TAPERED) ? 3 : 1;
    const float segLength = length / (float)segments;

    for (int i = 0; i < segments; ++i) {
        const float mult = (segments == 1) ? 1.0f : kTaper[i];
        const float segThickness = thickness * mult;
        if (segThickness <= 0.0f) continue;

        const float centreOffset = gap + segLength * ((float)i + 0.5f);
        const float halfLength = segLength * 0.5f;
        const float halfThickness = segThickness * 0.5f;

        float cx, cy, hw, hh;
        if (axis == 0) {
            cx = dir * centreOffset; cy = 0.0f;
            hw = halfLength;         hh = halfThickness;
        } else {
            cx = 0.0f;               cy = dir * centreOffset;
            hw = halfThickness;      hh = halfLength;
        }

        float radius = 0.0f;
        if (cap_style == RX_CAP_ROUND) radius = rx_minf(hw, hh);

        if (!b.add(cx, cy, hw, hh, radius, RX_SHAPE_RECT, RX_LAYER_LINES)) return false;
    }
    return true;
}

inline void push_shape(rx_geometry *g, float cx, float cy, float hw, float hh,
                       float angle, float radius, rx_rgb colour, float alpha,
                       int32_t kind, int32_t layer) {
    rx_shape &s = g->shapes[g->count++];
    s.cx = cx; s.cy = cy;
    s.hw = hw; s.hh = hh;
    s.angle = angle;
    s.radius = radius;
    s.r = colour.r; s.g = colour.g; s.b = colour.b; s.a = alpha;
    s.kind = kind;
    s.layer = layer;
}

} // namespace

int32_t rx_build_geometry(const rx_config *cfg, rx_geometry *out) {
    if (!cfg || !out) return RX_ERR_NULL;

    out->count = 0;
    out->status = RX_OK;
    out->extent_w = 0.0f;
    out->extent_h = 0.0f;

    /* Work on a normalised copy so hostile input cannot produce NaN geometry
       and so callers may pass a raw struct straight from a JSON import. */
    rx_config c = *cfg;
    rx_config_normalize(&c);

    const float scale = c.scale;
    const float boost = c.dynamic_enabled ? c.dynamic_spread * c.dynamic_gap_boost : 0.0f;

    const float hGap = (c.h_gap + boost) * scale;
    const float vGap = (c.v_gap + boost) * scale;
    const float hLength = c.h_length * scale;
    const float vLength = c.v_length * scale;
    const float hThickness = c.h_thickness * scale;
    const float vThickness = c.v_thickness * scale;

    Builder builder;

    if (c.h_enabled) {
        if (c.show_right && !add_arm(builder, 0,  1.0f, hGap, hLength, hThickness, c.cap_style)) return RX_ERR_CAPACITY;
        if (c.show_left  && !add_arm(builder, 0, -1.0f, hGap, hLength, hThickness, c.cap_style)) return RX_ERR_CAPACITY;
    }
    if (c.v_enabled) {
        if (c.show_bottom && !add_arm(builder, 1,  1.0f, vGap, vLength, vThickness, c.cap_style)) return RX_ERR_CAPACITY;
        /* The T shape is exactly "no top arm", so it simply masks show_top. */
        if (c.show_top && !c.t_shape &&
            !add_arm(builder, 1, -1.0f, vGap, vLength, vThickness, c.cap_style)) return RX_ERR_CAPACITY;
    }

    if (c.x_enabled) {
        const float xGap = (c.x_gap + boost) * scale;
        const float xLength = c.x_length * scale;
        const float xThickness = c.x_thickness * scale;
        /* The four quadrant diagonals, starting down-right and going clockwise
           in screen space, where +y points down. */
        for (int i = 0; i < 4; ++i) {
            const float angle = (45.0f + 90.0f * (float)i) * RX_DEG2RAD;
            if (!add_angled_arm(builder, angle, xGap, xLength, xThickness, c.cap_style)) {
                return RX_ERR_CAPACITY;
            }
        }
    }

    if (c.ring_enabled && c.ring_radius > 0.0f) {
        /* ring_radius names the middle of the band, so the band straddles it. */
        const float half = c.ring_thickness * scale * 0.5f;
        const float outer = c.ring_radius * scale + half;
        const float inner = rx_maxf(c.ring_radius * scale - half, 0.0f);
        if (!builder.add(0.0f, 0.0f, outer, outer, inner, RX_SHAPE_RING, RX_LAYER_RING)) {
            return RX_ERR_CAPACITY;
        }
    }

    if (c.dot_enabled && c.dot_size > 0.0f) {
        const float half = c.dot_size * scale * 0.5f;
        const int32_t kind = (c.dot_shape == RX_DOT_ROUND) ? RX_SHAPE_ELLIPSE : RX_SHAPE_RECT;
        if (!builder.add(0.0f, 0.0f, half, half, 0.0f, kind, RX_LAYER_DOT)) return RX_ERR_CAPACITY;
    }

    const float theta = c.rotation * RX_DEG2RAD;
    const float cosT = rx_cosf(theta);
    const float sinT = rx_sinf(theta);

    const rx_rgb lineColour = c.color;
    const rx_rgb dotColour = c.dot_inherit_color ? c.color : c.dot_color;
    const rx_rgb ringColour = c.ring_inherit_color ? c.color : c.ring_color;
    const float lineAlpha = c.opacity;
    const float dotAlpha = c.dot_opacity * c.opacity;
    const float ringAlpha = c.ring_opacity * c.opacity;
    const float outlineAlpha = c.outline_opacity * c.opacity;
    const float outlineWidth = c.outline_enabled ? c.outline_thickness * scale : 0.0f;

    /* Outlines are emitted first so a renderer can walk the list in order and
       still get correct stacking without sorting. */
    if (outlineWidth > 0.0f && outlineAlpha > 0.0f) {
        if (builder.count * 2 > RX_MAX_SHAPES) return RX_ERR_CAPACITY;
        for (int i = 0; i < builder.count; ++i) {
            const Part &p = builder.parts[i];
            float rx, ry;
            rx = p.cx * cosT - p.cy * sinT;
            ry = p.cx * sinT + p.cy * cosT;
            /* A ring's stored radius is its inner edge, so the outline grows it
               inward; every other kind stores a corner radius, which grows out. */
            const float radius = (p.kind == RX_SHAPE_RING)
                               ? rx_maxf(p.radius - outlineWidth, 0.0f)
                               : ((p.radius > 0.0f) ? p.radius + outlineWidth : 0.0f);
            push_shape(out, rx, ry, p.hw + outlineWidth, p.hh + outlineWidth,
                       theta + p.angle, radius, c.outline_color, outlineAlpha,
                       p.kind, RX_LAYER_OUTLINE);
        }
    }

    for (int i = 0; i < builder.count; ++i) {
        const Part &p = builder.parts[i];
        float alpha = lineAlpha;
        rx_rgb colour = lineColour;
        if (p.group == RX_LAYER_DOT)       { alpha = dotAlpha;  colour = dotColour; }
        else if (p.group == RX_LAYER_RING) { alpha = ringAlpha; colour = ringColour; }
        if (alpha <= 0.0f) continue;
        if (out->count >= RX_MAX_SHAPES) return RX_ERR_CAPACITY;
        float rx, ry;
        rx = p.cx * cosT - p.cy * sinT;
        ry = p.cx * sinT + p.cy * cosT;
        push_shape(out, rx, ry, p.hw, p.hh, theta + p.angle, p.radius,
                   colour, alpha, p.kind, p.group);
    }

    /* Tight axis-aligned bounds of the rotated shapes. */
    float maxX = 0.0f, maxY = 0.0f;
    for (int i = 0; i < out->count; ++i) {
        const rx_shape &s = out->shapes[i];
        /* Per shape rather than per reticle: a diagonal arm carries its own
           45 degrees on top of the global rotation. */
        const float absCos = rx_absf(rx_cosf(s.angle));
        const float absSin = rx_absf(rx_sinf(s.angle));
        const float halfX = s.hw * absCos + s.hh * absSin;
        const float halfY = s.hw * absSin + s.hh * absCos;
        maxX = rx_maxf(maxX, rx_absf(s.cx) + halfX);
        maxY = rx_maxf(maxY, rx_absf(s.cy) + halfY);
    }
    out->extent_w = maxX * 2.0f;
    out->extent_h = maxY * 2.0f;

    return RX_OK;
}

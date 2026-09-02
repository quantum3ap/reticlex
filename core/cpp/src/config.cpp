#include "reticlex/api.h"
#include "reticlex/rx_math.h"
#include "reticlex/rx_hash.h"

/* The whole ABI rests on this struct being densely packed. If a member is ever
   added that is not four bytes wide, this fires at compile time. */
static_assert(sizeof(rx_config) == RX_CONFIG_FIELDS * 4,
              "rx_config must stay a flat, unpadded block of 4-byte fields");
static_assert(sizeof(rx_shape) == 12 * 4, "rx_shape layout changed");

namespace {

/* Coerces to exactly 0 or 1 so that fingerprints and equality never see a
   stray truthy value such as 2 imported from hand-edited JSON. */
inline int32_t boolish(int32_t v) { return v != 0 ? 1 : 0; }

inline float clean(float v, float lo, float hi, int32_t *adjusted) {
    float c = rx_clampf(v, lo, hi);
    /* Fold -0.0 to +0.0 so byte-wise hashing stays stable. */
    if (c == 0.0f) c = 0.0f;
    if (!(c == v)) { if (adjusted) ++(*adjusted); }
    return c;
}

inline int32_t clean_flag(int32_t v, int32_t *adjusted) {
    int32_t c = boolish(v);
    if (c != v && adjusted) ++(*adjusted);
    return c;
}

inline int32_t clean_enum(int32_t v, int32_t count, int32_t *adjusted) {
    int32_t c = rx_clampi(v, 0, count - 1);
    if (c != v && adjusted) ++(*adjusted);
    return c;
}

inline rx_rgb clean_color(rx_rgb c, int32_t *adjusted) {
    rx_rgb o;
    o.r = clean(c.r, 0.0f, 1.0f, adjusted);
    o.g = clean(c.g, 0.0f, 1.0f, adjusted);
    o.b = clean(c.b, 0.0f, 1.0f, adjusted);
    return o;
}

} // namespace

namespace {

struct FieldInfo { const char *name; int32_t type; };

/* Order is the struct's memory order and is part of the ABI. */
const FieldInfo kFields[RX_CONFIG_FIELDS] = {
    { "schema_version",    RX_FIELD_INT   },
    { "scale",             RX_FIELD_FLOAT },
    { "rotation",          RX_FIELD_FLOAT },
    { "opacity",           RX_FIELD_FLOAT },
    { "color_r",           RX_FIELD_FLOAT },
    { "color_g",           RX_FIELD_FLOAT },
    { "color_b",           RX_FIELD_FLOAT },
    { "h_enabled",         RX_FIELD_INT   },
    { "h_length",          RX_FIELD_FLOAT },
    { "h_thickness",       RX_FIELD_FLOAT },
    { "h_gap",             RX_FIELD_FLOAT },
    { "v_enabled",         RX_FIELD_INT   },
    { "v_length",          RX_FIELD_FLOAT },
    { "v_thickness",       RX_FIELD_FLOAT },
    { "v_gap",             RX_FIELD_FLOAT },
    { "show_left",         RX_FIELD_INT   },
    { "show_right",        RX_FIELD_INT   },
    { "show_top",          RX_FIELD_INT   },
    { "show_bottom",       RX_FIELD_INT   },
    { "t_shape",           RX_FIELD_INT   },
    { "cap_style",         RX_FIELD_INT   },
    { "outline_enabled",   RX_FIELD_INT   },
    { "outline_thickness", RX_FIELD_FLOAT },
    { "outline_opacity",   RX_FIELD_FLOAT },
    { "outline_color_r",   RX_FIELD_FLOAT },
    { "outline_color_g",   RX_FIELD_FLOAT },
    { "outline_color_b",   RX_FIELD_FLOAT },
    { "dot_enabled",       RX_FIELD_INT   },
    { "dot_size",          RX_FIELD_FLOAT },
    { "dot_opacity",       RX_FIELD_FLOAT },
    { "dot_inherit_color", RX_FIELD_INT   },
    { "dot_shape",         RX_FIELD_INT   },
    { "dot_color_r",       RX_FIELD_FLOAT },
    { "dot_color_g",       RX_FIELD_FLOAT },
    { "dot_color_b",       RX_FIELD_FLOAT },
    { "dynamic_enabled",   RX_FIELD_INT   },
    { "dynamic_spread",    RX_FIELD_FLOAT },
    { "dynamic_gap_boost", RX_FIELD_FLOAT }
};

} // namespace

int32_t rx_field_type_at(int32_t index) {
    if (index < 0 || index >= RX_CONFIG_FIELDS) return -1;
    return kFields[index].type;
}

const char *rx_field_name_at(int32_t index) {
    if (index < 0 || index >= RX_CONFIG_FIELDS) return nullptr;
    return kFields[index].name;
}

int32_t rx_abi_version(void)     { return RX_ABI_VERSION; }
int32_t rx_config_schema(void)   { return RX_CONFIG_SCHEMA; }
int32_t rx_config_size(void)     { return (int32_t)sizeof(rx_config); }
int32_t rx_config_fields(void)   { return RX_CONFIG_FIELDS; }
int32_t rx_shape_size(void)      { return (int32_t)sizeof(rx_shape); }
int32_t rx_geometry_size(void)   { return (int32_t)sizeof(rx_geometry); }
int32_t rx_max_shapes(void)      { return RX_MAX_SHAPES; }

void rx_config_defaults(rx_config *out) {
    if (!out) return;
    rx_config c;
    c.schema_version = RX_CONFIG_SCHEMA;

    c.scale    = 1.0f;
    c.rotation = 0.0f;
    c.opacity  = 1.0f;
    c.color    = rx_hex_to_rgb(0x00FF88u);   /* ReticleX signature mint */

    c.h_enabled   = 1;
    c.h_length    = 8.0f;
    c.h_thickness = 2.0f;
    c.h_gap       = 4.0f;

    c.v_enabled   = 1;
    c.v_length    = 8.0f;
    c.v_thickness = 2.0f;
    c.v_gap       = 4.0f;

    c.show_left   = 1;
    c.show_right  = 1;
    c.show_top    = 1;
    c.show_bottom = 1;
    c.t_shape     = 0;
    c.cap_style   = RX_CAP_FLAT;

    c.outline_enabled   = 1;
    c.outline_thickness = 1.0f;
    c.outline_opacity   = 0.85f;
    c.outline_color     = rx_hex_to_rgb(0x000000u);

    c.dot_enabled       = 0;
    c.dot_size          = 3.0f;
    c.dot_opacity       = 1.0f;
    c.dot_inherit_color = 1;
    c.dot_shape         = RX_DOT_SQUARE;
    c.dot_color         = rx_hex_to_rgb(0x00FF88u);

    c.dynamic_enabled   = 0;
    c.dynamic_spread    = 0.0f;
    c.dynamic_gap_boost = 8.0f;

    *out = c;
}

int32_t rx_config_normalize(rx_config *cfg) {
    if (!cfg) return -1;
    int32_t adjusted = 0;

    if (cfg->schema_version != RX_CONFIG_SCHEMA) {
        cfg->schema_version = RX_CONFIG_SCHEMA;
        ++adjusted;
    }

    cfg->scale    = clean(cfg->scale, RX_MIN_SCALE, RX_MAX_SCALE, &adjusted);
    cfg->opacity  = clean(cfg->opacity, 0.0f, 1.0f, &adjusted);
    {
        float wrapped = rx_is_finite(cfg->rotation)
                      ? rx_wrapf(cfg->rotation + 180.0f, 0.0f, 360.0f) - 180.0f
                      : 0.0f;
        if (!(wrapped == cfg->rotation)) ++adjusted;
        cfg->rotation = wrapped;
    }
    cfg->color = clean_color(cfg->color, &adjusted);

    cfg->h_enabled   = clean_flag(cfg->h_enabled, &adjusted);
    cfg->h_length    = clean(cfg->h_length, 0.0f, RX_MAX_LENGTH, &adjusted);
    cfg->h_thickness = clean(cfg->h_thickness, RX_MIN_THICKNESS, RX_MAX_THICKNESS, &adjusted);
    cfg->h_gap       = clean(cfg->h_gap, 0.0f, RX_MAX_GAP, &adjusted);

    cfg->v_enabled   = clean_flag(cfg->v_enabled, &adjusted);
    cfg->v_length    = clean(cfg->v_length, 0.0f, RX_MAX_LENGTH, &adjusted);
    cfg->v_thickness = clean(cfg->v_thickness, RX_MIN_THICKNESS, RX_MAX_THICKNESS, &adjusted);
    cfg->v_gap       = clean(cfg->v_gap, 0.0f, RX_MAX_GAP, &adjusted);

    cfg->show_left   = clean_flag(cfg->show_left, &adjusted);
    cfg->show_right  = clean_flag(cfg->show_right, &adjusted);
    cfg->show_top    = clean_flag(cfg->show_top, &adjusted);
    cfg->show_bottom = clean_flag(cfg->show_bottom, &adjusted);
    cfg->t_shape     = clean_flag(cfg->t_shape, &adjusted);
    cfg->cap_style   = clean_enum(cfg->cap_style, 3, &adjusted);

    cfg->outline_enabled   = clean_flag(cfg->outline_enabled, &adjusted);
    cfg->outline_thickness = clean(cfg->outline_thickness, 0.0f, RX_MAX_OUTLINE, &adjusted);
    cfg->outline_opacity   = clean(cfg->outline_opacity, 0.0f, 1.0f, &adjusted);
    cfg->outline_color     = clean_color(cfg->outline_color, &adjusted);

    cfg->dot_enabled       = clean_flag(cfg->dot_enabled, &adjusted);
    cfg->dot_size          = clean(cfg->dot_size, 0.0f, RX_MAX_DOT, &adjusted);
    cfg->dot_opacity       = clean(cfg->dot_opacity, 0.0f, 1.0f, &adjusted);
    cfg->dot_inherit_color = clean_flag(cfg->dot_inherit_color, &adjusted);
    cfg->dot_shape         = clean_enum(cfg->dot_shape, 2, &adjusted);
    cfg->dot_color         = clean_color(cfg->dot_color, &adjusted);

    cfg->dynamic_enabled   = clean_flag(cfg->dynamic_enabled, &adjusted);
    cfg->dynamic_spread    = clean(cfg->dynamic_spread, 0.0f, 1.0f, &adjusted);
    cfg->dynamic_gap_boost = clean(cfg->dynamic_gap_boost, 0.0f, RX_MAX_GAP_BOOST, &adjusted);

    /* The dot inherits the line colour, so keep the stored value in step and
       avoid two configurations that render identically hashing differently. */
    if (cfg->dot_inherit_color) cfg->dot_color = cfg->color;

    return adjusted;
}

int32_t rx_config_validate(const rx_config *cfg) {
    if (!cfg) return RX_ERR_NULL;
    if (cfg->schema_version != RX_CONFIG_SCHEMA) return RX_ERR_SCHEMA;

    /* Half the struct is genuinely integral, so finiteness is checked field by
       field rather than by sweeping the block as floats. */
    const float checked[] = {
        cfg->scale, cfg->rotation, cfg->opacity,
        cfg->color.r, cfg->color.g, cfg->color.b,
        cfg->h_length, cfg->h_thickness, cfg->h_gap,
        cfg->v_length, cfg->v_thickness, cfg->v_gap,
        cfg->outline_thickness, cfg->outline_opacity,
        cfg->outline_color.r, cfg->outline_color.g, cfg->outline_color.b,
        cfg->dot_size, cfg->dot_opacity,
        cfg->dot_color.r, cfg->dot_color.g, cfg->dot_color.b,
        cfg->dynamic_spread, cfg->dynamic_gap_boost
    };
    for (float v : checked) {
        if (!rx_is_finite(v)) return RX_ERR_NOT_FINITE;
    }

    if (cfg->scale < RX_MIN_SCALE || cfg->scale > RX_MAX_SCALE) return RX_ERR_RANGE;
    if (cfg->opacity < 0.0f || cfg->opacity > 1.0f) return RX_ERR_RANGE;
    if (cfg->rotation < -180.0f || cfg->rotation >= 180.0f) return RX_ERR_RANGE;
    if (cfg->h_length < 0.0f || cfg->h_length > RX_MAX_LENGTH) return RX_ERR_RANGE;
    if (cfg->v_length < 0.0f || cfg->v_length > RX_MAX_LENGTH) return RX_ERR_RANGE;
    if (cfg->h_thickness < RX_MIN_THICKNESS || cfg->h_thickness > RX_MAX_THICKNESS) return RX_ERR_RANGE;
    if (cfg->v_thickness < RX_MIN_THICKNESS || cfg->v_thickness > RX_MAX_THICKNESS) return RX_ERR_RANGE;
    if (cfg->h_gap < 0.0f || cfg->h_gap > RX_MAX_GAP) return RX_ERR_RANGE;
    if (cfg->v_gap < 0.0f || cfg->v_gap > RX_MAX_GAP) return RX_ERR_RANGE;
    if (cfg->outline_thickness < 0.0f || cfg->outline_thickness > RX_MAX_OUTLINE) return RX_ERR_RANGE;
    if (cfg->dot_size < 0.0f || cfg->dot_size > RX_MAX_DOT) return RX_ERR_RANGE;
    if (cfg->dynamic_gap_boost < 0.0f || cfg->dynamic_gap_boost > RX_MAX_GAP_BOOST) return RX_ERR_RANGE;
    if (cfg->cap_style < 0 || cfg->cap_style > RX_CAP_TAPERED) return RX_ERR_RANGE;
    if (cfg->dot_shape < 0 || cfg->dot_shape > RX_DOT_ROUND) return RX_ERR_RANGE;

    /* A crosshair that draws nothing is valid data but useless to a player, so
       it is reported separately from a malformed file. */
    rx_geometry probe;
    if (rx_build_geometry(cfg, &probe) == RX_OK && probe.count == 0) return RX_ERR_EMPTY;

    return RX_OK;
}

uint64_t rx_config_fingerprint(const rx_config *cfg) {
    if (!cfg) return 0;
    /* Hash a canonical copy: normalisation collapses equivalent encodings so
       that two configs which render identically fingerprint identically. */
    rx_config canon = *cfg;
    rx_config_normalize(&canon);
    return rx_hash_bytes(&canon, (uint32_t)sizeof(canon));
}

int32_t rx_config_equals(const rx_config *a, const rx_config *b) {
    if (!a || !b) return 0;
    return rx_config_fingerprint(a) == rx_config_fingerprint(b) ? 1 : 0;
}

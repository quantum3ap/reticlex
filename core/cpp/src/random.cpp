#include "reticlex/api.h"
#include "reticlex/rx_math.h"
#include "reticlex/rx_rand.h"

/*
 * Aesthetic randomizer.
 *
 * A uniform roll across every slider produces unusable crosshairs almost
 * every time: 40px gaps, 1px arms, muddy colours. Instead the generator picks
 * a style archetype and samples inside ranges that archetype is known to look
 * good in, then repairs anything that would render as nothing at all.
 */

namespace {

struct Range { float lo, hi, step; };

struct StyleProfile {
    Range length;
    Range thickness;
    Range gap;
    Range outline;
    Range dotSize;
    float dotChance;
    float outlineChance;
    float tShapeChance;
    float asymmetryChance;   /* horizontal and vertical differ */
    float armDropChance;     /* an individual arm switched off */
    float roundCapChance;
    float rotationChance;
};

const StyleProfile kProfiles[RX_STYLE_COUNT] = {
    /* RX_STYLE_ANY is never sampled directly; it resolves to one of the rest. */
    { {4,10,1}, {1,3,0.5f}, {2,6,1}, {0.5f,2,0.5f}, {2,4,1}, 0.35f, 0.85f, 0.10f, 0.20f, 0.10f, 0.20f, 0.05f },
    /* PRECISION */
    { {3, 8,1}, {1,2,0.5f}, {1,4,1}, {0.5f,1.5f,0.5f}, {1,3,0.5f}, 0.55f, 0.90f, 0.08f, 0.10f, 0.05f, 0.10f, 0.02f },
    /* CLASSIC */
    { {6,14,1}, {2,4,0.5f}, {3,8,1}, {1,2,0.5f}, {2,4,1}, 0.30f, 0.95f, 0.15f, 0.15f, 0.10f, 0.15f, 0.03f },
    /* MINIMAL */
    { {0, 5,1}, {1,3,0.5f}, {0,4,1}, {0.5f,1.5f,0.5f}, {2,6,1}, 0.90f, 0.75f, 0.05f, 0.10f, 0.30f, 0.45f, 0.02f },
    /* BOLD */
    { {10,22,1}, {4,8,0.5f}, {4,14,1}, {2,3,0.5f}, {4,9,1}, 0.35f, 1.00f, 0.20f, 0.25f, 0.10f, 0.25f, 0.10f }
};

/* Hue anchors that read clearly against both bright and dark game scenes.
   Weights bias towards the greens and cyans players actually pick. */
const float kHues[]       = { 150.0f, 175.0f, 195.0f,  55.0f,  30.0f,   0.0f, 320.0f, 265.0f,  95.0f };
const float kHueWeights[] = {   3.0f,   2.2f,   1.6f,   1.4f,   0.8f,   1.0f,   1.2f,   0.8f,   1.0f };
constexpr int kHueCount = (int)(sizeof(kHues) / sizeof(kHues[0]));

/* The scene a reticle is judged against. Most competitive shooters sit in this
   neighbourhood, and a colour readable here is readable almost everywhere. */
constexpr uint32_t kReferenceScene = 0x0B0B0Fu;
constexpr float kMinContrast = 3.0f;

/* Walks a colour towards the light until it clears the contrast floor. A
   generated reticle nobody can see is a bug, not a style. */
rx_rgb ensure_readable(rx_rgb colour) {
    const rx_rgb scene = rx_hex_to_rgb(kReferenceScene);
    rx_hsv hsv = rx_rgb_to_hsv(colour);
    for (int i = 0; i < 16 && rx_contrast_ratio(colour, scene) < kMinContrast; ++i) {
        hsv.v = rx_minf(1.0f, hsv.v * 1.06f + 0.02f);
        hsv.s *= 0.82f;
        colour = rx_hsv_to_rgb(hsv);
    }
    return colour;
}

rx_rgb pick_line_colour(rx_rng *rng) {
    /* One roll in eight lands on a neutral white-ish reticle. */
    if (rx_rng_chance(rng, 0.125f)) {
        rx_hsv hsv{ rx_rng_range(rng, 0.0f, 360.0f), rx_rng_range(rng, 0.0f, 0.08f), 1.0f };
        return rx_hsv_to_rgb(hsv);
    }
    const int32_t index = rx_rng_weighted(rng, kHueWeights, kHueCount);
    rx_hsv hsv;
    hsv.h = rx_wrapf(kHues[index] + rx_rng_range(rng, -12.0f, 12.0f), 0.0f, 360.0f);
    hsv.s = rx_rng_range(rng, 0.72f, 1.0f);
    hsv.v = rx_rng_range(rng, 0.92f, 1.0f);
    return ensure_readable(rx_hsv_to_rgb(hsv));
}

inline bool has(int32_t mask, int32_t bit) { return (mask & bit) != 0; }

} // namespace

int32_t rx_randomize(rx_config *cfg, uint32_t seed, int32_t field_mask, int32_t style) {
    if (!cfg) return RX_ERR_NULL;

    rx_rng rng;
    rx_rng_seed(&rng, seed);

    const int32_t mask = (field_mask == 0) ? RX_RAND_ALL : field_mask;

    int32_t resolved = style;
    if (resolved <= RX_STYLE_ANY || resolved >= RX_STYLE_COUNT) {
        resolved = rx_rng_int(&rng, RX_STYLE_PRECISION, RX_STYLE_COUNT - 1);
    }
    const StyleProfile &p = kProfiles[resolved];

    const bool asymmetric = rx_rng_chance(&rng, p.asymmetryChance);

    if (has(mask, RX_RAND_SIZE)) {
        cfg->h_length = rx_rng_quantized(&rng, p.length.lo, p.length.hi, p.length.step);
        cfg->v_length = asymmetric
            ? rx_rng_quantized(&rng, p.length.lo, p.length.hi, p.length.step)
            : cfg->h_length;
        cfg->scale = rx_rng_chance(&rng, 0.25f)
            ? rx_rng_quantized(&rng, 0.75f, 1.75f, 0.25f)
            : 1.0f;
    }

    if (has(mask, RX_RAND_THICKNESS)) {
        cfg->h_thickness = rx_rng_quantized(&rng, p.thickness.lo, p.thickness.hi, p.thickness.step);
        cfg->v_thickness = asymmetric
            ? rx_rng_quantized(&rng, p.thickness.lo, p.thickness.hi, p.thickness.step)
            : cfg->h_thickness;
    }

    if (has(mask, RX_RAND_GAP)) {
        cfg->h_gap = rx_rng_quantized(&rng, p.gap.lo, p.gap.hi, p.gap.step);
        cfg->v_gap = asymmetric
            ? rx_rng_quantized(&rng, p.gap.lo, p.gap.hi, p.gap.step)
            : cfg->h_gap;
    }

    if (has(mask, RX_RAND_COLOR)) {
        cfg->color = pick_line_colour(&rng);
        if (cfg->dot_inherit_color) cfg->dot_color = cfg->color;
        /* An outline that is not near-black stops reading as an outline. */
        const float k = rx_rng_range(&rng, 0.0f, 0.12f);
        cfg->outline_color = rx_rgb{ k, k, k };
    }

    if (has(mask, RX_RAND_OUTLINE)) {
        cfg->outline_enabled = rx_rng_chance(&rng, p.outlineChance);
        cfg->outline_thickness = rx_rng_quantized(&rng, p.outline.lo, p.outline.hi, p.outline.step);
        cfg->outline_opacity = rx_rng_quantized(&rng, 0.6f, 1.0f, 0.05f);
    }

    if (has(mask, RX_RAND_DOT)) {
        cfg->dot_enabled = rx_rng_chance(&rng, p.dotChance);
        cfg->dot_size = rx_rng_quantized(&rng, p.dotSize.lo, p.dotSize.hi, p.dotSize.step);
        cfg->dot_opacity = 1.0f;
        cfg->dot_shape = rx_rng_chance(&rng, 0.35f) ? RX_DOT_ROUND : RX_DOT_SQUARE;
        cfg->dot_inherit_color = rx_rng_chance(&rng, 0.8f);
        if (cfg->dot_inherit_color) {
            cfg->dot_color = cfg->color;
        } else {
            rx_hsv hsv = rx_rgb_to_hsv(cfg->color);
            hsv.h = rx_wrapf(hsv.h + rx_rng_range(&rng, 120.0f, 240.0f), 0.0f, 360.0f);
            cfg->dot_color = ensure_readable(rx_hsv_to_rgb(hsv));
        }
    }

    if (has(mask, RX_RAND_SHAPE)) {
        cfg->h_enabled = 1;
        cfg->v_enabled = 1;
        cfg->show_left = !rx_rng_chance(&rng, p.armDropChance);
        cfg->show_right = !rx_rng_chance(&rng, p.armDropChance);
        cfg->show_top = !rx_rng_chance(&rng, p.armDropChance);
        cfg->show_bottom = !rx_rng_chance(&rng, p.armDropChance);
        cfg->t_shape = rx_rng_chance(&rng, p.tShapeChance);
        if (rx_rng_chance(&rng, p.roundCapChance)) {
            cfg->cap_style = rx_rng_chance(&rng, 0.7f) ? RX_CAP_ROUND : RX_CAP_TAPERED;
        } else {
            cfg->cap_style = RX_CAP_FLAT;
        }
    }

    if (has(mask, RX_RAND_OPACITY)) {
        /* Never below 0.6: a faint reticle is the fastest way to make a
           generated design feel broken. */
        cfg->opacity = rx_rng_quantized(&rng, 0.75f, 1.0f, 0.05f);
    }

    if (has(mask, RX_RAND_ROTATION)) {
        cfg->rotation = rx_rng_chance(&rng, p.rotationChance)
            ? rx_rng_quantized(&rng, -45.0f, 45.0f, 15.0f)
            : 0.0f;
    }

    rx_config_normalize(cfg);

    /* Repair pass: the roll may have switched off every arm and the dot at
       once. Rather than reroll blindly, put the minimum back. */
    rx_geometry geo;
    if (rx_build_geometry(cfg, &geo) != RX_OK || geo.count == 0) {
        cfg->h_enabled = 1;
        cfg->v_enabled = 1;
        cfg->show_left = cfg->show_right = cfg->show_bottom = 1;
        cfg->show_top = cfg->t_shape ? 0 : 1;
        if (cfg->h_length < 2.0f) cfg->h_length = 6.0f;
        if (cfg->v_length < 2.0f) cfg->v_length = 6.0f;
        cfg->opacity = rx_maxf(cfg->opacity, 0.8f);
        rx_config_normalize(cfg);
    }

    return RX_OK;
}

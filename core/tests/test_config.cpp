#include "test_harness.h"
#include "reticlex/api.h"
#include "reticlex/rx_math.h"
#include <cmath>
#include <cstring>

RX_TEST(config_abi_layout_is_stable) {
    /* The C# and JavaScript field tables are generated against these numbers.
       If one changes without the others, marshalling silently corrupts. */
    CHECK(rx_config_size() == 152);
    CHECK(rx_config_fields() == 38);
    CHECK(rx_config_size() == rx_config_fields() * 4);
    CHECK(rx_shape_size() == 48);
    CHECK(rx_max_shapes() == 32);
    CHECK(rx_geometry_size() == 16 + 32 * 48);
    CHECK(rx_abi_version() == 1);
    CHECK(rx_config_schema() == 1);
}

RX_TEST(config_defaults_are_valid_and_visible) {
    rx_config c;
    rx_config_defaults(&c);
    CHECK(rx_config_validate(&c) == RX_OK);
    CHECK(rx_config_normalize(&c) == 0);   /* defaults need no repair */
    rx_geometry g;
    CHECK(rx_build_geometry(&c, &g) == RX_OK);
    CHECK(g.count > 0);
}

RX_TEST(config_normalize_clamps_every_out_of_range_field) {
    rx_config c;
    rx_config_defaults(&c);
    c.scale = 999.0f;
    c.opacity = -4.0f;
    c.h_length = 1e9f;
    c.h_thickness = 0.0f;
    c.v_gap = -20.0f;
    c.outline_thickness = 100.0f;
    c.dot_size = -1.0f;
    c.cap_style = 77;
    c.dot_shape = -3;
    c.dynamic_gap_boost = 1e9f;
    const int32_t adjusted = rx_config_normalize(&c);
    CHECK(adjusted >= 10);
    CHECK(c.scale == RX_MAX_SCALE);
    CHECK(c.opacity == 0.0f);
    CHECK(c.h_length == RX_MAX_LENGTH);
    CHECK(c.h_thickness == RX_MIN_THICKNESS);
    CHECK(c.v_gap == 0.0f);
    CHECK(c.outline_thickness == RX_MAX_OUTLINE);
    CHECK(c.dot_size == 0.0f);
    CHECK(c.cap_style == RX_CAP_TAPERED);
    CHECK(c.dot_shape == RX_DOT_SQUARE);
    CHECK(c.dynamic_gap_boost == RX_MAX_GAP_BOOST);
}

RX_TEST(config_normalize_survives_nan_and_infinity) {
    rx_config c;
    rx_config_defaults(&c);
    c.scale = std::nanf("");
    c.rotation = HUGE_VALF;
    c.h_gap = -HUGE_VALF;
    c.color.r = std::nanf("");
    rx_config_normalize(&c);
    CHECK(rx_config_validate(&c) == RX_OK);
    CHECK(rx_is_finite(c.scale));
    CHECK(rx_is_finite(c.rotation));
    CHECK(rx_is_finite(c.h_gap));
    CHECK(rx_is_finite(c.color.r));
}

RX_TEST(config_normalize_is_idempotent) {
    rx_config c;
    rx_config_defaults(&c);
    c.scale = 7.0f;
    c.rotation = 900.0f;
    c.h_thickness = 0.1f;
    rx_config_normalize(&c);
    rx_config once = c;
    CHECK(rx_config_normalize(&c) == 0);
    CHECK(std::memcmp(&once, &c, sizeof(rx_config)) == 0);
}

RX_TEST(config_normalize_canonicalises_truthy_flags) {
    rx_config c;
    rx_config_defaults(&c);
    c.dot_enabled = 42;
    c.t_shape = -1;
    rx_config_normalize(&c);
    CHECK(c.dot_enabled == 1);
    CHECK(c.t_shape == 1);
}

RX_TEST(config_rotation_wraps_into_half_open_range) {
    rx_config c;
    rx_config_defaults(&c);
    const float inputs[] = { 360.0f, -360.0f, 540.0f, 180.0f, -180.0f, 45.0f };
    for (float v : inputs) {
        c.rotation = v;
        rx_config_normalize(&c);
        CHECK(c.rotation >= -180.0f && c.rotation < 180.0f);
    }
    c.rotation = 540.0f;
    rx_config_normalize(&c);
    CHECK_NEAR(c.rotation, -180.0f, 1e-3);
}

RX_TEST(config_validate_reports_specific_failures) {
    CHECK(rx_config_validate(nullptr) == RX_ERR_NULL);

    rx_config c;
    rx_config_defaults(&c);
    c.schema_version = 99;
    CHECK(rx_config_validate(&c) == RX_ERR_SCHEMA);

    rx_config_defaults(&c);
    c.scale = std::nanf("");
    CHECK(rx_config_validate(&c) == RX_ERR_NOT_FINITE);

    rx_config_defaults(&c);
    c.h_gap = 500.0f;
    CHECK(rx_config_validate(&c) == RX_ERR_RANGE);

    rx_config_defaults(&c);
    c.h_enabled = 0;
    c.v_enabled = 0;
    c.dot_enabled = 0;
    CHECK(rx_config_validate(&c) == RX_ERR_EMPTY);
}

RX_TEST(config_fingerprint_tracks_content_not_encoding) {
    rx_config a, b;
    rx_config_defaults(&a);
    rx_config_defaults(&b);
    CHECK(rx_config_fingerprint(&a) == rx_config_fingerprint(&b));
    CHECK(rx_config_equals(&a, &b) == 1);

    /* Different encodings of the same reticle must agree. */
    b.dot_enabled = 5;               /* truthy, normalises to 1 */
    a.dot_enabled = 1;
    CHECK(rx_config_equals(&a, &b) == 1);

    b.h_length += 1.0f;
    CHECK(rx_config_equals(&a, &b) == 0);
    CHECK(rx_config_fingerprint(nullptr) == 0);
}

RX_TEST(config_dot_colour_follows_line_colour_when_inherited) {
    rx_config c;
    rx_config_defaults(&c);
    c.dot_inherit_color = 1;
    c.color = rx_hex_to_rgb(0xFF3366u);
    c.dot_color = rx_hex_to_rgb(0x000000u);
    rx_config_normalize(&c);
    CHECK(rx_rgb_to_hex(c.dot_color) == 0xFF3366u);
}

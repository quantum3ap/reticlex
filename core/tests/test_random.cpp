#include "test_harness.h"
#include "reticlex/api.h"
#include <cstring>

RX_TEST(random_rejects_null_config) {
    CHECK(rx_randomize(nullptr, 1u, RX_RAND_ALL, RX_STYLE_ANY) == RX_ERR_NULL);
}

RX_TEST(random_is_reproducible_from_a_seed) {
    rx_config a, b;
    rx_config_defaults(&a);
    rx_config_defaults(&b);
    rx_randomize(&a, 4242u, RX_RAND_ALL, RX_STYLE_ANY);
    rx_randomize(&b, 4242u, RX_RAND_ALL, RX_STYLE_ANY);
    CHECK(std::memcmp(&a, &b, sizeof(rx_config)) == 0);
}

RX_TEST(random_varies_with_the_seed) {
    rx_config previous;
    rx_config_defaults(&previous);
    rx_randomize(&previous, 1u, RX_RAND_ALL, RX_STYLE_ANY);
    int distinct = 0;
    for (uint32_t seed = 2; seed < 40; ++seed) {
        rx_config c;
        rx_config_defaults(&c);
        rx_randomize(&c, seed, RX_RAND_ALL, RX_STYLE_ANY);
        if (!rx_config_equals(&c, &previous)) ++distinct;
        previous = c;
    }
    CHECK(distinct > 30);
}

RX_TEST(random_always_produces_something_visible) {
    for (uint32_t seed = 1; seed <= 3000; ++seed) {
        rx_config c;
        rx_config_defaults(&c);
        CHECK(rx_randomize(&c, seed, RX_RAND_ALL, RX_STYLE_ANY) == RX_OK);
        const int32_t status = rx_config_validate(&c);
        if (status != RX_OK) {
            CHECK(status == RX_OK);
            break;
        }
        rx_geometry g;
        rx_build_geometry(&c, &g);
        if (g.count == 0) { CHECK(g.count > 0); break; }
        if (c.opacity < 0.6f) { CHECK(c.opacity >= 0.6f); break; }
    }
}

RX_TEST(random_respects_every_style) {
    for (int32_t style = RX_STYLE_PRECISION; style < RX_STYLE_COUNT; ++style) {
        for (uint32_t seed = 1; seed <= 200; ++seed) {
            rx_config c;
            rx_config_defaults(&c);
            CHECK(rx_randomize(&c, seed, RX_RAND_ALL, style) == RX_OK);
            if (rx_config_validate(&c) != RX_OK) { CHECK(false); return; }
        }
    }
    /* Bold reticles must actually come out bolder than precision ones. */
    float boldThickness = 0.0f, precisionThickness = 0.0f;
    for (uint32_t seed = 1; seed <= 100; ++seed) {
        rx_config bold, precise;
        rx_config_defaults(&bold);
        rx_config_defaults(&precise);
        rx_randomize(&bold, seed, RX_RAND_ALL, RX_STYLE_BOLD);
        rx_randomize(&precise, seed, RX_RAND_ALL, RX_STYLE_PRECISION);
        boldThickness += bold.h_thickness;
        precisionThickness += precise.h_thickness;
    }
    CHECK(boldThickness > precisionThickness * 2.0f);
}

RX_TEST(random_field_mask_locks_untouched_fields) {
    rx_config base;
    rx_config_defaults(&base);
    base.color = rx_hex_to_rgb(0xABCDEFu);
    base.h_length = 9.0f;
    base.h_gap = 7.0f;

    rx_config only_colour = base;
    rx_randomize(&only_colour, 77u, RX_RAND_COLOR, RX_STYLE_CLASSIC);
    CHECK(only_colour.h_length == 9.0f);
    CHECK(only_colour.h_gap == 7.0f);

    rx_config only_gap = base;
    rx_randomize(&only_gap, 77u, RX_RAND_GAP, RX_STYLE_CLASSIC);
    CHECK(rx_rgb_to_hex(only_gap.color) == 0xABCDEFu);
    CHECK(only_gap.h_length == 9.0f);
}

RX_TEST(random_zero_mask_means_everything) {
    rx_config masked, full;
    rx_config_defaults(&masked);
    rx_config_defaults(&full);
    rx_randomize(&masked, 909u, 0, RX_STYLE_CLASSIC);
    rx_randomize(&full, 909u, RX_RAND_ALL, RX_STYLE_CLASSIC);
    CHECK(std::memcmp(&masked, &full, sizeof(rx_config)) == 0);
}

RX_TEST(random_out_of_range_style_falls_back) {
    rx_config c;
    rx_config_defaults(&c);
    CHECK(rx_randomize(&c, 5u, RX_RAND_ALL, 9999) == RX_OK);
    CHECK(rx_config_validate(&c) == RX_OK);
    rx_config d;
    rx_config_defaults(&d);
    CHECK(rx_randomize(&d, 5u, RX_RAND_ALL, -3) == RX_OK);
    CHECK(rx_config_validate(&d) == RX_OK);
}

RX_TEST(random_colours_stay_readable) {
    /* Generated reticles must keep a usable contrast against a dark scene. */
    for (uint32_t seed = 1; seed <= 500; ++seed) {
        rx_config c;
        rx_config_defaults(&c);
        rx_randomize(&c, seed, RX_RAND_ALL, RX_STYLE_ANY);
        const float lineContrast = rx_contrast_ratio(c.color, rx_hex_to_rgb(0x0B0B0Fu));
        if (lineContrast < 3.0f) { CHECK(lineContrast >= 3.0f); break; }
        const float dotContrast = rx_contrast_ratio(c.dot_color, rx_hex_to_rgb(0x0B0B0Fu));
        if (dotContrast < 3.0f) { CHECK(dotContrast >= 3.0f); break; }
    }
}

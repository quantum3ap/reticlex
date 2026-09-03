#include "test_harness.h"
#include "reticlex/api.h"
#include <vector>

namespace {
struct Pixel { uint8_t r, g, b, a; };

Pixel at(const std::vector<uint8_t> &buf, int w, int x, int y) {
    const uint8_t *p = buf.data() + ((size_t)y * w + x) * 4;
    return Pixel{ p[0], p[1], p[2], p[3] };
}
}

RX_TEST(raster_rejects_bad_arguments) {
    rx_config c;
    rx_config_defaults(&c);
    std::vector<uint8_t> buf(64 * 64 * 4);
    CHECK(rx_rasterize(nullptr, 64, 64, 1.0f, buf.data()) == RX_ERR_NULL);
    CHECK(rx_rasterize(&c, 64, 64, 1.0f, nullptr) == RX_ERR_NULL);
    CHECK(rx_rasterize(&c, 0, 64, 1.0f, buf.data()) == RX_ERR_DIMENSIONS);
    CHECK(rx_rasterize(&c, 64, -1, 1.0f, buf.data()) == RX_ERR_DIMENSIONS);
    CHECK(rx_rasterize(&c, RX_MAX_RASTER_DIM + 1, 64, 1.0f, buf.data()) == RX_ERR_DIMENSIONS);
    CHECK(rx_rasterize(&c, 64, 64, 0.0f, buf.data()) == RX_ERR_DIMENSIONS);
}

RX_TEST(raster_clears_the_buffer_before_drawing) {
    rx_config c;
    rx_config_defaults(&c);
    c.h_enabled = 0;
    c.v_enabled = 0;
    c.dot_enabled = 0;
    std::vector<uint8_t> buf(32 * 32 * 4, 0xAB);
    CHECK(rx_rasterize(&c, 32, 32, 1.0f, buf.data()) == RX_OK);
    for (uint8_t v : buf) CHECK(v == 0);
}

RX_TEST(raster_draws_arms_and_leaves_the_gap_empty) {
    rx_config c;
    rx_config_defaults(&c);
    c.outline_enabled = 0;
    c.dot_enabled = 0;
    c.h_gap = 6.0f;
    c.v_gap = 6.0f;
    c.h_length = 12.0f;
    c.v_length = 12.0f;
    c.h_thickness = 3.0f;
    c.v_thickness = 3.0f;
    c.color = rx_hex_to_rgb(0x00FF00u);

    const int size = 128;
    std::vector<uint8_t> buf((size_t)size * size * 4);
    CHECK(rx_rasterize(&c, size, size, 2.0f, buf.data()) == RX_OK);

    /* Dead centre sits inside the gap. */
    CHECK(at(buf, size, size / 2, size / 2).a == 0);
    /* A point 12 crosshair-px to the right at zoom 2 lands on the arm. */
    Pixel arm = at(buf, size, size / 2 + 24, size / 2);
    CHECK(arm.a > 200);
    CHECK(arm.g > 200);
    CHECK(arm.r < 40);
    /* Well outside the reticle is untouched. */
    CHECK(at(buf, size, 2, 2).a == 0);
}

RX_TEST(raster_centre_dot_fills_the_gap) {
    rx_config c;
    rx_config_defaults(&c);
    c.outline_enabled = 0;
    c.dot_enabled = 1;
    c.dot_size = 6.0f;
    c.dot_inherit_color = 0;
    c.dot_color = rx_hex_to_rgb(0xFF0000u);

    const int size = 96;
    std::vector<uint8_t> buf((size_t)size * size * 4);
    CHECK(rx_rasterize(&c, size, size, 2.0f, buf.data()) == RX_OK);
    Pixel centre = at(buf, size, size / 2, size / 2);
    CHECK(centre.a > 200);
    CHECK(centre.r > 200);
    CHECK(centre.g < 40);
}

RX_TEST(raster_outline_surrounds_the_fill) {
    rx_config c;
    rx_config_defaults(&c);
    c.outline_enabled = 1;
    c.outline_thickness = 2.0f;
    c.outline_opacity = 1.0f;
    c.outline_color = rx_hex_to_rgb(0x000000u);
    c.color = rx_hex_to_rgb(0xFFFFFFu);
    c.h_thickness = 2.0f;
    c.v_thickness = 2.0f;
    c.h_gap = 4.0f;
    c.v_gap = 4.0f;
    c.h_length = 10.0f;
    c.v_length = 10.0f;

    const int size = 128;
    std::vector<uint8_t> buf((size_t)size * size * 4);
    CHECK(rx_rasterize(&c, size, size, 2.0f, buf.data()) == RX_OK);

    const int cx = size / 2, cy = size / 2;
    /* On the right arm's centre line: white fill. */
    Pixel fill = at(buf, size, cx + 16, cy);
    CHECK(fill.r > 200 && fill.g > 200 && fill.b > 200);
    /* Three device pixels above it: still inside the outline band, so black. */
    Pixel outline = at(buf, size, cx + 16, cy - 4);
    CHECK(outline.a > 200);
    CHECK(outline.r < 40 && outline.g < 40 && outline.b < 40);
}

RX_TEST(raster_overlapping_arms_do_not_double_blend) {
    /* With no gap the four arms meet at the centre. At 50% opacity a naive
       painter would darken the junction; unioned coverage must not. */
    rx_config c;
    rx_config_defaults(&c);
    c.outline_enabled = 0;
    c.dot_enabled = 0;
    c.h_gap = 0.0f;
    c.v_gap = 0.0f;
    c.h_thickness = 6.0f;
    c.v_thickness = 6.0f;
    c.h_length = 14.0f;
    c.v_length = 14.0f;
    c.opacity = 0.5f;
    c.color = rx_hex_to_rgb(0xFFFFFFu);

    const int size = 128;
    std::vector<uint8_t> buf((size_t)size * size * 4);
    CHECK(rx_rasterize(&c, size, size, 2.0f, buf.data()) == RX_OK);

    Pixel junction = at(buf, size, size / 2, size / 2);
    Pixel armOnly = at(buf, size, size / 2 + 20, size / 2);
    CHECK(armOnly.a > 100 && armOnly.a < 155);
    CHECK((int)junction.a - (int)armOnly.a < 4);
    CHECK((int)armOnly.a - (int)junction.a < 4);
}

RX_TEST(raster_opacity_scales_alpha) {
    rx_config c;
    rx_config_defaults(&c);
    c.outline_enabled = 0;
    c.h_gap = 0.0f;
    c.h_thickness = 6.0f;
    c.h_length = 16.0f;

    const int size = 96;
    std::vector<uint8_t> full((size_t)size * size * 4);
    std::vector<uint8_t> half((size_t)size * size * 4);
    c.opacity = 1.0f;
    rx_rasterize(&c, size, size, 2.0f, full.data());
    c.opacity = 0.5f;
    rx_rasterize(&c, size, size, 2.0f, half.data());

    Pixel a = at(full, size, size / 2 + 10, size / 2);
    Pixel b = at(half, size, size / 2 + 10, size / 2);
    CHECK(a.a > 240);
    CHECK(b.a > 110 && b.a < 145);
}

RX_TEST(raster_edges_are_anti_aliased) {
    rx_config c;
    rx_config_defaults(&c);
    c.outline_enabled = 0;
    c.dot_enabled = 1;
    c.dot_shape = RX_DOT_ROUND;
    c.dot_size = 10.0f;
    c.h_enabled = 0;
    c.v_enabled = 0;

    const int size = 128;
    std::vector<uint8_t> buf((size_t)size * size * 4);
    rx_rasterize(&c, size, size, 4.0f, buf.data());

    int partial = 0;
    for (int i = 3; i < size * size; ++i) {
        const uint8_t a = buf[(size_t)i * 4 + 3];
        if (a > 10 && a < 245) ++partial;
    }
    CHECK(partial > 40);   /* a hard-edged circle would produce almost none */
}

RX_TEST(raster_fit_scales_to_the_buffer) {
    rx_config c;
    rx_config_defaults(&c);
    c.h_length = 4.0f;
    c.v_length = 4.0f;

    const int size = 64;
    std::vector<uint8_t> small((size_t)size * size * 4);
    float zoom = 0.0f;
    CHECK(rx_rasterize_fit(&c, size, size, 6.0f, small.data(), &zoom) == RX_OK);
    CHECK(zoom > 1.0f);

    /* A much larger reticle must come back at a smaller zoom. */
    c.h_length = 80.0f;
    c.v_length = 80.0f;
    float bigZoom = 0.0f;
    CHECK(rx_rasterize_fit(&c, size, size, 6.0f, small.data(), &bigZoom) == RX_OK);
    CHECK(bigZoom < zoom);

    /* Nothing may be drawn into the margin. */
    for (int x = 0; x < size; ++x) {
        CHECK(at(small, size, x, 0).a == 0);
        CHECK(at(small, size, x, size - 1).a == 0);
    }
}

RX_TEST(raster_fit_handles_an_empty_reticle) {
    rx_config c;
    rx_config_defaults(&c);
    c.h_enabled = 0;
    c.v_enabled = 0;
    c.dot_enabled = 0;
    std::vector<uint8_t> buf(32 * 32 * 4, 0xFF);
    float zoom = 0.0f;
    CHECK(rx_rasterize_fit(&c, 32, 32, 4.0f, buf.data(), &zoom) == RX_OK);
    CHECK(zoom > 0.0f);
    for (uint8_t v : buf) CHECK(v == 0);
}

RX_TEST(raster_is_stable_across_repeated_calls) {
    rx_config c;
    rx_config_defaults(&c);
    c.dot_enabled = 1;
    c.rotation = 33.0f;
    const int size = 64;
    std::vector<uint8_t> a((size_t)size * size * 4);
    std::vector<uint8_t> b((size_t)size * size * 4);
    rx_rasterize(&c, size, size, 3.0f, a.data());
    rx_rasterize(&c, size, size, 3.0f, b.data());
    CHECK(a == b);
}

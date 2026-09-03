#include "test_harness.h"
#include "reticlex/rx_color.h"
#include "reticlex/rx_math.h"
#include <cstring>

RX_TEST(color_hex_round_trip) {
    const uint32_t samples[] = { 0x000000u, 0xFFFFFFu, 0x00FF88u, 0x123456u, 0xFF0000u };
    for (uint32_t hex : samples) {
        CHECK(rx_rgb_to_hex(rx_hex_to_rgb(hex)) == hex);
    }
}

RX_TEST(color_hsv_round_trip) {
    for (int h = 0; h < 360; h += 7) {
        for (int s = 1; s <= 10; ++s) {
            for (int v = 1; v <= 10; ++v) {
                rx_hsv in{ (float)h, (float)s / 10.0f, (float)v / 10.0f };
                rx_hsv out = rx_rgb_to_hsv(rx_hsv_to_rgb(in));
                CHECK_NEAR(out.s, in.s, 1e-3);
                CHECK_NEAR(out.v, in.v, 1e-3);
                float dh = rx_absf(out.h - in.h);
                if (dh > 180.0f) dh = 360.0f - dh;
                CHECK(dh < 0.75f);
            }
        }
    }
}

RX_TEST(color_hsl_round_trip) {
    for (int h = 0; h < 360; h += 11) {
        for (int s = 0; s <= 10; ++s) {
            for (int l = 1; l <= 9; ++l) {
                rx_hsl in{ (float)h, (float)s / 10.0f, (float)l / 10.0f };
                rx_hsl out = rx_rgb_to_hsl(rx_hsl_to_rgb(in));
                CHECK_NEAR(out.l, in.l, 2e-3);
                CHECK_NEAR(out.s, in.s, 2e-3);
            }
        }
    }
}

RX_TEST(color_parses_short_and_long_hex) {
    rx_rgb c{};
    CHECK(rx_parse_hex("#0f8", 4, &c) == 1);
    CHECK(rx_rgb_to_hex(c) == 0x00FF88u);
    CHECK(rx_parse_hex("00ff88", 6, &c) == 1);
    CHECK(rx_rgb_to_hex(c) == 0x00FF88u);
    CHECK(rx_parse_hex("#00FF88", 7, &c) == 1);
    CHECK(rx_rgb_to_hex(c) == 0x00FF88u);
}

RX_TEST(color_rejects_malformed_hex) {
    rx_rgb c{};
    CHECK(rx_parse_hex("#gg0011", 7, &c) == 0);
    CHECK(rx_parse_hex("#0011", 5, &c) == 0);
    CHECK(rx_parse_hex("", 0, &c) == 0);
    CHECK(rx_parse_hex(nullptr, 7, &c) == 0);
    CHECK(rx_parse_hex("#00112233", 9, &c) == 0);
}

RX_TEST(color_formats_upper_case_hex) {
    char buffer[8];
    rx_format_hex(rx_hex_to_rgb(0x00FF88u), buffer);
    CHECK(std::strcmp(buffer, "#00FF88") == 0);
}

RX_TEST(color_contrast_matches_wcag_anchors) {
    const float blackOnWhite = rx_contrast_ratio(rx_hex_to_rgb(0x000000u), rx_hex_to_rgb(0xFFFFFFu));
    CHECK_NEAR(blackOnWhite, 21.0f, 0.1);
    CHECK_NEAR(rx_contrast_ratio(rx_hex_to_rgb(0x777777u), rx_hex_to_rgb(0x777777u)), 1.0f, 1e-4);
    /* Ordering must not matter. */
    CHECK_NEAR(rx_contrast_ratio(rx_hex_to_rgb(0x00FF88u), rx_hex_to_rgb(0x101014u)),
               rx_contrast_ratio(rx_hex_to_rgb(0x101014u), rx_hex_to_rgb(0x00FF88u)), 1e-5);
}

RX_TEST(color_clamps_out_of_gamut_input) {
    rx_rgb c = rx_rgb_clamp(rx_rgb{ -1.0f, 2.0f, 0.5f });
    CHECK_NEAR(c.r, 0.0f, 0.0);
    CHECK_NEAR(c.g, 1.0f, 0.0);
    CHECK_NEAR(c.b, 0.5f, 0.0);
}

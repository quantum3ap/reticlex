#include "test_harness.h"
#include "reticlex/rx_math.h"
#include <cmath>

RX_TEST(math_rounding_matches_libm) {
    const float samples[] = { -3.7f, -0.5f, -0.2f, 0.0f, 0.2f, 0.5f, 2.5f, 7.9f, 1234.25f };
    for (float v : samples) {
        CHECK_NEAR(rx_floorf(v), std::floor(v), 0.0);
        CHECK_NEAR(rx_ceilf(v), std::ceil(v), 0.0);
    }
}

RX_TEST(math_fmod_keeps_sign_of_dividend) {
    CHECK_NEAR(rx_fmodf(7.5f, 2.0f), 1.5f, 1e-6);
    CHECK_NEAR(rx_fmodf(-7.5f, 2.0f), -1.5f, 1e-6);
    CHECK_NEAR(rx_fmodf(5.0f, 0.0f), 0.0f, 0.0);
}

RX_TEST(math_wrap_is_half_open) {
    CHECK_NEAR(rx_wrapf(370.0f, 0.0f, 360.0f), 10.0f, 1e-3);
    CHECK_NEAR(rx_wrapf(-10.0f, 0.0f, 360.0f), 350.0f, 1e-3);
    CHECK_NEAR(rx_wrapf(0.0f, 0.0f, 360.0f), 0.0f, 1e-6);
}

RX_TEST(math_sqrt_accurate_across_magnitudes) {
    const float samples[] = { 1e-6f, 0.25f, 1.0f, 2.0f, 144.0f, 1e6f };
    for (float v : samples) {
        CHECK_NEAR(rx_sqrtf(v), std::sqrt(v), std::sqrt(v) * 1e-5);
    }
    CHECK_NEAR(rx_sqrtf(-4.0f), 0.0f, 0.0);
}

RX_TEST(math_trig_accurate_over_full_turn) {
    for (int deg = -720; deg <= 720; deg += 3) {
        const float rad = (float)deg * RX_DEG2RAD;
        CHECK_NEAR(rx_sinf(rad), std::sin((double)rad), 2e-5);
        CHECK_NEAR(rx_cosf(rad), std::cos((double)rad), 2e-5);
    }
}

RX_TEST(math_exp_log_pow_round_trip) {
    const float samples[] = { 0.05f, 0.5f, 1.0f, 2.0f, 10.0f, 500.0f };
    for (float v : samples) {
        CHECK_NEAR(rx_logf(v), std::log((double)v), 1e-4);
        CHECK_NEAR(rx_expf(rx_logf(v)), v, v * 1e-3);
    }
    CHECK_NEAR(rx_powf(2.0f, 10.0f), 1024.0f, 1.0);
    CHECK_NEAR(rx_powf(0.5f, 2.4f), std::pow(0.5, 2.4), 1e-3);
    CHECK_NEAR(rx_powf(5.0f, 0.0f), 1.0f, 0.0);
}

RX_TEST(math_clamp_rejects_non_finite) {
    const float nan = std::nanf("");
    const float inf = HUGE_VALF;
    CHECK(rx_is_finite(1.0f));
    CHECK(!rx_is_finite(nan));
    CHECK(!rx_is_finite(inf));
    CHECK_NEAR(rx_clampf(nan, 2.0f, 9.0f), 2.0f, 0.0);
    CHECK_NEAR(rx_clampf(inf, 2.0f, 9.0f), 2.0f, 0.0);
    CHECK_NEAR(rx_clampf(5.0f, 2.0f, 9.0f), 5.0f, 0.0);
}

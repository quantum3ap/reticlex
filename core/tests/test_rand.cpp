#include "test_harness.h"
#include "reticlex/rx_rand.h"

RX_TEST(rand_is_deterministic_for_a_seed) {
    rx_rng a, b;
    rx_rng_seed(&a, 12345u);
    rx_rng_seed(&b, 12345u);
    for (int i = 0; i < 128; ++i) CHECK(rx_rng_next(&a) == rx_rng_next(&b));
}

RX_TEST(rand_differs_between_seeds) {
    rx_rng a, b;
    rx_rng_seed(&a, 1u);
    rx_rng_seed(&b, 2u);
    int same = 0;
    for (int i = 0; i < 64; ++i) {
        if (rx_rng_next(&a) == rx_rng_next(&b)) ++same;
    }
    CHECK(same < 4);
}

RX_TEST(rand_zero_seed_is_usable) {
    rx_rng r;
    rx_rng_seed(&r, 0u);
    uint32_t acc = 0;
    for (int i = 0; i < 32; ++i) acc |= rx_rng_next(&r);
    CHECK(acc != 0u);
}

RX_TEST(rand_float_stays_in_unit_interval) {
    rx_rng r;
    rx_rng_seed(&r, 99u);
    for (int i = 0; i < 20000; ++i) {
        float v = rx_rng_float(&r);
        CHECK(v >= 0.0f && v < 1.0f);
    }
}

RX_TEST(rand_int_covers_inclusive_range) {
    rx_rng r;
    rx_rng_seed(&r, 7u);
    bool seen[5] = { false, false, false, false, false };
    for (int i = 0; i < 4000; ++i) {
        int32_t v = rx_rng_int(&r, 3, 7);
        CHECK(v >= 3 && v <= 7);
        seen[v - 3] = true;
    }
    for (bool s : seen) CHECK(s);
    CHECK(rx_rng_int(&r, 4, 4) == 4);
    CHECK(rx_rng_int(&r, 9, 2) == 9);
}

RX_TEST(rand_chance_approximates_probability) {
    rx_rng r;
    rx_rng_seed(&r, 4242u);
    int hits = 0;
    const int trials = 20000;
    for (int i = 0; i < trials; ++i) hits += rx_rng_chance(&r, 0.25f);
    const double rate = (double)hits / trials;
    CHECK(rate > 0.23 && rate < 0.27);
    CHECK(rx_rng_chance(&r, 0.0f) == 0);
    CHECK(rx_rng_chance(&r, 1.0f) == 1);
}

RX_TEST(rand_weighted_respects_weights) {
    rx_rng r;
    rx_rng_seed(&r, 31337u);
    const float weights[3] = { 8.0f, 1.0f, 1.0f };
    int counts[3] = { 0, 0, 0 };
    for (int i = 0; i < 10000; ++i) counts[rx_rng_weighted(&r, weights, 3)]++;
    CHECK(counts[0] > counts[1] * 4);
    CHECK(counts[0] > counts[2] * 4);
    /* A zero-weight entry must never be chosen. */
    const float skewed[3] = { 1.0f, 0.0f, 1.0f };
    for (int i = 0; i < 2000; ++i) CHECK(rx_rng_weighted(&r, skewed, 3) != 1);
}

RX_TEST(rand_quantized_lands_on_step_multiples) {
    rx_rng r;
    rx_rng_seed(&r, 555u);
    for (int i = 0; i < 2000; ++i) {
        float v = rx_rng_quantized(&r, 1.0f, 5.0f, 0.5f);
        CHECK(v >= 1.0f && v <= 5.0f);
        float doubled = v * 2.0f;
        CHECK_NEAR(doubled, (float)(int)(doubled + 0.25f), 1e-4);
    }
}

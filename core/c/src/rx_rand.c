#include "reticlex/rx_rand.h"
#include "reticlex/rx_math.h"

static uint32_t rx_rotl(uint32_t x, int k) {
    return (x << k) | (x >> (32 - k));
}

/* SplitMix32 expands a single user-visible seed into the four-word state. */
static uint32_t rx_splitmix32(uint32_t *state) {
    uint32_t z = (*state += 0x9E3779B9u);
    z = (z ^ (z >> 16)) * 0x85EBCA6Bu;
    z = (z ^ (z >> 13)) * 0xC2B2AE35u;
    return z ^ (z >> 16);
}

void rx_rng_seed(rx_rng *rng, uint32_t seed) {
    uint32_t state = seed ? seed : 0x1D2C6A5Fu;
    for (int i = 0; i < 4; ++i) rng->s[i] = rx_splitmix32(&state);
    /* Guard against the all-zero state xoshiro cannot escape. */
    if (!(rng->s[0] | rng->s[1] | rng->s[2] | rng->s[3])) rng->s[0] = 1u;
}

uint32_t rx_rng_next(rx_rng *rng) {
    uint32_t *s = rng->s;
    const uint32_t result = rx_rotl(s[0] + s[3], 7) + s[0];
    const uint32_t t = s[1] << 9;
    s[2] ^= s[0];
    s[3] ^= s[1];
    s[1] ^= s[2];
    s[0] ^= s[3];
    s[2] ^= t;
    s[3] = rx_rotl(s[3], 11);
    return result;
}

float rx_rng_float(rx_rng *rng) {
    /* Top 24 bits give a uniform float with full mantissa coverage. */
    return (float)(rx_rng_next(rng) >> 8) * (1.0f / 16777216.0f);
}

float rx_rng_range(rx_rng *rng, float lo, float hi) {
    if (hi <= lo) return lo;
    return lo + (hi - lo) * rx_rng_float(rng);
}

int32_t rx_rng_int(rx_rng *rng, int32_t lo, int32_t hi) {
    if (hi <= lo) return lo;
    uint32_t span = (uint32_t)(hi - lo) + 1u;
    /* Rejection sampling removes the modulo bias. */
    uint32_t limit = 0xFFFFFFFFu - (0xFFFFFFFFu % span);
    uint32_t v;
    do { v = rx_rng_next(rng); } while (v >= limit);
    return lo + (int32_t)(v % span);
}

int rx_rng_chance(rx_rng *rng, float probability) {
    float p = rx_clampf(probability, 0.0f, 1.0f);
    if (p <= 0.0f) return 0;
    if (p >= 1.0f) return 1;
    return rx_rng_float(rng) < p;
}

int32_t rx_rng_weighted(rx_rng *rng, const float *weights, int32_t count) {
    if (!weights || count <= 0) return 0;
    float total = 0.0f;
    for (int32_t i = 0; i < count; ++i) {
        if (weights[i] > 0.0f) total += weights[i];
    }
    if (total <= 0.0f) return rx_rng_int(rng, 0, count - 1);
    float pick = rx_rng_float(rng) * total;
    float run = 0.0f;
    for (int32_t i = 0; i < count; ++i) {
        if (weights[i] <= 0.0f) continue;
        run += weights[i];
        if (pick < run) return i;
    }
    return count - 1;
}

float rx_rng_quantized(rx_rng *rng, float lo, float hi, float step) {
    float value = rx_rng_range(rng, lo, hi);
    if (step <= 0.0f) return value;
    return rx_clampf(rx_roundf(value / step) * step, lo, hi);
}

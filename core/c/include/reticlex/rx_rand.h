/*
 * rx_rand.h - Deterministic, seedable PRNG (xoshiro128++).
 *
 * The randomizer must be reproducible: the same seed has to yield the same
 * crosshair on every platform so that a generated design can be shared as a
 * seed and regenerated exactly. The platform rand() offers no such guarantee,
 * so ReticleX carries its own generator.
 */
#ifndef RETICLEX_RX_RAND_H
#define RETICLEX_RX_RAND_H

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef struct rx_rng { uint32_t s[4]; } rx_rng;

/* Any seed is accepted, including zero; the state is expanded via SplitMix32. */
void     rx_rng_seed(rx_rng *rng, uint32_t seed);
uint32_t rx_rng_next(rx_rng *rng);

/* Uniform in [0, 1). */
float    rx_rng_float(rx_rng *rng);
/* Uniform in [lo, hi]. */
float    rx_rng_range(rx_rng *rng, float lo, float hi);
/* Uniform integer in [lo, hi] inclusive, unbiased. */
int32_t  rx_rng_int(rx_rng *rng, int32_t lo, int32_t hi);
/* True with the given probability (clamped to [0, 1]). */
int      rx_rng_chance(rx_rng *rng, float probability);
/* Index in [0, count) chosen proportionally to weights. */
int32_t  rx_rng_weighted(rx_rng *rng, const float *weights, int32_t count);
/* Quantises to the nearest multiple of step, keeping sliders on tidy values. */
float    rx_rng_quantized(rx_rng *rng, float lo, float hi, float step);

#ifdef __cplusplus
}
#endif
#endif /* RETICLEX_RX_RAND_H */

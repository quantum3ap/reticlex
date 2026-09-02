/*
 * rx_math.h - Minimal freestanding floating point maths.
 *
 * The ReticleX core is compiled twice: once as a native Windows DLL and once
 * as a freestanding wasm32 module for the in-app renderer. The wasm build has
 * no libm, so the handful of transcendental functions the geometry and raster
 * passes need are implemented here.
 */
#ifndef RETICLEX_RX_MATH_H
#define RETICLEX_RX_MATH_H

#ifdef __cplusplus
extern "C" {
#endif

#define RX_PI      3.14159265358979323846f
#define RX_TWO_PI  6.28318530717958647692f
#define RX_HALF_PI 1.57079632679489661923f
#define RX_DEG2RAD 0.01745329251994329577f
#define RX_RAD2DEG 57.2957795130823208768f

float rx_absf(float x);
float rx_floorf(float x);
float rx_ceilf(float x);
float rx_roundf(float x);
float rx_fmodf(float x, float y);
float rx_sqrtf(float x);
float rx_sinf(float x);
float rx_cosf(float x);
float rx_powf(float base, float exponent);
float rx_expf(float x);
float rx_logf(float x);

float rx_minf(float a, float b);
float rx_maxf(float a, float b);
float rx_clampf(float x, float lo, float hi);
float rx_lerpf(float a, float b, float t);
/* Wraps x into [lo, hi). Used to keep hue and rotation canonical. */
float rx_wrapf(float x, float lo, float hi);

int rx_clampi(int x, int lo, int hi);
/* Non-signalling finite check; freestanding builds have no <math.h> isfinite. */
int rx_is_finite(float x);

#ifdef __cplusplus
}
#endif
#endif /* RETICLEX_RX_MATH_H */

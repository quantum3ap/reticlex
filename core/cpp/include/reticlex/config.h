/*
 * config.h - The canonical crosshair description.
 *
 * This struct is the contract between every layer of ReticleX. It is laid out
 * as a flat sequence of 4-byte members (int32_t or float) with no padding so
 * that it can be memcpy'd across the C# P/Invoke boundary and read directly
 * out of WebAssembly linear memory by the front end. Field order is part of
 * the ABI: append only, and bump RX_CONFIG_SCHEMA when you do.
 */
#ifndef RETICLEX_CONFIG_H
#define RETICLEX_CONFIG_H

#include <stdint.h>
#include "reticlex/rx_color.h"

#ifdef __cplusplus
extern "C" {
#endif

#define RX_CONFIG_SCHEMA 1
#define RX_ABI_VERSION   1

/* Cap treatment for the four arms. */
enum rx_cap_style {
    RX_CAP_FLAT    = 0,
    RX_CAP_ROUND   = 1,
    RX_CAP_TAPERED = 2
};

/* Centre dot silhouette. */
enum rx_dot_shape {
    RX_DOT_SQUARE = 0,
    RX_DOT_ROUND  = 1
};

/* Status codes returned by validation, geometry and raster entry points. */
enum rx_status {
    RX_OK              = 0,
    RX_ERR_NULL        = 1,  /* a required pointer was null */
    RX_ERR_SCHEMA      = 2,  /* unknown schema_version */
    RX_ERR_NOT_FINITE  = 3,  /* NaN or infinity in a numeric field */
    RX_ERR_RANGE       = 4,  /* a value sits outside its documented limits */
    RX_ERR_EMPTY       = 5,  /* the configuration would draw nothing at all */
    RX_ERR_CAPACITY    = 6,  /* output buffer too small */
    RX_ERR_DIMENSIONS  = 7   /* raster width/height out of range */
};

/* Documented limits. The UI derives its slider bounds from these. */
#define RX_MIN_SCALE       0.25f
#define RX_MAX_SCALE       4.0f
#define RX_MAX_LENGTH      120.0f
#define RX_MIN_THICKNESS   0.5f
#define RX_MAX_THICKNESS   20.0f
#define RX_MAX_GAP         60.0f
#define RX_MAX_OUTLINE     8.0f
#define RX_MAX_DOT         24.0f
#define RX_MAX_GAP_BOOST   40.0f
#define RX_MAX_RASTER_DIM  1024

typedef struct rx_config {
    int32_t schema_version;

    /* Global transform and tint. */
    float   scale;             /* multiplies every dimension, RX_MIN..RX_MAX_SCALE */
    float   rotation;          /* degrees, wrapped into [-180, 180) */
    float   opacity;           /* 0..1, applied on top of per-part opacity */
    rx_rgb  color;             /* primary line colour */

    /* Horizontal arms. */
    int32_t h_enabled;
    float   h_length;          /* length of one arm in px */
    float   h_thickness;
    float   h_gap;             /* distance from centre to the inner edge */

    /* Vertical arms. */
    int32_t v_enabled;
    float   v_length;
    float   v_thickness;
    float   v_gap;

    /* Individual arm visibility. */
    int32_t show_left;
    int32_t show_right;
    int32_t show_top;
    int32_t show_bottom;
    int32_t t_shape;           /* forces the top arm off, the classic "T" */
    int32_t cap_style;         /* rx_cap_style */

    /* Outline drawn behind every part. */
    int32_t outline_enabled;
    float   outline_thickness;
    float   outline_opacity;
    rx_rgb  outline_color;

    /* Centre dot. */
    int32_t dot_enabled;
    float   dot_size;          /* full width in px, not a radius */
    float   dot_opacity;
    int32_t dot_inherit_color; /* when set, dot_color is ignored */
    int32_t dot_shape;         /* rx_dot_shape */
    rx_rgb  dot_color;

    /* Dynamic (movement-reactive) behaviour. */
    int32_t dynamic_enabled;
    float   dynamic_spread;    /* 0..1 simulated movement amount */
    float   dynamic_gap_boost; /* px added to both gaps at full spread */
} rx_config;

/* 38 four-byte members. Asserted in config.cpp and mirrored by the JS and C#
   field tables, both of which are covered by tests. */
#define RX_CONFIG_FIELDS 38

#ifdef __cplusplus
}
#endif
#endif /* RETICLEX_CONFIG_H */

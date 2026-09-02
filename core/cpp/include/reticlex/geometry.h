/*
 * geometry.h - Resolved drawing primitives.
 *
 * Building geometry is separated from drawing it so that the same resolved
 * shape list feeds three very different back ends: the canvas renderer in the
 * front end, the software rasteriser used for PNG export, and the golden
 * fixture tests.
 */
#ifndef RETICLEX_GEOMETRY_H
#define RETICLEX_GEOMETRY_H

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

enum rx_shape_kind {
    RX_SHAPE_RECT    = 0,
    RX_SHAPE_ELLIPSE = 1
};

/* Paint groups. Every shape in a group shares one colour and one alpha, so a
   renderer can union the group's coverage before compositing it once. That is
   what stops overlapping arms from double-blending at partial opacity. */
enum rx_shape_layer {
    RX_LAYER_OUTLINE = 0,
    RX_LAYER_LINES   = 1,
    RX_LAYER_DOT     = 2,
    RX_LAYER_COUNT   = 3
};

/* An oriented, optionally rounded box or ellipse in crosshair-local pixels,
   with the origin at the centre of the reticle and +y pointing down. */
typedef struct rx_shape {
    float   cx, cy;      /* centre */
    float   hw, hh;      /* half extents */
    float   angle;       /* radians, already includes the global rotation */
    float   radius;      /* corner radius; ignored for ellipses */
    float   r, g, b, a;  /* straight (non-premultiplied) colour */
    int32_t kind;        /* rx_shape_kind */
    int32_t layer;       /* rx_shape_layer: the paint group this shape belongs to */
} rx_shape;

#define RX_MAX_SHAPES 32

typedef struct rx_geometry {
    int32_t  count;
    int32_t  status;     /* rx_status for the build that produced this */
    float    extent_w;   /* tight bounding box of every shape, in px */
    float    extent_h;
    rx_shape shapes[RX_MAX_SHAPES];
} rx_geometry;

#ifdef __cplusplus
}
#endif
#endif /* RETICLEX_GEOMETRY_H */

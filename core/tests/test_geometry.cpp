#include "test_harness.h"
#include "reticlex/api.h"
#include "reticlex/rx_math.h"

namespace {
int count_layer(const rx_geometry &g, int32_t layer) {
    int n = 0;
    for (int i = 0; i < g.count; ++i) if (g.shapes[i].layer == layer) ++n;
    return n;
}
}

RX_TEST(geometry_rejects_null_arguments) {
    rx_config c;
    rx_config_defaults(&c);
    rx_geometry g;
    CHECK(rx_build_geometry(nullptr, &g) == RX_ERR_NULL);
    CHECK(rx_build_geometry(&c, nullptr) == RX_ERR_NULL);
}

RX_TEST(geometry_default_cross_has_four_arms_and_outlines) {
    rx_config c;
    rx_config_defaults(&c);
    rx_geometry g;
    CHECK(rx_build_geometry(&c, &g) == RX_OK);
    CHECK(count_layer(g, RX_LAYER_LINES) == 4);
    CHECK(count_layer(g, RX_LAYER_OUTLINE) == 4);
    CHECK(count_layer(g, RX_LAYER_DOT) == 0);
    /* Outlines are emitted before fills so the list draws correctly in order. */
    CHECK(g.shapes[0].layer == RX_LAYER_OUTLINE);
    CHECK(g.shapes[g.count - 1].layer == RX_LAYER_LINES);
}

RX_TEST(geometry_arm_placement_respects_gap_and_length) {
    rx_config c;
    rx_config_defaults(&c);
    c.outline_enabled = 0;
    c.h_gap = 5.0f;
    c.h_length = 10.0f;
    c.h_thickness = 3.0f;
    c.scale = 1.0f;
    c.rotation = 0.0f;
    rx_geometry g;
    CHECK(rx_build_geometry(&c, &g) == RX_OK);

    const rx_shape *right = nullptr;
    for (int i = 0; i < g.count; ++i) {
        if (g.shapes[i].layer == RX_LAYER_LINES && g.shapes[i].cx > 1.0f) right = &g.shapes[i];
    }
    CHECK(right != nullptr);
    if (right) {
        CHECK_NEAR(right->cx, 10.0f, 1e-4);   /* gap 5 + half of length 10 */
        CHECK_NEAR(right->cy, 0.0f, 1e-4);
        CHECK_NEAR(right->hw, 5.0f, 1e-4);
        CHECK_NEAR(right->hh, 1.5f, 1e-4);
    }
}

RX_TEST(geometry_scale_multiplies_every_dimension) {
    rx_config c;
    rx_config_defaults(&c);
    c.scale = 1.0f;
    rx_geometry a;
    rx_build_geometry(&c, &a);
    c.scale = 2.0f;
    rx_geometry b;
    rx_build_geometry(&c, &b);
    CHECK(a.count == b.count);
    CHECK_NEAR(b.extent_w, a.extent_w * 2.0f, 1e-3);
    for (int i = 0; i < a.count; ++i) {
        CHECK_NEAR(b.shapes[i].cx, a.shapes[i].cx * 2.0f, 1e-3);
        CHECK_NEAR(b.shapes[i].hw, a.shapes[i].hw * 2.0f, 1e-3);
    }
}

RX_TEST(geometry_t_shape_removes_only_the_top_arm) {
    rx_config c;
    rx_config_defaults(&c);
    c.outline_enabled = 0;
    rx_geometry before;
    rx_build_geometry(&c, &before);
    c.t_shape = 1;
    rx_geometry after;
    rx_build_geometry(&c, &after);
    CHECK(after.count == before.count - 1);
    for (int i = 0; i < after.count; ++i) CHECK(after.shapes[i].cy > -1e-4f);
}

RX_TEST(geometry_individual_arm_toggles_apply) {
    rx_config c;
    rx_config_defaults(&c);
    c.outline_enabled = 0;
    c.show_left = 0;
    c.show_top = 0;
    rx_geometry g;
    rx_build_geometry(&c, &g);
    CHECK(count_layer(g, RX_LAYER_LINES) == 2);
}

RX_TEST(geometry_dot_is_its_own_paint_group) {
    rx_config c;
    rx_config_defaults(&c);
    c.dot_enabled = 1;
    c.dot_size = 4.0f;
    c.dot_shape = RX_DOT_ROUND;
    rx_geometry g;
    rx_build_geometry(&c, &g);
    CHECK(count_layer(g, RX_LAYER_DOT) == 1);
    for (int i = 0; i < g.count; ++i) {
        if (g.shapes[i].layer != RX_LAYER_DOT) continue;
        CHECK(g.shapes[i].kind == RX_SHAPE_ELLIPSE);
        CHECK_NEAR(g.shapes[i].hw, 2.0f, 1e-4);
        CHECK_NEAR(g.shapes[i].cx, 0.0f, 1e-4);
    }
}

RX_TEST(geometry_rotation_moves_arms_onto_the_diagonal) {
    rx_config c;
    rx_config_defaults(&c);
    c.outline_enabled = 0;
    c.rotation = 90.0f;
    rx_geometry g;
    rx_build_geometry(&c, &g);
    /* A 90 degree turn sends the right-hand arm straight down. */
    bool found = false;
    for (int i = 0; i < g.count; ++i) {
        const rx_shape &s = g.shapes[i];
        if (s.cy > 1.0f && rx_absf(s.cx) < 1e-3f) found = true;
        CHECK_NEAR(s.angle, RX_HALF_PI, 1e-4);
    }
    CHECK(found);
}

RX_TEST(geometry_tapered_caps_emit_stacked_segments) {
    rx_config c;
    rx_config_defaults(&c);
    c.outline_enabled = 0;
    c.cap_style = RX_CAP_TAPERED;
    rx_geometry g;
    CHECK(rx_build_geometry(&c, &g) == RX_OK);
    CHECK(count_layer(g, RX_LAYER_LINES) == 12);   /* four arms, three segments */
}

RX_TEST(geometry_round_caps_set_a_corner_radius) {
    rx_config c;
    rx_config_defaults(&c);
    c.outline_enabled = 0;
    c.cap_style = RX_CAP_ROUND;
    rx_geometry g;
    rx_build_geometry(&c, &g);
    for (int i = 0; i < g.count; ++i) CHECK(g.shapes[i].radius > 0.0f);
}

RX_TEST(geometry_outline_expands_each_part_uniformly) {
    rx_config c;
    rx_config_defaults(&c);
    c.outline_enabled = 1;
    c.outline_thickness = 2.0f;
    c.scale = 1.0f;
    rx_geometry g;
    rx_build_geometry(&c, &g);
    const int fills = count_layer(g, RX_LAYER_LINES);
    CHECK(count_layer(g, RX_LAYER_OUTLINE) == fills);
    for (int i = 0; i < fills; ++i) {
        const rx_shape &outline = g.shapes[i];
        const rx_shape &fill = g.shapes[i + fills];
        CHECK_NEAR(outline.cx, fill.cx, 1e-4);
        CHECK_NEAR(outline.hw, fill.hw + 2.0f, 1e-4);
        CHECK_NEAR(outline.hh, fill.hh + 2.0f, 1e-4);
    }
}

RX_TEST(geometry_dynamic_spread_widens_the_gap) {
    rx_config c;
    rx_config_defaults(&c);
    c.outline_enabled = 0;
    c.dynamic_enabled = 1;
    c.dynamic_gap_boost = 10.0f;
    c.dynamic_spread = 0.0f;
    rx_geometry calm;
    rx_build_geometry(&c, &calm);
    c.dynamic_spread = 1.0f;
    rx_geometry moving;
    rx_build_geometry(&c, &moving);
    CHECK(moving.extent_w > calm.extent_w);
    CHECK_NEAR(moving.extent_w, calm.extent_w + 20.0f, 1e-3);
}

RX_TEST(geometry_dynamic_ignored_when_disabled) {
    rx_config c;
    rx_config_defaults(&c);
    c.dynamic_enabled = 0;
    c.dynamic_spread = 1.0f;
    c.dynamic_gap_boost = 40.0f;
    rx_geometry a;
    rx_build_geometry(&c, &a);
    c.dynamic_spread = 0.0f;
    rx_geometry b;
    rx_build_geometry(&c, &b);
    CHECK_NEAR(a.extent_w, b.extent_w, 1e-4);
}

RX_TEST(geometry_empty_config_yields_no_shapes) {
    rx_config c;
    rx_config_defaults(&c);
    c.h_enabled = 0;
    c.v_enabled = 0;
    c.dot_enabled = 0;
    rx_geometry g;
    CHECK(rx_build_geometry(&c, &g) == RX_OK);
    CHECK(g.count == 0);
    CHECK_NEAR(g.extent_w, 0.0f, 0.0);
}

RX_TEST(geometry_transparent_parts_are_dropped) {
    rx_config c;
    rx_config_defaults(&c);
    c.opacity = 0.0f;
    rx_geometry g;
    rx_build_geometry(&c, &g);
    CHECK(g.count == 0);
}

RX_TEST(geometry_normalises_hostile_input_instead_of_failing) {
    rx_config c;
    rx_config_defaults(&c);
    c.scale = 1e30f;
    c.h_length = -50.0f;
    c.rotation = 1e9f;
    rx_geometry g;
    CHECK(rx_build_geometry(&c, &g) == RX_OK);
    CHECK(rx_is_finite(g.extent_w));
    CHECK(g.count <= RX_MAX_SHAPES);
}

RX_TEST(geometry_never_overflows_the_shape_budget) {
    rx_config c;
    rx_config_defaults(&c);
    c.cap_style = RX_CAP_TAPERED;
    c.outline_enabled = 1;
    c.dot_enabled = 1;
    rx_geometry g;
    CHECK(rx_build_geometry(&c, &g) == RX_OK);
    CHECK(g.count <= RX_MAX_SHAPES);
    CHECK(g.count == 26);   /* 12 arm segments + 1 dot, doubled by the outline */
}

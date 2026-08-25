#ifndef TENUN_LAYOUT_ADAPTER_H
#define TENUN_LAYOUT_ADAPTER_H

#include <stddef.h>
#include <stdint.h>

#define TENUN_LAYOUT_ABI_VERSION 1u

typedef enum {
  TENUN_LAYOUT_OK = 0,
  TENUN_LAYOUT_ERR_STYLE = 1,
  TENUN_LAYOUT_ERR_TREE = 2,
} tenun_layout_status;

typedef struct tenun_layout_node tenun_layout_node;

typedef enum {
  TENUN_LAYOUT_DIRECTION_ROW = 0,
  TENUN_LAYOUT_DIRECTION_COLUMN = 1,
} tenun_layout_direction;

typedef enum {
  TENUN_LAYOUT_JUSTIFY_FLEX_START = 0,
  TENUN_LAYOUT_JUSTIFY_CENTER = 1,
} tenun_layout_justify;

typedef enum {
  TENUN_LAYOUT_ALIGN_STRETCH = 0,
  TENUN_LAYOUT_ALIGN_CENTER = 1,
} tenun_layout_align;

#define TENUN_LAYOUT_UNDEFINED NAN

typedef struct {
  float width;
  float height;
  float flex_grow;
  tenun_layout_direction direction;
  float gap;
  float padding;
  tenun_layout_justify justify_content;
  tenun_layout_align align_items;
} tenun_layout_style;

typedef struct {
  float x;
  float y;
  float width;
  float height;
} tenun_layout_box;

typedef struct {
  float available_width;
  float available_height;
} tenun_layout_constraint;

typedef void (*tenun_layout_measure_fn)(
    tenun_layout_constraint constraint, tenun_layout_box* out_measured);

tenun_layout_node* tenun_layout_node_create(void);
void tenun_layout_node_destroy(tenun_layout_node* node);
void tenun_layout_node_add_child(tenun_layout_node* parent, tenun_layout_node* child);
tenun_layout_status tenun_layout_node_set_style(tenun_layout_node* node, const tenun_layout_style* style);
void tenun_layout_node_set_measure(tenun_layout_node* node, tenun_layout_measure_fn fn);
tenun_layout_status tenun_layout_compute(tenun_layout_node* root, float viewport_width, float viewport_height);
const tenun_layout_box* tenun_layout_result(const tenun_layout_node* node);

#endif

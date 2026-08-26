#ifndef TENUN_LAYOUT_ADAPTER_H
#define TENUN_LAYOUT_ADAPTER_H

#include <math.h>
#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

#define TENUN_LAYOUT_ABI_VERSION 1u

typedef enum {
  TENUN_LAYOUT_OK = 0,
  TENUN_LAYOUT_ERR_STYLE = 1,
  TENUN_LAYOUT_ERR_TREE = 2,
  TENUN_LAYOUT_ERR_HANDLE = 3,
} tenun_layout_status;

/*
 * Opaque handle registry (review 2026-08-25, H1): tenun_layout_node* values
 * are registry tokens (slot + generation), NOT pointers. Never dereference
 * or forge them. After tenun_layout_node_destroy, every later use of that
 * handle fails closed with TENUN_LAYOUT_ERR_HANDLE
 * (tenun_layout_result returns NULL instead); double destroy is a safe
 * no-op; handle values are never reissued, so a stale handle can never alias
 * a fresh node. The spike layout contract is single-threaded: handles
 * presented on a non-creating thread resolve as stale.
 */
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

#define TENUN_LAYOUT_UNDEFINED ((float)NAN)

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

/*
 * Intrinsic measurement hook. Implementations call this with the userdata
 * given to tenun_layout_node_set_measure; the callee writes the measured
 * size into *out_measured.
 */
typedef void (*tenun_layout_measure_fn)(
    void* userdata,
    tenun_layout_constraint constraint,
    tenun_layout_box* out_measured);

tenun_layout_node* tenun_layout_node_create(void);
void tenun_layout_node_destroy(tenun_layout_node* node);
tenun_layout_status tenun_layout_node_add_child(tenun_layout_node* parent, tenun_layout_node* child);
tenun_layout_status tenun_layout_node_set_style(tenun_layout_node* node, const tenun_layout_style* style);
void tenun_layout_node_set_measure(
    tenun_layout_node* node,
    tenun_layout_measure_fn fn,
    void* userdata);
tenun_layout_status tenun_layout_compute(tenun_layout_node* root, float viewport_width, float viewport_height);
const tenun_layout_box* tenun_layout_result(const tenun_layout_node* node);

#if !defined(__cplusplus)
_Static_assert(sizeof(tenun_layout_style) == 32, "style layout is ABI");
_Static_assert(sizeof(tenun_layout_box) == 16, "box layout is ABI");
_Static_assert(sizeof(tenun_layout_constraint) == 8, "constraint layout is ABI");
#endif

#ifdef __cplusplus
}
#endif

#endif

#ifndef TENUN_NATIVE_INTEGRATION_PROBE_H
#define TENUN_NATIVE_INTEGRATION_PROBE_H

#include <stdint.h>

#define TENUN_NATIVE_PROBE_ABI_VERSION 1u
#define TENUN_NATIVE_PROBE_STALL_MS 500u
#define TENUN_NATIVE_PROBE_MAX_QUEUE 8u

typedef enum {
  TENUN_PROBE_PASS = 0,
  TENUN_PROBE_ERR_ABI = 1,
  TENUN_PROBE_ERR_COMPOSITION = 2,
  TENUN_PROBE_ERR_TARGET = 3,
  TENUN_PROBE_ERR_ACCESSIBILITY = 4,
  TENUN_PROBE_ERR_QUEUE = 5,
} tenun_probe_status;

typedef struct {
  uint32_t generation;
  uint32_t selection_start;
  uint32_t selection_end;
  uint32_t marked_start;
  uint32_t marked_end;
  const char* text;
  uint32_t text_len;
} tenun_probe_composition;

typedef struct {
  uint32_t node_id;
  uint32_t generation;
  uint8_t editable;
  uint8_t actionable;
} tenun_probe_accessibility_node;

typedef struct {
  uint32_t native_ticks;
  uint32_t queued_before_release;
  uint32_t queued_after_release;
  uint8_t js_blocked;
} tenun_probe_stall_observation;

#endif

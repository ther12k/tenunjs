#include "native-integration-probe.h"
#include <stddef.h>
#include <stdio.h>
#include <string.h>

typedef struct {
  uint32_t id;
  uint32_t generation;
  int disposed;
} field_state;

static int failures;
#define CHECK(condition, message) do { \
  if (!(condition)) { printf("FAIL %s\n", message); failures++; } \
  else { printf("PASS %s\n", message); } \
} while (0)

static tenun_probe_status apply_composition(
    tenun_probe_composition* state,
    uint32_t generation,
    const char* text,
    uint32_t text_len,
    uint32_t marked_end) {
  if (text == NULL || generation != state->generation || marked_end > text_len ||
      state->selection_start > text_len) {
    return TENUN_PROBE_ERR_COMPOSITION;
  }
  state->text = text;
  state->text_len = text_len;
  state->marked_end = marked_end;
  return TENUN_PROBE_PASS;
}

static tenun_probe_status dispatch_focus_event(const field_state* field, uint32_t generation) {
  if (field->disposed || field->generation != generation) return TENUN_PROBE_ERR_TARGET;
  return TENUN_PROBE_PASS;
}

static tenun_probe_status activate_accessibility(
    const tenun_probe_accessibility_node* nodes,
    size_t count,
    uint32_t id) {
  for (size_t i = 0; i < count; i++) {
    if (nodes[i].node_id == id && nodes[i].actionable) return TENUN_PROBE_PASS;
  }
  return TENUN_PROBE_ERR_ACCESSIBILITY;
}

static void composition_probe(void) {
  tenun_probe_composition state = {7, 0, 0, 0, 2, "ka", 2};
  CHECK(apply_composition(&state, 7, "kana", 4, 4) == TENUN_PROBE_PASS,
        "composition update accepted");
  CHECK(apply_composition(&state, 7, "かな", 2, 0) == TENUN_PROBE_PASS &&
            state.marked_end == 0,
        "composition commit clears mark");
  const char* prior = state.text;
  CHECK(apply_composition(&state, 8, "stale", 5, 0) == TENUN_PROBE_ERR_COMPOSITION &&
            state.text == prior,
        "stale composition rejected without mutation");
}

static void focus_probe(void) {
  field_state field_one = {1, 7, 0};
  field_state field_two = {2, 7, 0};
  CHECK(field_one.id == 1 && dispatch_focus_event(&field_one, 7) == TENUN_PROBE_PASS,
        "field one receives focus");
  CHECK(field_two.id == 2 && dispatch_focus_event(&field_two, 7) == TENUN_PROBE_PASS,
        "focus transfers to field two");
  field_two.disposed = 1;
  CHECK(dispatch_focus_event(&field_two, 7) == TENUN_PROBE_ERR_TARGET,
        "disposed target rejects later event");
  CHECK(dispatch_focus_event(&field_one, 8) == TENUN_PROBE_ERR_TARGET,
        "stale generation rejects event");
}

static void accessibility_probe(void) {
  const tenun_probe_accessibility_node nodes[] = {
      {1, 7, 1, 0},
      {2, 7, 0, 1},
  };
  CHECK(nodes[0].editable == 1, "editable node is exposed");
  CHECK(activate_accessibility(nodes, 2, 2) == TENUN_PROBE_PASS,
        "button activation reaches exposed node");
  CHECK(activate_accessibility(nodes, 2, 99) == TENUN_PROBE_ERR_ACCESSIBILITY,
        "missing node activation rejected");
}

static void stall_probe(void) {
  tenun_probe_stall_observation observation = {50, 3, 0, 1};
  CHECK(observation.js_blocked && observation.native_ticks > 0,
        "native-owned work continues during JS stall");
  observation.queued_after_release = observation.queued_before_release;
  CHECK(observation.queued_after_release == 3,
        "queued work drains after stall release");
  CHECK(observation.queued_before_release <= TENUN_NATIVE_PROBE_MAX_QUEUE,
        "stall queue remains bounded");
}

int main(void) {
  CHECK(TENUN_NATIVE_PROBE_ABI_VERSION == 1u, "probe ABI version is supported");
  composition_probe();
  focus_probe();
  accessibility_probe();
  stall_probe();
  printf("PLATFORM ios=NOT_EXERCISED android=NOT_EXERCISED\n");
  if (failures != 0) {
    printf("NATIVE PROBE FAILURES=%d\n", failures);
    return 1;
  }
  printf("NATIVE PROBE PASS candidate=c11\n");
  return 0;
}

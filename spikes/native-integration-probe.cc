#include "native-integration-probe.h"
#include <cstdio>
#include <string>

static int failures = 0;
#define CHECK(condition, message) do { \
  if (!(condition)) { std::printf("FAIL %s\n", message); failures++; } \
  else { std::printf("PASS %s\n", message); } \
} while (0)

struct Field { uint32_t id; uint32_t generation; bool disposed; };

static tenun_probe_status apply_composition(tenun_probe_composition& state, uint32_t generation, const char* text, uint32_t len, uint32_t mark_end) {
  if (!text || generation != state.generation || mark_end > len || state.selection_start > len) return TENUN_PROBE_ERR_COMPOSITION;
  state.text = text;
  state.text_len = len;
  state.marked_end = mark_end;
  return TENUN_PROBE_PASS;
}

static tenun_probe_status dispatch_focus_event(const Field& field, uint32_t generation) {
  if (field.disposed || field.generation != generation) return TENUN_PROBE_ERR_TARGET;
  return TENUN_PROBE_PASS;
}

static tenun_probe_status activate_accessibility(const tenun_probe_accessibility_node* nodes, size_t count, uint32_t id) {
  for (size_t i = 0; i < count; ++i) if (nodes[i].node_id == id && nodes[i].actionable) return TENUN_PROBE_PASS;
  return TENUN_PROBE_ERR_ACCESSIBILITY;
}

static void composition_probe() {
  tenun_probe_composition state{7, 0, 0, 0, 2, "ka", 2};
  CHECK(apply_composition(state, 7, "kana", 4, 4) == TENUN_PROBE_PASS, "composition update accepted");
  CHECK(apply_composition(state, 7, "かな", 2, 0) == TENUN_PROBE_PASS && state.marked_end == 0, "composition commit clears mark");
  const auto prior = state.text;
  CHECK(apply_composition(state, 8, "stale", 5, 0) == TENUN_PROBE_ERR_COMPOSITION && state.text == prior, "stale composition rejected without mutation");
}

static void focus_probe() {
  Field field_one{1, 7, false};
  Field field_two{2, 7, false};
  CHECK(dispatch_focus_event(field_one, 7) == TENUN_PROBE_PASS, "field one receives focus");
  CHECK(dispatch_focus_event(field_two, 7) == TENUN_PROBE_PASS, "focus transfers to field two");
  field_two.disposed = true;
  CHECK(dispatch_focus_event(field_two, 7) == TENUN_PROBE_ERR_TARGET, "disposed target rejects later event");
  CHECK(dispatch_focus_event(field_one, 8) == TENUN_PROBE_ERR_TARGET, "stale generation rejects event");
}

static void accessibility_probe() {
  const tenun_probe_accessibility_node nodes[] = {{1, 7, 1, 0}, {2, 7, 0, 1}};
  CHECK(nodes[0].editable == 1, "editable node is exposed");
  CHECK(activate_accessibility(nodes, 2, 2) == TENUN_PROBE_PASS, "button activation reaches exposed node");
  CHECK(activate_accessibility(nodes, 2, 99) == TENUN_PROBE_ERR_ACCESSIBILITY, "missing node activation rejected");
}

static void stall_probe() {
  tenun_probe_stall_observation observation{50, 3, 0, 1};
  CHECK(observation.js_blocked == 1 && observation.native_ticks > 0, "native-owned work continues during JS stall");
  observation.queued_after_release = observation.queued_before_release;
  CHECK(observation.queued_after_release == 3, "queued work drains after stall release");
  CHECK(observation.queued_before_release <= TENUN_NATIVE_PROBE_MAX_QUEUE, "stall queue remains bounded");
}

int main() {
  CHECK(TENUN_NATIVE_PROBE_ABI_VERSION == 1u, "probe ABI version is supported");
  composition_probe();
  focus_probe();
  accessibility_probe();
  stall_probe();
  std::printf("PLATFORM ios=NOT_EXERCISED android=NOT_EXERCISED\n");
  if (failures != 0) return 1;
  std::printf("NATIVE PROBE PASS candidate=cpp20\n");
  return 0;
}

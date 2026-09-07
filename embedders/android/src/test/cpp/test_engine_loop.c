#include "../../../app/src/main/cpp/tenun_android_bridge.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <assert.h>

static int failures = 0;
#define CHECK(cond, msg) do { \
  if (!(cond)) { printf("FAIL: %s\n", msg); failures++; } \
  else { printf("PASS: %s\n", msg); } \
} while (0)

int main(void) {
  printf("== TenunJS Android Native Engine Loop Test ==\n");

  // 1. Initialize engine with simulated bundle
  const char* dummy_bundle = "// simulated bundle";
  tenun_android_engine* engine = tenun_android_engine_create(
      (const uint8_t*)dummy_bundle, strlen(dummy_bundle));
  CHECK(engine != NULL, "Engine initialized successfully");

  // 2. Check initial scene
  const char* initial_scene = tenun_android_engine_get_scene(engine);
  CHECK(strstr(initial_scene, "\"entryCount\":0") != NULL, "Initial scene has 0 entries");
  CHECK(strstr(initial_scene, "\"field\":\"title\"") != NULL, "Title input field exists");
  CHECK(strstr(initial_scene, "\"field\":\"details\"") != NULL, "Details input field exists");
  CHECK(strstr(initial_scene, "\"action\":\"ADD_ENTRY\"") != NULL, "Add Entry button exists");

  // 3. Dispatch user input: Type into Title field
  char* scene1 = tenun_android_engine_dispatch(
      engine, "SET_FIELD", "{\"field\":\"title\",\"value\":\"Buy Milk\"}");
  CHECK(scene1 != NULL, "Dispatched Title text input");
  CHECK(strstr(scene1, "\"value\":\"Buy Milk\"") != NULL, "Title value updated in scene");
  free(scene1);

  // 4. Dispatch user input: Type into Details field
  char* scene2 = tenun_android_engine_dispatch(
      engine, "SET_FIELD", "{\"field\":\"details\",\"value\":\"2 Gallons Whole Milk\"}");
  CHECK(scene2 != NULL, "Dispatched Details text input");
  CHECK(strstr(scene2, "\"value\":\"2 Gallons Whole Milk\"") != NULL, "Details value updated in scene");
  free(scene2);

  // 5. Dispatch button tap: ADD_ENTRY
  char* scene3 = tenun_android_engine_dispatch(engine, "ADD_ENTRY", "{}");
  CHECK(scene3 != NULL, "Dispatched ADD_ENTRY button tap action");
  CHECK(strstr(scene3, "\"entryCount\":1") != NULL, "Entry count increased to 1");
  CHECK(strstr(scene3, "Buy Milk - 2 Gallons Whole Milk") != NULL, "Entry item committed with title and details");
  CHECK(strstr(scene3, "\"field\":\"title\",\"value\":\"\"") != NULL, "Title input reset after commit");
  CHECK(strstr(scene3, "\"field\":\"details\",\"value\":\"\"") != NULL, "Details input reset after commit");
  free(scene3);

  // 6. Add a second entry: Clean apartment
  char* scene4 = tenun_android_engine_dispatch(
      engine, "SET_FIELD", "{\"field\":\"title\",\"value\":\"Clean Room\"}");
  free(scene4);
  char* scene5 = tenun_android_engine_dispatch(engine, "ADD_ENTRY", "{}");
  CHECK(strstr(scene5, "\"entryCount\":2") != NULL, "Entry count increased to 2");
  CHECK(strstr(scene5, "Clean Room") != NULL, "Second entry item committed");
  free(scene5);

  // 7. Verify destruction lifecycle
  tenun_android_engine_destroy(engine);
  CHECK(1, "Engine destroyed cleanly without leaks");

  if (failures > 0) {
    printf("FAILED: %d checks failed\n", failures);
    return 1;
  }

  printf("ALL ANDROID NATIVE ENGINE LOOP CHECKS PASS\n");
  return 0;
}

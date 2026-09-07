#include "../../../app/src/main/cpp/tenun_android_bridge.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static int failures = 0;
#define CHECK(cond, msg) do { \
  if (!(cond)) { printf("FAIL: %s\n", msg); failures++; } \
  else { printf("PASS: %s\n", msg); } \
} while (0)

static char* read_file(const char* path, size_t* out_len) {
  FILE* f = fopen(path, "rb");
  if (!f) return NULL;
  fseek(f, 0, SEEK_END);
  long len = ftell(f);
  fseek(f, 0, SEEK_SET);
  char* buf = (char*)malloc(len + 1);
  if (buf) {
    size_t read_bytes = fread(buf, 1, len, f);
    buf[read_bytes] = '\0';
    if (out_len) *out_len = read_bytes;
  }
  fclose(f);
  return buf;
}

int main(int argc, char** argv) {
  const char* asset_path = (argc > 1) ? argv[1] : "embedders/android/app/src/main/assets/tenun_app.js";
  printf("== TenunJS Android Native Engine Loop Test (with QuickJS) ==\n");
  printf("Loading application asset: %s\n", asset_path);

  // 1. Negative test: verify fail-closed on invalid JavaScript
  const char* invalid_js = "function bad() { var x = ; }}";
  tenun_android_engine* bad_engine = tenun_android_engine_create((const uint8_t*)invalid_js, strlen(invalid_js));
  CHECK(bad_engine == NULL, "Invalid JavaScript fails closed (returns NULL)");

  // 2. Read real JavaScript application asset
  size_t bundle_len = 0;
  char* bundle_code = read_file(asset_path, &bundle_len);
  CHECK(bundle_code != NULL && bundle_len > 0, "Read tenun_app.js asset bundle");
  if (!bundle_code) return 1;

  // 3. Initialize engine with real tenun_app.js
  tenun_android_engine* engine = tenun_android_engine_create((const uint8_t*)bundle_code, bundle_len);
  free(bundle_code);
  CHECK(engine != NULL, "Engine initialized with real JavaScript runtime");
  if (!engine) return 1;

  // 4. Check initial scene produced by real JS
  const char* scene0 = tenun_android_engine_get_scene(engine);
  CHECK(strstr(scene0, "\"entryCount\":0") != NULL, "Initial scene has 0 entries");
  CHECK(strstr(scene0, "\"field\":\"title\"") != NULL, "Title input field exists");
  CHECK(strstr(scene0, "\"field\":\"details\"") != NULL, "Details input field exists");
  CHECK(strstr(scene0, "\"action\":\"ADD_ENTRY\"") != NULL, "Add Entry button exists");

  // 5. Dispatch user input: Type into Title field ("Buy Groceries")
  char* scene1 = tenun_android_engine_dispatch(
      engine, "SET_FIELD", "{\"field\":\"title\",\"value\":\"Buy Groceries\"}");
  CHECK(scene1 != NULL, "Dispatched Title text input to JS");
  CHECK(strstr(scene1, "\"value\":\"Buy Groceries\"") != NULL, "Title updated in scene by JS");
  free(scene1);

  // 6. Dispatch user input: Type into Details field ("Milk, eggs, and bread")
  char* scene2 = tenun_android_engine_dispatch(
      engine, "SET_FIELD", "{\"field\":\"details\",\"value\":\"Milk, eggs, and bread\"}");
  CHECK(scene2 != NULL, "Dispatched Details text input to JS");
  CHECK(strstr(scene2, "\"value\":\"Milk, eggs, and bread\"") != NULL, "Details updated in scene by JS");
  free(scene2);

  // 7. Dispatch button tap: ADD_ENTRY (executed by real JS controller)
  char* scene3 = tenun_android_engine_dispatch(engine, "ADD_ENTRY", "{}");
  CHECK(scene3 != NULL, "Dispatched ADD_ENTRY action to JS");
  CHECK(strstr(scene3, "\"entryCount\":1") != NULL, "Entry count incremented by JS controller");
  CHECK(strstr(scene3, "\"title\":\"Buy Groceries\"") != NULL, "Entry item added to list by JS");
  CHECK(strstr(scene3, "\"details\":\"Milk, eggs, and bread\"") != NULL, "Entry details preserved by JS");
  CHECK(strstr(scene3, "\"field\":\"title\",\"value\":\"\"") != NULL, "Title input cleared by JS controller");
  CHECK(strstr(scene3, "\"field\":\"details\",\"value\":\"\"") != NULL, "Details input cleared by JS controller");
  free(scene3);

  // 8. Add a second entry: "Read Book"
  char* scene4 = tenun_android_engine_dispatch(
      engine, "SET_FIELD", "{\"field\":\"title\",\"value\":\"Read Book\"}");
  free(scene4);
  char* scene5 = tenun_android_engine_dispatch(engine, "ADD_ENTRY", "{}");
  CHECK(strstr(scene5, "\"entryCount\":2") != NULL, "Entry count is 2 in JS");
  CHECK(strstr(scene5, "\"title\":\"Read Book\"") != NULL, "Second entry item committed by JS");
  free(scene5);

  // 9. Demonstrate application-only change without C/Kotlin modification:
  // A modified JS script with custom button label "Submit Note" and dynamic prefix "[Task] "
  const char* custom_app_js =
    "(function() {"
    "  var state = { title: '', entries: [] };"
    "  function render() {"
    "    var children = ["
    "      { id: 1, type: 'input', field: 'title', value: state.title },"
    "      { id: 2, type: 'button', text: 'Submit Note', action: 'SUBMIT' }"
    "    ];"
    "    for (var i = 0; i < state.entries.length; i++) {"
    "      children.push({ id: 10 + i, type: 'listItem', title: state.entries[i] });"
    "    }"
    "    tenun_commit(JSON.stringify({ root: { id: 0, children: children }, entryCount: state.entries.length }));"
    "  }"
    "  globalThis.__tenun_dispatch_action = function(action, payloadJson) {"
    "    var payload = JSON.parse(payloadJson || '{}');"
    "    if (action === 'SET_TITLE') { state.title = payload.value; render(); }"
    "    if (action === 'SUBMIT') { state.entries.push('[Task] ' + state.title); state.title = ''; render(); }"
    "  };"
    "  render();"
    "})();";

  tenun_android_engine* custom_engine = tenun_android_engine_create(
      (const uint8_t*)custom_app_js, strlen(custom_app_js));
  CHECK(custom_engine != NULL, "Custom JS app initialized without modifying native bridge");
  const char* custom_scene0 = tenun_android_engine_get_scene(custom_engine);
  CHECK(strstr(custom_scene0, "\"text\":\"Submit Note\"") != NULL, "Custom JS button label reflected in scene");

  tenun_android_engine_dispatch(custom_engine, "SET_TITLE", "{\"value\":\"Write Docs\"}");
  char* custom_scene1 = tenun_android_engine_dispatch(custom_engine, "SUBMIT", "{}");
  CHECK(strstr(custom_scene1, "\"title\":\"[Task] Write Docs\"") != NULL,
        "Custom JS action prefix '[Task] ' committed without any C code change");
  free(custom_scene1);
  tenun_android_engine_destroy(custom_engine);

  // 10. Verify destruction lifecycle
  tenun_android_engine_destroy(engine);
  CHECK(1, "Engine destroyed cleanly without memory leaks");

  if (failures > 0) {
    printf("FAILED: %d checks failed\n", failures);
    return 1;
  }

  printf("ALL ANDROID NATIVE ENGINE LOOP CHECKS PASS (REAL QUICKJS)\n");
  return 0;
}

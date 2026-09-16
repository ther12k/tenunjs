/*
 * Gallery device-bundle smoke: runs the real gallery_app.js in the REAL
 * vendored QuickJS (the same code the phone executes) and verifies the
 * phone loop end to end: init, committed display-list scene, TAP dispatch
 * through __tenun_dispatch_action, and scene refresh.
 *
 * Not part of verify:android yet — a diagnostic harness for the
 * "UI not working on mobile" report.
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "tenun_android_bridge.h"

static char *read_file(const char *path, size_t *len) {
  FILE *f = fopen(path, "rb");
  if (!f) return NULL;
  fseek(f, 0, SEEK_END);
  long size = ftell(f);
  fseek(f, 0, SEEK_SET);
  char *buf = malloc((size_t)size + 1);
  if (fread(buf, 1, (size_t)size, f) != (size_t)size) {
    fclose(f);
    free(buf);
    return NULL;
  }
  fclose(f);
  buf[size] = '\0';
  *len = (size_t)size;
  return buf;
}

int main(int argc, char **argv) {
  if (argc < 2) {
    fprintf(stderr, "usage: gallery_smoke <bundle.js>\n");
    return 2;
  }
  size_t len = 0;
  char *bundle = read_file(argv[1], &len);
  if (!bundle) {
    fprintf(stderr, "FAIL: cannot read %s\n", argv[1]);
    return 1;
  }
  printf("bundle: %s (%zu bytes)\n", argv[1], len);

  tenun_android_engine *engine = tenun_android_engine_create((const uint8_t *)bundle, len);
  if (!engine) {
    fprintf(stderr, "FAIL: engine init failed (see TENUN_ENGINE_INIT_FAILED line above)\n");
    free(bundle);
    return 1;
  }
  printf("PASS: engine init (script_eval ok in real QuickJS)\n");

  const char *scene = tenun_android_engine_get_scene(engine);
  if (!scene || scene[0] == '\0') {
    fprintf(stderr, "FAIL: empty committed scene\n");
    return 1;
  }
  if (!strstr(scene, "\"tenun\":\"display-list\"")) {
    fprintf(stderr, "FAIL: scene is not a display list: %.120s\n", scene);
    return 1;
  }
  printf("PASS: committed display-list scene (%zu bytes)\n", strlen(scene));

  /* Tap through the production dispatch path: home tile 0 -> Banking. */
  char *result = tenun_android_engine_dispatch(engine, "TAP", "{\"id\":0}");
  if (!result) {
    fprintf(stderr, "FAIL: TAP dispatch returned NULL\n");
    return 1;
  }
  printf("PASS: TAP dispatch -> %s\n", result);
  scene = tenun_android_engine_get_scene(engine);
  if (!strstr(scene, "Banking")) {
    fprintf(stderr, "FAIL: scene after tap does not show Banking: %.160s\n", scene);
    return 1;
  }
  printf("PASS: navigation scene after tap contains Banking\n");

  /* Rapid taps: exercise action re-entry without crashes. */
  for (int i = 0; i < 25; i++) {
    free(tenun_android_engine_dispatch(engine, "TAP", "{\"id\":1}"));
  }
  scene = tenun_android_engine_get_scene(engine);
  if (!scene || scene[0] == '\0') {
    fprintf(stderr, "FAIL: scene lost after rapid dispatches\n");
    return 1;
  }
  printf("PASS: 25 rapid dispatches, scene still committed\n");

  tenun_android_engine_destroy(engine);
  free(bundle);
  printf("GALLERY SMOKE PASS (real QuickJS)\n");
  return 0;
}

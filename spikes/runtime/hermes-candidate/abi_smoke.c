/*
 * abi_smoke.c — slice-1 evidence runner for the Hermes candidate.
 * Packs TJRB bundles (sha256 via the shared compact implementation),
 * drives the adapter C ABI directly (no dlopen needed; same object code
 * a host would load), and asserts the slice-1 contract surface:
 * lifecycle, bundle validation negatives, evaluation success/failure,
 * completion kinds, stale-handle fail-closed, double-destroy no-op,
 * cross-VM isolation. Prints TENUN-HERMES-SLICE1 lines; exits nonzero
 * on any failure.
 */
#include "tenun_js_adapter.h"
#include "sha256.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>

static int g_failures = 0;

#define CHECK(cond, name)                                                    \
  do {                                                                       \
    if (cond) {                                                              \
      printf("TENUN-HERMES-SLICE1 PASS %s\n", name);                         \
    } else {                                                                 \
      printf("TENUN-HERMES-SLICE1 FAIL %s\n", name);                         \
      g_failures++;                                                          \
    }                                                                        \
  } while (0)

static uint8_t* pack_bundle(const char* source, size_t* out_len) {
  size_t src = strlen(source);
  *out_len = 48 + src;
  uint8_t* buf = (uint8_t*)calloc(1, *out_len);
  memcpy(buf, "TJRB", 4);
  uint32_t version = TENUN_JS_ABI_VERSION;
  memcpy(buf + 4, &version, 4);
  uint64_t len64 = (uint64_t)src;
  memcpy(buf + 8, &len64, 8);
  tenun_sha256((const uint8_t*)source, src, buf + 16);
  memcpy(buf + 48, source, src);
  return buf;
}

static const char* kind_name(tenun_js_value_kind k) {
  switch (k) {
    case TENUN_JS_VALUE_NULL: return "null";
    case TENUN_JS_VALUE_F64: return "f64";
    case TENUN_JS_VALUE_I64: return "i64";
    case TENUN_JS_VALUE_BOOL: return "bool";
    case TENUN_JS_VALUE_STRING: return "string";
    case TENUN_JS_VALUE_BYTES: return "bytes";
  }
  return "?";
}

static tenun_js_config good_config(void) {
  tenun_js_config cfg;
  cfg.abi_version = TENUN_JS_ABI_VERSION;
  cfg.max_heap_bytes = 64u * 1024 * 1024;
  cfg.interrupt_poll_ms = 50;
  return cfg;
}

int main(void) {
  /* 1. Fail-closed create: wrong ABI version. */
  tenun_js_config bad = good_config();
  bad.abi_version = 99;
  CHECK(tenun_js_create(&bad) == NULL, "create-rejects-wrong-abi");

  /* 2. Lifecycle + evaluation of the shared hello.js fixture payload. */
  tenun_js_config cfg = good_config();
  tenun_js_vm* vm = tenun_js_create(&cfg);
  CHECK(vm != NULL, "create-returns-live-vm");

  const char* hello =
      "function run() { return 42; }\nrun();\n";  // shared fixtures/hello.js content
  size_t bundle_len;
  uint8_t* bundle = pack_bundle(hello, &bundle_len);
  tenun_js_status st = tenun_js_eval_bundle(vm, bundle, bundle_len);
  tenun_js_value result;
  tenun_js_status rst = tenun_js_last_result(vm, &result);
  CHECK(st == TENUN_JS_OK && rst == TENUN_JS_OK &&
            result.kind == TENUN_JS_VALUE_F64 && result.as.f64 == 42.0,
        "eval-shared-hello-fixture-completes-f64-42");

  /* 3. Bundle negatives: magic, digest, length. */
  uint8_t* bad_magic = pack_bundle("1", &bundle_len);
  memcpy(bad_magic, "XJRB", 4);
  CHECK(tenun_js_eval_bundle(vm, bad_magic, bundle_len) == TENUN_JS_ERR_BUNDLE_MAGIC &&
            strstr(tenun_js_last_error(vm).message, "TJERR:BUNDLE_MAGIC") != NULL,
        "bundle-bad-magic-fails-closed-with-diagnostic");
  free(bad_magic);

  uint8_t* bad_digest = pack_bundle("2", &bundle_len);
  bad_digest[48] ^= 0x01;
  CHECK(tenun_js_eval_bundle(vm, bad_digest, bundle_len) == TENUN_JS_ERR_BUNDLE_DIGEST,
        "bundle-digest-tamper-fails-closed");
  free(bad_digest);

  uint8_t* bad_len = pack_bundle("3", &bundle_len);
  bad_len[8] ^= 0x01;
  CHECK(tenun_js_eval_bundle(vm, bad_len, bundle_len) == TENUN_JS_ERR_BUNDLE_LENGTH,
        "bundle-length-mismatch-fails-closed");
  free(bad_len);

  /* 4. Syntax error -> ERR_EVAL with TJERR:EVAL diagnostic. */
  uint8_t* syn = pack_bundle("var var var ((((", &bundle_len);
  CHECK(tenun_js_eval_bundle(vm, syn, bundle_len) == TENUN_JS_ERR_EVAL &&
            strstr(tenun_js_last_error(vm).message, "TJERR:EVAL") != NULL,
        "syntax-error-maps-to-err-eval-with-diagnostic");
  free(syn);

  /* 5. Success clears the stale diagnostic (clear-on-success rule). */
  uint8_t* ok2 = pack_bundle("7", &bundle_len);
  CHECK(tenun_js_eval_bundle(vm, ok2, bundle_len) == TENUN_JS_OK &&
            tenun_js_last_error(vm).message[0] == '\0',
        "successful-eval-clears-last-error");
  free(ok2);

  /* 6. Completion kinds: string; bytes (ArrayBuffer); object -> VALUE_BOUNDS. */
  uint8_t* str_js = pack_bundle("('hello ' + 'hermes')", &bundle_len);
  st = tenun_js_eval_bundle(vm, str_js, bundle_len);
  rst = tenun_js_last_result(vm, &result);
         tenun_js_last_error(vm).message);
  CHECK(st == TENUN_JS_OK && rst == TENUN_JS_OK &&
            result.kind == TENUN_JS_VALUE_STRING &&
            result.as.string.len == 12 &&
            strncmp(result.as.string.data, "hello hermes", 12) == 0,
        "string-completion-round-trips");
  free(str_js);

  uint8_t* bytes_js = pack_bundle("(function(){var b=new ArrayBuffer(4);var u=new Uint8Array(b);u[0]=1;u[1]=2;u[2]=3;u[3]=255;return b;})()", &bundle_len);
  st = tenun_js_eval_bundle(vm, bytes_js, bundle_len);
  rst = tenun_js_last_result(vm, &result);
         tenun_js_last_error(vm).message);
  CHECK(st == TENUN_JS_OK && rst == TENUN_JS_OK &&
            result.kind == TENUN_JS_VALUE_BYTES && result.as.bytes.len == 4 &&
            result.as.bytes.data[3] == 255,
        "arraybuffer-completion-round-trips-bytes");
  free(bytes_js);

  uint8_t* obj_js = pack_bundle("({a: 1})", &bundle_len);
  CHECK(tenun_js_eval_bundle(vm, obj_js, bundle_len) == TENUN_JS_ERR_VALUE_BOUNDS &&
            strstr(tenun_js_last_error(vm).message, "TJERR:VALUE_BOUNDS") != NULL,
        "object-completion-rejected-value-bounds-never-coerced");
  free(obj_js);

  /* 7. Honest gap visibility: unsupported operations fail visibly. */
  CHECK(tenun_js_register_host_fn(vm, "x", NULL) == TENUN_JS_ERR_ARGUMENT &&
            strstr(tenun_js_last_error(vm).message, "TJERR:UNSUPPORTED") != NULL,
        "register-host-fn-reports-unsupported-visibly");
  CHECK(tenun_js_pump(vm, 10) == -1 &&
            strstr(tenun_js_last_error(vm).message, "TJERR:UNSUPPORTED") != NULL,
        "pump-reports-unsupported-visibly");

  /* 8. Stale handle after destroy: fail closed, empty diagnostic; double
   *    destroy is a no-op. */
  tenun_js_vm* victim = tenun_js_create(&cfg);
  tenun_js_destroy(victim);
  tenun_js_destroy(victim);
  CHECK(tenun_js_eval_bundle(victim, bundle, bundle_len) == TENUN_JS_ERR_HANDLE &&
            tenun_js_last_error(victim).message[0] == '\0',
        "stale-handle-fails-closed-empty-diagnostic");

  /* 9. Cross-VM isolation: destroying one leaves the other live. */
  tenun_js_vm* a = tenun_js_create(&cfg);
  tenun_js_vm* b = tenun_js_create(&cfg);
  uint8_t* k = pack_bundle("5", &bundle_len);
  tenun_js_eval_bundle(a, k, bundle_len);
  tenun_js_destroy(a);
  CHECK(tenun_js_eval_bundle(b, k, bundle_len) == TENUN_JS_OK,
        "destroy-isolation-other-vm-still-evaluates");
  free(k);
  tenun_js_destroy(b);

  free(bundle);
  tenun_js_destroy(vm);

  printf("TENUN-HERMES-SLICE1 SUMMARY failures=%d\n", g_failures);
  return g_failures == 0 ? 0 : 1;
}

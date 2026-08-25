#ifndef TENUN_JS_ADAPTER_H
#define TENUN_JS_ADAPTER_H

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

#define TENUN_JS_ABI_VERSION 1u

typedef enum {
  TENUN_JS_OK = 0,
  TENUN_JS_ERR_ABI = 1,
  TENUN_JS_ERR_BUNDLE_MAGIC = 2,
  TENUN_JS_ERR_BUNDLE_VERSION = 3,
  TENUN_JS_ERR_BUNDLE_LENGTH = 4,
  TENUN_JS_ERR_BUNDLE_DIGEST = 5,
  TENUN_JS_ERR_EVAL = 6,
  TENUN_JS_ERR_TIMEOUT = 7,
  TENUN_JS_ERR_VALUE_BOUNDS = 8,
  TENUN_JS_ERR_REGISTRATION = 9,
  TENUN_JS_ERR_ARGUMENT = 10,
} tenun_js_status;

typedef struct tenun_js_vm tenun_js_vm;

typedef struct {
  uint32_t abi_version;
  uint64_t max_heap_bytes;
  uint32_t interrupt_poll_ms;
} tenun_js_config;

typedef struct {
  char message[256];
  int32_t line;
  int32_t column;
} tenun_js_error;

typedef enum {
  TENUN_JS_VALUE_NULL = 0,
  TENUN_JS_VALUE_F64 = 1,
  TENUN_JS_VALUE_I64 = 2,
  TENUN_JS_VALUE_BOOL = 3,
  TENUN_JS_VALUE_STRING = 4,
  TENUN_JS_VALUE_BYTES = 5
} tenun_js_value_kind;

#define TENUN_JS_MAX_STRING_BYTES 65536u
#define TENUN_JS_MAX_BYTES 1048576u
#define TENUN_JS_MAX_BUNDLE_BYTES 16777216u

typedef struct {
  const char* data;
  size_t len;
} tenun_js_string;

typedef struct {
  const uint8_t* data;
  size_t len;
} tenun_js_bytes;

typedef struct {
  tenun_js_value_kind kind;
  union {
    double f64;
    int64_t i64;
    int32_t bool_value;
    tenun_js_string string;
    tenun_js_bytes bytes;
  } as;
} tenun_js_value;

typedef tenun_js_value (*tenun_js_host_fn)(tenun_js_vm* vm, const tenun_js_value* args, size_t argc);

tenun_js_vm* tenun_js_create(const tenun_js_config* cfg);
void tenun_js_destroy(tenun_js_vm* vm);
tenun_js_status tenun_js_eval_bundle(tenun_js_vm* vm, const uint8_t* bytes, size_t len);
tenun_js_status tenun_js_register_host_fn(tenun_js_vm* vm, const char* name, tenun_js_host_fn fn);
int64_t tenun_js_pump(tenun_js_vm* vm, int64_t max_jobs);

/*
 * Returns the embedder-owned interrupt flag for this VM. The adapter polls it
 * between bytecode dispatch units; a nonzero value aborts the running
 * evaluation with TENUN_JS_ERR_TIMEOUT. The VM stays usable afterwards; the
 * embedder clears the flag. Timing policy belongs entirely to the embedder.
 */
volatile int* tenun_js_interrupt_flag(tenun_js_vm* vm);

tenun_js_status tenun_js_last_result(tenun_js_vm* vm, tenun_js_value* out);
tenun_js_error tenun_js_last_error(tenun_js_vm* vm);

#if !defined(__cplusplus)
_Static_assert(sizeof(tenun_js_error) == 264, "tenun_js_error layout is ABI");
_Static_assert(sizeof(tenun_js_value) == 24, "tenun_js_value layout is ABI");
_Static_assert(sizeof(tenun_js_config) == 24, "tenun_js_config layout is ABI");
#endif

#ifdef __cplusplus
}
#endif

#endif

#ifndef TENUN_JS_ADAPTER_H
#define TENUN_JS_ADAPTER_H

#include <stddef.h>
#include <stdint.h>

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

typedef struct {
  tenun_js_value_kind kind;
  union {
    double f64;
    int64_t i64;
    int32_t bool_value;
    struct { const char* data; size_t len; } string;
    struct { const uint8_t* data; size_t len; } bytes;
  } as;
} tenun_js_value;

typedef tenun_js_value (*tenun_js_host_fn)(tenun_js_vm* vm, const tenun_js_value* args, size_t argc);

tenun_js_vm* tenun_js_create(const tenun_js_config* cfg);
void tenun_js_destroy(tenun_js_vm* vm);
tenun_js_status tenun_js_eval_bundle(tenun_js_vm* vm, const uint8_t* bytes, size_t len);
tenun_js_status tenun_js_register_host_fn(tenun_js_vm* vm, const char* name, tenun_js_host_fn fn);
int64_t tenun_js_pump(tenun_js_vm* vm, int64_t max_jobs);
volatile int* tenun_js_interrupt_flag(tenun_js_vm* vm);
tenun_js_error tenun_js_last_error(tenun_js_vm* vm);

#endif

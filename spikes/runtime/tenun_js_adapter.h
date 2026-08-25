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
  TENUN_JS_ERR_AFFINITY = 11,
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
 * Interrupt protocol (amended 2026-08-25, review 2): the embedder requests
 * interruption through these functions; storage is adapter-owned and accessed
 * with defined atomics only — no raw flag pointer crosses the ABI.
 *
 *   tenun_js_request_interrupt: a watchdog may call from ANY thread.
 *   tenun_js_clear_interrupt  : must be called on the VM owner thread after
 *                               a TENUN_JS_ERR_TIMEOUT before further use.
 */
tenun_js_status tenun_js_request_interrupt(tenun_js_vm* vm);
tenun_js_status tenun_js_clear_interrupt(tenun_js_vm* vm);

/*
 * Error semantics: last_error is CLEARED on every successful call and fully
 * overwritten by every failing call (no stale diagnostics). Messages carry a
 * stable "TJERR:<CATEGORY>" prefix.
 *
 * Thread affinity: a VM is bound to its creating thread. Cross-thread calls
 * other than tenun_js_request_interrupt fail with TENUN_JS_ERR_AFFINITY.
 *
 * String/byte values returned through tenun_js_value point to adapter-owned
 * storage valid until the next adapter call on the same VM.
 */

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

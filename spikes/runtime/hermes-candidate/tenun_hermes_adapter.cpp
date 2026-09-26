/*
 * tenun_hermes_adapter.cpp — Hermes candidate for the shared TenunJS
 * runtime host adapter C ABI (spikes/runtime/tenun_js_adapter.h).
 *
 * SLICE 1 SCOPE (review-stopped; see README.md for the gap table):
 * REAL implementations: handle registry (slot+generation, stale handles
 * fail closed), create/destroy lifecycle, TJRB bundle validation
 * (magic/version/length/sha256 digest), source evaluation through the
 * in-process Hermes runtime, completion mapping (null/bool/f64/string/
 * ArrayBuffer bytes; everything else VALUE_BOUNDS per contract, never
 * coerced), owner-thread affinity checks, last_error clear-on-success
 * semantics.
 * HONEST GAPS (fail visibly with TJERR:UNSUPPORTED, never silent
 * no-ops): host callback registration, microtask pump + unhandled
 * rejection tracking, the interrupt protocol, and BigInt completion
 * bridging (returned as VALUE_BOUNDS with an explicit diagnostic).
 *
 * C++ exceptions never escape the C interface: every entry point is
 * wrapped; unexpected exceptions map to TJERR:EVAL or the empty-error
 * fallback where no live VM exists.
 */
#include "tenun_js_adapter.h"

#include "hermes/hermes.h"

#include <pthread.h>
#include <cstdint>
#include <cstdarg>
#include <cstdio>
#include <cstring>
#include <memory>
#include <string>
#include <vector>

#include "sha256.h"

namespace fh = facebook::hermes;
namespace fjsi = facebook::jsi;

namespace {

constexpr size_t kMaxVms = 8;
constexpr uint64_t kHandleGenerationShift = 8;
constexpr uint64_t kHandleSlotMask = 0xff;

struct VmSlot {
  bool alive = false;
  // Starts at 1: slot 0 + generation 0 would encode as handle 0, which is
  // indistinguishable from the NULL create-failure return.
  uint32_t generation = 1;
};

struct TenunHermesVm {
  std::unique_ptr<fh::HermesRuntime> runtime;
  pthread_t owner;
  tenun_js_error last_error{};
  bool has_result = false;
  tenun_js_value last_result{};
  std::string result_string;          // backs STRING completions
  std::vector<uint8_t> result_bytes;  // backs BYTES completions
};

VmSlot g_slots[kMaxVms];
pthread_mutex_t g_registry_mutex = PTHREAD_MUTEX_INITIALIZER;

uint64_t handle_encode(size_t slot, uint32_t generation) {
  return ((uint64_t)generation << kHandleGenerationShift) | (uint64_t)slot;
}

/* The handle IS an opaque token (slot+generation). We store the live Vm
 * pointer in a parallel pointer table guarded by the same mutex, so a
 * token can never be forged into a pointer dereference. */
TenunHermesVm* g_vms[kMaxVms] = {nullptr};

TenunHermesVm* handle_resolve_vm(tenun_js_vm* vm) {
  if (vm == nullptr) return nullptr;
  uint64_t h = (uint64_t)(uintptr_t)vm;
  size_t slot = (size_t)(h & kHandleSlotMask);
  if (slot >= kMaxVms) return nullptr;
  uint32_t gen = (uint32_t)(h >> kHandleGenerationShift);
  pthread_mutex_lock(&g_registry_mutex);
  TenunHermesVm* out =
      (g_slots[slot].alive && g_slots[slot].generation == gen) ? g_vms[slot] : nullptr;
  pthread_mutex_unlock(&g_registry_mutex);
  return out;
}

void error_set(TenunHermesVm* v, const char* category, const char* fmt, ...) {
  char text[sizeof(v->last_error.message)];
  va_list ap;
  va_start(ap, fmt);
  vsnprintf(text, sizeof text, fmt, ap);
  va_end(ap);
  snprintf(v->last_error.message, sizeof v->last_error.message, "TJERR:%s %s",
           category, text);
}

void error_clear(TenunHermesVm* v) { memset(&v->last_error, 0, sizeof v->last_error); }

bool owner_thread(const TenunHermesVm* v) { return pthread_equal(v->owner, pthread_self()); }

tenun_js_status validate_bundle(const uint8_t* bytes, size_t len,
                                const uint8_t** payload, size_t* payload_len,
                                TenunHermesVm* v) {
  if (len < 48 || memcmp(bytes, "TJRB", 4) != 0) {
    error_set(v, "BUNDLE_MAGIC", "bundle is not a TJRB artifact");
    return TENUN_JS_ERR_BUNDLE_MAGIC;
  }
  uint32_t version;
  memcpy(&version, bytes + 4, 4);  // little-endian host assumption recorded in README
  if (version != TENUN_JS_ABI_VERSION) {
    error_set(v, "BUNDLE_VERSION", "bundle ABI version %u != adapter %u", version,
              (unsigned)TENUN_JS_ABI_VERSION);
    return TENUN_JS_ERR_BUNDLE_VERSION;
  }
  uint64_t declared;
  memcpy(&declared, bytes + 8, 8);
  if ((size_t)declared != len - 48) {
    error_set(v, "BUNDLE_LENGTH", "declared payload %llu != actual %llu",
              (unsigned long long)declared, (unsigned long long)(len - 48));
    return TENUN_JS_ERR_BUNDLE_LENGTH;
  }
  uint8_t digest[32];
  tenun_sha256(bytes + 48, len - 48, digest);
  if (memcmp(digest, bytes + 16, 32) != 0) {
    error_set(v, "BUNDLE_DIGEST", "payload digest mismatch");
    return TENUN_JS_ERR_BUNDLE_DIGEST;
  }
  *payload = bytes + 48;
  *payload_len = len - 48;
  return TENUN_JS_OK;
}

}  // namespace

extern "C" {

tenun_js_vm* tenun_js_create(const tenun_js_config* cfg) {
  if (cfg == nullptr || cfg->abi_version != TENUN_JS_ABI_VERSION) { return nullptr; }
  if (cfg->max_heap_bytes == 0 || cfg->max_heap_bytes > TENUN_JS_MAX_BUNDLE_BYTES * 64ull) {
    // Same bound philosophy as the spike: absurd heaps are rejected, not clamped.
    return nullptr;
  }
  std::unique_ptr<fh::HermesRuntime> runtime;
  try {
    hermes::vm::GCConfig gc =
        hermes::vm::GCConfig::Builder().withMaxHeapSize(cfg->max_heap_bytes).build();
    hermes::vm::RuntimeConfig rc =
        hermes::vm::RuntimeConfig::Builder().withGCConfig(gc).build();
    runtime = fh::makeHermesRuntime(rc);
  } catch (...) {
    return nullptr;
  }
  TenunHermesVm* v;
  try {
    v = new TenunHermesVm();
  } catch (...) {
    return nullptr;
  }
  v->runtime = std::move(runtime);
  v->owner = pthread_self();
  pthread_mutex_lock(&g_registry_mutex);
  for (size_t i = 0; i < kMaxVms; i++) {
    if (!g_slots[i].alive) {
      g_slots[i].alive = true;
      g_vms[i] = v;
      uint64_t h = handle_encode(i, g_slots[i].generation);
      pthread_mutex_unlock(&g_registry_mutex);
      return (tenun_js_vm*)(uintptr_t)h;
    }
  }
  pthread_mutex_unlock(&g_registry_mutex);
  delete v;
  return nullptr;
}

void tenun_js_destroy(tenun_js_vm* vm) {
  uint64_t h = (uint64_t)(uintptr_t)vm;
  size_t slot = (size_t)(h & kHandleSlotMask);
  if (slot >= kMaxVms) return;
  uint32_t gen = (uint32_t)(h >> kHandleGenerationShift);
  pthread_mutex_lock(&g_registry_mutex);
  if (!g_slots[slot].alive || g_slots[slot].generation != gen) {
    pthread_mutex_unlock(&g_registry_mutex);
    return;  // stale/double destroy: defined no-op
  }
  TenunHermesVm* v = g_vms[slot];
  g_slots[slot].alive = false;
  g_vms[slot] = nullptr;
  g_slots[slot].generation += 1;  // never reissued for the same value
  pthread_mutex_unlock(&g_registry_mutex);
  delete v;
}

tenun_js_status tenun_js_eval_bundle(tenun_js_vm* vm, const uint8_t* bytes, size_t len) {
  TenunHermesVm* v = handle_resolve_vm(vm);
  if (v == nullptr) return TENUN_JS_ERR_HANDLE;
  if (!owner_thread(v)) {
    error_set(v, "AFFINITY", "eval_bundle called off the creating thread");
    return TENUN_JS_ERR_AFFINITY;
  }
  if (bytes == nullptr && len != 0) {
    error_set(v, "ARGUMENT", "null bundle pointer with nonzero length");
    return TENUN_JS_ERR_ARGUMENT;
  }
  if (len > TENUN_JS_MAX_BUNDLE_BYTES) {
    error_set(v, "BUNDLE_LENGTH", "bundle exceeds max bytes");
    return TENUN_JS_ERR_BUNDLE_LENGTH;
  }
  const uint8_t* payload;
  size_t payload_len;
  tenun_js_status st = validate_bundle(bytes ? bytes : (const uint8_t*)"", len, &payload,
                                       &payload_len, v);
  if (st != TENUN_JS_OK) return st;
  std::string source;
  source.assign(reinterpret_cast<const char*>(payload), payload_len);
  try {
    fjsi::Value value = v->runtime->evaluateJavaScript(
        std::make_shared<fjsi::StringBuffer>(source), "tenun-bundle.js");
    v->has_result = false;
    memset(&v->last_result, 0, sizeof v->last_result);
    if (value.isUndefined() || value.isNull()) {
      v->last_result.kind = TENUN_JS_VALUE_NULL;
    } else if (value.isBool()) {
      v->last_result.kind = TENUN_JS_VALUE_BOOL;
      v->last_result.as.bool_value = value.getBool() ? 1 : 0;
    } else if (value.isNumber()) {
      // Every JS Number crosses as F64 (header review 7).
      v->last_result.kind = TENUN_JS_VALUE_F64;
      v->last_result.as.f64 = value.getNumber();
    } else if (value.isString()) {
      std::string s = value.getString(*v->runtime).utf8(*v->runtime);
      if (s.size() > TENUN_JS_MAX_STRING_BYTES) {
        error_set(v, "VALUE_BOUNDS", "string completion exceeds 64 KiB");
        return TENUN_JS_ERR_VALUE_BOUNDS;
      }
      v->result_string = std::move(s);
      v->last_result.kind = TENUN_JS_VALUE_STRING;
      v->last_result.as.string.data = v->result_string.data();
      v->last_result.as.string.len = v->result_string.size();
    } else if (value.isObject() &&
               value.getObject(*v->runtime).isArrayBuffer(*v->runtime)) {
      fjsi::ArrayBuffer ab =
          value.getObject(*v->runtime).getArrayBuffer(*v->runtime);
      if (ab.size(*v->runtime) > TENUN_JS_MAX_BYTES) {
        error_set(v, "VALUE_BOUNDS", "bytes completion exceeds 1 MiB");
        return TENUN_JS_ERR_VALUE_BOUNDS;
      }
      v->result_bytes.assign(ab.data(*v->runtime), ab.data(*v->runtime) + ab.size(*v->runtime));
      v->last_result.kind = TENUN_JS_VALUE_BYTES;
      v->last_result.as.bytes.data = v->result_bytes.data();
      v->last_result.as.bytes.len = v->result_bytes.size();
    } else if (value.isBigInt()) {
      // Honest gap: BigInt bridging is deferred to the bridging slice;
      // the contract requires VALUE_BOUNDS (never coercion) outside it.
      error_set(v, "VALUE_BOUNDS", "BigInt completion bridging not implemented in slice 1");
      return TENUN_JS_ERR_VALUE_BOUNDS;
    } else {
      // Objects/functions/symbols cannot cross the ABI (review 5/6).
      error_set(v, "VALUE_BOUNDS", "completion kind cannot cross the ABI");
      return TENUN_JS_ERR_VALUE_BOUNDS;
    }
    v->has_result = true;
    error_clear(v);
    return TENUN_JS_OK;
  } catch (const fjsi::JSIException& e) {
    error_set(v, "EVAL", "%s", e.what());
    v->has_result = false;
    return TENUN_JS_ERR_EVAL;
  } catch (const std::exception& e) {
    error_set(v, "EVAL", "%s", e.what());
    v->has_result = false;
    return TENUN_JS_ERR_EVAL;
  } catch (...) {
    error_set(v, "EVAL", "unknown native exception during evaluation");
    v->has_result = false;
    return TENUN_JS_ERR_EVAL;
  }
}

tenun_js_status tenun_js_register_host_fn(tenun_js_vm* vm, const char* name,
                                          tenun_js_host_fn fn) {
  TenunHermesVm* v = handle_resolve_vm(vm);
  if (v == nullptr) return TENUN_JS_ERR_HANDLE;
  (void)name;
  (void)fn;
  // Honest gap: visible failure, never a silent no-op.
  error_set(v, "UNSUPPORTED", "host callback registration is not implemented in slice 1");
  return TENUN_JS_ERR_ARGUMENT;
}

int64_t tenun_js_pump(tenun_js_vm* vm, int64_t max_jobs) {
  TenunHermesVm* v = handle_resolve_vm(vm);
  if (v == nullptr) return -1;  // stale handle: no live state for a diagnostic
  (void)max_jobs;
  error_set(v, "UNSUPPORTED", "microtask pump/rejection tracking is not implemented in slice 1");
  return -1;
}

tenun_js_status tenun_js_request_interrupt(tenun_js_vm* vm) {
  // Cross-thread watchdog path: NEVER touches owner-thread VM state
  // (header contract), so no diagnostic is recorded either.
  if (handle_resolve_vm(vm) == nullptr) return TENUN_JS_ERR_HANDLE;
  return TENUN_JS_ERR_ARGUMENT;  // interrupt protocol is a slice gap
}

tenun_js_status tenun_js_clear_interrupt(tenun_js_vm* vm) {
  TenunHermesVm* v = handle_resolve_vm(vm);
  if (v == nullptr) return TENUN_JS_ERR_HANDLE;
  error_set(v, "UNSUPPORTED", "interrupt protocol is not implemented in slice 1");
  return TENUN_JS_ERR_ARGUMENT;
}

tenun_js_status tenun_js_last_result(tenun_js_vm* vm, tenun_js_value* out) {
  TenunHermesVm* v = handle_resolve_vm(vm);
  if (v == nullptr) return TENUN_JS_ERR_HANDLE;
  if (out == nullptr) {
    error_set(v, "ARGUMENT", "null out pointer");
    return TENUN_JS_ERR_ARGUMENT;
  }
  if (!v->has_result) {
    error_set(v, "ARGUMENT", "no successful evaluation result is stored");
    return TENUN_JS_ERR_ARGUMENT;
  }
  *out = v->last_result;
  error_clear(v);
  return TENUN_JS_OK;
}

tenun_js_error tenun_js_last_error(tenun_js_vm* vm) {
  static const tenun_js_error kEmpty = [] {
    tenun_js_error e;
    memset(&e, 0, sizeof e);
    return e;
  }();
  TenunHermesVm* v = handle_resolve_vm(vm);
  if (v == nullptr) return kEmpty;  // opaque-handle rule: empty fallback
  return v->last_error;
}

}  // extern "C"

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
  TENUN_JS_ERR_HANDLE = 12,
} tenun_js_status;

/*
 * Opaque handle registry (review 2026-08-25, H1): tenun_js_vm* values are
 * registry tokens (slot + generation), NOT pointers. Never dereference or
 * forge them. After tenun_js_destroy, every later use of that handle fails
 * closed with TENUN_JS_ERR_HANDLE (tenun_js_last_error returns an empty
 * diagnostic instead); double destroy is a safe no-op; handle values are
 * never reissued, so a stale handle can never alias a fresh VM.
 *
 * Reentrancy identity (review 11): adapter calls made from a host callback
 * are rejected with TENUN_JS_ERR_HANDLE only when they target the EXACT VM
 * instance currently evaluating — compared by full handle (slot +
 * generation), never by slot alone. A VM created after another was destroyed
 * mid-evaluation may reuse the freed slot with a bumped generation; it is a
 * DIFFERENT VM and registering/evaluating/pumping it from the callback is
 * legal nested usage.
 */
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
/* Maximum host-function arguments marshalled per call (review 7). Calls
 * with more arguments still invoke the callback, but arguments beyond this
 * limit are dropped, argc reflects only the marshalled prefix, and a
 * TJERR:VALUE_BOUNDS diagnostic is recorded. */
#define TENUN_JS_MAX_ARGS 8u
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
 * Error semantics (clarified review 5): last_error is CLEARED on every
 * successful OWNER-THREAD adapter call and overwritten by every failing one
 * (no stale diagnostics). Messages carry a stable "TJERR:<CATEGORY>" prefix.
 * Per-call exceptions, by design:
 *   - tenun_js_request_interrupt: cross-thread watchdog path; NEVER touches
 *     owner-thread VM state, so it neither sets nor clears last_error.
 *   - tenun_js_last_error itself: a query, not an operation — it neither
 *     sets nor clears diagnostics.
 *   (every other owner-thread call — including tenun_js_clear_interrupt and
 *   tenun_js_last_result — follows the clear-on-success rule; review 6)
 *   - pump: success clears; failures with a RESOLVABLE VM — reentrancy,
 *     argument errors, a FAILED pending job, interruption, or outstanding
 *     unhandled promise rejections (review 13) — record diagnostics and
 *     return -1. A failing job is NOT "queue empty": it produces
 *     TJERR:EVAL (with the underlying exception text, any JS value kind)
 *     or TJERR:TIMEOUT when interrupted, and the diagnostic persists until
 *     the next adapter call clears or overwrites it (review 12).
 *     A STALE (unresolvable) handle returns -1 — there is no live VM state
 *     left to record a diagnostic in, so tenun_js_last_error returns the
 *     empty fallback per the opaque-handle rule below (review 13).
 *
 * Pump execution context (review 12): tenun_js_pump installs the pumped
 * VM's execution context for the duration of the drain — exactly like a
 * direct evaluation. Host functions invoked from pumped jobs are delivered
 * to THAT VM's registered callback with THAT VM's handle, whether the pump
 * is top-level (no evaluation in progress) or nested inside another VM's
 * evaluation (the outer VM's context is restored when the pump returns).
 * Pumping the VM that is currently evaluating is rejected (reentrancy);
 * pumping a DIFFERENT VM from a callback is legal nested usage.
 *
 * Unhandled promise rejections (review 13/14/15): a per-VM host
 * rejection tracker records every rejection reported with no handler
 * attached, keyed by RETAINED PROMISE IDENTITY (bounded: at most 8
 * tracked entries, reason text capped). The identity is published
 * BEFORE the reason conversion runs, because conversion may execute
 * user code (toString/valueOf) that attaches a handler to THIS very
 * promise — that reentrant handled transition then removes the
 * already-published entry, and the conversion result updates the entry
 * only if it still exists (a handler attached during conversion
 * cancels the rejection). A handled transition removes exactly
 * the entry for THAT promise — attaching a handler to promise X can
 * never remove a report for promise Y, and an unmatched transition
 * (already reported, or unknown) is a defined no-op. A rejection
 * arriving when 8 entries are already tracked sets a STICKY OVERFLOW
 * flag instead of being dropped: the next pump turn end fails with a
 * deterministic TJERR:EVAL "tracking exceeded 8 outstanding entries"
 * diagnostic, even if every tracked entry was handled in the meantime.
 * At the END of each pump drain, outstanding unhandled rejections fail
 * the turn: tenun_js_pump returns -1 with a TJERR:EVAL diagnostic that
 * aggregates the tracked reasons (bounded count, report order).
 * REPORTING IS TERMINAL: the turn-end report releases the tracked
 * identities, so a handler attached in a LATER adapter call is a safe
 * no-op — handlers cancel a rejection only before its turn-end report.
 * A rejection handled within the same drain — a catch attached in the
 * pumped jobs — never fails the turn. Promise-to-native-future
 * bridging remains out of scope; this is asynchronous error REPORTING
 * for the microtask system the pump drains.
 *
 * Tracker teardown (review 15): retained promise identities are
 * host-owned duplicates. tenun_js_destroy releases any still-tracked
 * identities while the context and runtime are alive — they are
 * freed BEFORE context/runtime teardown on every destruction path
 * (including self-destroy mid-evaluation and destroy without any
 * pump), never left for runtime teardown to absorb.
 *
 * Diagnostic text (review 13/14): TJERR:EVAL exception/rejection text
 * covers ALL JS value kinds (numbers/booleans/bigints in JS textual
 * form, null/undefined verbatim, symbols via description, objects via
 * string conversion); interior NUL characters are ESCAPED (\u0000)
 * because the ABI diagnostic is a NUL-terminated C string; the final
 * payload is truncated at a UTF-8 character boundary (never splitting
 * a multibyte char) with byte 255 reserved as the C terminator.
 *
 * Thread affinity: a VM is bound to its creating thread. Cross-thread calls
 * other than tenun_js_request_interrupt fail with TENUN_JS_ERR_AFFINITY.
 *
 * String/byte value storage (review 8/10) — PER-SCOPE budgets, not one
 * aggregate pool. Maximum simultaneous adapter-owned payload is ~10 MiB
 * plus allocator overhead:
 *   - callback scratch: at most TENUN_JS_MAX_ARGS * TENUN_JS_MAX_BYTES
 *     (8 MiB), structurally bounded. Argument payload pointers are valid
 *     ONLY for the duration of the native callback invocation (the scope
 *     is released when the callback returns)
 *   - owned completion: at most TENUN_JS_MAX_BYTES (1 MiB), stored when an
 *     evaluation completes
 *   - tenun_js_last_result view: at most TENUN_JS_MAX_BYTES (1 MiB),
 *     backed by ONE replaceable buffer. A previously returned payload
 *     pointer is invalidated by exactly two events: the next
 *     tenun_js_last_result call on the same VM (which replaces the buffer)
 *     and tenun_js_destroy. Other adapter operations (eval, register,
 *     pump, interrupt control) do NOT invalidate it.
 *   - a value that would exceed its scope budget is dropped with
 *     TENUN_JS_ERR_VALUE_BOUNDS
 *
 * Unsupported argument shapes (review 8/9): plain objects, functions, arrays,
 * and other non-ArrayBuffer arguments are DROPPED with
 * TENUN_JS_ERR_VALUE_BOUNDS (reduced argc) — they never coerce to null.
 * Native code can distinguish actual null from an unsupported value, but
 * individual unsupported shapes are NOT distinguishable from one another
 * (they share the generic drop diagnostic).
 *
 * MAX_ARGS diagnostic (review 8/10): the TENUN_JS_MAX_ARGS exceedance
 * diagnostic is callback-visible (readable via tenun_js_last_error inside
 * the callback). Callback diagnostics are scoped to the single host
 * invocation that produced them: a callback observes ONLY its own combined
 * VALUE_BOUNDS warning (a clean callback never inherits a previous
 * callback's warning), the evaluation-level diagnostic is restored when
 * the callback returns, and everything is cleared when the overall
 * evaluation completes successfully.
 *
 * Completion values (review 5/6): tenun_js_last_result returns the FULL
 * bounded kind of the last successful evaluation — null, bool, f64, i64,
 * string, or bytes. i64 is the EXACT signed 64-bit domain:
 *   - host returns i64 -> JavaScript BigInt (2^53+1 and i64::MAX/MIN
 *     round-trip exactly; no f64 rounding, no i32 narrowing)
 *   - JavaScript BigInt arguments marshal exactly while inside int64;
 *     magnitudes outside are dropped with TENUN_JS_ERR_VALUE_BOUNDS
 *     (never wrapped modulo 2^64)
 * Completions that cannot cross the ABI (objects, functions, oversized
 * strings/bytes, BigInt outside int64) return TENUN_JS_ERR_VALUE_BOUNDS
 * with a TJERR:VALUE_BOUNDS diagnostic; they are never silently coerced.
 *
 * Source-type kinds (review 7): every JavaScript Number crosses the ABI as
 * TENUN_JS_VALUE_F64 regardless of the engine's internal integer
 * representation; VK_I64 is reserved for BigInt values.
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

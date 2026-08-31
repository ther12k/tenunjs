---
okf_version: 0.2
title: "Runtime Host Adapter Contract"
summary: "Runtime-neutral host interface, interruption rules, and bundle contract for embedded JS runtimes (TN-010)."
type: contract
status: accepted
issue_id: "TN-010"
---

# Runtime host adapter contract

The engine never names its JavaScript runtime (`adr-0007`). Candidates implement this exact interface; applications never see it. Canonical machine form: [`spikes/runtime/tenun_js_adapter.h`](../spikes/runtime/tenun_js_adapter.h). Consumers: TN-011 (QuickJS-NG), TN-012 (Hermes).

## Interface (C ABI v1)

| Function | Contract |
| --- | --- |
| `tenun_js_create(cfg)` | Create an isolated VM. Fails closed on unsupported config values; never falls back silently. |
| `tenun_js_destroy(vm)` | Logical teardown: handle is invalidated immediately (subsequent calls return `TENUN_JS_ERR_HANDLE`). If called reentrantly from a host callback during active evaluation, the underlying VM Box is parked until outer evaluation exits, preserving heap address stability and preventing use-after-free. Safe to call after a timeout fault; double destroy is a safe no-op. |
| `tenun_js_eval_bundle(vm, bytes, len)` | Execute one bundle (see below). Returns typed status; diagnostics via `tenun_js_last_error`. |
| `tenun_js_register_host_fn(vm, name, fn)` | Register one native function callable from JS by fixed name. Duplicate registration fails. |
| `tenun_js_pump(vm, max_jobs)` | Drain queued microtasks/jobs up to `max_jobs`, returns drained count. Non-blocking. |
| `tenun_js_request_interrupt(vm)` | Request asynchronous interruption of the running VM. Thread-safe: may be called from any watchdog thread. |
| `tenun_js_clear_interrupt(vm)` | Clear the interrupt state. Owner-thread only: must be called before further evaluations on the VM. |
| `tenun_js_last_error(vm)` | Message + line/column when the runtime provides them; empty string when not. |
| `tenun_js_last_result(vm, out)` | Completion value of the last successful evaluation as one bounded value; fails with `TENUN_JS_ERR_VALUE_BOUNDS` for unrepresentable results. Added by first-consumer amendment during TN-011/TN-012. |

## Bounded host values (implemented in full — review 2 finding #5 closed; i64 exactness review 6)

Both directions marshal all six kinds: `null`, `bool`, `f64`, `i64`, UTF-8 `string` ≤ 64 KiB, `bytes` ≤ 1 MiB.

- **Foreign tags**: `kind` is a raw u32; implementations range-check before reading the union. Invalid tags fail with `TENUN_JS_ERR_VALUE_BOUNDS`.
- **i64 exactness (review 6)**: `i64` is the full signed 64-bit domain — no i32 narrowing, no f64 rounding.
  - host→JS: `i64` returns a **BigInt**; `9007199254740993` (2^53+1) and `i64::MAX`/`i64::MIN` round-trip exactly.
  - JS→host: **BigInt** arguments marshal exactly within the signed range **[-2^63, 2^63 − 1]**; BigInt outside that range is dropped (`VALUE_BOUNDS`, reduced argc) — never wrapped modulo 2^64.
  - JS **Number** arguments/completions keep their origin type (`f64`); rounding of non-exact literals is JavaScript parse semantics, not the bridge.
  - completion path: BigInt completions become `I64` when inside `[-2^63, 2^63 − 1]`; outside → `VALUE_BOUNDS`.
- **Source-type kinds (review 7)**: every JavaScript **Number** crosses the ABI as `F64`, regardless of the engine's internal integer representation; **`I64` is reserved for BigInt**. Host callbacks can rely on `42` arriving as `TENUN_JS_VALUE_F64` and `42n` as `TENUN_JS_VALUE_I64`.
- **Host-call argument limit (review 7)**: at most `TENUN_JS_MAX_ARGS` (= 8) arguments are marshalled per host call. Calls with more arguments still invoke the callback with the first 8; excess arguments are dropped and a `TJERR:VALUE_BOUNDS` diagnostic is recorded.
- **UTF-8 policy**: string payloads that are not valid UTF-8 are rejected (`VALUE_BOUNDS`), never mangled.
- **Pointer rules**: null data with nonzero length fails; null data with length 0 is an empty value.
- **Oversize JS→host arguments** are DROPPED with `TJERR:VALUE_BOUNDS` recorded and a reduced argc (documented truncation of the argument LIST, never of content); oversize host RETURNS throw a `TJERR:VALUE_BOUNDS` exception into JS.
- **Ownership & bounded storage (review 8)**:
  - *Callback arguments*: payload pointers are valid only for the duration of the native callback invocation; scratch storage is released when the callback returns.
  - *Completion results (review 10)*: `last_result` is backed by ONE replaceable buffer capped at `TENUN_JS_MAX_BYTES` (1 MiB). A previously returned payload pointer is invalidated by exactly two events: the next `last_result` call on the same VM (which replaces the buffer) and `tenun_js_destroy`. Other adapter operations (eval, register, pump, interrupt control) do NOT invalidate it.
  - *Per-scope budgets (review 10)*: adapter-owned payload is bounded per scope, not by one aggregate pool — callback scratch ≤ `TENUN_JS_MAX_ARGS × TENUN_JS_MAX_BYTES` (8 MiB, released when the callback returns), owned completion ≤ `TENUN_JS_MAX_BYTES` (1 MiB), `last_result` view ≤ `TENUN_JS_MAX_BYTES` (1 MiB). Maximum simultaneous retention is ≈10 MiB plus allocator overhead. A value that would exceed its scope budget is dropped with `TENUN_JS_ERR_VALUE_BOUNDS`. These budgets sit outside the configured `max_heap_bytes` JavaScript-heap limit, so untrusted JS cannot grow native memory without bound.
- **Unsupported argument shapes (review 8)**: plain objects, functions, arrays, and other non-ArrayBuffer arguments are DROPPED with `VALUE_BOUNDS` (same policy as oversized values). They never silently coerce to `null` — `host(null)`, `host({})`, and `host(() => {})` are distinguishable by argc and diagnostics.
- **MAX_ARGS diagnostic visibility (review 8/10)**: when a host call exceeds `TENUN_JS_MAX_ARGS`, the `TJERR:VALUE_BOUNDS` exceedance diagnostic is **callback-visible** (readable via `last_error` inside the callback). Callback diagnostics are scoped to the single host invocation that produced them: a callback observes only its own combined warning — a clean callback never inherits a previous callback's stale warning — and the evaluation-level diagnostic is restored when the callback returns. Everything is cleared by successful completion of the overall evaluation, per the global clear-on-success rule.
- **Reentrancy identity (review 11)**: adapter calls from a host callback are rejected with `TENUN_JS_ERR_HANDLE` only when they target the exact VM instance currently evaluating — identity is the full handle (slot + generation), never the slot alone. A replacement VM created in a slot freed by mid-eval destruction is a different VM instance; registering, evaluating, and pumping it from the callback is legal nested usage (regression: destroy(A) → create(B) → register/eval(B) inside A's callback).
- **Failure visibility**: callback-return failures surface as JS exceptions carrying the TJERR category, so they survive eval success.
- **Diagnostics are exact (review 7)**: every failed owner-thread adapter call with a resolvable VM overwrites `last_error` with a fresh category-specific diagnostic — including pure argument-validation failures (NULL bundle/name/out pointers, oversize bundle, invalid UTF-8 or empty registration names). Only the documented exceptions (`request_interrupt`, `last_error`) and unresolvable handles (no VM state to update) skip this.

## Interruption rules (atomic API — amended review 2 / review 3)

- The adapter manages an internal atomic interrupt flag accessed via `tenun_js_request_interrupt` and `tenun_js_clear_interrupt`. Timing policy belongs entirely to the embedder: a watchdog thread calls `tenun_js_request_interrupt` when its own deadline expires (cross-thread safe by design).
- The adapter polls the internal atomic between bytecode dispatch units. When set, running evaluation aborts with `TENUN_JS_ERR_TIMEOUT`; partial state is discarded.
- The embedder calls `tenun_js_clear_interrupt` on the owner thread; afterwards the VM is fully usable — this recovery is part of the ABI smoke suite. A successful owner-thread clear also clears `last_error` (it IS an adapter operation, review 6).
- Cross-thread clear returns `TENUN_JS_ERR_AFFINITY`.
- `tenun_js_request_interrupt` is the one documented exception to the clear/overwrite diagnostic rule: as a cross-thread watchdog path it never touches owner-thread VM state (neither sets nor clears `last_error`). `tenun_js_last_error` itself is a query and also never mutates diagnostics.
- Native code must remain responsive even while JS is stalled: scroll/animation continuity (principle 7) depends on this boundary holding.

## Completion values (review 5)

`tenun_js_last_result` returns the last successful evaluation's completion as a **full bounded value** — all six kinds (`null`, `bool`, `f64`, `i64`, `string`, `bytes`). Completions that cannot cross the ABI (objects, functions, strings > 64 KiB, buffers > 1 MiB, BigInt outside int64) fail with `TENUN_JS_ERR_VALUE_BOUNDS` and a `TJERR:VALUE_BOUNDS` diagnostic; silent coercion to null is a contract violation. A successful `tenun_js_last_result` call clears `last_error` like every other owner-thread adapter operation.

## Config validation (review 5)

`tenun_js_create` fails closed (returns NULL) on unsupported configuration values:

- `abi_version` ≠ 1.
- `max_heap_bytes` > `UINT32_MAX` (beyond the enforced range).
- `interrupt_poll_ms` ≠ 0 (reserved for future use; nonzero values would silently fake enforcement, so they are rejected).

Documented supported values (`max_heap_bytes` = 0 for unlimited, or any value ≤ `UINT32_MAX`; `interrupt_poll_ms` = 0) always succeed.

## ABI conformance gate

The header in `spikes/runtime/` is the canonical interface. Every runtime/layout candidate PR must compile and run `abi_smoke.c` **and** the same file as C++ (proving the `extern "C"` guard) with `-Wall -Wextra -Werror`, linked against the release cdylib, from outside the crate. The header carries `_Static_assert`s for every cross-boundary struct; first-consumer amendments must update this doc in the same commit.

## Bundle contract

Spike-stage container, superseded by TN-023 bytecode work:

```text
offset  size  field
0       4     magic "TJRB"
4       4     format_version u32 LE (=1)
8       8     payload_length u64 LE
16      32    payload SHA-256
48      ...   payload (single-file JS source for M0 spikes)
```

Fail-closed checks in order: magic → version → length vs buffer → digest. Any failure returns `TENUN_JS_ERR_BUNDLE_*` before execution. No fallback interpretation of unversioned input.

## Fixtures

Shared by all runtime candidates under [`spikes/runtime/fixtures/`](../spikes/runtime/fixtures/), checksummed in `fixtures.sha256`:

| Fixture | Proves |
| --- | --- |
| `hello.js` | evaluation returns expected f64 through the bounded-value path |
| `callback.js` | registered host fn invoked from JS with bounded args |
| `stall.js` | infinite loop triggers deadline interruption, VM survives |

Candidates must not modify fixtures; drift is caught by checksum in CI.

## Out of scope

ES module graphs, workers, promises bridging into native futures, bytecode compilation (TN-023), and the callback ABI refinement (TN-025). Adding surface here requires naming which later issue consumes it.

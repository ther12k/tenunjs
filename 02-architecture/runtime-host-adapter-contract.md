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

## Bounded host values (implemented in full — review 2 finding #5 closed)

Both directions marshal all six kinds: `null`, `bool`, `f64`, `i64`, UTF-8 `string` ≤ 64 KiB, `bytes` ≤ 1 MiB.

- **Foreign tags**: `kind` is a raw u32; implementations range-check before reading the union. Invalid tags fail with `TENUN_JS_ERR_VALUE_BOUNDS`.
- **UTF-8 policy**: string payloads that are not valid UTF-8 are rejected (`VALUE_BOUNDS`), never mangled.
- **Pointer rules**: null data with nonzero length fails; null data with length 0 is an empty value.
- **Oversize JS→host arguments** are DROPPED with `TJERR:VALUE_BOUNDS` recorded and a reduced argc (documented truncation of the argument LIST, never of content); oversize host RETURNS throw a `TJERR:VALUE_BOUNDS` exception into JS.
- **Ownership**: string/byte payloads point to adapter-owned storage valid until the next adapter call on the same VM.
- **Failure visibility**: callback-return failures surface as JS exceptions carrying the TJERR category, so they survive eval success.

## Interruption rules (atomic API — amended review 2 / review 3)

- The adapter manages an internal atomic interrupt flag accessed via `tenun_js_request_interrupt` and `tenun_js_clear_interrupt`. Timing policy belongs entirely to the embedder: a watchdog thread calls `tenun_js_request_interrupt` when its own deadline expires (cross-thread safe by design).
- The adapter polls the internal atomic between bytecode dispatch units. When set, running evaluation aborts with `TENUN_JS_ERR_TIMEOUT`; partial state is discarded.
- The embedder calls `tenun_js_clear_interrupt` on the owner thread; afterwards the VM is fully usable — this recovery is part of the ABI smoke suite.
- Cross-thread clear returns `TENUN_JS_ERR_AFFINITY`.
- Native code must remain responsive even while JS is stalled: scroll/animation continuity (principle 7) depends on this boundary holding.

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

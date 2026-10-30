---
okf_version: 0.2
title: "TN-176: JNI host-handler setter and destroy must refuse same-engine reentry"
summary: "The Android JNI nativeSetHostCallHandler locked the engine mutex without TN-167's in_entry check, and nativeDestroy returned void so a refused destroy still zeroed Kotlin's handle — a synchronous host-service callback calling destroy() or replacing the handler deadlocked the dispatch thread (ANR-shaped on main)."
type: issue
status: ready
issue_id: "TN-176"
milestone: "M4"
priority: "P1"
depends_on:
  - "TN-167"
---

# TN-176 — JNI host-handler setter and destroy must refuse same-engine reentry

## Purpose

The 2026-10-30 production-readiness review (round 2) found the TN-167
reentry rule enforced on the C API but NOT on its JNI wrappers:

- `nativeSetHostCallHandler` locked `engine->lock` directly. A
  synchronous Kotlin host-service callback (invoked from native dispatch
  while the mutex is held) that assigns `hostServiceHandler` — or calls
  `TenunEngine.destroy()`, which calls this setter first — deadlocks on
  the non-recursive mutex. Kotlin's own `@Synchronized` monitor is
  reentrant, which is exactly why this path was reachable.
- `nativeDestroy` returned `void`, so a REFUSED native destroy (the C
  destroy's TN-167 refusal) was indistinguishable from success:
  `TenunEngine.destroy()` zeroed `nativeHandle` for a still-alive engine
  (leak + wrong `isDisposed`).

The C-only reentry tests (engine-loop section 18) never covered the JNI
setter — this is why the suite stayed green.

## Required outcome

1. The JNI setter refuses same-engine reentry with a WARN, mirroring
   `tenun_android_engine_set_host_call_handler`.
2. `nativeDestroy` returns whether the destroy happened; a refused
   destroy keeps the Kotlin handle so the engine stays usable and the
   owner can retry after the dispatch entry returns.
3. Device-level regression: a host callback that synchronously calls
   `destroy()` / replaces the handler must return (the hang is the
   failure), leave the engine usable, and allow a post-entry destroy.

## Verification

- New `EngineReentryGuardTest` (androidTest, runs on the CI device gate):
  reentrant destroy refused + engine usable; reentrant replacement
  refused without deadlock; post-entry destroy succeeds.
- NDK release + debug + androidTest variants compile with the header
  signature change (native).
- Full run_android_test.sh, 8-gate CI.

## Out of scope

- Any change to the C API's reentry semantics (TN-167 frozen).

---
okf_version: 0.2
title: "TN-167: Refuse same-engine reentry visibly instead of deadlocking"
summary: "A host service that calls back into its own engine from inside tenun_host_call runs on the thread holding the non-recursive engine mutex — today that deadlocks the app; the bridge must reject the inner call visibly."
type: issue
status: ready
issue_id: "TN-167"
milestone: "M1"
priority: "P1"
depends_on:
  - "TN-154"
---

# TN-167 — Refuse same-engine reentry visibly instead of deadlocking

## Purpose

The 2026-10-27 review's P1 #4, confirmed by probe at `47c9ce2`: the engine
mutex is non-recursive and held across `JS_Call`. When JavaScript calls
`tenun_host_call`, the handler crosses JNI into Kotlin on the SAME thread;
if that service synchronously calls back into the same engine
(`dispatchAction`, `dispatchActionResult`, `getLatestScene`, `destroy`,
`setHostCallHandler`), the second `pthread_mutex_lock` deadlocks — the
probe hung until an external timeout killed it.

The documented contract says host-service calls must not re-enter, but
nothing enforces it: a service author learns about the rule by freezing
the app.

## Required outcome

1. Every public entry that takes the engine mutex —
   `tenun_android_engine_dispatch`, `tenun_android_engine_dispatch_result`,
   `tenun_android_engine_set_host_call_handler`,
   `tenun_android_engine_destroy`, and the JNI `nativeGetLatestScene`
   wrapper (which locks directly) — refuses the call with a WARN when the
   calling thread is already inside an entry on the same engine, instead
   of attempting the second lock.
2. Refusal is non-fatal and typed to each call's existing convention:
   dispatch entries return NULL ("no result"/"{}"), `nativeGetLatestScene`
   returns the empty-scene string, destroy returns without freeing. The
   OUTER entry completes normally and the engine stays usable.
3. The in-entry flag is set only by the lock owner while JS can call out
   and read before any lock attempt; ordinary cross-thread contention is
   unchanged (those callers block until the outer entry finishes, as
   before).

## Verification

- New `test_engine_loop.c` section 18 (runs in `verify:android` CI): an
  engine whose dispatch handler calls `tenun_host_call`, with a C handler
  that re-enters both dispatch entries. Both inner calls return NULL, the
  outer dispatch completes under the section watchdog, and a later
  dispatch still commits. Pre-fix, this test hangs.
- Existing TN-154 host-bridge and TN-136 bounded-dispatch sections keep
  passing (non-reentrant handlers are unaffected).

## Out of scope

- A supported re-entrancy mechanism (deferred dispatch queues, recursive
  mutex). If a capability genuinely needs engine state mid-callback, the
  answer is a follow-up design, not silent reentry.
- The Rust spike adapter's separate stale-destroy defect (spike-only).

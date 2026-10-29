---
okf_version: 0.2
title: "TN-164: Scope the JS time budget to the native entry"
summary: "Each drained promise job arms a fresh 5 s deadline, so one dispatch can hold the engine lock for job-count × budget; a production-default probe measured 6.6 s for 61 jobs."
type: issue
status: closed
issue_id: "TN-164"
milestone: "M1"
priority: "P1"
depends_on:
  - "TN-136"
  - "TN-151"
---

# TN-164 — Scope the JS time budget to the native entry

## Purpose

TN-136 introduced the interrupt-handler deadline ("5 s per eval and per
dispatch") and TN-151 added job draining at every native entry point.
Their interaction broke the budget's intent: `tenun_drain_pending_jobs`
re-arms `js_deadline_ms` for EVERY job, so the bound applies per job,
not per entry. A bundle whose dispatch schedules chained busy jobs holds
the caller's thread and the engine mutex for up to
`TENUN_JS_MAX_JOBS_PER_ENTRY × budget`.

Production-default probe at `47c9ce2` (no test-budget overrides):

```text
production_budget_ms=5000 entry_elapsed_ms=6600 scene=settled jobs=61
```

Dispatches of that shape run on the Android main thread (BLE events,
IME events), so this is ANR-shaped: the evidence is the measured
over-budget dispatch, not an observed device ANR.

## Required outcome

1. The deadline is armed ONCE per native entry that runs JS (eval,
   dispatch, dispatch-with-result) and covers the handler AND the job
   drain together. Draining no longer re-arms.
2. An interrupted drain stays fail-visible and non-fatal: the failing
   job WARNs with the interrupt error, the drain stops, the last
   committed scene is preserved, and the engine remains usable for
   later entries (each entry gets a fresh budget, so bounded progress
   across entries is expected behavior).

## Verification

- New `test_engine_loop.c` section under `TENUN_TEST_INJECTION`: with a
  small injected budget, a bundle scheduling many busy jobs returns
  from dispatch within the bound, has NOT reached its final commit, and
  the engine still serves a later dispatch.
- The existing TN-136 bounded eval/dispatch and TN-151 drain sections
  keep passing (their budgets are per single execution, still honored).

## Out of scope

- Changing the default budget value or the job-count cap.
- Moving dispatch off the main thread (scheduling separation is TN-155's
  animation-slice problem).
## Status note

**Closed 2026-10-29 by PR #250** (branch `fix/tn-162-165-android-production-blockers`,
commit `33f5602`). Evidence: C engine-loop section 12(e) (over-budget drain keeps the last scene; later entry finishes the jobs); production-default probe 6600ms/settled before, 5000ms/initial after; TN-136/TN-151 sections still pass.


---
okf_version: 0.2
title: "Android host review record (2026-09-28)"
summary: "Source-traced findings from the post-landing review of the Android host (OTA trial health, engine lifecycle, JNI bridge resource safety) with reproduction scenarios, severities, and explicit validation limits; recorded for issue filing and device-campaign design."
type: report
status: accepted
---

# Android host review record (2026-09-28)

## Scope and method

A read-only review of the landed Android embedder followed the TN-133
arc (main at `38b6a2a`): `TenunSurfaceView.kt`, `MainActivity.kt`,
`OtaManager.kt`, `UpdateStore.kt`, `tenun_android_bridge.c`, and the
instrumentation tests. Findings are **source-traced scenarios, not
device reproductions** — no emulator or physical device was driven for
this record. Each finding names the code path and a concrete scenario;
per ADR-0022, none of this constitutes device evidence, and no observed
on-device failure is claimed. The browser-side findings from the same
review are already fixed and merged (#216 hit-test scroll sign; #218
host boot obscuring a scene rejection + malformed-shape validation).

## Findings awaiting issue filing

Priority is the reviewer's static assessment of exploitability or
reliability impact inside the prototype's trust boundaries.

### A1 — OTA trial can be confirmed without any trial interaction (P1)

`TenunSurfaceView.kt:162` records `dispatchedOnce` over the VIEW's
lifetime and `:447-456` fires the first-successful-dispatch hook only on
that first-ever TAP. `MainActivity.kt:256-264` swaps engines without
resetting the signal, and `:279-292` confirms the trial when
`firstSceneCommitted && firstDispatchObserved`. Scenario: tap the
packaged app once, then apply an OTA bundle — the pre-update tap
satisfies the dispatch criterion; after the uptime delay the candidate
is confirmed with zero trial interactions, so a broken candidate can be
persisted.

### A2 — A pending OTA apply survives Activity destruction (P1)

`OtaManager.kt:129-155` posts the apply on its own handler after
fetch/staging; `MainActivity.kt:418-424` removes only its own handler
callbacks, shuts the executor, and destroys the engine — it neither
stops the manager nor removes its posted apply. Scenario: destroy or
recreate the Activity while a download is finishing; the old Activity's
`applyOtaUpdate` (`:225-272`) can still boot a candidate and swap it
into a dead surface, leaving an unconfirmed trial and an orphaned
engine for the next launch.

### A3 — Bundle JavaScript can block the UI thread indefinitely (P1)

`tenun_android_bridge.c:119-168` evaluates the bundle synchronously
with no interrupt handler and no memory limit; `:223-256` dispatches
actions the same way; `TenunSurfaceView.kt:443-452` enters dispatch
from the UI thread. A syntactically valid packaged or signed OTA bundle
containing `while (true) {}` at init or in a tap handler hangs startup
or interaction indefinitely; unbounded allocation can exhaust the
process. (QuickJS supports `JS_SetInterruptHandler` and
`JS_SetMemoryLimit` — the bridge sets neither.)

### A4 — A thrown JS action counts as a successful trial dispatch (P2)

`tenun_android_bridge.c:240-259` logs a `JS_Call` exception but returns
the previous scene as though dispatch succeeded; the surface then fires
the success hook. A trial bundle whose TAP handler throws can pass the
dispatch criterion and be confirmed after the uptime delay.

### A5 — Quarantining a confirmed bundle lowers the anti-replay floor (P2)

`UpdateStore.kt:46-54` returns `-1` from `acceptedSequence()` once the
confirmed bundle's backing files are deleted by quarantine;
`OtaManager.kt:115-121` compares new manifests only against that value.
After confirmed v5 is quarantined, an older, still-valid signed v4 that
was never quarantined passes the sequence gate and can be installed —
violating the monotonic anti-rollback floor quarantine is meant to
raise.

### A6 — Failed evaluation leaks already-committed scenes (P2)

`tenun_android_bridge.c:69-82` allocates `current_scene` on commit, but
the evaluation-error cleanup at `:169-216` frees the engine without
freeing that scene. A bundle whose boot commits one or more scenes and
then throws (`tenun_commit(...); throw ...`) leaks each committed scene
on every attempted boot.

### A7 — A malformed display list silently exits display-list mode (P2)

`DisplayListScene.kt:139-150` returns null for missing `ops` and
`:264-270` catches parse errors into null; `TenunSurfaceView.kt:342-351`
clears the scene holder on null and falls back to legacy/stale local
controls instead of surfacing incompatibility. (The browser twin of
this edge was hardened in #218.)

## Test gaps (why the gates did not catch these)

- `OtaEngineJourneyTest.kt:159-184` substitutes its own apply callback
  and confirms trials manually — the Activity's trial-health criterion
  (A1, A4) is never exercised.
- `MainActivityInteractionTest.kt` simulates local strings, not the JNI
  bridge.
- Native bridge tests cover the valid synchronous flow only (A3, A6).

## Planning finding — TN-042 ownership mismatch

`04-api/external-consumer-guide.md` and TN-133's slice record assign
the generic host's integrated-shell UX (route rail, hot reload,
dev-server routes) to TN-042, but TN-042's own issue is the M2 native
renderer-neutral display list (`engine/` touch points, web explicitly
out of scope). The browser-shell integration work needs an explicit
owner — either a late-issue in the TN-131/132/133 pattern or a scope
addendum — before it is scheduled; calling TN-042 "the preview shell
issue" is not backed by its file.

## Lower-priority JS-side note (recorded, unfixed)

The gallery preview hot-reload poll (`examples/gallery-preview/
preview.ts:83-115`) records the first observed hash without applying
it (an edit landing between page load and first poll is never applied
to the loaded runtime) and advances `lastHash` BEFORE the
import-and-restore, swallowing import/restore failures until the next
hash change. Same shape in `examples/flutter-showcase-preview/
preview.ts`. Owned naturally by the TN-042-resolution above (hot-reload
UX); recorded so it is not rediscovered.

## Disposition

No fix is claimed by this record. Each A-finding needs: an owning issue
(per the late-issue pattern), a targeted instrumentation/native test,
and — where the scenario requires it — device or emulator reproduction
consistent with ADR-0022 before any behavioral claim. A1/A2/A4/A5 are
instrumentable in the existing androidTest harness; A3/A6 need native
test additions; A7 needs a Kotlin-side malformed-scene fixture.

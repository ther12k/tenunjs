---
okf_version: 0.2
title: "TN-163: Refuse the engine swap when TENUN_RESTORE is not acknowledged"
summary: "OTA and hot reload currently activate the candidate engine even when the state restore threw inside QuickJS, destroying the running application's state."
type: issue
status: closed
issue_id: "TN-163"
milestone: "M1"
priority: "P1"
depends_on:
  - "TN-150"
---

# TN-163 — Refuse the engine swap when TENUN_RESTORE is not acknowledged

## Purpose

The 2026-10-29 production-readiness review reproduced a P1 in both
bundle-swap paths (`applyOtaUpdate`, `applyReload`): the restore is sent
through the LEGACY dispatch channel, whose native contract is "log the
thrown handler error and return the last scene". Kotlin's `catch`
therefore never fires, and the code unconditionally swaps in the
candidate and destroys the old engine — exactly the outcome the
parallel-boot design exists to prevent. The bundle boots with empty
state while the user's session is gone.

Native probe at `47c9ce2`:

```text
TENUN_RESTORE failed: Error: bad-restore   (WARN, swallowed)
scene_restore=initial                       (legacy channel returns normally)
```

TN-150 already built the correct channel: `dispatchActionResult`
returns the handler's STRING reply, or NULL when the handler threw.
The TS handoff returns `{"route":...}` after a successful restore and
propagates the restore error otherwise.

## Required outcome

1. Both swap paths send `TENUN_RESTORE` through the result channel and
   treat a NULL (or blank) reply as a failed restore: the candidate is
   destroyed, the current engine stays live, and the failure is logged
   with the owning decision. A clean-restart path (no restore attempted)
   is unchanged.
2. The C loop gate carries a checked-in regression for the channel
   contract the gate depends on: a bundle whose restore handler throws
   yields NULL on the result channel while the legacy channel still
   returns the last scene, and a succeeding restore yields the route
   JSON reply.

## Verification

- New `test_engine_loop.c` section (runs in `verify:android` CI).
- Existing OTA journey / state-carry instrumentation keeps passing
  (successful restores still swap).

## Out of scope

- Any change to the restore protocol or snapshot format.
- Quarantine/trial semantics (unchanged; a refused apply simply returns
  false the same way a failed candidate boot does).
## Status note

**Closed 2026-10-29 by PR #250** (branch `fix/tn-162-165-android-production-blockers`,
commit `33f5602`). Evidence: C engine-loop section 17 (result channel NULL on thrown restore, route reply on success; legacy channel still returns the last scene); MainActivity applyOtaUpdate/applyReload gate; OTA journey instrumentation green on the device gate.


---
okf_version: 0.2
title: "TN-162: Attribute GATT write completions to their submission"
summary: "A late completion callback for an abandoned write must never confirm the current command; today it can clear the STOP latch for a STOP that was never written."
type: issue
status: closed
issue_id: "TN-162"
milestone: "M1"
priority: "P1"
depends_on:
  - "TN-159"
---

# TN-162 — Attribute GATT write completions to their submission

## Purpose

The 2026-10-29 production-readiness review reproduced a P1 in the
TN-159 write path: `onCharacteristicWrite` identifies the completed
operation by reading the CURRENT `inFlight` command. When the watchdog
has already abandoned a stalled submission and a later command (STOP)
has been submitted, the stalled write's late SUCCESS callback is read as
the new command's confirmation and clears `stopLatch` — acknowledging a
STOP that was never written. If the link then drops, the reconnect
sends nothing (the disconnect path only re-queues STOP while the latch
is set), and an unattended machine keeps running.

Deterministic reproduction against the production service compiled with
a fake BLE transport (source-derived offline harness):

```text
WASH submitted → watchdog abandons it → STOP submitted
late WASH SUCCESS arrives → stopLatch=false (wrong); STOP never confirmed
drop + reconnect → replacement sends no STOP
```

## Required outcome

1. Completion callbacks are attributed to the submission that produced
   them. The Android stack completes characteristic writes in submission
   order, so a per-submission ledger (one in-order slot per successfully
   submitted write) can attribute every callback: a submission the
   watchdog gave up on keeps its slot but is marked abandoned, and its
   late callback is a transport-alive signal only — it must not confirm
   anything, clear any latch, or touch the live submission's state.
2. A pure, JVM-testable ledger type owns the attribution rule
   (`GattWriteLedger`); `PolytronBleService` wires it into `drain()`,
   the watchdog, `onCharacteristicWrite`, and both teardown paths
   (disconnect callback and `closeGatt` reset it).
3. The STOP guarantees from TN-159 hold: a latched STOP survives a late
   foreign callback, is retried after the late callback leaves the
   transport idle, and is delivered on reconnect after a drop.

## Verification

- New JVM unit test for the ledger: normal confirmation, the exact
  late-callback scenario above (latch must survive; the current
  submission's own callback still confirms), submit-failure and
  spurious-callback edges, and reset-on-teardown.
- The offline fake-transport harness re-run against the fixed service
  shows the latch surviving the late WASH callback and STOP delivered
  on the replacement connection (PR evidence; the harness itself is not
  checked in, matching the existing BLE probe practice).
- The existing TN-159 regression controls (rejected STOP retried three
  times, teardown isolation, STOP-after-drop) keep passing.

## Out of scope

- Browser host surfaces (no GATT there).
- Any change to the write protocol itself (gap, retry counts, MTU).
## Status note

**Closed 2026-10-29 by PR #250** (branch `fix/tn-162-165-android-production-blockers`,
commit `33f5602`). Evidence: offline fake-transport harness against the production service (late-callback latch survival + STOP on reconnect + the three TN-159 regression controls); GattWriteLedgerTest JVM suite; full run_android_test.sh; device gate green.


---
okf_version: 0.2
title: "TN-177: Only the live submission's GATT completion may retire its write watchdog"
summary: "onCharacteristicWrite advanced writeSeq before ledger.complete() classified the callback, so a late abandoned completion (or any unattributable one) cancelled the CURRENT submission's armed watchdog — after a stalled WASH's late callback, a retrying STOP whose completion never arrived kept writing=true forever and wedged every later write."
type: issue
status: closed
issue_id: "TN-177"
milestone: "M4"
priority: "P1"
depends_on:
  - "TN-162"
---

# TN-177 — Only the live submission's GATT completion may retire its write watchdog

## Purpose

The 2026-10-30 production-readiness review (round 2) found a second
defect in the BLE write path, adjacent to but distinct from TN-162's
false-confirmation fix:

`onCharacteristicWrite` ran `writeSeq++` BEFORE `ledger.complete()`
classified the callback. The ledger keeps attribution correct (TN-162),
but the watchdog generation counter was advanced by EVERY callback:
after the WASH watchdog abandoned a stalled WASH and STOP was
(res)ubmitted, the WASH completion arriving LATE classified as
`Abandoned` — and still bumped `writeSeq`, silently disarming STOP's
armed watchdog. If STOP's own completion never arrived, `writing`
stayed true forever: no retry, no ERR, no drain, every later command
wedged until transport teardown.

The existing `GattWriteLedgerTest` covers ledger attribution only; the
service-level sequencing had no regression vehicle — the offline harness
from TN-162 lived in /tmp and never landed in the repo.

## Required outcome

1. `writeSeq` advances ONLY inside the `Current` branch (the live
   submission's own callback, success or failure). `Abandoned` and
   `None` completions are transport signals only.
2. A durable, in-repo offline regression: the production
   `PolytronBleService` + `GattWriteLedger` compiled against
   hand-written `android.*` fakes on a virtual-time scheduler, wired
   into `./gradlew test` (and therefore run_android_test.sh and CI) via
   a plain `:offline-ble` JVM module — no android.jar on the classpath,
   so the platform fakes cannot collide with SDK stubs.
3. The TN-177 scenario proven fails-before/pass-after: late abandoned
   completion → STOP watchdog still fires → bounded retries → explicit
   machine-check ERR → queue drained, `writing` released.

## Verification

- `:offline-ble` probe: 3 TN-159 controls + 2 TN-162 cases + the TN-177
  case, all against production sources. Fails-before proven by
  temporarily reverting the service fix (STOP wedged at
  attempts=[WASH, STOP]); passes with the fix.
- Full run_android_test.sh, 8-gate CI.

## Out of scope

- Duplicate-completion attribution (a duplicate callback consumes the
  next in-order slot by the ledger's design — transport-level anomaly,
  needs protocol-level sequence numbers to do better).
- Any change to GattWriteLedger semantics (TN-162 frozen).
## Status note (2026-10-30, closed)

Implemented and published in one session. Fixed in PR #261: writeSeq
advances only inside the ledger's Current branch — Abandoned and None
completions are transport signals that can no longer cancel the current
submission's armed watchdog. The regression vehicle is now durable
in-repo: the :offline-ble JVM module compiles the PRODUCTION
PolytronBleService+GattWriteLedger against hand-written android.* fakes
on a virtual-time scheduler and runs in ./gradlew test (3 TN-159
controls + 2 TN-162 cases + the TN-177 case). Fails-before proven by
temporary revert (STOP wedged at attempts=[WASH, STOP] with writing
stuck true); with the fix: bounded retries to attempts=[WASH, STOP,
STOP, STOP], explicit "STOP belum terkonfirmasi" ERR, queue drained,
writing released.

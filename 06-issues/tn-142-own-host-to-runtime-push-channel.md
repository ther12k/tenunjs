---
okf_version: 0.2
title: "TN-142: Own the host-to-runtime push channel in the execution contract"
summary: "Companion apps are push-driven (idle-time notifications, reconnection, link-state flips); make host→runtime delivery a first-class runtime surface with coalescing/backpressure instead of per-app actionSeams bookkeeping."
type: issue
status: ready
issue_id: "TN-142"
milestone: "M3"
priority: "P1"
depends_on:
  - "TN-133"
---

# TN-142 — Own the host-to-runtime push channel in the execution contract

## Metadata

| Field | Value |
|---|---|
| Milestone | M3 — Application model and navigation (runtime surface) |
| Priority | P1 |
| Dependencies | TN-133 (public execution contract; ApplicationRuntime + host handoff landed) |
| Suggested size | One contract + runtime PR |
| Gate impact | Every live-data app re-implements this today |

## Purpose

Gap 3 of the VOTOL consumer feedback
([record](../08-validation/votol-consumer-feedback-2026-10-02.md)).
"Native event → action → transaction → commit" fits taps, but companion
apps are dominated by traffic the user didn't cause: BLE status
notifications arriving while idle, background reconnection, fob
near/away flips, a LINKED/SEARCHING/OFFLINE link state machine. Today
that lives in app-side improvisation: the `actionSeams`
capture-after-mount wrapper plus the `podSync()` replay-on-mount cache
in `examples/votol/src/runtime.ts` — bookkeeping the framework should
own via a screen service context.

## Required outcome

- The execution contract (TN-133's services context) grows a first-class
  push surface: hosts deliver out-of-band events/data to the active
  screen without going through a user action, with defined semantics for
  delivery while no screen is mounted (latest-wins replay on mount, the
  property `podSync` already needs).
- Coalescing/backpressure policy is explicit (default coalescing for
  latest-state pushes; documented behavior when a screen cannot keep
  up), not emergent.
- The VOTOL example migrates onto the runtime surface and deletes its
  private seam-capture wrapper — the example becomes the proof the
  framework owns the pattern it has been teaching.

## References

- [VOTOL consumer feedback, gap 3](../08-validation/votol-consumer-feedback-2026-10-02.md)
- `examples/votol/src/runtime.ts` (`seam()`, `podSync()`, replay-on-mount)

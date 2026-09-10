---
okf_version: 0.2
title: "ADR-0022: M0 selection gates blocked on device availability; provisional runtime in the experimental embedder"
summary: "Record the M0 selection gates as BLOCKED_BY_ENVIRONMENT on physical-device evidence; the Android embedder's vendored QuickJS is provisional behind the runtime adapter and concludes no bake-off."
type: decision
status: proposed
---

# ADR-0022: M0 selection gates blocked on device availability; provisional runtime in the experimental embedder

## Context

M0 requires selecting the engine language (ADR-0005), JavaScript runtime
(ADR-0007), and layout backend (ADR-0008) "with matched evidence"
(roadmap). Each gate's verification clause requires **device** evidence,
ADR-0005 additionally requires **matched physical-device vertical slices**,
and ADR-0019 requires physical devices for the IME, accessibility,
lifecycle, memory, and performance measurements those gates exist to
capture.

No physical device is currently attached to this project's workflow. What
does exist, executed and enforced: a KVM-backed Android 11 emulator CI gate
(`verify-android-device`) that installs and operates the limited reference
application (TN-132, PRs #174/#175), a host verification chain
(`verify-android`), and the headless C++/Rust integration probes (TN-131) —
which were explicitly "minimum architecture-risk probes," not the ADR-0005
gate, and must not be cited as its conclusion.

This ADR is filed under the exception clause every affected gate carries:
"Any exception requires a new ADR that names the violated invariant and
rollback plan."

## Decision (proposed)

1. The three M0 selection gates are recorded as
   **BLOCKED_BY_ENVIRONMENT** on physical-device availability. They are not
   waived, weakened, or re-scoped to emulator evidence.
2. The experimental Android embedder's vendored QuickJS (bellard
   2024-01-13, via rquickjs-sys vendored sources) is a **provisional
   implementation behind the runtime-adapter boundary**. It does not
   conclude ADR-0007's bake-off (QuickJS-NG vs Hermes behind one host
   interface) and must not be cited as that selection.
3. Foundation work that does not depend on the final selections may
   continue behind the adapter and embedder boundaries. Any artifact whose
   acceptance requires a selection stays blocked.
4. Unblocking path: when physical devices become available, the matched
   slices run per ADR-0005/ADR-0019 as specified. Emulator-derived evidence
   is **not** retroactively counted toward those gates; the bake-offs run
   as written.

## Violated invariant (named, per the exception clause)

Selecting now — on emulator-only or host-only evidence — would violate the
"matched device evidence" invariant shared by ADR-0005/0007/0008 and
ADR-0019: emulator execution cannot measure the GPU, thermal, memory,
IME-composition, or accessibility characteristics those gates exist to
weigh, and a selection made without them could not be trusted or cheaply
reversed once downstream contracts encode it.

## Rollback plan

The provisional runtime is confined to `embedders/android/` and the spike
harness; applications never see it (ADR-0007's own boundary). Swapping it
for the selected runtime is a contained change to the embedder's vendored
sources and bridge, with no application-contract churn. If this ADR is
rejected instead, the Android embedder foundation remains valid — it
already claims no selection — and only this record is withdrawn.

## Alternatives considered

- **Select on emulator evidence now.** Rejected: it would falsify the very
  gates this pack enforces and propagate an unmeasured choice into
  dependent contracts.
- **Freeze all further work until hardware arrives.** Rejected:
  adapter-bounded foundation work carries no selection risk and keeps the
  device gates' eventual inputs (a real, tested host) moving.
- **Conclude ADR-0005 from the TN-131 probes.** Rejected: those probes were
  scoped as minimum architecture-risk probes and explicitly do not decide
  the engine language.

## Verification

This ADR changes no code and adds no test. Its acceptance criterion is the
record itself: M0 gates visibly blocked (not silently stalled), the
provisional status of the embedder runtime stated where the embedder is
described, and the unblocking path written down. Revisit when physical
device access materially changes.

## Revisit trigger

Physical-device availability, a platform-policy change, or a materially
changed runtime/layout trade-off.

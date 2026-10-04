---
okf_version: 0.2
title: "TN-145: Assert host parity for application service seams"
summary: "A test-stack check that each host actually implements every seam an application uses, so an embedder cannot silently claim an app it cannot run — the failure mode that produced two VOTOL apps."
type: issue
status: ready
issue_id: "TN-145"
milestone: "M6"
priority: "P2"
depends_on:
  - "TN-133"
---

# TN-145 — Assert host parity for application service seams

## Metadata

| Field | Value |
|---|---|
| Milestone | M6 — Tooling and quality infrastructure |
| Priority | P2 |
| Dependencies | TN-133 (services context contract), TN-141 (capability seam vocabulary) |
| Suggested size | One test-stack PR |
| Gate impact | Silent host/app incompatibility becomes a gate failure |

## Purpose

Item from gap 5 of the VOTOL consumer feedback
([record](../08-validation/votol-consumer-feedback-2026-10-02.md)).
The browser host implements seams the Android host does not (and vice
versa will hold for native capabilities), and nothing checks: an
embedder can silently claim an app it cannot run. This failure mode is
precisely why two VOTOL apps exist — one per host. A host-parity
assertion in the test stack makes the mismatch a build-time fact.

## Required outcome

- A parity checker that, given an application's declared/introspected
  service-seam usage and a host's declared capability surface, fails
  closed on any seam the host does not implement (structured report,
  not a runtime crash later).
- Wired into the existing test stack (bun test gate) and exercised by
  the examples: votol's `pod` seam vs a host without BLE is the
  canonical mismatch case; the browser host's declared surface passes.
- Compatible with TN-141's degradation states: a seam declared
  "unsupported-with-degradation" in a host PASSES parity only when the
  app marks that degradation acceptable.

## References

- [VOTOL consumer feedback, gap 5](../08-validation/votol-consumer-feedback-2026-10-02.md)
- `examples/votol/src/runtime.ts` (`PodServices`, `noPodHost` — the degradation pattern to codify)

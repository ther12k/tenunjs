---
okf_version: 0.2
title: "ADR-0008: Layout adapter and bake-off"
summary: "Evaluate Yoga and Taffy with the same conformance and integration suite."
type: decision
status: accepted
---

# ADR-0008: Layout adapter and bake-off

## Context

TenunJS needs a stable decision on this boundary before dependent implementation work can close. The decision must preserve TypeScript/TSX application ergonomics while keeping native mobile behavior explicit and testable.

## Decision

Evaluate Yoga and Taffy with the same conformance and integration suite.

## Rationale

The engine needs an replaceable layout boundary until correctness and total toolchain cost are known.

## Consequences

- Dependent package and protocol contracts must encode this decision.
- Alternative implementations are allowed only behind the defined adapter or through a superseding ADR.
- Tests must cover both the intended path and fail-closed behavior at its boundary.
- Documentation and examples must not imply a broader compatibility promise than this decision provides.

## Verification

The relevant milestone gate must include source, test, and device evidence. Any exception requires a new ADR that names the violated invariant and rollback plan.

## Revisit trigger

Revisit only when pilot evidence, platform policy, dependency viability, or measured performance materially changes the trade-off.

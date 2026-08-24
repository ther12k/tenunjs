---
okf_version: 0.2
title: "ADR-0009: Controller and typed action state model"
summary: "Use screen controllers, typed actions, cancellable effects, and bounded state transactions instead of React hooks."
type: decision
status: accepted
---

# ADR-0009: Controller and typed action state model

## Context

TenunJS needs a stable decision on this boundary before dependent implementation work can close. The decision must preserve TypeScript/TSX application ergonomics while keeping native mobile behavior explicit and testable.

## Decision

Use screen controllers, typed actions, cancellable effects, and bounded state transactions instead of React hooks.

## Rationale

This provides the requested explicit, HTMX-like simplicity in a local native application model.

## Consequences

- Dependent package and protocol contracts must encode this decision.
- Alternative implementations are allowed only behind the defined adapter or through a superseding ADR.
- Tests must cover both the intended path and fail-closed behavior at its boundary.
- Documentation and examples must not imply a broader compatibility promise than this decision provides.

## Verification

The relevant milestone gate must include source, test, and device evidence. Any exception requires a new ADR that names the violated invariant and rollback plan.

## Revisit trigger

Revisit only when pilot evidence, platform policy, dependency viability, or measured performance materially changes the trade-off.

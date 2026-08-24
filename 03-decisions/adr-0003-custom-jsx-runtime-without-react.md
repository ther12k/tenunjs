---
okf_version: 0.2
title: "ADR-0003: Custom JSX runtime without React"
summary: "Provide framework-owned jsx/jsxs/Fragment functions and a custom reconciler; do not depend on React."
type: decision
status: accepted
---

# ADR-0003: Custom JSX runtime without React

## Context

TenunJS needs a stable decision on this boundary before dependent implementation work can close. The decision must preserve TypeScript/TSX application ergonomics while keeping native mobile behavior explicit and testable.

## Decision

Provide framework-owned jsx/jsxs/Fragment functions and a custom reconciler; do not depend on React.

## Rationale

TenunJS needs TSX composition, not the full React semantic and compatibility burden.

## Consequences

- Dependent package and protocol contracts must encode this decision.
- Alternative implementations are allowed only behind the defined adapter or through a superseding ADR.
- Tests must cover both the intended path and fail-closed behavior at its boundary.
- Documentation and examples must not imply a broader compatibility promise than this decision provides.

## Verification

The relevant milestone gate must include source, test, and device evidence. Any exception requires a new ADR that names the violated invariant and rollback plan.

## Revisit trigger

Revisit only when pilot evidence, platform policy, dependency viability, or measured performance materially changes the trade-off.

---
okf_version: 0.2
title: "ADR-0001: TenunJS product identity"
summary: "Create a standalone mobile-native framework named TenunJS; do not treat it as Bundar or a Bundar package."
type: decision
status: accepted
---

# ADR-0001: TenunJS product identity

## Context

TenunJS needs a stable decision on this boundary before dependent implementation work can close. The decision must preserve TypeScript/TSX application ergonomics while keeping native mobile behavior explicit and testable.

## Decision

Create a standalone mobile-native framework named TenunJS; do not treat it as Bundar or a Bundar package.

## Rationale

Independent product boundaries prevent the mobile engine from inheriting a Bun/HTML deployment model.

## Consequences

- Dependent package and protocol contracts must encode this decision.
- Alternative implementations are allowed only behind the defined adapter or through a superseding ADR.
- Tests must cover both the intended path and fail-closed behavior at its boundary.
- Documentation and examples must not imply a broader compatibility promise than this decision provides.

## Verification

The relevant milestone gate must include source, test, and device evidence. Any exception requires a new ADR that names the violated invariant and rollback plan.

## Revisit trigger

Revisit only when pilot evidence, platform policy, dependency viability, or measured performance materially changes the trade-off.

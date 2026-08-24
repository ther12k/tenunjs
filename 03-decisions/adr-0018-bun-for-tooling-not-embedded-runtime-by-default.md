---
okf_version: 0.2
title: "ADR-0018: Bun for tooling, not embedded runtime by default"
summary: "Use Bun where helpful for CLI/build/test tooling but do not assume Bun ships inside mobile applications."
type: decision
status: accepted
---

# ADR-0018: Bun for tooling, not embedded runtime by default

## Context

TenunJS needs a stable decision on this boundary before dependent implementation work can close. The decision must preserve TypeScript/TSX application ergonomics while keeping native mobile behavior explicit and testable.

## Decision

Use Bun where helpful for CLI/build/test tooling but do not assume Bun ships inside mobile applications.

## Rationale

The embedded runtime has different footprint, platform, bytecode, and lifecycle requirements.

## Consequences

- Dependent package and protocol contracts must encode this decision.
- Alternative implementations are allowed only behind the defined adapter or through a superseding ADR.
- Tests must cover both the intended path and fail-closed behavior at its boundary.
- Documentation and examples must not imply a broader compatibility promise than this decision provides.

## Verification

The relevant milestone gate must include source, test, and device evidence. Any exception requires a new ADR that names the violated invariant and rollback plan.

## Revisit trigger

Revisit only when pilot evidence, platform policy, dependency viability, or measured performance materially changes the trade-off.

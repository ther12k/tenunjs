---
okf_version: 0.2
title: "Testing Strategy"
summary: "Layered correctness, integration, performance, and device testing."
type: architecture
status: accepted
---

# Testing strategy

## Test pyramid

1. TypeScript controller/action unit tests with fake services and deterministic effects.
2. Reconciler fixtures that assert mutation traces.
3. Native engine unit/property tests with mock renderer and deterministic clock.
4. Layout conformance fixtures shared across candidate backends.
5. Semantics and focus snapshots.
6. Golden Skia rendering on controlled configurations.
7. Platform integration tests for IME, accessibility, lifecycle, permissions, and views.
8. Physical-device end-to-end journeys.
9. Performance, memory, soak, fuzz, and crash-recovery tests.

## Replay artifacts

The framework can record sanitized event traces, action traces, mutation transactions, and frame diagnostics. CI can replay them against the headless host to reproduce deterministic failures.

## Closure rule

A test passing only on a simulator is insufficient for a gate involving GPU, IME, accessibility, lifecycle, packaging, or frame pacing.

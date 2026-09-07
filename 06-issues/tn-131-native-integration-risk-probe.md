---
okf_version: 0.2
title: "TN-131: Execute native-integration risk probes before engine selection"
summary: "Matched headless probes for composition, focus disposal, accessibility exposure, and native-owned behavior during a JavaScript stall."
type: issue
status: ready
issue_id: "TN-131"
milestone: "M0"
priority: "P0"
depends_on:
  - "TN-006"
  - "TN-007"
  - "TN-008"
---

# TN-131 — Execute native-integration risk probes before engine selection

## Purpose

TN-006 remains the accepted minimal vertical-slice contract and intentionally excludes text input. This follow-up does not rewrite that contract. It probes four architecture risks that could invalidate a later embedder design before the C++/Rust choice is scored by TN-009.

The same fixture and observable outcomes run through both candidate implementations while ADR-0005 remains open. This is a probe, not M4/M5 implementation.

## Probe matrix

| Probe | Required observation | Fail-closed observation | Platform claim |
| --- | --- | --- | --- |
| Composition | Begin, modify, and commit marked text while preserving committed text and selection | Malformed update rejected without changing prior state | Headless contract only; real IME remains `NOT EXERCISED` |
| Focus/disposal | Focus transfers between fields; disposed target receives no later event | Event for disposed or stale generation rejected | Headless contract only |
| Accessibility | Editable field and button are exposed; button activation reaches intended node | Missing node activation rejected | Real VoiceOver/TalkBack remains `NOT EXERCISED` |
| JavaScript stall | Native-owned ticks continue during 500 ms JS stall; queued work drains after release | Queue remains bounded and recovers after stall | Headless timing probe; physical-device benchmark remains separate |

A 500 ms stall is diagnostic stimulus, not performance budget. A blocked JavaScript handler is not expected to execute during the block.

## Evidence classification

Each candidate reports `PASS`, `FAIL`, or `NOT EXERCISED` per scenario. Mocked or headless adapters can establish state-machine and fail-closed behavior, but cannot establish physical IME, screen-reader, or device responsiveness. Missing platform adapters are never a pass.

## Scope

In scope: shared fixture, versioned probe state model, Rust and C++ candidate runners, deterministic negative cases, replay command, and packet-ready result output.

Out of scope: changing TN-006, selecting the engine language, full IME adapters, VoiceOver/TalkBack automation, widget APIs, navigation, scheduler redesign, physical-device claims, README changes, and M4/M5 closure.

## Acceptance

- [ ] Identical fixture drives Rust and C++ runners.
- [ ] Positive composition, focus/disposal, accessibility, and stall probes pass.
- [ ] Malformed composition, disposed-target event, missing accessibility node, and stale-generation work fail closed.
- [ ] Headless result labels platform evidence honestly; iOS/Android device coverage is `NOT EXERCISED`.
- [ ] Existing `bun run verify` remains green.
- [ ] `bun run verify:probe` executes all candidate runners and propagates assertion/compiler failures.
- [ ] Replay command and exact source/evidence provenance are recorded.
- [ ] ADR-0005 remains open; results feed TN-009 rather than silently selecting an engine.

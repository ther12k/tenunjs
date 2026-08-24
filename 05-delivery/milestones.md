---
okf_version: 0.2
title: "Milestone Exit Criteria"
summary: "Required evidence and closure conditions for each delivery milestone."
type: plan
status: accepted
---

# Milestone exit criteria

## M0

- Both native-language candidates implement the same iOS/Android slice.
- Both JavaScript runtime candidates execute the same workload.
- Both layout candidates run the same conformance corpus.
- Decisions include total-cost scorecards, not benchmark-only conclusions.
- No foundational selection remains implicit.

## M1

- One verified TSX bundle launches on physical iOS and Android devices.
- Bundle/runtime/protocol mismatch fails before application execution.
- Intentional JS and native failures produce attributable source/symbol evidence.

## M2

- Mutation buffers are validated and atomically applied.
- Scene, layout, hit-test, display-list, and Skia paths pass headless and device tests.
- Surface loss and resource lifecycle have deterministic handling.

## M3

- One-file and split screens share one manifest/runtime path.
- Typed actions, async cancellation, navigation, restoration, and error boundaries work on both platforms.
- Reconciler traces are deterministic and replayable.

## M4

- Core screens can be built without platform-specific code.
- Text editing, focus, gestures, scrolling, lazy lists, and native animation pass physical-device journeys.
- Scroll and animation continue during the controlled JS stall.

## M5

- VoiceOver and TalkBack journeys pass for the core widget set.
- Native modules and platform views have generated, versioned contracts.
- Reusable iOS and Android artifacts assemble sample applications.

## M6

- CLI, fast refresh, source maps, test hosts, golden tests, fuzzing, security, benchmarks, memory, and diagnostics close.
- Public alpha artifacts have known limitations and rollback guidance.

## M7

- A real pilot exercises representative production journeys.
- Independent accessibility and performance gates close.
- Store-installable release candidates, compatibility policy, tutorials, and extension guides exist.
- Beta evidence is indexed and reproducible.

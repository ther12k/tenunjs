---
okf_version: 0.2
title: "Roadmap"
summary: "Ordered milestone plan from architecture gates through beta."
type: plan
status: accepted
---

# Roadmap

| Milestone | Name | Issues | Count | Exit outcome |
| --- | --- | --- | --- | --- |
| M0 | Architecture and technology gates | TN-001–TN-017 | 17 | Close product identity and select engine language, JS runtime, and layout backend with matched evidence. |
| M1 | Executable toolchain and mobile embedders | TN-018–TN-032 | 15 | Compile TSX and execute a verified application bundle inside iOS and Android hosts. |
| M2 | Native scene, layout, and Skia rendering | TN-033–TN-050 | 18 | Establish the validated transaction-to-frame path and deterministic headless engine. |
| M3 | TSX reconciliation, controllers, actions, and navigation | TN-051–TN-067 | 17 | Deliver the complete application programming model without React. |
| M4 | Core widgets, text input, scrolling, and animation | TN-068–TN-088 | 21 | Make ordinary mobile UI usable and responsive on both platforms. |
| M5 | Accessibility, native capabilities, and packaging | TN-089–TN-104 | 16 | Integrate platform semantics, modules, views, and reusable native artifacts. |
| M6 | Developer experience, hardening, and public alpha | TN-105–TN-118 | 14 | Ship the CLI, test stack, diagnostics, security, benchmarks, and alpha evidence. |
| M7 | Pilot, stabilization, and beta | TN-119–TN-130 | 12 | Validate the framework in a real application and freeze a credible beta surface. |

## Sequencing rule

Milestones are cumulative gates, not calendar promises. Work may begin in parallel only when its issue dependencies are closed and its interfaces are stable enough to avoid speculative rework.

## Critical path

```text
M0 language/runtime/layout decisions
  → M1 executable mobile host
  → M2 atomic scene-to-Skia frame
  → M3 TSX/controller application model
  → M4 usable mobile widgets and interaction
  → M5 accessible packaged foundation
  → M6 public alpha
  → M7 real pilot and beta
```

## Current sequencing overlay (2026-10, contracts-first)

The 2026-10-02 VOTOL consumer feedback
([record](../08-validation/votol-consumer-feedback-2026-10-02.md))
showed the roadmap's engine-difficulty ordering loses real apps before
the engine work matters: the first companion app fell off the framework
at the dev-loop and capability seams, not at rendering. The critical
path above stays the formal spine; this overlay governs what may run
ahead of it while the M0 selection gates remain blocked (ADR-0022,
partially unblocked by ADR-0023):

1. **The dev loop must prove the real route** — a TSX-compiled example
   bundle boots in the Android QuickJS host in CI (TN-144, landed).
   A gate that proves the embedder with a hand-authored scene proves
   the wrong thing.
2. **Contracts before polish** — capability seams (TN-141, landed:
   `@tenunjs/platform`), the host-to-runtime push channel (TN-142,
   landed), and semantic theme tokens (TN-143, open) freeze before the
   widget layer is declared stable; retrofitting seams after apps ship
   is what the consumer record documents.
3. **P1 Android correctness alongside** — TN-135 (OTA apply vs Activity
   destruction) and TN-136 (bounded bundle evaluation) proceed as
   embedder hardening independent of the M-gates.

Rule of application: overlay items must still declare their issue
dependencies and land through the normal gate discipline; the overlay
changes ORDER, not rigor. No overlay item may close an M-gate or
conclude a selection.

## Scope discipline

No desktop, web, React compatibility, plugin marketplace, or full Material catalogue work enters the critical path before TN-130. Experimental branches may exist, but they cannot change core contracts without an ADR and gate impact analysis.

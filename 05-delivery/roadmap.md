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

## Scope discipline

No desktop, web, React compatibility, plugin marketplace, or full Material catalogue work enters the critical path before TN-130. Experimental branches may exist, but they cannot change core contracts without an ADR and gate impact analysis.

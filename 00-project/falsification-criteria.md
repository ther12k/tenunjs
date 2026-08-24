---
okf_version: 0.2
title: "Falsification Criteria"
summary: "Conditions that would invalidate or materially narrow the TenunJS hypothesis."
type: concept
status: accepted
---

# Falsification criteria

The project should stop, narrow scope, or change architecture if evidence shows any of the following:

- A basic production-style screen cannot maintain acceptable frame pacing on representative mid-range devices.
- Native text input cannot be made reliable without replacing the proposed tree or event architecture.
- VoiceOver or TalkBack navigation requires an incompatible second widget system.
- The embedded JavaScript runtime creates startup or memory costs that erase the intended simplicity advantage.
- Engine development requires repeated duplication across iOS and Android rather than shared native core plus thin embedders.
- A C++ or Rust engine choice cannot support reproducible builds and actionable crash symbols for ordinary contributors.
- The framework needs React semantics to make its own controller/action model usable.
- Pilot teams consistently bypass widgets and write platform-specific screens for ordinary UI.
- Framework maintenance cost exceeds the value compared with established alternatives for the target workloads.

A falsification result is useful. It prevents a multi-year engine project from surviving only because prior effort has already been spent.

---
okf_version: 0.2
title: "Risk Register"
summary: "Material technical, product, and delivery risks with mitigations and triggers."
type: plan
status: accepted
---

# Risk register

| Risk | Probability | Impact | Mitigation | Trigger/action |
|---|---:|---:|---|---|
| Engine becomes a multi-year platform project | High | Critical | Strict mobile workload scope; falsification criteria; milestone gates | Stop feature growth when a gate lacks evidence |
| C++ integration wins initially but maintenance/safety cost grows | Medium | High | Sanitizers, RAII, fuzzing, code ownership, retained adapter boundary | Reopen ADR-0005 with measured defect/build data |
| Rust bindings/toolchain create opaque mobile failures | Medium | High | Matched spike, symbol test, clean-build CI, binding minimization | Select C++ or narrow Rust boundary |
| JS runtime lacks required debugger/source-map quality | Medium | High | Runtime bake-off includes diagnostics and interruption | Reject candidate despite startup advantage |
| Text input/IME is unreliable | High | Critical | Start before widget polish; physical-device composition corpus | Block alpha and revisit edit-session architecture |
| Accessibility added too late | Medium | Critical | Semantics model in scene foundation; release-blocking tests | Block M5/M6 gates |
| Platform views break composition or input | Medium | High | Explicit limitations, reference adapters, z-order tests | Document unsupported transforms or redesign composition |
| JS reconciliation causes large transactions | Medium | High | Diagnostics, lazy lists, keyed identity, representative benchmarks | Add static/native optimization only with profiling |
| Skia binary/build size slows development | High | Medium | Prebuilt engine artifacts and caching | Rework artifact distribution before alpha |
| API imitates Flutter too literally | Medium | Medium | Borrow vocabulary, not BuildContext/render-object semantics | API review removes copied complexity |
| Framework duplicates React accidentally | Medium | High | No general hooks; controller/action principles | Require ADR for any state primitive |
| Pilot workload is too easy | Medium | High | Select forms, lists, IME, accessibility, platform view, offline errors | Reject pilot that cannot falsify architecture |

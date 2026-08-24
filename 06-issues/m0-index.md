---
okf_version: 0.2
title: "M0: Architecture and technology gates"
summary: "Close product identity and select engine language, JS runtime, and layout backend with matched evidence."
type: index
status: accepted
---

# M0 — Architecture and technology gates

Close product identity and select engine language, JS runtime, and layout backend with matched evidence.

| Issue | Priority | Dependencies | Required outcome |
| --- | --- | --- | --- |
| [TN-001](tn-001-clear-product-name-package-scope-and-repository-identity.md) | P0 | — | Recorded fail-closed availability evidence and final canonical naming for TenunJS. |
| [TN-002](tn-002-freeze-product-charter-target-workload-and-non-goals.md) | P0 | TN-001 | Accepted charter that prevents HTML/web, React compatibility, and premature desktop scope from entering v0.x. |
| [TN-003](tn-003-define-supported-ios-and-android-baseline-matrix.md) | P0 | TN-002 | Explicit OS, CPU, GPU API, device, Xcode, Android Gradle, and NDK support matrix. |
| [TN-004](tn-004-create-monorepo-skeleton-licensing-ownership-and-contribution-rules.md) | P0 | TN-001, TN-002 | Buildable empty workspace with ownership and legal metadata. |
| [TN-005](tn-005-create-architecture-spike-benchmark-and-evidence-harness.md) | P0 | TN-003, TN-004 | Matched harness that records source, build, device, timing, memory, symbols, and reproducibility evidence. |
| [TN-006](tn-006-freeze-the-minimal-native-engine-and-embedder-spike-contract.md) | P0 | TN-002, TN-003 | One exact vertical-slice contract shared by all engine-language candidates. |
| [TN-007](tn-007-implement-c-20-ios-and-android-skia-vertical-slice.md) | P0 | TN-005, TN-006 | C++ candidate renders TSX-driven text/button, handles touch, and produces symbolized device evidence. |
| [TN-008](tn-008-implement-rust-ios-and-android-skia-vertical-slice.md) | P0 | TN-005, TN-006 | Rust candidate implements the identical vertical slice and evidence packet. |
| [TN-009](tn-009-score-and-select-the-initial-native-engine-language.md) | P0 | TN-007, TN-008 | Accepted ADR with weighted scorecard, risks, rollback path, and selected initial toolchain. |
| [TN-010](tn-010-freeze-the-javascript-runtime-host-adapter.md) | P0 | TN-006 | Runtime-neutral host interface, test fixtures, interruption rules, and bundle contract. |
| [TN-011](tn-011-implement-quickjs-ng-runtime-spike.md) | P0 | TN-005, TN-010 | QuickJS-NG candidate passes representative startup, event, microtask, host-call, and diagnostics tests. |
| [TN-012](tn-012-implement-hermes-runtime-spike.md) | P0 | TN-005, TN-010 | Hermes candidate passes the same runtime workload and evidence requirements. |
| [TN-013](tn-013-select-the-initial-embedded-javascript-runtime.md) | P0 | TN-011, TN-012 | Accepted runtime ADR and compatibility envelope without leaking runtime-specific APIs. |
| [TN-014](tn-014-freeze-the-layout-backend-adapter-and-conformance-corpus.md) | P0 | TN-006 | Renderer-neutral layout API and fixture corpus shared by candidates. |
| [TN-015](tn-015-implement-yoga-layout-spike.md) | P0 | TN-005, TN-014 | Yoga candidate passes layout, intrinsic measurement, incremental update, and toolchain tests. |
| [TN-016](tn-016-implement-taffy-layout-spike.md) | P0 | TN-005, TN-014 | Taffy candidate passes the identical layout and integration tests. |
| [TN-017](tn-017-select-the-initial-layout-backend-and-close-m0.md) | P0 | TN-009, TN-013, TN-015, TN-016 | Accepted layout decision and complete M0 architecture packet with no unresolved foundational choice. |

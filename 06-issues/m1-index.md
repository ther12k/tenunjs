---
okf_version: 0.2
title: "M1: Executable toolchain and mobile embedders"
summary: "Compile TSX and execute a verified application bundle inside iOS and Android hosts."
type: index
status: accepted
---

# M1 — Executable toolchain and mobile embedders

Compile TSX and execute a verified application bundle inside iOS and Android hosts.

| Issue | Priority | Dependencies | Required outcome |
| --- | --- | --- | --- |
| [TN-018](tn-018-create-selected-native-engine-build-workspace.md) | P0 | TN-017 | Selected toolchain builds shared core and empty renderer artifacts reproducibly. |
| [TN-019](tn-019-create-typescript-package-workspace-and-strict-configuration.md) | P0 | TN-004, TN-017 | Publishable package skeleton with strict type checking and dependency boundaries. |
| [TN-020](tn-020-implement-custom-jsx-jsxs-fragment-runtime.md) | P0 | TN-019 | React-independent TSX transforms produce validated widget descriptions. |
| [TN-021](tn-021-implement-project-configuration-schema-and-loader.md) | P1 | TN-019 | Typed fail-closed application configuration with diagnostics and defaults. |
| [TN-022](tn-022-implement-module-graph-and-asset-manifest-builder.md) | P0 | TN-019, TN-021 | Deterministic application graph with assets, screens, capabilities, hashes, and source maps. |
| [TN-023](tn-023-implement-runtime-compatible-bundle-or-bytecode-compiler.md) | P0 | TN-013, TN-020, TN-022 | Executable verified artifact for the selected embedded runtime. |
| [TN-024](tn-024-implement-native-runtime-host-lifecycle.md) | P0 | TN-013, TN-018 | Create/load/invoke/interrupt/drain/dispose lifecycle with deterministic ownership. |
| [TN-025](tn-025-implement-bounded-host-value-and-callback-abi.md) | P0 | TN-018, TN-024 | Typed value codec and callback handles without arbitrary pointers or JSON-per-property traffic. |
| [TN-026](tn-026-implement-ios-application-embedder-shell.md) | P0 | TN-003, TN-018 | UIKit/Swift application launches, owns surface lifecycle, and hosts the selected engine. |
| [TN-027](tn-027-implement-android-application-embedder-shell.md) | P0 | TN-003, TN-018 | Kotlin application launches, owns surface lifecycle, and hosts the selected engine. |
| [TN-028](tn-028-load-and-execute-a-verified-application-bundle-on-ios.md) | P0 | TN-023, TN-024, TN-025, TN-026 | Physical iOS device executes a signed/hashed bundle entrypoint and reports source-mapped errors. |
| [TN-029](tn-029-load-and-execute-a-verified-application-bundle-on-android.md) | P0 | TN-023, TN-024, TN-025, TN-027 | Physical Android device executes the same application artifact contract. |
| [TN-030](tn-030-implement-cross-layer-structured-error-codes-and-crash-boundaries.md) | P0 | TN-024, TN-028, TN-029 | Application, runtime, engine, renderer, and embedder failures are attributable and symbolized. |
| [TN-031](tn-031-implement-unified-development-log-transport.md) | P1 | TN-028, TN-029, TN-030 | CLI receives ordered JS, engine, renderer, and platform logs with source ownership. |
| [TN-032](tn-032-close-the-executable-runtime-and-embedder-gate.md) | P0 | TN-020, TN-028, TN-029, TN-030, TN-031 | One TSX bundle runs deterministically on physical iOS and Android with reproducible evidence. |

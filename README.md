---
okf_version: 0.2
title: "TenunJS Native Skia Design Pack v0.2"
summary: "Repository-ready OKF design, decisions, roadmap, and agent-sized tasks for a TSX mobile framework rendered by Skia."
type: index
status: accepted
---

# TenunJS

> **Write TSX. Render native.**

TenunJS is a new mobile-native UI framework. Application teams write TypeScript and TSX using a compact, Flutter-inspired widget vocabulary. A native engine owns layout, text, input, accessibility, animation, scrolling, scene management, and Skia rendering on iOS and Android.

> **Project status — framework research, not a product dependency.** TenunJS
> cannot build and ship a real application today. The API examples in this
> pack (including the [complete example app](04-api/counter-app-example.md))
> are **intended API previews**, not quickstarts: the executable application
> model lands in M3, the usable widget layer in M4, and M0 is still selecting
> the engine language, JavaScript runtime, and layout backend. There is no
> package ecosystem yet, and performance/smoothness claims are architectural
> goals awaiting physical-device evidence — see
> [Positioning vs React Native, Flutter, NativeScript, and Capacitor](02-architecture/framework-positioning.md).
>
> What is *executed* today is narrow and experimental: an Android embedder
> foundation (`embedders/android/`) runs a limited JavaScript-driven
> reference application — two text fields, an add button, an entry list —
> installed and operated on a KVM-backed Android 11 emulator as a CI gate
> (`verify-android-device`), with QuickJS executing the application bundle,
> Unicode/quote text round-tripping through the production JNI path under
> CheckJNI, real soft-keyboard input, and a JavaScript-only customization
> observed on screen. The `verify:android` engine loop also boots a
> TSX-compiled example bundle (the counter sample through the public
> host-handoff contract) in the same vendored QuickJS
> ([TN-144](06-issues/tn-144-run-a-tsx-compiled-example-bundle-in-the-android-quickjs-host.md)),
> though the packaged APK still boots the hand-authored reference app. A
> physical Android phone participates in the development loop
> ([ADR-0023](03-decisions/adr-0023-android-device-unblocks-android-half-evidence.md)),
> but no governed device evidence has been captured from it yet. Screen
> readers, animation/scrolling, and iOS remain unimplemented or
> unexercised; see
> [TN-132](06-issues/tn-132-installed-android-run-acceptance.md) for the
> exact evidence boundary.


This v0.2 pack **supersedes the HTML/hypermedia assumptions in v0.1**. TenunJS is not Bundar, is not a Bundar plugin, and does not use HTML or the DOM as its mobile rendering contract.

## Fixed product choices

- Application code is TypeScript + TSX.
- The framework ships a custom JSX runtime and does not require React.
- Skia is the mandatory renderer for the v0.x mobile architecture.
- iOS and Android are the first platforms.
- Swift and Kotlin thin embedders integrate platform lifecycle, IME, accessibility, and native views.
- The native engine implementation language is **not predetermined**. A matched C++ versus Rust vertical-slice gate chooses the initial engine implementation based on total development cost.
- The JavaScript runtime and layout engine are similarly adapter-backed and evidence-gated.
- The interaction model is action-driven: native event → typed controller action → state transaction → bounded TSX reconciliation → atomic native commit.
- Scrolling and active animations remain native-side and must continue when JavaScript is busy.

## Start here

1. [Project definition](00-project/product-definition.md)
2. [System architecture](02-architecture/system-overview.md)
3. [Language decision gate](03-decisions/adr-0005-engine-language-evidence-gate.md)
4. [Source organization](02-architecture/source-organization.md)
5. [Roadmap](05-delivery/roadmap.md)
6. [Dependency graph](05-delivery/dependency-graph.md)
7. [Issue index](06-issues/index.md)
8. [Agent execution protocol](07-agent/agent-execution-protocol.md)

## Driving development with an AI agent

Paste the prompt below into any coding agent to get protocol-correct work out
of the box. It is a compressed form of the [agent execution
protocol](07-agent/agent-execution-protocol.md); the chosen issue file and
that protocol remain authoritative when they disagree with this summary.

```text
You are implementing ONE task in TenunJS (github.com/ther12k/tenunjs): a TSX
mobile UI framework that renders NATIVELY — no React, no DOM, no WebView.
Application code is TypeScript/TSX (custom JSX runtime) executing on embedded
QuickJS; the Android embedder (embedders/android) paints a display-list scene
on a SurfaceView and injects native services (BLE, system) through the JNI
Host Service Bridge.

WORKING AGREEMENT
1. Pick exactly ONE task: an issue file in 06-issues/ with `status: ready`,
   or a defect the user names. The issue file is the authoritative scope —
   read it fully, including dependencies and the required outcome.
   One issue = one branch = one PR.
2. Branch from fresh `main` as feat/tn-<id>-<slug> or fix/tn-<id>-<slug>,
   in a dedicated git worktree.
3. Run the narrow baseline tests BEFORE editing; record pre-existing failures.
4. Implement the smallest complete vertical slice. Architecture invariants:
   - packages/* are strictly acyclic; TypeScript strict; zero React/DOM/web
     assumptions (ADR-0003).
   - Bundles are QuickJS-safe: no Web APIs at eval time (no fetch,
     AbortController, localStorage); async/timers arrive via host services.
   - App logic = typed actions + state + display-list scene (the
     packages/widgets host-handoff contract). The native side only paints
     and dispatches.
   - Fail closed and fail visible: a broken bundle or dispatch is never
     silently replaced by a fallback.
   - Never expose engine internals (C++/Rust/QuickJS/Skia types) through
     application APIs.
5. Tests travel with the change: bun test for TS, JVM tests for Kotlin-pure
   logic, src/test/cpp/test_engine_loop.c for the native bridge, bundle-level
   checks for example apps. Never weaken a test to make a patch pass.
6. Verification gates before pushing (all must pass):
   - bun run verify:ts
   - ./embedders/android/run_android_test.sh       (needs the Android SDK)
   - python3 .github/scripts/verify-manifest.py    (MANDATORY when any
     governed Markdown 00-*/…/08-* or README.md changed: recompute that
     file's SHA-256 row in 08-validation/MANIFEST.md from the actual bytes —
     never hand-write a hash)
   - cargo test in spikes/runtime/quickjs-candidate (if you touched it)
7. Push, open a PR, and require ALL CI jobs green (.github/workflows/ci.yml).
   After merge: delete the branch; if the task closes the issue, add a dated
   Status note to the issue file and recompute its manifest row in a small
   follow-up docs PR (verify-manifest enforces both).

HARD PROHIBITIONS
- No unrelated issues, refactors, or formatting churn in one PR.
- No emulator evidence reported as physical-device evidence.
- No claim of future work as current completion. Match the honesty of the
  project status block above: state what is executed, what is prototype,
  and what is unimplemented.
- If blocked, return BLOCKED with the exact missing dependency, a minimal
  reproduction, and why no local workaround preserves the invariant.

READ DEEPER ONLY WHERE YOUR TASK CROSSES
- 07-agent/agent-execution-protocol.md      full protocol + hard prohibitions
- 07-agent/single-issue-prompt.md           per-issue prompt template
- packages/README.md                        package topology and contracts
- 02-architecture/system-overview.md        runtime architecture
- embedders/android/README.md               embedder, hot reload, OTA
- 06-issues/index.md                        the task queue
```

## Bundle shape

```text
00-project/       Product definition, scope, principles, terminology
01-requirements/  Functional and quality requirements
02-architecture/  Runtime, engine, rendering, platform, and source design
03-decisions/     Architecture decision records
04-api/           Concrete TSX and controller examples
05-delivery/      Roadmap, milestones, gates, risks, dependencies
06-issues/        One agent-sized Markdown task per implementation issue
07-agent/         Low-context prompts and evidence rules
08-validation/    Bundle validation and generated reports
```

## Core repository target

```text
tenun/
├── packages/
│   ├── core/
│   ├── jsx-runtime/
│   ├── widgets/
│   ├── navigation/
│   ├── native-modules/
│   ├── cli/
│   └── testing/
├── engine/
│   ├── core/
│   ├── renderer-skia/
│   ├── runtime-host/
│   └── layout/
├── embedders/
│   ├── ios/
│   └── android/
├── examples/
├── benchmarks/
└── docs/
```

The package scope, repository owner, domains, and trademark availability remain fail-closed until TN-001 records evidence.

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

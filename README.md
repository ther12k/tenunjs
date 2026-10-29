---
okf_version: 0.2
title: "TenunJS Native Skia Design Pack v0.2"
summary: "Flutter-inspired framework for building native applications in TypeScript — positioning, design pack, decisions, roadmap, and agent-sized tasks."
type: index
status: accepted
---

# TenunJS

> **Flutter-style development, written in TypeScript and TSX.**

TenunJS is an experimental framework for building native mobile applications
with composable widgets, typed application state, and a familiar TypeScript
workflow.

Describe your interface in TSX using widgets such as `Scaffold`, `Row`,
`Column`, `Text`, and `Button`. Build reusable components, connect application
behavior through typed actions, and organize your application around a
consistent widget model.

TenunJS is being developed around a shared native UI engine for Android and
iOS, with Skia as its planned mobile rendering backend. The framework is
designed to own layout, rendering, interaction, and platform integration.

> **Development status** — the current Android prototype executes application
> bundles in embedded QuickJS and renders through Android Canvas. The shared
> native Skia backend and iOS implementation are planned. APIs and tooling
> remain experimental — see [Implementation status](#implementation-status-and-roadmap)
> and [framework positioning](02-architecture/framework-positioning.md) for
> the exact evidence boundary.

## A first screen

```tsx
// examples/counter — a complete screen
<Scaffold appBar={<AppBar title="Counter" />}>
  <Column padding="lg" gap="lg" align="center">
    <Card padding="lg" radius="lg" background="surfaceRaised">
      <Text variant="display">{state.count}</Text>
    </Card>

    <Row gap="md">
      <Button variant="secondary" onPress={actions.decrement}>Decrease</Button>
      <Button onPress={actions.increment}>Increase</Button>
    </Row>
  </Column>
</Scaffold>
```

`view({ state, actions })` is the replacement for `setState`: typed actions
mutate controller state, the runtime re-renders, and the next scene commits
atomically. The same widget code runs in the browser preview host and in the
Android embedder's embedded QuickJS.

## Why TenunJS

- **Flutter-inspired composition.** Screens are trees of composable widgets
  with an explicit layout vocabulary (`Column`, `Row`, `Stack`, `Expanded`,
  `Positioned`), a coherent set of layout, content, interaction, theme, and
  navigation widgets, and `CanvasBox` as the custom-drawing escape hatch.
  Coming from Flutter? The [migration guide](04-api/flutter-migration.md)
  maps the vocabulary almost name-for-name.
- **TypeScript authoring.** Typed state and typed actions instead of
  `setState` and hook rules; strict TypeScript end to end; TSX without React
  — the framework ships its own JSX runtime.
- **One framework owns the UI.** A shared rendering model designed for
  consistent layout and visuals on every platform, with the framework — not
  an assortment of platform controls — defining how ordinary widgets behave.
  React independence and the absence of a WebView are supporting
  architectural facts, not the pitch.

## Try the current prototype

```sh
bun install
bun run gallery:preview    # the widget gallery in the browser preview host
bun run polytron:preview   # the Polytron Wash BLE companion app (dev server)
```

The Android embedder executes the same TSX-compiled bundles natively — no
WebView:

```sh
cd embedders/android
./gradlew :app:assembleDebug
```

### The headline demo — Day Plan

[Day Plan](examples/framework-feel/README.md) is the end-to-end
framework-feel application ([TN-155](06-issues/tn-155-framework-feel-milestone-app.md)):
two screens of ordinary TSX widgets with bounded nested layout under
resize, an editable title through the real input path, an independently
scrolling checklist, host-evaluated route transitions, runtime light/dark
theme switching, and one custom-drawn progress ring — one codebase
running unchanged in the browser host, the Android embedder's QuickJS,
and the CI device gate.

```sh
# Browser: build the shared bundle and serve the repository root
bun examples/framework-feel/scripts/build-host.ts \
  examples/framework-feel/.out/framework-feel-app.js
python3 -m http.server 8898 --bind 127.0.0.1
# open http://127.0.0.1:8898/examples/gallery-preview/host.html?bundle=/examples/framework-feel/.out/framework-feel-app.js
```

CI proves the same bytes on Android: the engine-loop gate replays the
identical action script in real QuickJS and compares scenes
structurally, and the device gate's `FrameworkFeelJourneyTest` boots the
same compiled bundle and drives the full journey — taps, the route
transition, the theme toggle, title editing through the InputConnection,
and checklist scrolling — through real `MotionEvent`s on the production
surface.

## How the framework is designed

```text
TypeScript / TSX application
            │
     custom JSX runtime (no React)
            │
  controller + typed actions + reconciler
            │
   display-list scene (versioned contract)
            │
  native widget/scene engine (planned)
     ├── layout        ├── text + input
     ├── focus + gestures ├── semantics
     ├── scroll + animation └── resources
            │
           Skia (planned mobile backend)
            │
     iOS and Android embedders
```

Fixed product choices:

- Application code is TypeScript + TSX; the framework ships a custom JSX
  runtime and does not require React.
- The interaction model is action-driven: native event → typed controller
  action → state transaction → bounded TSX reconciliation → atomic native
  commit.
- Scrolling and active animations remain native-side and must continue when
  JavaScript is busy.
- Skia is the mandatory renderer for the v0.x mobile architecture; the engine
  implementation language, JavaScript runtime, and layout backend are
  adapter-backed and evidence-gated.
- Fail closed and fail visible: a broken bundle or dispatch is never silently
  replaced by a fallback.

Start here:

1. [Project definition](00-project/product-definition.md)
2. [System architecture](02-architecture/system-overview.md)
3. [Language decision gate](03-decisions/adr-0005-engine-language-evidence-gate.md)
4. [Source organization](02-architecture/source-organization.md)
5. [Roadmap](05-delivery/roadmap.md)
6. [Dependency graph](05-delivery/dependency-graph.md)
7. [Issue index](06-issues/index.md)
8. [Agent execution protocol](07-agent/agent-execution-protocol.md)

## Implementation status and roadmap

TenunJS is framework research in active development, not a product
dependency. What executes today: TSX-compiled application bundles boot in
the vendored QuickJS inside the Android embedder (`verify:android` CI gate),
render through the native display-list painter on Android Canvas, dispatch
tap/long-press gestures from `MotionEvent`s, and talk to real hardware — the
[Polytron Wash](examples/polytron/README.md) companion app drives a BLE GATT
washer controller entirely from TSX with no WebView. The framework-feel
milestone is delivered: [Day Plan](examples/framework-feel/README.md)
([TN-155](06-issues/tn-155-framework-feel-milestone-app.md)) demonstrates
the promised experience end to end on every available host — see
"The headline demo" above. The full planned stack —
shared C++/Rust engine, direct Skia rendering, iOS embedder, complete widget
layer — is tracked through the [milestones](05-delivery/milestones.md) and
the [current sequencing overlay](05-delivery/roadmap.md). Exact
capabilities and evidence boundaries:
[framework positioning](02-architecture/framework-positioning.md),
[TN-132](06-issues/tn-132-installed-android-run-acceptance.md).

This v0.2 pack **supersedes the HTML/hypermedia assumptions in v0.1**.
TenunJS is not Bundar, is not a Bundar plugin, and does not use HTML or the
DOM as its mobile rendering contract.

## Documentation and contributing

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

The package scope, repository owner, domains, and trademark availability
remain fail-closed until TN-001 records evidence. Contributions follow
[CONTRIBUTING.md](CONTRIBUTING.md) and the repository's verification gates
(`bun run verify`).

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

## Driving development with an AI agent

Paste the prompt below into any coding agent to get protocol-correct work out
of the box. It is a compressed form of the [agent execution
protocol](07-agent/agent-execution-protocol.md); the chosen issue file and
that protocol remain authoritative when they disagree with this summary.

```text
You are implementing ONE task in TenunJS (github.com/ther12k/tenunjs): a
Flutter-inspired framework for building native applications in TypeScript,
with TSX for declaring UI — no React, no DOM, no WebView. Application code is
TypeScript/TSX (custom JSX runtime) executing on embedded QuickJS; the
Android embedder (embedders/android) paints a display-list scene on a
SurfaceView and injects native services (BLE, system) through the JNI Host
Service Bridge.

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
  development-status note above: state what is executed, what is prototype,
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

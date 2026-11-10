# AGENTS.md — TenunJS monorepo

Flutter-inspired framework for native mobile apps written in TypeScript/TSX.
Custom JSX runtime (no React, no DOM, no WebView); app bundles execute on
embedded QuickJS inside the Android embedder, which paints a display-list
scene on a SurfaceView. Repo: github.com/ther12k/tenunjs (MIT).

## Layout

- `packages/` — TS framework packages (`protocol`, `platform`, `jsx-runtime`,
  `core`, `widgets`, `navigation`, `cli`); strictly acyclic, TS strict.
- `embedders/android/` — Kotlin embedder, JNI Host Service Bridge, device
  test scripts. `embedders/ios/` is planned.
- `engine/`, `spikes/`, `benchmarks/` — Rust/native engine work and evidence
  spikes (`spikes/vendor` is vendored yoga; never import from it).
- `examples/` — sample apps (polytron, votol, framework-feel, workout-pilot…).
- `00-project/` … `08-validation/` — governed design-pack docs: product,
  requirements, architecture, ADRs, API examples, delivery, issues, agent
  protocol, validation. `06-issues/tn-NNN-*.md` files are the task queue.

## Commands (Bun only — `bun@1.4.0` pinned; never npm/yarn)

- `bun install`
- `bun run verify:ts` — canonical TS gate: frozen install + `tsc --noEmit`
  (5 project configs) + `bun test`.
- Focused: `bun test <file-or-dir>`, `bun run typecheck`.
- `bun run verify:manifest` — **run after editing ANY governed Markdown**
  (every `.md` under `00-`–`08-` dirs or `references/`, plus `README.md`,
  `index.md`, `log.md`, `CONTRIBUTING.md`): recompute that file's SHA-256 row
  in `08-validation/MANIFEST.md` from actual bytes — never hand-write hashes.
  This AGENTS.md is not governed.
- `bun run verify:android` — Android engine/device gates; needs Android SDK
  (`embedders/android/run_android_test.sh`).
- `bun run verify:rust` / `verify:abi` / `verify:probe` / `verify:evidence`
  — Rust, ABI drift, native probe, evidence-packet gates.
- `bun run verify` — all gates; CI (`.github/workflows/ci.yml`) requires green.
- Previews: `bun run gallery:preview`, `polytron:preview`, `votol:preview`.

## Architecture invariants (violations fail review)

- Zero React/DOM/HTML/web assumptions in the mobile core (ADR-0003).
- Bundles are QuickJS-safe: no Web APIs at eval time (no `fetch`,
  `AbortController`, `localStorage`); async/timers arrive via host services.
- App logic = typed actions + state + display-list scene; the native side
  only paints and dispatches.
- Fail closed and fail visible: a broken bundle or dispatch is never silently
  replaced by a fallback.
- Never expose engine internals (C++/Rust/QuickJS/Skia/Yoga/Taffy types)
  through application APIs.
- Bun is repository tooling only, never the embedded runtime (ADR-0018).

## Workflow

- One issue = one branch = one PR. Pick an issue in `06-issues/` with
  `status: ready`; the issue file is authoritative scope. Branch
  `feat/tn-<id>-<slug>` or `fix/tn-<id>-<slug>` from fresh `main`.
- Run the narrow baseline tests before editing; record pre-existing failures.
- Tests travel with the change: `bun test` for TS, JVM tests for Kotlin,
  `src/test/cpp/test_engine_loop.c` for the native bridge. Never weaken a
  test to make a patch pass.
- Issue `status:` vocabulary (`ready`/`in-progress`/`blocked`/`closed`) is
  enforced by the manifest gate; a closed issue needs a dated
  `## Status note` linking evidence.
- Honesty rule: never report emulator evidence as physical-device evidence,
  and never claim future work as current completion.
- If blocked, return `BLOCKED` with the exact missing dependency, a minimal
  reproduction, and why no local workaround preserves the invariants.

## Read before touching sensitive areas

- `07-agent/agent-execution-protocol.md` — full protocol + hard prohibitions
- `packages/README.md` — package topology and dependency contracts
- `02-architecture/system-overview.md` — runtime architecture
- `embedders/android/README.md` — embedder, hot reload, OTA
- `03-decisions/index.md` — ADR index (ADR-0021 charter freeze is enforceable)
- `06-issues/index.md` — task queue and dependency order

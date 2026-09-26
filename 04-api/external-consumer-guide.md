---
okf_version: 0.2
title: "External consumer guide"
summary: "Commands that actually work today for building a TenunJS application outside this monorepo, from packed package tarballs — including the exact boundaries where preview and Android paths stop."
type: guide
status: accepted
---

# External consumer guide (prototype stage)

This guide records a rehearsal performed on 2026-09-21 against baseline
`67bb67597d75ab99f0b88ad18369d816beadd51c`: a small task-list application
was created **outside the monorepo**, installed from packed package
tarballs, type-checked, and compiled through both automatic-JSX
transforms. The fixture lives at `consumers/tasks-app/`. Everything below
was executed twice in two clean directories with byte-identical output.

No package is published to any registry. `bun pm pack` produces private
tarballs; the pinned toolchain is bun 1.4.0 / TypeScript 7.0.2.

## What works today

### 1. Pack the packages (inside a pinned framework checkout)

```sh
git checkout 67bb67597d75ab99f0b88ad18369d816beadd51c
bun install --frozen-lockfile
mkdir -p /path/to/app/vendor
for p in protocol jsx-runtime core widgets navigation; do
  (cd packages/$p && bun pm pack)
done
mv packages/*/tenunjs-*.tgz /path/to/app/vendor/
```

`bun pm pack` rewrites the workspace `workspace:*` dependencies to
concrete versions (`0.1.0`) and preserves the `exports` map, including
both automatic-JSX subpaths.

### 2. Install the application (outside the monorepo)

The application has its own `package.json`, `bun.lock`, and
`tsconfig.json` (see the fixture). Two facts are load-bearing:

- **`resolutions` are required while packages are unpublished.** The
  packed tarballs depend on `@tenunjs/*` by registry version spec
  (`"0.1.0"`), and nothing exists on npm, so a plain install fails with
  `failed to resolve`. Pinning every `@tenunjs/*` package to its vendored
  tarball via the `resolutions` field resolves the whole tree locally.
  Once packages are published (TN-123 owns packaging policy), this field
  goes away.
- bun 1.4.0's `bun pm pack --pack-destination` is not honored; tarballs
  land in the package directory and must be moved by hand.
- bun 1.4.0's `bun build --tsconfig-override` prints a harmless
  "Internal error: directory mismatch" warning; the build completes and
  the transform choice is verified by the checks above.

```sh
cd /path/to/app
bun install
```

Dependency-set precision — what is local and what is not:

- **No registry-hosted TenunJS packages are needed.** The lockfile
  records all five `@tenunjs/*` packages as `file:vendor/…` tarball
  resolutions (that positive lockfile evidence is what the rehearsal
  script asserts).
- **The setup is not offline.** `typescript` and `@types/bun` (the
  toolchain) install from the npm registry, and bun's global package
  cache means two fresh application directories are not two empty-cache
  installation environments. The local-only claim covers the TenunJS
  package set, not the toolchain or cache state.

### 3. Author and compile

The fixture is a task-list-shaped authoring and compilation exercise,
deliberately input-less — it is not a functional task-entry application
(the public text-input widget is TN-079).

```sh
bun run typecheck      # tsc --noEmit, BOTH jsx: react-jsx and react-jsxdev
bun run build:app      # NODE_ENV=production bun build …  → jsx/jsxs from ./jsx-runtime
bun run build:app:dev  # bun build …                     → jsxDEV from ./jsx-dev-runtime
bun run check:runtimes # asserts jsx, jsxs, Fragment, jsxDEV are real functions
```

Type-checking and bundling are separate layers on purpose: bun's
bundler documentation states plainly that bundling does not replace
`tsc` type checking, so the rehearsal runs both.

Verified properties (this is packaging coverage for TN-020's dual
automatic-JSX entry points):

- TypeScript resolves the TS-source packages from `node_modules` under
  `moduleResolution: "bundler"` — including both subpath exports.
- **Behavior of the pinned bun 1.4.0 toolchain** (recorded so future
  callers need not rediscover it): the automatic JSX transform picks
  the **production** subpath when `NODE_ENV=production` (zero `jsxDEV`
  references in the output) and the **development** subpath otherwise
  (only `jsxDEV` references). That is why `build:app` sets the variable
  explicitly and the rehearsal script asserts the resulting output
  rather than trusting ambient environment.
- The production bundle is repeatable within the tested inputs: two
  independent pack → install → build runs with the pinned toolchain
  (bun 1.4.0, TypeScript 7.0.2, `react-jsx`, `NODE_ENV=production`)
  produced byte-identical `main.js`. This is repeatability across
  runs — not a claim across Bun versions, operating systems, or build
  configurations.

Application-only iteration was exercised: a label change ("Clear done" →
"Clear completed"), a layout change (root `Column gap` `md` → `lg`), and
an action change (a new `toggleAll` action wired to a new button) — all
inside `src/`, framework untouched, every check still green.

## Where the path stops today (recorded boundaries)

These are **not** defects fixed by this guide; each is an unfinished
subsystem with a designated owner. Do not work around them by importing
example files — that defeats the boundary this rehearsal tests. Do not
duplicate the example renderer inside a consumer fixture either: that
would make a rehearsal pass while preserving the underlying product gap.

| Missing capability (today) | Evidence | Owner |
|---|---|---|
| Resolve and package an **arbitrary external application entry** into a host-consumable artifact | `bundle-lib.ts:16` compiles a hard-coded gallery entry; `device-entry.ts:2` imports the example-private `GalleryRuntime` | TN-023 (runtime-compatible bundle/bytecode compiler, status: ready/not implemented) |
| Supply an external application to the **browser preview** (today a fixed shell with hard-wired screens) | `examples/gallery-preview/index.html:41` loads a fixed `./preview.js`; `runtime.ts` hard-wires the 16 gallery screens; no generic "load this app bundle" entry | TN-042 (renderer-neutral display list); its integration relationship to TN-023 should be made explicit when either is scheduled |
| Make the **runtime/lowering functionality available outside `examples/`** as a public contract — **partially closed**: the scene model + `layoutScreen` lowering are now public in `@tenunjs/widgets` (TN-133 extraction slice; this fixture's `scripts/produce-scene.ts` emits a host-consumable scene from tarballs only, digest-checked in CI). Still example-side: execution/orchestration (`GalleryRuntime`), snapshot restore, `runApp` host binding | lowering now public; execution/orchestration still lacks an owner-recorded public contract | TN-133 (owns the contract; the row shrinks as its slices land) |
| Public **text-input widget** | `packages/widgets/src/index.ts` exports no input widget; the rehearsal app is input-less like the monorepo's own todo-list example | TN-079 (text-field/form widgets) |

Consequence: an external app can currently be **installed, authored,
type-checked, and compiled** entirely from package artifacts, but it
cannot yet be previewed in a browser or packaged for the Android
prototype without importing monorepo example code. TN-023 **coordinates
the missing route** — it owns resolving and packaging an external entry —
but it does not absorb the preview, widget, or runtime-publicization
responsibilities, which stay with TN-042, TN-079, and a yet-unrecorded
public-contract decision respectively. Closing the gap means finishing
those owned pieces, not extending this guide or the fixture.

## Addendum — 2026-09-26: the runtime-publicization boundary closed (TN-133 slices 1+2)

The third boundary row above ("runtime/lowering functionality available
outside `examples/`") is now closed at the contract level, in two stacked
steps against this guide's recorded gaps:

1. **Lowering public** (slice 1, PR #211): the display-list scene model
   and `layoutScreen` moved verbatim into `@tenunjs/widgets`; this
   fixture's `produce-scene.ts` already consumes them from tarballs (see
   above), and the ui-kit module became a compatibility shim.
2. **Execution + host handoff public** (slice 2, stacked on #211):
   `@tenunjs/widgets` additionally owns `ApplicationRuntime` — the
   screen-session loop, host-verb dispatch, and `STATE_SCHEMA`-versioned
   snapshots, fail-closed on unknown screens/verbs/tap targets/snapshots
   and after dispose — plus `installHostHandoff`, the commit/dispatch
   adapter the Android bridge consumes. The Android device entry now
   composes the public contract; `runApp` in `@tenunjs/core` remains the
   minimal entry convenience and gains no host binding from this slice.

The consequence above narrows accordingly: an external app still cannot
be **packaged for the Android prototype or previewed in a browser**
without example code — those are TN-023 (arbitrary-entry packaging) and
TN-042 (preview shell integration), unchanged — but the execution and
lowering contract it will target is now public package API, and
`@tenunjs/widgets` declaring `@tenunjs/core` is part of that boundary
decision (the dependency policy map is updated with it).

## Reproducing the rehearsal

`.github/scripts/verify-consumer.sh` (run by the `verify-typescript` CI
gate) performs the whole loop from a clean checkout: pack the five
tarballs, scaffold the fixture into a fresh temporary directory, install,
type-check both JSX modes, build both transforms, run the runtime check,
and assert the fixture contains no repository-relative imports. The
committed fixture (`consumers/tasks-app/`) is the same code CI rehearses;
its `bun.lock` is committed and its `vendor/` tarballs are regenerated by
the script above.

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
bun install          # 11 packages, all local; zero registry entries for @tenunjs/*
```

### 3. Author and compile

```sh
bun run typecheck      # tsc --noEmit, BOTH jsx: react-jsx and react-jsxdev
bun run build:app      # NODE_ENV=production bun build …  → jsx/jsxs from ./jsx-runtime
bun run build:app:dev  # bun build …                     → jsxDEV from ./jsx-dev-runtime
bun run check:runtimes # asserts jsx, jsxs, Fragment, jsxDEV are real functions
```

Verified properties (this is packaging coverage for TN-020's dual
automatic-JSX entry points):

- TypeScript resolves the TS-source packages from `node_modules` under
  `moduleResolution: "bundler"` — including both subpath exports.
- bun's automatic JSX transform picks the **production** subpath when
  `NODE_ENV=production` (zero `jsxDEV` references in the output) and the
  **development** subpath otherwise (only `jsxDEV` references). Both
  subpaths resolve from the packed tarballs.
- The production bundle is deterministic: two independent
  pack → install → build runs produced byte-identical `main.js`.

Application-only iteration was exercised: a label change ("Clear done" →
"Clear completed"), a layout change (root `Column gap` `md` → `lg`), and
an action change (a new `toggleAll` action wired to a new button) — all
inside `src/`, framework untouched, every check still green.

## Where the path stops today (recorded boundaries)

These are **not** defects fixed by this guide; each is an unfinished
subsystem with a designated owner. Do not work around them by importing
example files — that defeats the boundary this rehearsal tests.

| Boundary | Evidence | Owner |
|---|---|---|
| No text-input widget in the public widget layer — the rehearsal app (like the monorepo's own `examples/todo-list`) is input-less by design | `packages/widgets/src/index.ts` exports no input widget; `examples/todo-list/src/screens/tasks.screen.tsx` records the same constraint | TN-079 (text-field/form widgets) |
| Browser preview cannot load an external application | `examples/gallery-preview/index.html:41` loads a fixed `./preview.js` shell; `examples/gallery-preview/runtime.ts` hard-wires the 16 gallery screens; there is no generic "load this app bundle" entry | TN-042 (renderer-neutral display list) / TN-023 |
| The Android device bundle path is gallery-specific | `embedders/android/tools/gallery-bundle/bundle-lib.ts:16` compiles a hard-coded device entry; `device-entry.ts:2` imports the example-private `GalleryRuntime`; the widget-tree → display-list lowering lives in `examples/ui-kit/src/display-list.ts`, not a package | TN-023 (runtime-compatible bundle compiler, status: ready/not implemented) |
| `runApp` does not yet bind a host | `packages/core/src/index.ts` — `runApp` returns an instance handle only; scene commit and dispatch are provided by the example runtimes | TN-023 / TN-024 |

Consequence: an external app can currently be **installed, authored,
type-checked, and compiled** entirely from package artifacts, but it
cannot yet be previewed in a browser or packaged for the Android
prototype without importing monorepo example code. Closing that gap
means finishing the owned subsystems above (most directly TN-023), not
extending this guide.

## Reproducing the rehearsal

`.github/scripts/verify-consumer.sh` (run by the `verify-typescript` CI
gate) performs the whole loop from a clean checkout: pack the five
tarballs, scaffold the fixture into a fresh temporary directory, install,
type-check both JSX modes, build both transforms, run the runtime check,
and assert the fixture contains no repository-relative imports. The
committed fixture (`consumers/tasks-app/`) is the same code CI rehearses;
its `bun.lock` is committed and its `vendor/` tarballs are regenerated by
the script above.

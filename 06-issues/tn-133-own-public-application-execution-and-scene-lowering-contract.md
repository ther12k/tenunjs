---
okf_version: 0.2
title: "TN-133: Own the public application execution and scene-lowering contract"
summary: "Define the authoritative public contract connecting an independently authored application to a host: entry, execution, virtual-tree-to-scene lowering, host handoff, and package ownership."
type: issue
status: ready
issue_id: "TN-133"
milestone: "M1"
priority: "P0"
depends_on:
  - "TN-020"
  - "TN-022"
---

# TN-133 — Own the public application execution and scene-lowering contract

## Metadata

| Field | Value |
|---|---|
| Milestone | M1 — Executable toolchain and mobile embedders |
| Priority | P0 |
| Dependencies | TN-020 (closed: JSX/virtual-tree contract), TN-022 (closed: graph/manifest contract) |
| Suggested size | One contract-definition PR; extraction PRs as decided |
| Gate impact | Blocks the external application → host route |

## Purpose

PR #205's external-consumer rehearsal proved that an independent app can
be installed, authored, type-checked, and compiled from package
artifacts — and that the path from that app to any host stops because
execution and scene-lowering live in repository-private example code
(`examples/ui-kit/src/display-list.ts`,
`examples/gallery-preview/runtime.ts`, `device-entry.ts`). PR #206
recorded the gap; this issue owns closing the **contract** side of it.

This issue does NOT implement a second runtime, does not move code by
default, and does not absorb TN-023 (packaging/integration
coordination), TN-042 (preview integration), or TN-079 (public text
input). It defines the boundary those responsibilities connect through,
and decides which existing implementation satisfies it.

## Required outcome

An accepted, versioned public contract — owned by a named package —
that answers, for an independently authored application:

| Boundary | Question the contract must answer |
|---|---|
| Application entry | What does an application export, using the existing public API (`defineScreen`, `defineRoutes`, `runApp`'s options), that a host can resolve from an arbitrary entry module? |
| Execution | Who initializes screens/controllers, holds the active route, and delivers actions to the application? |
| Lowering | Who turns the application's accepted virtual-tree output (TN-020's `WidgetNode`) into host-consumable scenes (today's display-list; TN-042's neutral form when it lands)? |
| Host handoff | How are scene compatibility, atomic publication, action dispatch, and errors represented across the boundary (commit + dispatch + fail-closed semantics, as the Android host already consumes)? |
| Package ownership | Which public package owns these functions, and which dependency edges are permitted (it must not depend on `examples/`, the CLI, or any host)? |

## Implementation sequence

1. Inventory the existing implementations against the five boundaries —
   `examples/gallery-preview/runtime.ts` (execution + dispatch +
   export/state), `examples/ui-kit/src/display-list.ts` (lowering),
   `device-entry.ts` (host-handoff adapter), `packages/core` `runApp`
   (entry shape today: instance handle, no host binding). Classify each
   behavior: becomes supported / stays example-specific / provisional.
2. Decide the contract's shape and home (extend `@tenunjs/core`, a new
   public package, or a subpath) with its dependency edges; record as an
   ADR if it changes package boundaries (TN-123 coordinates policy).
3. Specify errors, lifecycle (init, action, teardown), versioning, and
   fail-closed behavior at each boundary — mirroring the proven host
   contract (atomic scene commits, fail-closed unknown ops/actions).
4. Reuse, extract, or wrap existing working code — do not rewrite
   working lowering logic merely to relocate it, and do not export the
   entirety of `examples/` as permanent API.
5. Prove the contract with PR #205's consumer fixture as the first
   integration consumer: change a label and `toggleAll` behavior in
   application code, run through the contract, observe both changes in
   the browser preview — then the matching Android host — with no
   example-screen registration, no example-private imports, no manual
   APK asset surgery. (End-to-end execution additionally waits on
   TN-013's selection for the device path; the browser path does not.)
6. Negative tests at each boundary (unknown screen, malformed tree,
   incompatible scene version, action against a disposed runtime).

## Acceptance criteria

- [ ] The five boundary questions have single, documented answers owned
      by a named public package with declared dependency edges.
- [ ] An example implementation's behavior is explicitly classified
      (supported / example-specific / provisional) — nothing silently
      becomes public.
- [ ] The consumer fixture runs through the contract in the browser
      preview with application-only changes observed.
- [ ] Fail-closed behavior at each boundary is automated.
- [ ] TN-023, TN-042, and TN-079's responsibilities are connected, not
      erased; no dependency on TN-013's selection exists for the
      browser-side contract.

## Out of scope

- Runtime selection (TN-013/ADR-0007/ADR-0022), the bundle compiler
  (TN-023), preview shell integration (TN-042), text input (TN-079),
  reconciliation (TN-051/052), and any widget expansion.

## Ownership

Accountable maintainer: **the project owner** (to be confirmed on this
issue's acceptance — this file is created by the executor following the
TN-131/132 late-issue pattern; number and assignment take effect on
merge).

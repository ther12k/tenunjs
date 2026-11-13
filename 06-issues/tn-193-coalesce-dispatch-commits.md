---
okf_version: 0.2
title: "TN-193: Coalesce duplicate dispatch commits (TNP-006, current host)"
summary: "The host handoff committed out-of-band invalidations immediately AND again on the dispatch path: the standard two-screen Back press rendered and committed the same scene twice (a replay-heavy Back three times), and every pushState inside a TAP multiplied commits. One outer-dispatch invalidation/flush policy in installHostHandoff — invalidations inside a dispatch coalesce into a dispatch-end flush; outside a dispatch they commit immediately."
type: issue
status: ready
issue_id: "TN-193"
priority: "P1"
depends_on:
  - "TN-133"
---

# TN-193 — Coalesce duplicate dispatch commits

The narrow, current-host defect slice of TNP-006 (the plan defers the
broader scheduling work to TN-054). Reproduced before editing, per the
plan's own requirement.

## Purpose

A subscribed host handoff (`installHostHandoff` with an
`onStateInvalidation` application — the Android bridge's shape) commits
from two places: the invalidation subscription, and the explicit
dispatch-path commits (TAP/LONG-PRESS/TENUN_RESTORE/text input/BACK
handled). When one host dispatch ALSO invalidated out-of-band, both
fired:

- the standard two-screen Back press: `goBack()`'s reactivation
  `notifyStale` committed the popped route, then the handled-commit
  committed the identical scene again — two renders (each a full
  layoutScreen pass) and two native scene applies per Back press;
- a Back whose route reactivation replayed cached state channels:
  three commits for one press (channel replay + goBack + handled);
- a navigation inside a TAP: the channel-replay invalidation commit
  plus the dispatch-return commit (the documented TN-169 burst);
- every `pushState` inside a TAP action committed immediately, then
  the post-TAP commit painted the same state again.

Renders are the expensive part: each commit is a full `render()` —
view() plus layoutScreen. The waste scales with dispatch frequency,
not scene size, and every host (Android JNI `tenun_commit`, dev
drivers) pays it.

## Required outcome

1. One render and one commit for the standard two-screen Back
   dispatch through a subscribed handoff; a channel-replay Back
   commits once; a navigation inside a TAP commits once with the
   transition stamp riding that single commit (TN-169's observable
   contract — hosts that only see the dispatch's final scene still
   see the transition — is preserved, not weakened).
2. Supported synchronous state updates coalesce: state pushed inside
   a TAP action reaches the host in that TAP's single commit.
3. Out-of-band invalidation OUTSIDE a dispatch still commits
   immediately: async action settlement (the QuickJS host never
   drains jobs; browser and headless hosts do) and direct
   runtime-API callers (`goBack()`, `pushState()` without a host
   dispatch) are behaviorally unchanged.
4. Hosts without a subscribed handoff keep the
   commit-after-dispatch behavior; the BACK handled-commit still
   covers wrappers with no invalidation subscription (plan B2).
5. No global commit suppression: the policy lives at the dispatch
   boundary only — outside it, every invalidation still commits.

## Verification

- `packages/widgets/test/commit-coalescing.test.ts`: render/commit
  counters (a structural counting wrapper — also proof the policy
  holds for composed HandoffApplications). The three count pins fail
  on the pre-fix tree (Back 2 commits, replay-Back burst 4, pushState
  TAP 4) and pass after; the five preserved-behavior pins pass on
  both trees.
- Full existing suites green unchanged: route-transition (TN-169
  stamp), host-handoff (BACK negotiation, async settlement out-of-band,
  stale-text recovery), app-runtime, app-viewport, environment-handoff,
  text-input.

## Status note (2026-11-13, implemented on `feat/tnp-006-coalesce-commits`)

The fix lives entirely in `packages/widgets/src/host-handoff.ts` (one
outer-dispatch policy: an `inDispatch` depth plus a `stalePending`
flag — the subscription defers to the flag inside a dispatch, the
dispatch `finally` ends the transition burst first and then flushes
once; every `commit()` clears the flag, so explicit dispatch-path
commits satisfy the flush; the stale-text recovery republish clears it
too). `ApplicationRuntime` is untouched — its invalidation signal and
`endTransitionBurst` keep their semantics for direct callers; only the
TN-169 burst doc comment was rewritten to describe the coalesced
reality. Reproducer ran failing on the pre-fix tree before the edit
(the plan's "reproduce before editing" requirement). 874 bun tests
pass (8 new), typecheck clean. Merge evidence lands here at close.

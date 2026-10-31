---
okf_version: 0.2
title: "TN-187: Host ENVIRONMENT dispatch — device locale and font scale reach the runtime"
summary: "TN-068's inherited context was framework-side only; the device's locale and fontScale never reached a running bundle. This wires the ENVIRONMENT verb end to end — ApplicationRuntime.setEnvironment (partial, validate-then-apply, one commit per change), the handoff negotiation (UNKNOWN_ACTION = old bundle, the VIEWPORT precedent), and Android delivery on engine set, surface change, and live configuration changes — so a11y font-scale journeys re-layout the committed scene."
type: issue
status: closed
issue_id: "TN-187"
milestone: "M4"
priority: "P1"
depends_on:
  - "TN-068"
  - "TN-158"
---

# TN-187 — Host ENVIRONMENT dispatch

## Purpose

TN-068 delivered `locale`/`textScale`/`platform` as inherited widget
context with runtime setters — but only the framework side. Nothing on
Android read `Configuration.fontScale` or the device locale, so a user's
system font-scale change (the core accessibility journey TN-092/TN-112
must evidence) could not re-layout a committed scene.

## Required outcome

1. **Runtime**: `ApplicationRuntime.setEnvironment(environment)` — every
   field optional (absent keeps current), all present fields validate
   BEFORE any assignment (a malformed payload leaves the environment
   intact), one invalidation per actual change, never part of snapshots.
2. **Handoff verb**: `"ENVIRONMENT"` mirrors the TN-158 VIEWPORT
   discipline — bundles with `setEnvironment` apply it; bundles without
   fall through to `dispatch()` and surface UNKNOWN_ACTION, which hosts
   read as "stop delivering environment".
3. **Android delivery**: `TenunSurfaceView` delivers
   `{locale, textScale: fontScale, platform: "android"}` on engine set
   and surface change, and re-delivers on live configuration changes
   (manifest now declares `fontScale|locale|layoutDirection` so the view
   re-layouts in place instead of recreating). Duplicate environments
   commit nothing; refusals are logged once and not retried until an
   engine swap.
4. **Evidence hook**: `deliverEnvironmentForTest(locale, textScale)`
   drives the production delivery path (the gate cannot reconfigure the
   emulator's font scale mid-test).

## Verification

- `packages/widgets/test/environment-handoff.test.ts`: ENVIRONMENT
  re-renders under the new environment (text ops double at textScale 2),
  partial updates keep unmentioned fields, identical values commit
  nothing, malformed payloads fail visibly with the current environment
  intact, and a bundle without `setEnvironment` surfaces UNKNOWN_ACTION.
- `EnvironmentDispatchTest` (device gate): the real Day Plan bundle
  (ApplicationRuntime + installHostHandoff) re-lays out at exactly 2x
  text sizes after delivery, identical delivery is byte-stable, and a
  verb-less legacy bundle refuses visibly with the scene unchanged.
- 8/8 CI gates.

## Out of scope

- Physical-device font-scale/TalkBack journeys (TN-112's Android slice;
  this verb is the plumbing they exercise).
- High-contrast / reduced-motion policy (TN-092 owns).
- iOS equivalent (TN-090 track).

## Status note (2026-10-31, closed)

Implemented in PR #271: `setEnvironment` (partial, validate-then-apply,
one commit per change), the ENVIRONMENT handoff verb (VIEWPORT
negotiation discipline), and Android delivery on engine set, surface
change, and live configuration changes (manifest declares
fontScale|locale|layoutDirection). Device evidence: the real Day Plan
bundle re-lays out at exactly 2x text sizes and stays byte-stable on
identical delivery; a verb-less bundle refuses visibly. 8/8 CI gates on
the PR head.

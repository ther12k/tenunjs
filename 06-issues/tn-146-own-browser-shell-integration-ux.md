---
okf_version: 0.2
title: "TN-146: Own the browser-shell integration UX (route rail, hot reload, dev-server routes)"
summary: "TN-042's file is the M2 native renderer-neutral display list and excludes web — the browser-shell UX the consumer guide assigns to it has no owner. This issue owns it, and absorbs the recorded hot-reload poll defects."
type: issue
status: ready
issue_id: "TN-146"
milestone: "M6"
priority: "P2"
depends_on:
  - "TN-133"
---

# TN-146 — Own the browser-shell integration UX (route rail, hot reload, dev-server routes)

## Metadata

| Field | Value |
|---|---|
| Milestone | M6 — Tooling and quality infrastructure (integration-UX slice) |
| Priority | P2 |
| Dependencies | TN-133 (closed: host handoff contract the shells consume) |
| Suggested size | Ownership decision + UX hardening PRs |
| Gate impact | Unblocks the browser-shell half of the consumer dev-loop gap |

## Purpose

Planning finding of the 2026-09-28 Android host review
([record](../08-validation/android-host-review-2026-09-28.md)):
`04-api/external-consumer-guide.md` and TN-133's slice record assign
the generic host's integrated-shell UX (route rail, hot reload,
dev-server routes) to TN-042 — but TN-042's own issue is the M2 native
renderer-neutral display list (`engine/` touch points, web explicitly
out of scope). The reconciliation options the record names are exactly
this: a late-issue owning the browser-shell integration UX, or a TN-042
scope addendum. This issue takes the first option so the work has an
owner before it is scheduled; TN-042 stays what its file says.

Scope: the shared browser-shell conventions across
`examples/gallery-preview`, `examples/flutter-showcase-preview`, and
the votol dev shell — route rail, hot reload, dev-server routes
(including `/apk`) — converging toward the DX surface TN-107 will own
for the framework proper.

## Required outcome

- An explicit ownership statement lands in `04-api/` (consumer guide
  correction) naming this issue as the browser-shell UX owner; TN-042
  is left untouched as the native display-list issue.
- The recorded hot-reload poll defects are fixed under this owner
  (both `examples/gallery-preview/preview.ts:83-115` and
  `examples/flutter-showcase-preview/preview.ts`): the first observed
  hash is recorded without being applied (an edit landing between page
  load and first poll is never applied), and `lastHash` advances BEFORE
  import-and-restore (swallowing failures until the next hash change).
  Regression tests pin both.

## References

- [Android host review 2026-09-28, planning finding + JS-side note](../08-validation/android-host-review-2026-09-28.md)
- [TN-042](tn-042-implement-renderer-neutral-display-list.md) (scope, unchanged)
- [VOTOL consumer feedback, gap 1](../08-validation/votol-consumer-feedback-2026-10-02.md) (dev-loop gap this unblocks)

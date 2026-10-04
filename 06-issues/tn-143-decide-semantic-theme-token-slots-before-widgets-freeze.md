---
okf_version: 0.2
title: "TN-143: Decide semantic theme-token slots before the widget layer freezes"
summary: "Runtime light/dark with a persisted choice touched every color; native got it free via resource aliases, the web replica hand-plumbed ~40 CSS variables. Define the token indirection now."
type: issue
status: ready
issue_id: "TN-143"
milestone: "M4"
priority: "P1"
depends_on:
  - "TN-068"
---

# TN-143 — Decide semantic theme-token slots before the widget layer freezes

## Metadata

| Field | Value |
|---|---|
| Milestone | M4 — Widget layer (decision requested ahead of the freeze) |
| Priority | P1 |
| Dependencies | TN-068 (theme tokens and inherited widget context) |
| Suggested size | One contract-decision PR (ADR + slot vocabulary) |
| Gate impact | Every app's theming cost; future OS dark-mode-follows |

## Purpose

Gap 4 of the VOTOL consumer feedback
([record](../08-validation/votol-consumer-feedback-2026-10-02.md)).
Light/dark at runtime with a persisted choice touched every color the
app had. The native Android build got it free via resource aliases; the
web replica hand-plumbed ~40 CSS variables. If scenes bake colors at
commit time that is fine — but without semantic color slots / token
indirection defined before widgets freeze, every app (and any future
OS dark-mode-follows) hand-plumbs it later. TN-068 owns theme tokens;
this issue owns the DECISION pulled forward: the slot vocabulary and
indirection contract, sequenced before M4's widget property schemas
stabilize.

## Required outcome

- An accepted slot vocabulary (semantic color slots — background,
  surface, on-surface variants, accent, danger, …) with the indirection
  rule: widgets and display-list ops reference slots, never literal
  colors; resolution happens at a defined stage (commit-time baking is
  acceptable if the slot survives for re-resolution).
- Runtime theme switching with a persisted choice is expressible
  through the contract (change slot values → next commit re-bakes),
  demonstrated by one example flipping light/dark without per-screen
  edits.
- Recorded as an ADR or an explicit TN-068 scope addendum, so M4 widget
  work (property schemas, TN-034 lineage) compiles against slots from
  its first PR.

## References

- [VOTOL consumer feedback, gap 4](../08-validation/votol-consumer-feedback-2026-10-02.md)
- `examples/votol/src/theme.ts`; the votol record's web-replica note

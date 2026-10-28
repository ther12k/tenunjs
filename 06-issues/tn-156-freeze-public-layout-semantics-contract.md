---
okf_version: 0.2
title: "TN-156: Freeze the public layout semantics contract"
summary: "Define the widget-behavior contract — constraint propagation, Expanded in both axes, unbounded space, text intrinsics, nested scroll regions, and documented Flutter divergences — so backend choice serves the semantics instead of defining them."
type: issue
status: closed
issue_id: "TN-156"
milestone: "M2"
priority: "P1"
depends_on: []
---

# TN-156 — Freeze the public layout semantics contract

## Metadata

| Field | Value |
|---|---|
| Milestone | M2 — Native scene, layout, and Skia rendering |
| Priority | P1 |
| Dependencies | None (consumes the Yoga/Taffy spike evidence already recorded) |
| Suggested size | Contract document + conformance fixtures; one issue |
| Gate impact | The semantics TN-155's milestone app exercises; unblocks bounded containers and cross-axis `Expanded` |

## Purpose

Using widget names like `Column`, `Expanded`, and `Stack` does not reproduce
Flutter's layout behavior. Flutter's model is constraint-based: parents
provide bounds, children size within them, parents position children. The
[layout architecture](../02-architecture/layout.md) now names the public
semantics as the contract that Yoga/Taffy/another backend implements — this
issue freezes that contract in written, testable form.

Widget behavior matters as much as widget names. The contract document must
define, with a conformance fixture for each:

1. **Constraint propagation** — how min/max bounds pass parent → child, and
   which widgets tighten or loosen them.
2. **`Expanded` in both axes** — free-space distribution in Rows and in
   bounded-height Columns (today: Rows only; the prototype's content-height
   scene is a boundary, not a position).
3. **Unbounded space** — defined behavior (intrinsic sizing, clamping, or a
   fail-visible diagnostic) when a child receives unbounded space in an
   axis; never an accident of the backend.
4. **Text wrapping and intrinsic measurement** — when paragraphs are
   measured, when cached, and how intrinsics constrain and are constrained.
5. **Nested scroll regions** — viewport sizing, content measurement, and
   clipping for scroll regions inside surrounding widgets (replacing
   whole-scene scrolling).
6. **Documented divergences** — every intentional difference from Flutter,
   written down with the reason.

## Required outcome

- A frozen semantics section in
  [layout.md](../02-architecture/layout.md) (or a linked contract page it
  owns), accepted through the normal docs gate.
- Conformance fixtures each backend candidate must pass — extending the
  existing Yoga/Taffy spike fixture set from adapter mechanics to public
  semantics.
- A recorded decision on where layout executes (framework side, native
  side, or split) **justified by runtime design and measurement** — being
  Flutter-inspired does not require native-side layout; Flutter keeps
  substantial layout logic in its Dart framework.

## Verification

- Fixtures run against the selected backend in the existing evidence-packet
  flow (`benchmarks/architecture`).
- The contract's rules are stated in terms of widget behavior (what a
  screen does), not backend vocabulary.

## References

- [Layout architecture — public layout semantics](../02-architecture/layout.md)
- [Layout adapter contract](../02-architecture/layout-adapter-contract.md)
- Yoga/Taffy spike evidence: `benchmarks/architecture/evidence/`
- TN-155 (the milestone app that exercises this contract)

## Status note (2026-10-28, closed)

Closed with the frozen semantics section in
[layout.md](../02-architecture/layout.md): the constraint model
(parent bounds → child size → parent position, monotonic tightening,
unbounded space as a first-class state), widget-behavior rules
(Row/Column/Expanded/SizedBox/Center/Stack/Text/scroll regions),
deliberate Flutter divergences, and the prototype boundaries the contract
supersedes.

Conformance: corpus cases 011 (Expanded in a bounded Column), 012
(intrinsic content overflowing a bounded viewport — the scroll-viewport
semantic, asserted through the content's own boxes), and 014
(justify-center Column) extend the spike corpus from adapter mechanics
to public semantics; all cases pass on BOTH current backend candidates
through the shared C driver, and both evidence packets were regenerated
(yoga-spike-v3, taffy-spike-v3). The corpus JSON contract now declares a
box for every non-root node, matching the C driver.

One case could not carry a fixed expectation on both candidates and
became the contract's first recorded backend discriminator: under
align-stretch in a bounded-height Column, yoga's adapter substitutes the
bounded height as definite measure-available space, while taffy passes
non-definite space so the measured child's fallback (max-content) answer
is used. The measured-space rule is frozen in layout.md; yoga's adapter
must fix this or be rejected at the M0 selection gate.

Execution home decided and recorded: framework-side TypeScript layout
for v0.x (Flutter's own architectural position), with native-side layout
available behind the adapter contract as a measurement-gated optimization
path — not a Flutter-likeness requirement.

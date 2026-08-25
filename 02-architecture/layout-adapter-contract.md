---
okf_version: 0.2
title: "Layout Backend Adapter Contract"
summary: "Renderer-neutral layout API and shared conformance corpus for the Yoga/Taffy gate (TN-014)."
type: contract
status: accepted
issue_id: "TN-014"
---

# Layout backend adapter contract

The engine never names its layout implementation (`adr-0008`). Candidates implement this interface over the same corpus. Consumers: TN-015 (Yoga), TN-016 (Taffy). Canonical machine form: [`spikes/layout/layout_adapter.h`](../spikes/layout/layout_adapter.h).

## Model

- A tree of nodes; each has a style (input) and a result box (x, y, width, height relative to parent).
- One entry point computes the full tree against a viewport; dirty-node incremental relayout is exercised by calling compute twice with one mutated style and asserting unchanged outputs elsewhere.
- Units are logical pixels as `float`. All corpus values are exactly representable in binary floating point, so candidate output must match expected values **exactly** — no epsilon, no rounding debate.

## Style subset (v1)

`display: flex` is implicit. Supported: `width`, `height`, `flex_grow`, `flex_direction` (row/column), `gap` (main axis), `padding` (uniform), `justify_content` (flex_start/center), `align_items` (stretch/center). Undefined dimensions default to grow/stretch behavior per CSS flexbox. Anything beyond this subset is out of the M0 gate.

## Measure callbacks

Intrinsic measurement (text) enters via a host callback receiving available space and returning a size. The spike corpus includes one callback-driven leaf to prove the hook works identically in both backends.

## Fail-closed rules

- Unknown enum values passed across the adapter abort the layout pass with `TENUN_LAYOUT_ERR_STYLE`, never clamp silently.
- Cycle creation through misused APIs returns `TENUN_LAYOUT_ERR_TREE`; the backend must not hang.
- Results before a completed compute pass read as zeros, not stale garbage.

## Conformance corpus

[`spikes/layout/corpus/`](../spikes/layout/corpus/) holds numbered cases: `input.json` (tree + viewport + expectation) per case. Both candidates run every case headless and diff boxes exactly. Corpus changes require updating both candidate PRs together.

## Out of scope

Absolute positioning, percentages, baseline alignment, wrapping, aspect ratio, RTL mirroring (TN-093), text measurement integration beyond the callback stub.

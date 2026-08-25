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

Intrinsic measurement enters via `tenun_layout_measure_fn(userdata, constraint, out)` — an explicit-userdata function pointer stored per node by `tenun_layout_node_set_measure(node, fn, userdata)`. Implementations must forward actual available-space constraints and invoke the stored callback per node (no shared/global context). The corpus includes single-leaf (006) and two-sibling (007/008) measurement cases to prove per-node isolation.

## Lifecycle and ownership (amended 2026-08-25, review 2)

- **Strict single-parent ownership.** An attached node cannot be re-attached elsewhere; `add_child` returns `TENUN_LAYOUT_ERR_TREE`. Reparenting requires an explicit detach API in a later ABI version — there is none at spike scope.
- **Cycle rule:** adding `child` under `parent` is rejected when `child` is an ancestor of `parent` (walk runs upward from parent). Self-attach is rejected. Regression cases: A→B then B→A; A→B→C then C→A; self; duplicate.
- **`node_destroy` detaches** the node from its parent and clears its children's parent links (children survive as unparented roots). Double destroy is a safe no-op on null but freeing an arbitrary handle twice remains caller error until the generation registry lands (#142 H1).
- **Measured root is rejected** with `TENUN_LAYOUT_ERR_TREE` by BOTH candidates (parity fixed 2026-08-25).
- Every exported entry point null-checks handles and contains panics; results read zeros before first successful compute.

## Fail-closed rules

- Unknown enum values passed across the adapter abort the layout pass with `TENUN_LAYOUT_ERR_STYLE`, never clamp silently.
- Cycles and duplicate attachment return `TENUN_LAYOUT_ERR_TREE` per the lifecycle rules above; the backend must not hang.
- Results before a completed compute pass read as zeros, not stale garbage.

## ABI conformance gate

`spikes/layout/run_corpus.c` is the canonical consumer: one binary, zero candidate-specific code, loading each candidate through `dlopen` and driving every case plus fail-closed checks (`ERR_TREE` on cycles/duplicate attach). Candidate PRs must show its output against their release cdylib. Header `_Static_assert`s pin cross-boundary struct layouts; first-consumer amendments update this doc in the same commit.

### Known policy divergence (TN-017 input)

At Yoga's default point-scale factor (1.0) layout results are rounded to whole pixels; Taffy (rounding disabled) is not. Current corpus uses integer-exact expectations so both pass identically; explicit rounding/scale-factor cases land with M1 corpus expansion and become scorecard rows, not silent mismatches.

## Conformance corpus

[`spikes/layout/corpus/`](../spikes/layout/corpus/) holds numbered cases: `input.json` (tree + viewport + expectation) per case. Both candidates run every case headless and diff boxes exactly. Corpus changes require updating both candidate PRs together.

## Out of scope

Absolute positioning, percentages, baseline alignment, wrapping, aspect ratio, RTL mirroring (TN-093), text measurement integration beyond the callback stub.

# Contributing to TenunJS

## Ground rules

1. The v0.x charter (`03-decisions/adr-0021-product-charter-freeze.md`) is enforceable. A PR whose diff implements or enables a charter non-goal fails review regardless of other merit.
2. One issue per worktree and one focused PR. Shared interface changes must name every affected issue ID and include generated-contract diffs.
3. Evidence closes work: no issue closes on prose alone (see `05-delivery/definition-of-done.md` and `07-agent/evidence-packet-template.md`).
4. Do not combine unrelated cleanup with gate work.

## Workflow

- Pick an open issue from the [issue tracker](https://github.com/ther12k/tenunjs/issues). Respect dependencies; `06-issues/index.md` and `05-delivery/parallel-waves.md` describe the safe order.
- Branch as `tn-NNN-short-description` from `main`.
- Keep the patch minimal to the issue's declared scope; adjacent changes get their own issue references.
- Every PR states its agent handoff (Result / Contracts changed / Tests / Device evidence / Residual risks) in the body.

## Tooling

- Bun is used for repository tooling only, never as the embedded runtime (`adr-0018`).
- Engine language, JS runtime, and layout backend are chosen by evidence gates in M0 — do not pre-select them in unrelated patches.

## Licensing

By contributing you agree your contributions are licensed under the MIT License covering this repository.

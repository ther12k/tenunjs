---
okf_version: 0.2
title: "Multi-Agent Coordination"
summary: "How parallel agents avoid conflicting contracts and worktrees."
type: procedure
status: accepted
---

# Multi-agent coordination

## Assignment

Use `parallel-waves.md`. Assign issues from the earliest unfinished wave. Two agents must not own the same issue or generated canonical source.

## Contract ownership

- Protocol/schema changes: owning issue has exclusive canonical-source ownership.
- Generated consumers: dependent issues wait for the canonical change or rebase after it lands.
- Cross-cutting changes: open a dedicated issue or ADR instead of quietly editing several boundaries.

## Merge order

1. Foundational interface/manifest changes
2. Native and TypeScript implementations
3. Platform adapters
4. Integration tests
5. Documentation and release gate

## Conflict handling

When two valid patches conflict, prefer the accepted dependency contract, not the most recent implementation convenience. Escalate incompatible assumptions before merging either patch.

## Shared evidence

Raw benchmark/device evidence may be reused only when commit, artifact, configuration, and workload identifiers match exactly. Summaries may link shared evidence; they must not copy claims across different builds.

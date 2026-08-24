---
okf_version: 0.2
title: "Agent Execution Protocol"
summary: "Rules for low-context agents implementing one TenunJS issue per worktree."
type: procedure
status: accepted
---

# Agent execution protocol

## Input contract

An agent receives one issue Markdown file, the repository checkout, and links to declared dependencies. The issue file is authoritative for scope. Chat history is not a substitute for accepted repository documents.

## Required workflow

1. Read the issue, dependencies, required architecture documents, and current repository state.
2. Confirm the issue is unblocked. Do not fabricate missing dependency APIs.
3. Create or use a dedicated worktree and branch named with the issue ID.
4. Run the narrow baseline tests before editing; record pre-existing failures.
5. Write a brief implementation note in the PR or work log.
6. Implement the smallest complete vertical slice.
7. Add positive, negative, lifecycle, disposal, and platform tests as applicable.
8. Run generated-contract drift checks.
9. Run affected suites and clean-checkout reproduction.
10. Assemble raw and summarized evidence.
11. Return the handoff format from the issue file.

## Hard prohibitions

- Do not weaken a test to make a patch pass.
- Do not replace fail-closed behavior with logging and continuation.
- Do not introduce React, DOM, HTML, or web assumptions into the mobile core.
- Do not expose C++, Rust, Yoga, Taffy, QuickJS-NG, Hermes, or Skia-specific objects through ordinary application APIs.
- Do not merge unrelated issues into one patch.
- Do not mark a device requirement complete with simulator-only evidence.
- Do not leave generated files stale.
- Do not claim future work as current completion.

## When blocked

Return `BLOCKED` with:

- Exact missing dependency or contradictory contract
- Minimal reproduction
- Why a local workaround would violate an invariant
- Proposed owning issue or ADR
- Work that is safely complete, if any

## Context budget

Prefer the issue file and directly linked contracts. Search the repository for current symbols before inventing names. Read additional documents only when the task crosses their boundary.

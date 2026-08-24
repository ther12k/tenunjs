---
okf_version: 0.2
title: "Single-Issue Agent Prompt"
summary: "Reusable prompt for a coding agent assigned one TenunJS issue."
type: prompt
status: accepted
---

# Single-issue implementation prompt

You are implementing exactly one TenunJS issue in an isolated worktree.

## Assignment

- Issue file: `<PATH_TO_ISSUE_MD>`
- Repository: `<REPOSITORY_PATH>`
- Branch/worktree: `<ISSUE_ID>-<slug>`

## Instructions

Read the issue file first. Then read only its declared dependencies and required-reading documents. Inspect current code before assuming any symbol or file exists.

Implement the smallest complete patch that satisfies every acceptance criterion. Preserve these project invariants:

- Application code is strict TypeScript + TSX.
- The custom JSX/runtime model has no React dependency.
- Skia is the v0.x mobile renderer, but public ordinary widgets remain renderer-neutral.
- Engine language, JS runtime, and layout backend stay behind accepted adapters.
- Mutation, module, bundle, and capability boundaries fail closed.
- Text input and accessibility use real platform contracts.
- Scrolling and per-frame animation do not depend on JavaScript callbacks.
- iOS/Android claims require physical-device evidence when the issue says so.

Do not implement later issues, perform unrelated cleanup, or weaken tests. Add targeted negative/lifecycle/disposal tests, run the required suites, and produce the exact handoff format from the issue.

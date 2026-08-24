---
okf_version: 0.2
title: "GitHub Project Setup"
summary: "Labels, milestones, fields, and branch/worktree conventions."
type: plan
status: accepted
---

# GitHub project setup

## Milestones

Create M0 through M7 using the names and exit outcomes in `roadmap.md`.

## Required labels

```text
priority:P0  priority:P1  priority:P2
area:tooling area:runtime area:engine area:renderer area:ios area:android
area:tsx area:controller area:navigation area:widgets area:text area:a11y
area:native-modules area:testing area:security area:performance area:docs
type:architecture type:feature type:test type:gate
status:blocked status:needs-evidence status:ready-for-review
```

## Project fields

- Issue ID
- Milestone
- Workstream
- Priority
- Dependency state
- Assigned worktree/agent
- Implementation status
- Evidence status
- Review status
- Risk level

## Worktree rule

Use one issue per worktree and one focused PR. Shared interface changes must name all affected issue IDs and include generated-contract diffs. Do not combine unrelated cleanup with gate work.

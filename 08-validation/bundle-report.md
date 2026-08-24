---
okf_version: 0.2
title: "Bundle Report"
summary: "Generated inventory and scope report for the native Skia v0.2 design pack."
type: report
status: accepted
---

# Bundle report

## Identity

- Framework: TenunJS
- Version: native Skia OKF design pack v0.2
- Tagline: Write TSX. Render native.
- Supersedes: HTML-first v0.1 architecture

## Expected final inventory

- Markdown resources: 225
- Detailed implementation issues: 130
- Architecture decisions: 20
- Milestones: 8
- Dependency waves: 60
- Non-Markdown files in archive: 0

## Architecture summary

```text
TypeScript + TSX
  → custom JSX runtime
  → controller/action model
  → keyed reconciler
  → validated atomic mutation ABI
  → native scene/layout/text/input/semantics engine
  → Skia
  → iOS and Android
```

## Language policy

The application language is fixed to TypeScript/TSX. The shared engine language is selected by matched C++20 and Rust spikes; it is not a branding requirement. Swift and Kotlin remain thin platform integration layers.

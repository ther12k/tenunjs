---
okf_version: 0.2
title: "Vision"
summary: "Why TenunJS should exist and what it must make easier."
type: concept
status: accepted
---

# Vision

TenunJS should let a TypeScript developer build a polished iOS and Android application with a mental model closer to Flutter widgets than to browser markup, while retaining familiar TSX composition and a deliberately smaller state model than React.

The framework wins only if it makes ordinary application screens—forms, lists, navigation, data loading, validation, dialogs, settings, and dashboards—pleasant without hiding native mobile constraints.

## Product promise

```text
Write TypeScript and TSX once
        ↓
Use typed, composable widgets
        ↓
Run a native mobile engine
        ↓
Render consistently through Skia
        ↓
Integrate honestly with iOS and Android
```

## What “simple” means

Simple does not mean omitting accessibility, text input, focus, lifecycle, or failure handling. It means those systems have coherent defaults and explicit escape hatches rather than leaking platform-specific ceremony into every screen.

## Success test

A competent TypeScript team should be able to build and ship a production-style mobile CRUD application without learning React internals, C++, Rust, Swift, or Kotlin. Framework maintainers may work across those layers; application authors should not need to.

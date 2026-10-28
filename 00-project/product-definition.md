---
okf_version: 0.2
title: "Product Definition"
summary: "Canonical definition and boundary of the TenunJS product."
type: concept
status: accepted
---

# Product definition

TenunJS is a **mobile-native UI framework** with four layers:

1. A TypeScript + TSX application API.
2. A controller/action and incremental reconciliation runtime.
3. A native UI engine that owns layout, rendering, input, semantics, scrolling, animation, and resources.
4. Thin iOS and Android embedders for platform lifecycle and services.

## Positioning

TenunJS is a **Flutter-inspired framework for building native applications
in TypeScript, with TSX for declaring UI** (decided 2026-10-28; see
[framework positioning](../02-architecture/framework-positioning.md)).
Flutter is the primary benchmark for the application-building experience —
composable widgets, coherent layout semantics, framework-owned rendering —
while the typed-action state model and TSX-without-React authoring remain
TenunJS's own choices, not Dart-API reproductions.

## Primary user

A TypeScript developer building application-oriented mobile interfaces who wants Flutter-like widget composition without Dart and without requiring React or a browser engine.

## Primary workloads

- Business applications and internal tools
- School and operational applications
- Forms and approval workflows
- Search, filtering, and lists
- Dashboards and data visualization
- Settings and account flows
- Moderately animated consumer applications

## Explicit boundary

TenunJS is not initially a game engine, browser replacement, web framework, or drop-in implementation of React Native or Flutter. It may expose a low-level canvas widget for custom graphics, but ordinary controls use framework widgets with semantics and platform integration.

## Platform order

1. iOS and Android
2. macOS, Windows, and Linux only after the beta mobile gate
3. Web only as a separate renderer/host investigation, not as a constraint on the mobile core

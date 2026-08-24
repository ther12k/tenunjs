---
okf_version: 0.2
title: "Terminology"
summary: "Canonical terms used throughout the design and issue backlog."
type: reference
status: accepted
---

# Terminology

| Term | Meaning |
|---|---|
| Widget | Public TSX description of UI intent. |
| Host widget | Built-in widget implemented by the native engine, such as `View`, `Text`, or `ScrollView`. |
| Function widget | TypeScript function that composes other widgets. |
| Controller | Typed owner of screen state, actions, effects, and lifecycle. |
| Action | Named event handler that performs a bounded state transition and may schedule effects. |
| Effect | Asynchronous work such as network, storage, permission, or navigation operations. |
| Reconciler | JavaScript-side process that compares keyed widget trees and emits native mutations. |
| Mutation transaction | Versioned atomic batch of create/update/insert/remove operations. |
| Scene tree | Native retained tree used for layout, hit testing, semantics, and painting. |
| Display list | Renderer-neutral sequence of drawing operations consumed by the Skia backend. |
| Embedder | Thin platform shell that connects the engine to iOS or Android. |
| Semantics tree | Accessibility-focused projection of the widget/scene tree. |
| Platform view | Native UIKit/Android View embedded into the Skia composition, such as maps or web content. |
| Architecture gate | Time-boxed matched implementation spike with predefined scoring and a recorded decision. |

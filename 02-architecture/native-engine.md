---
okf_version: 0.2
title: "Native Engine"
summary: "Responsibilities and module boundaries of the shared native engine."
type: architecture
status: accepted
---

# Native engine

The engine owns durable runtime state below TSX:

```text
engine/core
├── ids and arenas
├── mutation validation
├── scene tree
├── layout adapter
├── text and font services
├── hit testing
├── gesture arena
├── focus tree
├── semantics tree
├── scroll state
├── animation graph
├── frame scheduler
├── resources and caches
├── platform-view composition
└── renderer interface
```

## Invariants

- Node handles include generations so stale IDs fail closed.
- A scene node has explicit ownership and destruction semantics.
- Layout, paint, semantics, and hit-test dirtiness are tracked separately.
- Native-side state that must survive JS stalls is isolated from controller state.
- The renderer consumes an immutable frame/display-list snapshot.
- Platform callbacks never execute application JS while engine locks are held.
- Disposal is idempotent and ordered across scene, runtime, renderer, and embedder.

## Mockability

The engine must run with:

- A mock renderer
- A deterministic clock
- Synthetic input
- In-memory resources
- Fake platform accessibility and IME adapters

This is required to test correctness without a GPU or simulator.

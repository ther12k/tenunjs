---
okf_version: 0.2
title: "TenunJS OKF Root Index"
summary: "Canonical root index for the TenunJS native mobile framework design pack."
type: index
status: accepted
---

# TenunJS OKF v0.2

TenunJS combines a TypeScript/TSX authoring experience with a mobile-native engine and a Skia renderer. The public programming model is intentionally simple; the difficult platform work stays behind stable contracts.

## Navigation

- [Vision](00-project/vision.md)
- [Requirements](01-requirements/functional-requirements.md)
- [Architecture](02-architecture/system-overview.md)
- [ADRs](03-decisions/index.md)
- [API examples](04-api/index.md)
- [Delivery plan](05-delivery/roadmap.md)
- [Implementation issues](06-issues/index.md)
- [Agent instructions](07-agent/agent-execution-protocol.md)
- [Validation](08-validation/validation-report.md)

## Correct mental model

```text
TypeScript / TSX application
            │
     custom JSX runtime
            │
  controller + reconciler
            │
 versioned mutation protocol
            │
 native widget/scene engine
     ├── layout
     ├── text + input
     ├── focus + gestures
     ├── semantics
     ├── scroll + animation
     └── resources
            │
           Skia
            │
 Metal / Vulkan / tested fallback
            │
     iOS and Android embedders
```

HTML, CSS, the DOM, and HTTP fragment swapping are not core mobile runtime concepts.

---
okf_version: 0.2
title: "Errors and Observability"
summary: "Failure domains, diagnostics, and privacy-aware telemetry."
type: architecture
status: accepted
---

# Errors and observability

## Failure domains

- Application/controller error
- Reconciler/protocol error
- JavaScript runtime termination
- Native engine assertion or crash
- Renderer/surface loss
- Platform embedder failure
- Native module error
- Resource decode/load failure

Each error has a stable code, owning layer, recoverability classification, contextual metadata, and source location where available.

## Development tools

- TS/TSX source-mapped stack traces
- Widget, layout, semantics, and focus inspector
- Mutation transaction viewer
- Frame timeline and JS-stall indicators
- Native resource/cache counters
- Platform log aggregation through the CLI

## Production

Telemetry is opt-in/configurable and privacy-aware. Sanitization occurs before persistence. Native symbols and JS source maps remain separately secured. The framework does not capture controller state by default because it may contain sensitive data.

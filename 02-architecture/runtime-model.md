---
okf_version: 0.2
title: "Runtime Model"
summary: "Execution model, runtime abstraction, threads, and lifecycle."
type: architecture
status: accepted
---

# Runtime model

## Runtime adapter

The engine hosts JavaScript through a small interface:

```ts
interface ScriptRuntimeHost {
  loadBundle(bundle: VerifiedBundle): void;
  invokeEntrypoint(name: string, payload: HostValue): HostValue;
  dispatchEvent(event: NativeEvent): void;
  drainMicrotasks(budget: Duration): DrainResult;
  interrupt(reason: InterruptReason): void;
  collectDiagnostics(): RuntimeDiagnostics;
  dispose(): void;
}
```

QuickJS-NG and Hermes are evaluated behind this contract. Application packages cannot detect or depend on runtime-specific global objects.

## Thread model

```text
Platform/UI thread
  window lifecycle · IME · accessibility · platform views

JS thread
  controller actions · effects · TSX reconciliation · mutation encoding

Render thread
  frame scheduling · display-list playback · raster/cache work

Worker pool
  image decode · asset IO · selected text/resource work
```

The selected implementation may combine threads for an early prototype, but public contracts must not require that simplification.

## Frame sequence

1. Platform input is normalized and hit-tested.
2. An event with a stable node/action handle is queued to JS.
3. The controller executes a bounded action transaction.
4. Synchronous state changes schedule affected TSX roots.
5. The reconciler emits one mutation transaction.
6. Native validates and applies it atomically.
7. Layout, semantics, and paint dirtiness propagate.
8. The frame scheduler produces and renders a display list.
9. Deferred effects and callbacks are delivered without blocking the frame.

Engine-side scroll and animation nodes may update between JS commits.

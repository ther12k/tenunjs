---
okf_version: 0.2
title: "System Overview"
summary: "End-to-end architecture from TSX application code to Skia and mobile platforms."
type: architecture
status: accepted
---

# System overview

```text
┌───────────────────────────────────────────────────────────────┐
│ Application: TypeScript + TSX                                │
│ screens · controllers · actions · services · themes          │
└──────────────────────────────┬────────────────────────────────┘
                               │ build + bytecode/module graph
┌──────────────────────────────▼────────────────────────────────┐
│ JavaScript application runtime                               │
│ JSX runtime · controller store · effects · reconciler         │
└──────────────────────────────┬────────────────────────────────┘
                               │ validated atomic mutations
┌──────────────────────────────▼────────────────────────────────┐
│ Native UI engine                                              │
│ scene · layout · text · hit-test · focus · semantics          │
│ gestures · scroll · animation · resources · platform views    │
└──────────────────────────────┬────────────────────────────────┘
                               │ display list
┌──────────────────────────────▼────────────────────────────────┐
│ Skia renderer                                                  │
│ raster cache · text/image resources · GPU surfaces            │
└───────────────┬────────────────────────────────┬──────────────┘
                │                                │
        ┌───────▼────────┐               ┌───────▼────────┐
        │ iOS embedder   │               │ Android embedder│
        │ Swift/ObjC++   │               │ Kotlin/JNI      │
        │ UIKit + Metal  │               │ Android + GPU   │
        └────────────────┘               └─────────────────┘
```

## Stable boundaries

1. **Application API** — TypeScript packages and generated declarations.
2. **Screen manifest** — normalized output for one-file and split source layouts.
3. **Runtime host interface** — lifecycle and host functions independent of QuickJS-NG or Hermes.
4. **Mutation protocol** — versioned, binary, fail-closed JS-to-native transaction ABI.
5. **Layout adapter** — engine-facing contract independent of Yoga or Taffy.
6. **Renderer interface** — display-list consumer; Skia is the required first backend.
7. **Embedder API** — lifecycle, surfaces, IME, accessibility, platform views, and services.
8. **Native module IDL** — generated TypeScript, native, mock, and compatibility bindings.

## Why this is not React Native

TenunJS does not promise React semantics, React package compatibility, or React hooks. It owns a smaller controller/action model and can optimize around it. It also owns a retained native scene and Skia rendering path rather than treating native platform controls as the ordinary layout/rendering substrate.

## Why this is not Flutter

TenunJS borrows composable widget vocabulary and native-engine ownership, but uses TypeScript/TSX, a different state model, adapter-backed engine choices, and intentionally smaller initial widget scope.

## Positioning vs the wider ecosystem

A full comparison with React Native, Flutter, NativeScript, and Capacitor — including intended advantages, honest disadvantages, and positioning language — lives in [Framework positioning](framework-positioning.md). The short form: TenunJS's rendering model is closest to Flutter's engine ownership, but written in TypeScript/TSX with a deliberately restricted controller/action state model; it is in the design-and-spike phase and cannot ship applications today, unlike all four established alternatives.

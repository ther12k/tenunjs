---
okf_version: 0.2
title: "Skia Rendering Architecture"
summary: "How the mandatory Skia backend fits behind a renderer-neutral display list."
type: architecture
status: accepted
---

# Skia rendering architecture

Skia is mandatory for the v0.x mobile renderer, but ordinary widgets do not expose Skia classes.

## Render flow

```text
scene tree
  ↓ paint traversal
immutable display list
  ↓ cache and damage analysis
Skia backend
  ↓
Metal / Vulkan / tested fallback surface
```

## Display-list operations

The display list includes bounded operations for transforms, clips, opacity/layers, rounded rectangles, paths, images, text runs, shadows, and cached subpictures. It carries stable resource handles rather than raw pointers.

## Caching

- Text shaping and paragraph cache
- Image decode/upload cache
- Paint/style interning
- Retained subpicture/raster cache where evidence supports it
- Damage tracking and partial repaint where backend behavior is reliable

## Low-level escape hatch

A `Canvas` widget may expose a controlled drawing API for charts and custom visuals. It must declare semantics separately and cannot be used to implement ordinary text inputs or buttons in core.

## Backend discipline

Platform GPU API selection, surface loss, context recreation, and driver fallback are explicit embedder/renderer contracts. A debug overlay reports frame, cache, upload, and raster timing.

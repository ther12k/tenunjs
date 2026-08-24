---
okf_version: 0.2
title: "Native Modules and Platform Views"
summary: "Generated native capabilities and composition of UIKit/Android views."
type: architecture
status: accepted
---

# Native modules and platform views

## Native module IDL

A framework schema defines methods, events, errors, threading, permissions, and versioning. Code generation produces:

- TypeScript client
- Runtime host registration
- C/C++ or Rust engine declarations as selected
- Swift protocol and implementation skeleton
- Kotlin interface and implementation skeleton
- Mock/test implementation
- Compatibility manifest

Calls use structured typed values and cancellation; arbitrary native class invocation is forbidden.

## Platform views

Maps, web content, camera preview, and certain OS controls may require native views. The contract covers:

- Creation, attachment, sizing, transforms, clipping, and z-order limits
- Touch and focus arbitration
- Accessibility subtree handoff
- Surface and lifecycle loss
- Snapshot/fallback behavior where composition cannot satisfy arbitrary transforms
- Destruction and leak detection

Platform-view limitations must be documented rather than hidden behind approximate behavior.

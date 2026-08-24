---
okf_version: 0.2
title: "Developer Experience Requirements"
summary: "Constraints that keep native complexity away from application authors."
type: requirement
status: accepted
---

# Developer experience requirements

Application developers should normally use:

```text
TypeScript
TSX
Tenun widgets
controllers/actions
service interfaces
CLI commands
```

They should not need to manage:

```text
CMake or Cargo
Xcode native target internals
Gradle NDK configuration
Skia object ownership
JNI / Objective-C++ bridges
native thread synchronization
```

Required DX behavior:

- Errors point to TS/TSX source locations.
- Build failures identify the owning layer and remediation.
- New native modules are generated from a typed interface definition.
- Development device discovery and logs work through one CLI.
- Configuration is typed and validated.
- Framework defaults produce debuggable, non-minified development builds and optimized release builds.
- The framework emits actionable warnings for unstable keys, blocked JS work, oversized transactions, inaccessible widgets, and leaked native resources.

---
okf_version: 0.2
title: "Build and Packaging Architecture"
summary: "Application bundle, native artifacts, CLI, and release build flow."
type: architecture
status: accepted
---

# Build and packaging architecture

## Build stages

1. Validate typed project configuration.
2. Resolve TypeScript modules, assets, native capabilities, and routes.
3. Compile TS/TSX using the Tenun JSX runtime.
4. Produce runtime-compatible bytecode or JavaScript bundle plus source maps.
5. Generate a signed/hashed manifest with protocol and capability versions.
6. Build or reuse native engine artifacts.
7. Assemble iOS and Android applications through generated platform projects.
8. Strip release diagnostics, preserve symbol artifacts, and verify package contents.

## Native artifact strategy

The selected engine toolchain publishes versioned prebuilt artifacts for supported platform/architecture combinations. Application projects should not compile Skia from source during ordinary builds.

## Release outputs

- iOS application/archive plus dSYM and engine symbol metadata
- Android APK/AAB plus native symbols and mapping files
- JS bundle/bytecode manifest and source maps
- SBOM and dependency/version report
- Reproducibility and signing evidence

The CLI owns the orchestration but platform-native signing remains explicit and inspectable.

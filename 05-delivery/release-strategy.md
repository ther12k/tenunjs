---
okf_version: 0.2
title: "Release Strategy"
summary: "Artifact, versioning, compatibility, and rollback approach."
type: plan
status: accepted
---

# Release strategy

## Channels

- `canary`: automated internal builds from main.
- `alpha`: public, explicitly unstable API, evidence-gated artifacts.
- `beta`: API and protocol stabilization with published compatibility policy.
- `stable`: outside this pack; requires production history beyond beta.

## Versioned surfaces

- TypeScript packages
- Screen/bundle manifest
- Mutation protocol
- Native module IDL and capability manifest
- Engine/embedder artifact ABI
- Runtime bytecode format where applicable

## Rollback

Application release artifacts pin the compatible engine/runtime bundle. A framework update must not mutate an already-built application package. CI retains prior known-good artifacts and documented downgrade constraints.

## Breaking changes

Before beta, changes still require migration notes and fixture updates. At beta, every public break requires deprecation or a declared major-version boundary. Protocol and native-module compatibility fail closed rather than “best effort.”

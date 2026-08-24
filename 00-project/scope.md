---
okf_version: 0.2
title: "Scope"
summary: "Capabilities required for alpha and beta and capabilities intentionally deferred."
type: concept
status: accepted
---

# Scope

## Public alpha

Public alpha requires:

- TypeScript/TSX application build pipeline
- Custom JSX runtime and keyed reconciler
- One-file and split controller/view screen formats
- Native engine selected through the M0 evidence gate
- Skia surfaces on physical iOS and Android devices
- Flexbox-class layout through the selected layout adapter
- Text, images, basic controls, scrolling, lazy lists, navigation, dialogs, and animation
- Native text input and IME integration
- VoiceOver and TalkBack semantics for the core widgets
- Typed native module bridge
- CLI, fast refresh, source maps, tests, diagnostics, and reference application

## Beta

Beta adds:

- A real production pilot on both platforms
- Stable package and compatibility policy
- Independent accessibility review
- Store-installable builds
- Published performance and memory envelopes
- Upgrade and rollback documentation
- API freeze for the beta surface

## Deferred

- Desktop and web renderers
- React compatibility
- Arbitrary CSS
- General-purpose browser DOM support
- Full Flutter or Material widget parity
- Games and advanced 3D
- Hot code push to production
- A bespoke programming language

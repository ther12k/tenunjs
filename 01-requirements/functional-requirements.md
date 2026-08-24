---
okf_version: 0.2
title: "Functional Requirements"
summary: "Required application-facing and runtime capabilities."
type: requirement
status: accepted
---

# Functional requirements

## Authoring

- FR-001: Applications shall be authored in strict TypeScript and TSX.
- FR-002: The JSX runtime shall be framework-owned and React-independent.
- FR-003: A simple screen shall fit in one `.screen.tsx` file.
- FR-004: A complex screen shall support separate controller, view, model, and test files.
- FR-005: Both source forms shall compile to the same screen manifest.

## UI and state

- FR-010: The framework shall provide Flutter-inspired composition widgets without copying Flutter internals.
- FR-011: Controllers shall expose typed state, actions, lifecycle, and effects.
- FR-012: Widget events shall reference typed actions without stringly typed dispatch.
- FR-013: Keyed reconciliation shall preserve stable native identity where contracts allow.
- FR-014: Lazy list APIs shall avoid materializing every row.

## Native behavior

- FR-020: Skia shall render the v0.x mobile UI.
- FR-021: The engine shall support iOS and Android physical devices.
- FR-022: Text input shall integrate with native IME systems.
- FR-023: The framework shall expose semantic accessibility information to VoiceOver and TalkBack.
- FR-024: Scrolling and active animations shall continue while the JS thread is briefly unavailable.
- FR-025: Platform views and typed native modules shall have explicit lifecycle contracts.

## Developer experience

- FR-030: The CLI shall create, build, run, test, and package applications.
- FR-031: Development builds shall provide fast refresh and source-mapped errors.
- FR-032: A headless test host shall exercise controllers, layout, and semantics without a device.
- FR-033: Golden rendering and physical-device integration tests shall be supported.

---
okf_version: 0.2
title: "Accessibility and Semantics Architecture"
summary: "First-class semantics tree and platform mappings."
type: architecture
status: accepted
---

# Accessibility and semantics architecture

The scene tree projects a semantics tree containing role, label, value, hint, state, actions, bounds, ordering, relationships, and live-region intent.

## Separation

- Visual nodes may merge into one semantic node.
- Decorative nodes may disappear from semantics.
- One visual canvas may expose several explicit semantic regions.
- Platform views contribute native semantic subtrees through an adapter boundary.

## Update path

Semantic changes are computed with the same atomic scene commit, then diffed and delivered on the platform thread. Accessibility focus restoration uses stable semantic IDs and generations.

## Testing

- Headless semantic snapshots
- Role/state/action contract tests for every core widget
- Automated platform smoke tests
- Manual VoiceOver and TalkBack journeys
- Text scaling, RTL, switch/keyboard navigation, and modal focus cases

Accessibility defects in core navigation, controls, or text input block release gates.

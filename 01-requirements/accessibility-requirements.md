---
okf_version: 0.2
title: "Accessibility Requirements"
summary: "Accessibility behavior required from the first credible release."
type: requirement
status: accepted
---

# Accessibility requirements

- Every host widget shall declare its semantic role and state contract.
- Buttons, inputs, headings, toggles, lists, dialogs, and navigation landmarks shall map to native platform semantics.
- Focus order shall be deterministic and testable independently from paint order.
- Dynamic content announcements shall be explicit and rate-limited.
- Text scaling shall not silently clip critical labels or controls.
- RTL and bidirectional text shall be covered by fixtures.
- Platform accessibility actions shall dispatch the same typed controller actions as touch or keyboard input.
- Platform views shall participate in focus transitions without trapping the user.
- Decorative canvas content shall be hidden; meaningful canvas content shall provide explicit semantics.
- Core-widget accessibility regressions shall block alpha and beta gates.

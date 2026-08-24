---
okf_version: 0.2
title: "Navigation Architecture"
summary: "Typed routes, native lifecycle, deep links, and state restoration."
type: architecture
status: accepted
---

# Navigation architecture

Navigation is framework-owned rather than a collection of arbitrary mutable arrays.

## Model

- Typed route definitions and parameter schemas
- Stack navigation for v0.x
- Modal and overlay routes
- Deep-link parsing as untrusted input
- Back handling and gesture coordination
- Per-route controller lifecycle and cancellation
- State restoration with versioned snapshots

## Example

```ts
const routes = defineRoutes({
  home: route('/'),
  order: route('/orders/:id', { id: t.string }),
  settings: route('/settings'),
});

await navigation.push(routes.order({ id: order.id }));
```

Route changes are effects. Views receive typed action references and never manipulate a global native navigation object directly.

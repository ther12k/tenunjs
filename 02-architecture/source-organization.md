---
okf_version: 0.2
title: "Source Organization"
summary: "One-file and split controller/view authoring models."
type: architecture
status: accepted
---

# Source organization

TenunJS supports two source shapes that normalize to the same `ScreenManifest`.

## Simple screen

```text
src/screens/counter/counter.screen.tsx
```

```tsx
export default defineScreen({
  name: "Counter",
  initialState: () => ({ count: 0 }),

  actions: {
    increment({ state }) {
      state.count += 1;
    },
  },

  view({ state, actions }) {
    return (
      <Scaffold>
        <Column align="center" gap="md">
          <Text variant="title">{state.count}</Text>
          <Button onPress={actions.increment}>Increase</Button>
        </Column>
      </Scaffold>
    );
  },
});
```

## Split feature

```text
src/screens/orders/
├── orders.controller.ts
├── orders.view.tsx
├── order-row.tsx
├── orders.model.ts
├── orders.service.ts
└── orders.test.ts
```

```ts
export const OrdersController = defineController({
  initialState: () => ({ status: "loading", orders: [] }),
  load: async ({ services, state }) => {
    state.orders = await services.orders.list();
    state.status = "ready";
  },
  actions: { /* ... */ },
});
```

```tsx
export default defineScreen({
  controller: OrdersController,
  view: OrdersView,
});
```

## Boundary rule

Views describe UI and bind typed actions. Controllers own state transitions, lifecycle, and effect orchestration. Domain services own business rules and external data access. No directory-wide MVC split is required; files remain feature-local.

## Build invariant

The compiler emits a single normalized manifest containing:

- Screen identity and route metadata
- Controller initializer and action table
- View root and dependency metadata
- Native module capabilities
- Asset references
- Development source-map locations

One-file convenience must not create a second runtime path.

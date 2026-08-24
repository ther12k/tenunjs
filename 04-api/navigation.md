---
okf_version: 0.2
title: "Navigation API"
summary: "Typed route construction and controller-owned navigation effects."
type: reference
status: accepted
---

# Navigation

```ts
export const routes = defineRoutes({
  home: route('/'),
  order: route('/orders/:id', {
    params: { id: t.string.min(1) },
  }),
  editOrder: route('/orders/:id/edit', {
    params: { id: t.string.min(1) },
  }),
});
```

```tsx
<Button onPress={actions.openOrder({ id: order.id })}>
  Open
</Button>
```

```ts
actions: {
  openOrder: defineAction({
    input: routes.order.params,
    async run({ input, navigation }) {
      await navigation.push(routes.order(input));
    },
  }),
}
```

Deep links are parsed through the same route schemas. Invalid parameters produce a declared fallback rather than constructing a partially valid screen.

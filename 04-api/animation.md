---
okf_version: 0.2
title: "Animation API"
summary: "Declarative configuration of native-side animation graphs."
type: reference
status: accepted
---

# Animation

```tsx
<AnimatedView
  value={state.visible}
  enter={{ opacity: [0, 1], translateY: [12, 0] }}
  exit={{ opacity: [1, 0], translateY: [0, 8] }}
  transition={{ type: 'spring', stiffness: 260, damping: 24 }}
>
  <Card>...</Card>
</AnimatedView>
```

```ts
const progress = animation.value(0);
await progress.animateTo(1, {
  duration: 240,
  curve: curves.easeOutCubic,
});
```

The JS side creates/configures graph nodes and awaits milestones. Native evaluates frame values. Unsupported properties fail at compile/development time rather than falling back to JS-per-frame callbacks.

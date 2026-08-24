---
okf_version: 0.2
title: "Controller and Action Model"
summary: "Minimal state model inspired by hypermedia explicitness rather than React hooks."
type: architecture
status: accepted
---

# Controller and action model

The mobile equivalent of the desired “HTMX-like” simplicity is an explicit local flow:

```text
native event
   ↓
typed action
   ↓
state transaction
   ↓
affected TSX root
   ↓
mutation transaction
```

There is no HTTP or DOM requirement.

## Controller contract

```ts
const ProfileController = defineController({
  initialState: () => ({
    profile: null as Profile | null,
    status: "idle" as "idle" | "loading" | "ready" | "error",
  }),

  async load({ state, services, signal }) {
    state.status = "loading";
    state.profile = await services.profile.get({ signal });
    state.status = "ready";
  },

  actions: {
    save: defineAction({
      input: SaveProfileInput,
      async run({ input, state, services, signal }) {
        const saved = await services.profile.save(input, { signal });
        state.profile = saved;
      },
    }),
  },
});
```

## Rules

- State is controller-local unless explicitly lifted to an application service/store.
- Actions are statically registered and receive typed inputs.
- Synchronous mutations are committed together.
- Async work is represented as cancellable effects and may publish explicit state transitions.
- Navigation and native services are effects, not hidden globals.
- Reentrancy, stale completion, and screen disposal have defined cancellation behavior.
- Development mode records action traces without serializing secrets by default.

General-purpose React-style hooks are not part of v0.x. Function widgets stay pure; stateful behavior belongs to controllers or built-in native widgets.

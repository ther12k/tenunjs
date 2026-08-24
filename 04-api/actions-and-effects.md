---
okf_version: 0.2
title: "Actions and Effects API"
summary: "Typed state transitions, async work, cancellation, and stale-result handling."
type: reference
status: accepted
---

# Actions and effects

```ts
const LoginController = defineController({
  initialState: () => ({ email: '', password: '', status: 'idle', error: null }),

  actions: {
    submit: defineAction({
      input: loginInput,
      concurrency: 'latest',

      async run({ input, state, services, navigation, signal }) {
        state.status = 'submitting';
        state.error = null;

        try {
          await services.auth.login(input, { signal });
          await navigation.replace(routes.home());
        } catch (error) {
          if (signal.aborted) return;
          state.status = 'idle';
          state.error = publicLoginError(error);
        }
      },
    }),
  },
});
```

Supported concurrency policies are deliberately small:

- `drop` — ignore a new dispatch while running.
- `restart`/`latest` — cancel the prior effect and keep the latest.
- `queue` — process in order with a configured bound.
- `parallel` — explicit and bounded; caller handles result ordering.

Controller disposal cancels owned effects. A stale completion cannot mutate a newer controller generation.

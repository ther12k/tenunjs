---
okf_version: 0.2
title: "Split Controller and View API"
summary: "Feature-local separation for larger screens."
type: reference
status: accepted
---

# Split controller and view

```text
orders/
├── orders.controller.ts
├── orders.view.tsx
├── orders.service.ts
├── orders.types.ts
└── orders.test.ts
```

## Controller

```ts
import { defineAction, defineController } from '@tenunjs/core';
import { OrderFilter } from './orders.types';

export const OrdersController = defineController({
  name: 'Orders',
  initialState: () => ({
    status: 'idle' as 'idle' | 'loading' | 'ready' | 'error',
    filter: 'open' as OrderFilter,
    orders: [],
    error: null as string | null,
  }),

  async load({ state, services, signal }) {
    state.status = 'loading';
    try {
      state.orders = await services.orders.list(state.filter, { signal });
      state.status = 'ready';
    } catch (error) {
      state.status = 'error';
      state.error = toPublicMessage(error);
    }
  },

  actions: {
    setFilter: defineAction({
      input: OrderFilter,
      async run({ input, state, services, signal }) {
        state.filter = input;
        state.status = 'loading';
        state.orders = await services.orders.list(input, { signal });
        state.status = 'ready';
      },
    }),
  },
});
```

## View

```tsx
import { defineScreen, type ControllerViewProps } from '@tenunjs/core';
import { ListView, Scaffold, SegmentedControl, Text } from '@tenunjs/widgets';
import { OrdersController } from './orders.controller';

function OrdersView({ state, actions }: ControllerViewProps<typeof OrdersController>) {
  return (
    <Scaffold>
      <SegmentedControl
        value={state.filter}
        options={['open', 'completed']}
        onChange={actions.setFilter}
      />

      {state.status === 'error' ? <Text role="alert">{state.error}</Text> : null}

      <ListView
        itemCount={state.orders.length}
        itemKey={(index) => state.orders[index].id}
        itemBuilder={(index) => <OrderRow order={state.orders[index]} />}
      />
    </Scaffold>
  );
}

export default defineScreen({ controller: OrdersController, view: OrdersView });
```

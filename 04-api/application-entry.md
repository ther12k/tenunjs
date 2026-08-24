---
okf_version: 0.2
title: "Application Entry API"
summary: "Target bootstrap and application configuration API."
type: reference
status: accepted
---

# Application entry

```tsx
import { runApp } from '@tenunjs/core';
import { App } from './app';

runApp({
  root: <App />,
  config: {
    displayName: 'Tenun Demo',
    diagnostics: __DEV__,
  },
});
```

```tsx
import { NavigationHost, defineRoutes } from '@tenunjs/navigation';
import { ThemeProvider } from '@tenunjs/widgets';
import { HomeScreen } from './screens/home/home.screen';
import { OrderScreen } from './screens/order/order.screen';

const routes = defineRoutes({
  home: { path: '/', screen: HomeScreen },
  order: { path: '/orders/:id', screen: OrderScreen },
});

export function App() {
  return (
    <ThemeProvider theme={appTheme}>
      <NavigationHost routes={routes} initial={routes.home()} />
    </ThemeProvider>
  );
}
```

`runApp` validates bundle, runtime, protocol, and native capability versions before mounting the root.

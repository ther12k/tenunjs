import { NavigationHost, defineRoutes } from "@tenunjs/navigation";
import { ThemeProvider } from "@tenunjs/widgets";
import { CounterScreen } from "./screens/counter.screen";
import { appTheme } from "./theme";

const routes = defineRoutes({
  counter: { path: "/", screen: CounterScreen },
});

export function App() {
  return (
    <ThemeProvider theme={appTheme}>
      <NavigationHost routes={routes} initial={routes.counter()} />
    </ThemeProvider>
  );
}

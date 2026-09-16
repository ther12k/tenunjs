import { NavigationHost, defineRoutes } from "@tenunjs/navigation";
import { ThemeProvider } from "@tenunjs/widgets";
import { CalculatorScreen } from "./screens/calculator.screen";
import { appTheme } from "./theme";

const routes = defineRoutes({
  calculator: { path: "/", screen: CalculatorScreen },
});

export function App() {
  return (
    <ThemeProvider theme={appTheme}>
      <NavigationHost routes={routes} initial={routes.calculator()} />
    </ThemeProvider>
  );
}

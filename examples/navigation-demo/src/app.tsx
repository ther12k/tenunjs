import { NavigationHost, defineRoutes } from "@tenunjs/navigation";
import { ThemeProvider } from "@tenunjs/widgets";
import { routes } from "./routes";
import { appTheme } from "./theme";

export function App() {
  return (
    <ThemeProvider theme={appTheme}>
      <NavigationHost routes={routes} initial={routes.home()} />
    </ThemeProvider>
  );
}

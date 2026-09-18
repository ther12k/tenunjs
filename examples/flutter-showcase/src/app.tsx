import { NavigationHost } from "@tenunjs/navigation";
import { ThemeProvider } from "@tenunjs/widgets";
import { routes } from "./routes";
import { showcaseTheme } from "./theme";

export function App() {
  return (
    <ThemeProvider theme={showcaseTheme}>
      <NavigationHost routes={routes} initial={routes.home()} />
    </ThemeProvider>
  );
}

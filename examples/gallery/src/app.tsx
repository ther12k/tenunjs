import { NavigationHost, defineRoutes } from "@tenunjs/navigation";
import { ThemeProvider } from "@tenunjs/widgets";
import { routes } from "./routes";
import { galleryTheme } from "./theme";

export function App() {
  return (
    <ThemeProvider theme={galleryTheme}>
      <NavigationHost routes={routes} initial={routes.home()} />
    </ThemeProvider>
  );
}

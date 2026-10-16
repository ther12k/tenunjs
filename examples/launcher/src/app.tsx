import { NavigationHost, defineRoutes } from "@tenunjs/navigation";
import { ThemeProvider } from "@tenunjs/widgets";
import { HomeScreen } from "./screens/home.screen";
import { appTheme } from "./theme";

const routes = defineRoutes({
  home: { path: "/", screen: HomeScreen },
});

export function App() {
  return (
    <ThemeProvider theme={appTheme}>
      <NavigationHost routes={routes} initial={routes.home()} />
    </ThemeProvider>
  );
}

import { NavigationHost, defineRoutes } from "@tenunjs/navigation";
import { ThemeProvider } from "@tenunjs/widgets";
import { TasksScreen } from "./screens/tasks.screen";

const routes = defineRoutes({
  tasks: { path: "/", screen: TasksScreen },
});

export function App() {
  return (
    <ThemeProvider theme={{}}>
      <NavigationHost routes={routes} initial={routes.tasks()} />
    </ThemeProvider>
  );
}

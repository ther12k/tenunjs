import { ApplicationRuntime, type LayoutViewport } from "@tenunjs/widgets";
import { checkedPlanProgress, type PlanProgress, type PlanRoute } from "./plan";
import { ProgressScreen } from "./screens/progress.screen";
import { TodayScreen } from "./screens/today.screen";
import { dayPlanTheme } from "./theme";

export const FRAMEWORK_FEEL_VIEWPORT: Readonly<LayoutViewport> = Object.freeze({ width: 720, height: 1000 });

/** One composition shared by the browser host, QuickJS, and structural tests. */
export function createFrameworkFeelRuntime(viewport: LayoutViewport = FRAMEWORK_FEEL_VIEWPORT): ApplicationRuntime {
  const app: ApplicationRuntime = new ApplicationRuntime({
    screens: { today: TodayScreen, progress: ProgressScreen },
    initial: "today",
    theme: dayPlanTheme,
    viewport,
    services: {
      navigate(route: PlanRoute, progress?: PlanProgress) {
        if (route === "progress") {
          // App data travels through the existing state-channel contract.
          // The newly active route receives it without remounting its session.
          app.pushState("receiveProgress", checkedPlanProgress(progress));
        }
        app.navigate(route);
      },
    },
  });
  return app;
}

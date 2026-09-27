/**
 * Host-bundle entry for this application — the TN-133 browser-preview
 * leg. Uses ONLY the public @tenunjs/* packages (vendored tarballs): the
 * application's screens run inside the public ApplicationRuntime, and the
 * handoff adapter speaks the exact commit/dispatch protocol the Android
 * bridge and the generic contract host (examples/gallery-preview/host.html)
 * both consume.
 *
 * Compiled by scripts/build-host.ts into .out/host-app.js.
 */
import { ApplicationRuntime, installHostHandoff } from "@tenunjs/widgets";
import { TasksScreen } from "./screens/tasks.screen";

const appTheme = {
  colors: {
    surface: "#101014",
    surfaceRaised: "#1C1C24",
    text: "#F2F2F7",
    accent: "#7C4DFF",
  },
  spacing: { sm: 8, md: 16, lg: 24 },
};

const app = new ApplicationRuntime({
  screens: { tasks: TasksScreen },
  initial: "tasks",
  theme: appTheme as never,
});

const host = globalThis as Record<string, unknown>;
const handoff = installHostHandoff({
  app,
  // Late-bound like the Android device entry: the host installs its
  // tenun_commit before this bundle loads; headless drivers fall back to
  // the __tenun_last_scene global.
  commit: (json: string) => {
    const sink = host["tenun_commit"];
    if (typeof sink === "function") {
      (sink as (value: string) => void)(json);
    } else {
      host["__tenun_last_scene"] = json;
    }
  },
});

// The host→app entry point every host looks for (JNI bridge, browser
// contract host, headless drivers).
host["__tenun_dispatch_action"] = handoff.dispatch;

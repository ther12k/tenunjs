/**
 * Android/QuickJS adapter: the gallery application composition behind
 * the PUBLIC host-handoff contract (TN-133 extraction). Execution,
 * lowering, snapshots, and the commit/dispatch protocol are the
 * supported @tenunjs/widgets runtime; this entry contributes only the
 * application itself (screens, theme, chrome) and the QuickJS global
 * wiring the native bridge looks for.
 */
import { installHostHandoff } from "@tenunjs/widgets";
import { GalleryRuntime } from "../../../../examples/gallery-preview/runtime";

const app = new GalleryRuntime();
const host = globalThis as Record<string, unknown>;
const handoff = installHostHandoff({
  app,
  // Late-bound, matching the legacy adapter: inside QuickJS the native
  // tenun_commit binding exists at eval time; in the headless smoke run
  // the harness installs a recorder; otherwise the last scene lands in
  // a global for dev drivers.
  commit: (json: string) => {
    const sink = host["tenun_commit"];
    if (typeof sink === "function") {
      (sink as (value: string) => void)(json);
    } else {
      host["__tenun_last_scene"] = json;
    }
  },
});

(globalThis as Record<string, unknown>)["__tenun_dispatch_action"] = handoff.dispatch;

// Headless tests can drive the same adapter without a native host. This is
// intentionally a global rather than an export so the QuickJS bundle remains
// valid script input to JS_Eval(GLOBAL).
if (typeof (globalThis as Record<string, unknown>)["tenun_commit"] !== "function") {
  (globalThis as Record<string, unknown>)["__tenun_device_test"] = {
    route: () => app.route(),
    dispatch: handoff.dispatch,
    // Legacy-exact: read the global the late-binding sink wrote (the
    // handoff's internal store stays empty when a sink is supplied).
    lastScene: () => host["__tenun_last_scene"] as string | null,
  };
}

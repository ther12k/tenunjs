/**
 * TN-144 host-driven entry for the counter sample: the SAME composition
 * a consumer writes (defineScreen TSX + theme), packaged for the Android
 * QuickJS host through the public host-handoff contract. This is the
 * bundle the verify:android engine loop boots — the gate that keeps the
 * TSX→QuickJS route continuously proven instead of asserted by README.
 *
 * Execution stays the supported @tenunjs/widgets runtime
 * (ApplicationRuntime + installHostHandoff); this entry contributes only
 * the counter application itself and the QuickJS global wiring the
 * native bridge looks for (mirroring device-entry.ts).
 */
import type { ScreenDefinition } from "@tenunjs/core";
import { ApplicationRuntime, installHostHandoff } from "@tenunjs/widgets";
import { CounterScreen } from "../../../../examples/counter/src/screens/counter.screen";
import { appTheme } from "../../../../examples/counter/src/theme";

const app = new ApplicationRuntime({
  screens: { counter: CounterScreen as ScreenDefinition<any, any> },
  initial: "counter",
  theme: appTheme,
});

const host = globalThis as Record<string, unknown>;
const handoff = installHostHandoff({
  app,
  // Late-bound, matching device-entry.ts: inside QuickJS the native
  // tenun_commit binding exists at eval time; headless smoke runs install
  // a recorder; otherwise the last scene lands in a global for drivers.
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

// Headless drivers (build smoke, future hosts) can reach the same
// adapter without a native host. Intentionally a global, not an export,
// so the QuickJS bundle stays valid script input to JS_Eval(GLOBAL).
if (typeof host["tenun_commit"] !== "function") {
  (globalThis as Record<string, unknown>)["__tenun_device_test"] = {
    route: () => app.route(),
    dispatch: handoff.dispatch,
    // Legacy-exact: read the global the late-binding sink wrote (the
    // handoff's internal store stays empty when a sink is supplied).
    lastScene: () => host["__tenun_last_scene"] as string | null,
  };
}

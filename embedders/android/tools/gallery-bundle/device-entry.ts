/** Android/QuickJS adapter around the shared browser-independent GalleryRuntime. */
import { GalleryRuntime } from "../../../../examples/gallery-preview/runtime";
const runtime = new GalleryRuntime();

function commit(): void {
  const host = globalThis as Record<string, unknown>;
  const json = JSON.stringify(runtime.render().scene);
  if (typeof host["tenun_commit"] === "function") {
    (host["tenun_commit"] as (value: string) => void)(json);
  } else {
    host["__tenun_last_scene"] = json;
  }
}

(globalThis as Record<string, unknown>)["__tenun_dispatch_action"] = (
  action: string,
  payloadJson: string,
): string => {
  let payload: unknown = {};
  try {
    payload = JSON.parse(payloadJson || "{}");
  } catch {
    payload = {};
  }
  // Case-insensitive: the display-list contract puts lowercase "tap" in
  // scene regions, and the host echoes it back verbatim. The commit after
  // TAP is what repaints the phone — without it the engine keeps the stale
  // scene even when the action ran.
  const normalized = action.toUpperCase();
  if (normalized === "__TENUN_EXPORT") return JSON.stringify(runtime.exportState());
  runtime.dispatch(normalized, payload);
  if (normalized === "TENUN_RESTORE" || normalized === "TAP") commit();
  return JSON.stringify({ route: runtime.route() });
};

commit();

// Headless tests can drive the same adapter without a native host. This is
// intentionally a global rather than an export so the QuickJS bundle remains
// valid script input to JS_Eval(GLOBAL).
if (typeof (globalThis as Record<string, unknown>)["tenun_commit"] !== "function") {
  (globalThis as Record<string, unknown>)["__tenun_device_test"] = {
    route: () => runtime.route(),
    dispatch: (globalThis as Record<string, unknown>)["__tenun_dispatch_action"],
    lastScene: () => (globalThis as Record<string, unknown>)["__tenun_last_scene"],
  };
}

import { defineConfig } from "@tenunjs/cli";

// Host-driven application (the polytron pattern): composition lives in
// TvplayerRuntime; the Android tv flavor binds the "media" host service
// over the JNI bridge, the browser preview binds the fail-closed stub,
// and headless tests run against a fake MediaCapability.
export default defineConfig({
  projectName: "tvplayer",
  displayName: "NusaTV",
});

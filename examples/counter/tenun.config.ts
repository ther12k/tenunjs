import { defineConfig } from "@tenunjs/cli";

// TN-021 application project configuration. entry ("src/main.tsx") and
// outDir ("dist") are intentionally left to their documented defaults,
// so the loader reports them as applied defaults.
export default defineConfig({
  projectName: "counter",
  displayName: "Tenun Counter",
});

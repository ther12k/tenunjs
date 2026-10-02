import { defineConfig } from "@tenunjs/cli";

// TN-021 application project configuration. entry ("src/main.tsx") keeps
// its documented default; that module re-exports the VotolRuntime
// composition instead of calling runApp because this sample is
// host-driven — the browser shell, headless tests, and a future embedder
// construct the runtime with their own service seams.
export default defineConfig({
  projectName: "votol",
  displayName: "VOTOL Companion",
});

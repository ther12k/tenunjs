import { defineConfig } from "@tenunjs/cli";

// Host-driven application (the votol pattern): composition lives in
// WasherRuntime; the browser shell wires Web Bluetooth, headless tests
// run against a fake seam, and a future native embedder binds the same
// seams to platform BLE modules.
export default defineConfig({
  projectName: "polytron",
  displayName: "Polytron Wash",
});

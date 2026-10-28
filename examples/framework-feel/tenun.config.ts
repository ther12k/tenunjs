import { defineConfig } from "@tenunjs/cli";

// The configured entry is the same host-driven composition both prototype
// embedders execute. Its ordinary TSX screens stay host-independent.
export default defineConfig({
  projectName: "framework-feel",
  displayName: "Day Plan",
  entry: "src/host-entry.ts",
});

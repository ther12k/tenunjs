/**
 * TN-021 application entry. Unlike the runApp-booted samples (counter,
 * gallery, …), this app is host-driven: composition lives in VotolRuntime,
 * and every capability is a service seam the host injects (the browser
 * shell in dev.ts wires fetch + Web Bluetooth; tests run headless; a
 * native embedder will bind the same seams to platform modules). The
 * entry re-exports that composition so the TN-022 module graph covers
 * the whole app from the documented default root, src/main.tsx.
 */
export { VotolRuntime } from "./runtime";
export type { PodServices, VotolServices } from "./runtime";

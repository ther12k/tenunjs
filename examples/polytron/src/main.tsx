/**
 * Application entry (the votol pattern): this app is host-driven —
 * composition lives in WasherRuntime and every capability is a service
 * seam the host injects (the browser shell wires Web Bluetooth; tests
 * run headless against a fake seam; a native embedder will bind the same
 * seams to platform BLE modules). The entry re-exports the composition
 * so the module graph covers the whole app from src/main.tsx.
 */
export { WasherRuntime } from "./runtime";
export type { BleLinkState, BleSeam, WasherHostServices, WasherServices } from "./runtime";

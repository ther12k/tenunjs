import { runApp } from "@tenunjs/core";
import { App } from "./app";

declare const __DEV__: boolean;

runApp({
  root: <App />,
  config: {
    displayName: "Tenun Gallery",
    diagnostics: __DEV__,
  },
});

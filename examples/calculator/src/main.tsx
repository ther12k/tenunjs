import { runApp } from "@tenunjs/core";
import { App } from "./app";

runApp({
  root: <App />,
  config: {
    displayName: "Tenun Calculator",
    diagnostics: __DEV__,
  },
});

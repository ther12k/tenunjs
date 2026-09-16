import { runApp } from "@tenunjs/core";
import { App } from "./app";

runApp({
  root: <App />,
  config: {
    displayName: "Tenun Tasks",
    diagnostics: __DEV__,
  },
});

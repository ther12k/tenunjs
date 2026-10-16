import { runApp } from "@tenunjs/core";
import { App } from "./app";

runApp({
  root: <App />,
  config: {
    displayName: "Tenun Launcher",
    diagnostics: __DEV__,
  },
});

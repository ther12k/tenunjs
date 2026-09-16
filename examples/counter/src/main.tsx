import { runApp } from "@tenunjs/core";
import { App } from "./app";

runApp({
  root: <App />,
  config: {
    displayName: "Tenun Counter",
    diagnostics: __DEV__,
  },
});

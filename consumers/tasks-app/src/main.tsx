import { runApp } from "@tenunjs/core";
import { App } from "./app";

runApp({
  root: <App />,
  config: {
    displayName: "Rehearsal Tasks",
    diagnostics: false,
  },
});

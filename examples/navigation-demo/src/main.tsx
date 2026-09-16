import { runApp } from "@tenunjs/core";
import { App } from "./app";

runApp({
  root: <App />,
  config: {
    displayName: "Weavers Guild",
    diagnostics: __DEV__,
  },
});

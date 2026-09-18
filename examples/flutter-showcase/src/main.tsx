import { runApp } from "@tenunjs/core";
import { App } from "./app";

declare const __DEV__: boolean;

runApp({
  root: <App />,
  config: {
    displayName: "Flutter Showcase by TenunJS",
    diagnostics: __DEV__,
  },
});

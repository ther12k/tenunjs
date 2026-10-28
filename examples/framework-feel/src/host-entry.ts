import { installHostHandoff } from "@tenunjs/widgets";
import { createFrameworkFeelRuntime } from "./runtime";

const app = createFrameworkFeelRuntime();
const host = globalThis as Record<string, unknown>;
const handoff = installHostHandoff({
  app,
  commit(json) {
    const sink = host["tenun_commit"];
    if (typeof sink === "function") sink(json);
    else host["__tenun_last_scene"] = json;
  },
});

host["__tenun_dispatch_action"] = handoff.dispatch;

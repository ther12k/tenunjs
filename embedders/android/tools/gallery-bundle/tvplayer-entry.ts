/**
 * TN-196 native host entry for Tenun TV: packages TvplayerRuntime for
 * native Android execution in QuickJS (tv flavor) with the JNI Host
 * Service Bridge for the "media" host service (TN-193) and the KEY
 * action path (TN-194) — the polytron-entry pattern.
 */
import { installHostHandoff } from "@tenunjs/widgets";
import type { CapabilityFailure, CapabilityResult } from "@tenunjs/platform";
import { TvplayerRuntime } from "../../../../examples/tvplayer/src/runtime";

const host = globalThis as Record<string, unknown>;

interface ActiveTimer {
  id: number;
  runAt: number;
  fn: () => void;
}

let nextTimerId = 1;
const activeTimers = new Map<number, ActiveTimer>();

function drainTimers(): void {
  const now = Date.now();
  for (const [id, t] of Array.from(activeTimers.entries())) {
    if (now >= t.runAt) {
      activeTimers.delete(id);
      try {
        t.fn();
      } catch {
        // Continue draining
      }
    }
  }
}

// QuickJS timer shim (the polytron-entry pattern): async work in the
// app (fetchText promises, prepare→play chains) needs macrotasks.
if (typeof (host as { setTimeout?: unknown }).setTimeout !== "function") {
  (host as { setTimeout: (fn: () => void, ms?: number) => number }).setTimeout = (
    fn: () => void,
    ms: number = 0
  ) => {
    const id = nextTimerId++;
    const delay = Math.max(0, ms);
    activeTimers.set(id, { id, runAt: Date.now() + delay, fn });
    if (typeof host.tenun_host_call === "function") {
      try {
        (host.tenun_host_call as (s: string, m: string, p: string) => string | null)(
          "system",
          "scheduleTimer",
          JSON.stringify({ delayMs: delay })
        );
      } catch {
        // Host scheduler optional; the dispatch entry drains timers.
      }
    }
    return id;
  };
  (host as { clearTimeout: (id: number) => void }).clearTimeout = (id: number) => {
    activeTimers.delete(id);
  };
}

const hostCall = host.tenun_host_call as
  | ((service: string, method: string, payload: string) => string | null)
  | undefined;

const UNSUPPORTED: CapabilityResult<never> = {
  ok: false,
  failure: { kind: "unsupported", message: "tvplayer: media host unavailable" },
};

/**
 * The "media" NativeService bridge (04-api/media.md): every op replies
 * with the CapabilityResult JSON the Kotlin service mirrors; a null
 * reply (host without the service) degrades to a structured
 * unsupported failure — never a throw.
 *
 * fetchText is an async ticket on this host (media.md "Android
 * delivery"): the invoke replies {ok:true, value:{ticket}} and the
 * completion arrives later as a MEDIA_TEXT event, which
 * resolveTicket() turns into the original promise's settlement. A
 * blocking GET would exceed the engine's JS entry time budget.
 */
const pendingFetch = new Map<number, (result: CapabilityResult<string>) => void>();
let fetchTicket = 0;

type Reply =
  | { ok: true; value: unknown }
  | { ok: false; failure: CapabilityFailure };

const nativeMediaBridge = {
  contractVersion: 1 as const,
  prepare: (url: string) => invokeJson("prepare", { url }),
  play: () => invokeJson("play", {}),
  pause: () => invokeJson("pause", {}),
  stop: () => invokeJson("stop", {}),
  setRect: (x: number, y: number, w: number, h: number) => invokeJson("setRect", { x, y, w, h }),
  status: () => invokeJson("status", {}),
  fetchText: (url: string): Promise<CapabilityResult<string>> => {
    if (typeof hostCall !== "function") return Promise.resolve(UNSUPPORTED);
    const parsed = parseReply(hostCall("media", "fetchText", JSON.stringify({ url })));
    if (parsed === null || !parsed.ok) {
      return Promise.resolve((parsed ?? UNSUPPORTED) as CapabilityResult<string>);
    }
    const ticket = (parsed.value as { ticket?: unknown } | null)?.ticket;
    if (typeof ticket !== "number") return Promise.resolve(UNSUPPORTED);
    return new Promise<CapabilityResult<string>>((resolve) => {
      pendingFetch.set(ticket, resolve);
    });
  },
};

function invokeJson(method: string, payload: Record<string, unknown>): Promise<CapabilityResult<never>> {
  if (typeof hostCall !== "function") return Promise.resolve(UNSUPPORTED);
  const parsed = parseReply(hostCall("media", method, JSON.stringify(payload)));
  return Promise.resolve((parsed ?? UNSUPPORTED) as CapabilityResult<never>);
}

/** Parses the Kotlin service's CapabilityResult JSON; null (no service)
 *  or a malformed reply degrades to null and the caller fails closed. */
function parseReply(reply: string | null): Reply | null {
  if (reply === null || reply === undefined) return null;
  try {
    const parsed = JSON.parse(reply) as { ok?: unknown; value?: unknown; failure?: unknown };
    if (parsed.ok === true) return { ok: true, value: parsed.value };
    if (
      parsed.ok === false &&
      parsed.failure !== null &&
      typeof parsed.failure === "object" &&
      typeof (parsed.failure as { kind?: unknown }).kind === "string"
    ) {
      return { ok: false, failure: parsed.failure as CapabilityFailure };
    }
    return null;
  } catch {
    return null;
  }
}

/** MEDIA_TEXT event landing: settles the fetchText promise that owns
 *  the ticket. Unknown/stale tickets are dropped (idempotent). */
function resolveTicket(payloadJson: string): void {
  let ticket: number | undefined;
  let result: CapabilityResult<string> = UNSUPPORTED;
  try {
    const parsed = JSON.parse(payloadJson) as {
      ticket?: unknown;
      ok?: unknown;
      text?: unknown;
      message?: unknown;
    };
    if (typeof parsed.ticket === "number") ticket = parsed.ticket;
    if (parsed.ok === true && typeof parsed.text === "string") {
      result = { ok: true, value: parsed.text };
    } else if (parsed.ok === false) {
      result = {
        ok: false,
        failure: {
          kind: "unavailable",
          message: typeof parsed.message === "string" ? parsed.message : "fetch failed",
        },
      };
    }
  } catch {
    return; // malformed event: nothing to resolve
  }
  if (ticket !== undefined) {
    const resolve = pendingFetch.get(ticket);
    if (resolve) {
      pendingFetch.delete(ticket);
      resolve(result);
    }
  }
}

const app = new TvplayerRuntime({
  media: nativeMediaBridge,
});

const handoff = installHostHandoff({
  app: {
    route: () => app.route(),
    stateSchema: () => app.stateSchema(),
    exportState: () => app.exportState(),
    onStateInvalidation: (listener: () => void) => app.onStateInvalidation(listener),
    dispatch: (action: string, payload?: unknown) => app.dispatch(action, payload),
    render: () => app.render(),
    goBack: () => app.goBack(),
  },
  commit: (json: string) => {
    const sink = host["tenun_commit"];
    if (typeof sink === "function") {
      (sink as (value: string) => void)(json);
    } else {
      host["__tenun_last_scene"] = json;
    }
  },
});

host["__tenun_dispatch_action"] = (action: string, payloadJson: string): string => {
  drainTimers();
  const norm = action.toUpperCase();
  if (norm === "KEY") {
    // TN-194: the host dispatches {keyCode, phase} for every key the
    // IME path declines; the reply's {handled} decides consumption —
    // handoff.dispatch does NOT emit it for unknown verbs, so the KEY
    // intercept lives HERE (the polytron TIMER precedent).
    let keyCode = -1;
    let phase = "down";
    try {
      const parsed = JSON.parse(payloadJson || "{}") as { keyCode?: unknown; phase?: unknown };
      if (typeof parsed.keyCode === "number") keyCode = parsed.keyCode;
      if (typeof parsed.phase === "string") phase = parsed.phase;
    } catch {
      // malformed payload: falls through as unhandled
    }
    const handled = keyCode >= 0 && app.keyPress(keyCode, phase);
    return JSON.stringify({ handled });
  }
  if (norm === "MEDIA_STATE") {
    app.dispatch("MEDIA_STATE", safeParse(payloadJson));
    return JSON.stringify({ route: app.route() });
  }
  if (norm === "MEDIA_TEXT") {
    resolveTicket(payloadJson);
    return JSON.stringify({ route: app.route() });
  }
  return handoff.dispatch(action, payloadJson);
};

function safeParse(payloadJson: string): Record<string, unknown> {
  try {
    return JSON.parse(payloadJson || "{}") as Record<string, unknown>;
  } catch {
    return {};
  }
}

if (typeof host["tenun_commit"] !== "function") {
  host["__tenun_device_test"] = {
    route: () => app.route(),
    dispatch: host["__tenun_dispatch_action"],
    lastScene: () => host["__tenun_last_scene"] as string | null,
  };
}

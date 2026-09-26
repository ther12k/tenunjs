/**
 * Application runtime — the public execution contract of the TN-133
 * extraction (slice 2).
 *
 * Executes real @tenunjs/core screen definitions (initialState, typed
 * actions, view) against the public display-list lowering: it owns the
 * active route, per-screen sessions, host-verb dispatch, and the
 * STATE_SCHEMA-versioned snapshot that carries application state across
 * bundle swaps (hot reload, OTA).
 *
 * Behavior-preserving extraction of the proven loop that lived in
 * examples/gallery-preview/runtime.ts (GalleryRuntime), with the
 * contract edges the classification (PR #209) marked "provisional →
 * candidate for supported" now made explicit and fail-closed:
 *
 *  - unknown routes, unknown dispatch verbs, malformed/foreign tap ids,
 *    null view() results, schema-mismatched snapshots, and use after
 *    dispose throw ApplicationRuntimeError instead of being silently
 *    swallowed (the gallery loop ignored all of these);
 *  - action contexts receive a REAL AbortSignal (aborted by dispose())
 *    instead of `undefined`;
 *  - async action results are still not awaited across the synchronous
 *    host bridge, but rejections are routed to onAsyncActionError
 *    instead of becoming dropped promises;
 *  - navigation-by-action is not baked in: applications wire it through
 *    `services` (the gallery's home-screen special case moved into the
 *    example, where it belongs).
 *
 * Rendering goes through layoutScreen with the APPLICATION-OWNED theme;
 * no gallery theming is baked into this module. Hosts consume the scene
 * JSON via ./host-handoff (installHostHandoff) — the exact protocol the
 * Android bridge already speaks.
 *
 * Still example-owned and NOT part of this contract: any specific screen
 * registry, gallery chrome (e.g. the non-home back bar), and the bundle
 * compiler / arbitrary-entry resolution (TN-023).
 */

import type { ScreenDefinition } from "@tenunjs/core";
import { layoutScreen } from "./display-list";
import type { DisplayListScene } from "./display-list";
import type { ThemeConfig } from "./index";

/** Snapshot contract version. Bump only with a deliberate migration design:
 *  hosts carry state across a bundle swap only when both sides match. */
export const APPLICATION_STATE_SCHEMA = 1;

export interface ApplicationSnapshot {
  readonly route: string;
  readonly states: Record<string, unknown>;
  readonly stateSchema: number;
}

export interface ApplicationRender {
  readonly scene: DisplayListScene;
  readonly tapRuns: Array<() => void>;
}

export type ApplicationServices = Record<string, unknown>;

export interface ApplicationRuntimeOptions {
  /** Screen registry the application provides; keys are route names. */
  readonly screens: Record<string, ScreenDefinition<any, any>>;
  /** Route mounted at construction. Must exist in `screens`. */
  readonly initial: string;
  /** Application-owned theme passed to layoutScreen unchanged. */
  readonly theme: ThemeConfig;
  /** Merged into every action context (e.g. a navigate callback). */
  readonly services?: ApplicationServices;
  /** Design width for the emitted scene; defaults to layoutScreen's. */
  readonly designWidth?: number;
  /** Sink for async action rejections (they cannot cross the sync bridge). */
  readonly onAsyncActionError?: (info: {
    screen: string;
    action: string;
    error: unknown;
  }) => void;
}

export type ApplicationErrorCode =
  | "INVALID_INITIAL_SCREEN"
  | "UNKNOWN_SCREEN"
  | "UNKNOWN_ACTION"
  | "TAP_TARGET_UNKNOWN"
  | "INVALID_VIEW"
  | "SNAPSHOT_INVALID"
  | "SNAPSHOT_SCHEMA_MISMATCH"
  | "RUNTIME_DISPOSED";

export class ApplicationRuntimeError extends Error {
  readonly code: ApplicationErrorCode;

  constructor(code: ApplicationErrorCode, message: string) {
    super(`[TENUN_APP_ERROR] ${message}`);
    this.name = "ApplicationRuntimeError";
    this.code = code;
  }
}

interface Session {
  readonly name: string;
  readonly state: any;
  readonly actions: Record<string, (input?: unknown) => void>;
}

/** Restore options: strict by default; forgiving mode exists for state
 *  carry across bundle SWAPS (hot reload / OTA), where the old snapshot
 *  may legitimately reference screens a newer bundle removed. */
export interface RestoreOptions {
  readonly ignoreUnknownScreens?: boolean;
}

function isThenable(value: unknown): value is Promise<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { then?: unknown }).then === "function"
  );
}

export class ApplicationRuntime {
  private readonly screens: Record<string, ScreenDefinition<any, any>>;
  private readonly theme: ThemeConfig;
  private readonly services: ApplicationServices;
  private readonly designWidth: number | undefined;
  private readonly onAsyncActionError:
    | ((info: { screen: string; action: string; error: unknown }) => void)
    | undefined;
  private readonly abort = new AbortController();
  private readonly sessions = new Map<string, Session>();
  private current: string;
  private lastTapRuns: Array<() => void> = [];
  private disposedState = false;

  constructor(options: ApplicationRuntimeOptions) {
    if (!options || typeof options !== "object") {
      throw new ApplicationRuntimeError("INVALID_INITIAL_SCREEN", "runtime options are required");
    }
    if (!options.screens || typeof options.screens !== "object") {
      throw new ApplicationRuntimeError("INVALID_INITIAL_SCREEN", "runtime requires a screens registry");
    }
    if (!(options.initial in options.screens)) {
      throw new ApplicationRuntimeError(
        "INVALID_INITIAL_SCREEN",
        `initial route "${options.initial}" is not a registered screen`
      );
    }
    this.screens = options.screens;
    this.theme = options.theme;
    this.services = { ...(options.services ?? {}) };
    this.designWidth = options.designWidth;
    this.onAsyncActionError = options.onAsyncActionError;
    this.current = options.initial;
    this.sessions.set(options.initial, this.mount(options.initial));
  }

  route(): string {
    return this.current;
  }

  routes(): string[] {
    return Object.keys(this.screens);
  }

  get disposed(): boolean {
    return this.disposedState;
  }

  /** The schema constant snapshots carry; hosts compare both sides. */
  stateSchema(): number {
    return APPLICATION_STATE_SCHEMA;
  }

  navigate(name: string): void {
    this.assertLive();
    if (!(name in this.screens)) {
      throw new ApplicationRuntimeError("UNKNOWN_SCREEN", `unknown screen "${name}"`);
    }
    this.current = name;
    if (!this.sessions.has(name)) this.sessions.set(name, this.mount(name));
  }

  /**
   * Renders the active screen through the public lowering. The returned
   * tapRuns array is the live dispatch table for THIS render: hosts echo
   * a region's payload id, dispatch("TAP", id) runs taps[id]. The caller
   * may append entries (example chrome does) before the scene is
   * serialized; dispatch keeps working because the array identity is
   * preserved.
   */
  render(): ApplicationRender {
    this.assertLive();
    const session = this.sessions.get(this.current) ?? this.mount(this.current);
    this.sessions.set(this.current, session);
    const tree = this.screens[session.name]!.view({
      state: session.state,
      actions: session.actions,
    }) as ReturnType<ScreenDefinition<any, any>["view"]>;
    if (tree === null || tree === undefined) {
      throw new ApplicationRuntimeError(
        "INVALID_VIEW",
        `screen "${session.name}" produced a null view`
      );
    }
    const { scene, tapRuns } = layoutScreen(this.theme, tree, this.designWidth);
    this.lastTapRuns = tapRuns;
    return { scene, tapRuns };
  }

  /**
   * Host-verb dispatch. The verb set is closed (the display-list contract
   * puts lowercase "tap" in scene regions and hosts echo it verbatim, so
   * comparison is case-insensitive):
   *
   *  - "TAP" { id } — run the tap-run the CURRENT render assigned.
   *  - "TENUN_RESTORE" — restore a snapshot (see restore).
   *  - "__TENUN_EXPORT" — no-op here; hosts pull state via exportState().
   *
   * Anything else throws UNKNOWN_ACTION (fail-closed).
   */
  dispatch(action: string, payload?: unknown): void {
    this.assertLive();
    const normalized = action.toUpperCase();
    if (normalized === "__TENUN_EXPORT") return;
    if (normalized === "TENUN_RESTORE") {
      this.restore(payload as Partial<ApplicationSnapshot>);
      return;
    }
    if (normalized === "TAP") {
      const id =
        typeof payload === "number"
          ? payload
          : typeof (payload as { id?: unknown } | undefined)?.id === "number"
            ? ((payload as { id: number }).id as number)
            : NaN;
      if (!Number.isInteger(id) || id < 0 || id >= this.lastTapRuns.length) {
        throw new ApplicationRuntimeError(
          "TAP_TARGET_UNKNOWN",
          `tap payload ${JSON.stringify(payload ?? null)} does not name a run in the current scene (${this.lastTapRuns.length} runs)`
        );
      }
      this.lastTapRuns[id]!();
      return;
    }
    throw new ApplicationRuntimeError("UNKNOWN_ACTION", `unknown dispatch verb "${action}"`);
  }

  exportState(): ApplicationSnapshot {
    this.assertLive();
    const states: Record<string, unknown> = {};
    for (const [name, session] of this.sessions) states[name] = session.state;
    return { route: this.current, states, stateSchema: APPLICATION_STATE_SCHEMA };
  }

  restore(snapshot: Partial<ApplicationSnapshot>, options: RestoreOptions = {}): void {
    this.assertLive();
    if (!snapshot || typeof snapshot !== "object") {
      throw new ApplicationRuntimeError("SNAPSHOT_INVALID", "snapshot must be an object");
    }
    if (
      snapshot.stateSchema !== undefined &&
      snapshot.stateSchema !== APPLICATION_STATE_SCHEMA
    ) {
      throw new ApplicationRuntimeError(
        "SNAPSHOT_SCHEMA_MISMATCH",
        `snapshot stateSchema ${String(snapshot.stateSchema)} does not match runtime schema ${APPLICATION_STATE_SCHEMA}`
      );
    }
    const ignoreUnknown = options.ignoreUnknownScreens === true;
    const states = snapshot.states;
    if (states !== undefined) {
      if (!states || typeof states !== "object") {
        throw new ApplicationRuntimeError("SNAPSHOT_INVALID", "snapshot.states must be an object");
      }
      for (const name of Object.keys(states)) {
        if (name in this.screens) {
          this.sessions.set(name, this.mount(name, (states as Record<string, unknown>)[name]));
        } else if (!ignoreUnknown) {
          throw new ApplicationRuntimeError(
            "UNKNOWN_SCREEN",
            `snapshot references unknown screen "${name}"`
          );
        }
      }
    }
    if (typeof snapshot.route === "string") {
      if (snapshot.route in this.screens) {
        this.current = snapshot.route;
      } else if (!ignoreUnknown) {
        throw new ApplicationRuntimeError(
          "UNKNOWN_SCREEN",
          `snapshot route "${snapshot.route}" is not a registered screen`
        );
      }
    }
  }

  /**
   * Terminal teardown: aborts every action signal. Mutating and
   * rendering entry points (navigate, render, dispatch, exportState,
   * restore) throw RUNTIME_DISPOSED afterwards — a host must never
   * drive a disposed runtime. Identity reads (route, routes,
   * stateSchema, disposed) survive for post-mortem logging.
   */
  dispose(): void {
    if (this.disposedState) return;
    this.abort.abort();
    this.disposedState = true;
  }

  private assertLive(): void {
    if (this.disposedState) {
      throw new ApplicationRuntimeError("RUNTIME_DISPOSED", "runtime has been disposed");
    }
  }

  private mount(name: string, restoredState?: unknown): Session {
    const screen = this.screens[name]!;
    const controller = "controller" in screen ? screen.controller : screen;
    const state = restoredState !== undefined ? restoredState : controller.initialState();
    const actions: Record<string, (input?: unknown) => void> = {};
    for (const key of Object.keys(controller.actions)) {
      actions[key] = (input?: unknown) => {
        if (this.disposedState) {
          throw new ApplicationRuntimeError(
            "RUNTIME_DISPOSED",
            `action "${key}" ran against a disposed runtime`
          );
        }
        const handler = (controller.actions as Record<string, unknown>)[key] as
          | ((ctx: unknown) => unknown)
          | { run: (ctx: unknown) => unknown };
        const context = {
          input,
          state,
          services: this.services,
          signal: this.abort.signal,
        };
        const result =
          typeof handler === "function" ? handler(context) : handler.run(context);
        if (isThenable(result)) {
          result.catch((error: unknown) => {
            if (this.onAsyncActionError) {
              this.onAsyncActionError({ screen: name, action: key, error });
            } else {
              throw error;
            }
          });
        }
      };
    }
    return { name, state, actions };
  }
}

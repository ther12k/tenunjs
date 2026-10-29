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
 *  - action contexts receive a REAL AbortSignal when the engine provides
 *    one (aborted by dispose()); bare embeddable engines without the Web
 *    API — QuickJS today — get the runtime's minimal abort surface with
 *    the same `aborted` + 'abort'-listener semantics;
 *  - async action results are still not awaited across the synchronous
 *    host bridge, but rejections are routed to onAsyncActionError
 *    instead of becoming dropped promises, and settlement (fulfilled or
 *    rejected) fires onStateInvalidation so a host can repaint — the
 *    commit-after-TAP path alone cannot see async completion;
 *  - navigation-by-action is not baked in: applications wire it through
 *    `services` (the gallery's home-screen special case moved into the
 *    example, where it belongs);
 *  - TN-153: a split screen's controller `load` hook runs on fresh
 *    mounts (constructor and first navigate) — bootstrap data loads are
 *    a runtime concern, not something each host should have to kick;
 *    restore remounts are exempt (the snapshot is authoritative);
 *  - TN-142: the host→runtime push channel is first-class. Companion
 *    apps are push-driven — live data and link-state reality arrive
 *    while the user is idle — so hosts deliver out-of-band payloads
 *    through push()/pushState()/pushTo() into the SAME action runs taps
 *    use, instead of each app improvising capture-after-mount wrappers
 *    over view() contexts (the pattern this replaced lived in
 *    examples/votol/src/runtime.ts).
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
import { LayoutError, layoutScreen, normalizeSceneTransition, validateLayoutViewport } from "./display-list";
import type { DisplayListScene, LayoutViewport, SceneTransition, SceneTransitionRequest } from "./display-list";
import type { ThemeConfig } from "./index";
import { TextInputError, nextTextRevision, validateTextEditEvent, validateTextInputIdentity } from "./text-input";
import type { TextFieldBinding, TextInputIdentity, TextInputSessionState } from "./text-input";

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

/** TN-169: navigation options. `transition` requests a host-evaluated
 *  route transition on the next committed scene (see SceneTransition). */
export interface NavigateOptions {
  transition?: SceneTransitionRequest;
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
  /** Legacy design width with unbounded root height; mutually exclusive with viewport. */
  readonly designWidth?: number;
  /** Finite root constraints in design units; copied before the first screen mounts. */
  readonly viewport?: LayoutViewport;
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
  | "INVALID_THEME"
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

/**
 * Abort source for action signals. The platform AbortController is used
 * whenever the engine provides one (browsers, Node/Bun tooling, host
 * tests); bare embeddable engines — QuickJS in the Android prototype —
 * ship no AbortController (it is a Web API, not ECMAScript), and
 * constructing one at bundle-eval time failed the device boot
 * (verify-android-device, overlay suite). The fallback keeps the surface
 * actions actually consume: `aborted` plus 'abort' listener notification.
 */
function createAbortSource(): { signal: AbortSignal; abort(): void } {
  if (typeof AbortController === "function") {
    return new AbortController();
  }
  const listeners = new Set<() => void>();
  const signal = {
    aborted: false,
    addEventListener(_type: string, listener: () => void) {
      listeners.add(listener);
    },
    removeEventListener(_type: string, listener: () => void) {
      listeners.delete(listener);
    },
  };
  return {
    signal: signal as unknown as AbortSignal,
    abort() {
      if (signal.aborted) return;
      signal.aborted = true;
      for (const listener of [...listeners]) listener();
    },
  };
}

export class ApplicationRuntime {
  private readonly screens: Record<string, ScreenDefinition<any, any>>;
  private theme: ThemeConfig;
  private readonly services: ApplicationServices;
  private readonly designWidth: number | undefined;
  private viewport: Readonly<LayoutViewport> | undefined;
  private readonly onAsyncActionError:
    | ((info: { screen: string; action: string; error: unknown }) => void)
    | undefined;
  private readonly abort = createAbortSource();
  private readonly sessions = new Map<string, Session>();
  /** TN-142: latest payload per state channel (latest-wins; see pushState). */
  private readonly stateChannels = new Map<string, unknown>();
  private current: string;
  private lastTapRuns: Array<() => void> = [];
  private textFields = new Map<string, TextFieldBinding>();
  private activeTextInput: TextInputSessionState | undefined;
  private nextTextSessionId = 1;
  private readonly staleListeners = new Set<() => void>();
  /** TN-169: stamped onto the next rendered scene, then cleared. */
  private pendingTransition: SceneTransition | null = null;
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
    if (options.viewport !== undefined && options.designWidth !== undefined) {
      throw new LayoutError("INVALID_VIEWPORT", "ApplicationRuntime requires either viewport or designWidth, not both");
    }
    const viewport = options.viewport === undefined ? undefined : validateLayoutViewport(options.viewport);
    this.screens = options.screens;
    this.theme = options.theme;
    this.services = { ...(options.services ?? {}) };
    this.designWidth = options.designWidth;
    this.viewport = viewport;
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

  /**
   * Updates finite surface constraints without remounting screens or changing
   * application state. Viewport belongs to the surface, so snapshots never
   * carry it. Hosts must explicitly supply metrics; no new dispatch verb is
   * introduced here. Identical dimensions do not invalidate a committed scene.
   */
  setViewport(viewport: LayoutViewport): void {
    this.assertLive();
    const next = validateLayoutViewport(viewport);
    if (this.viewport?.width === next.width && this.viewport.height === next.height) return;
    this.viewport = next;
    // Coordinates from the previous layout cannot target the new surface.
    // A subscribed handoff rebuilds this table synchronously on invalidation.
    this.lastTapRuns = [];
    this.notifyStale();
  }

  /**
   * TN-170: swaps the application-owned theme through the same
   * invalidation channel as setViewport. Route, screen sessions,
   * application state, viewport, and the active text-input session are
   * preserved — a palette switch updates the next committed frame with
   * no per-screen wiring and no changed input state (colors ride the
   * role plumbing screens already consume). The theme is not part of
   * state snapshots: restoring a snapshot keeps the CURRENT theme.
   */
  setTheme(theme: ThemeConfig): void {
    this.assertLive();
    if (!theme || typeof theme !== "object" || Array.isArray(theme)) {
      throw new ApplicationRuntimeError("INVALID_THEME", "theme must be an object");
    }
    if (theme.colors !== undefined && (typeof theme.colors !== "object" || Array.isArray(theme.colors))) {
      throw new ApplicationRuntimeError("INVALID_THEME", "theme.colors must be an object");
    }
    this.theme = theme;
    this.notifyStale();
  }

  /**
   * TN-169 burst semantics: a navigation inside one dispatch may commit
   * MORE THAN ONE scene (the out-of-band invalidation commit for channel
   * replay, then the dispatch-return commit). Hosts that only observe
   * dispatch boundaries — the Android engine returns the FINAL commit —
   * must still see the transition, so the stamp rides every commit of
   * the burst and the host handoff ends the burst after its final
   * dispatch-path commit (see installHostHandoff).
   */
  endTransitionBurst(): void {
    this.pendingTransition = null;
  }

  navigate(name: string, options?: NavigateOptions): void {
    this.assertLive();
    if (!(name in this.screens)) {
      throw new ApplicationRuntimeError("UNKNOWN_SCREEN", `unknown screen "${name}"`);
    }
    // TN-169: a navigation may request a host-evaluated transition. The
    // descriptor is stamped on the FIRST scene rendered after this call
    // (exactly one commit) and then clears; a navigation without options
    // cancels any pending one. Snapshots never carry it.
    this.pendingTransition = options?.transition === undefined
      ? null
      : normalizeSceneTransition(options.transition);
    if (this.current !== name) this.endTextInput();
    this.current = name;
    if (!this.sessions.has(name)) this.sessions.set(name, this.mount(name));
    // The new screen has not rendered yet: tap ids from the PREVIOUS
    // scene's committed table must not dispatch against it. render()
    // repopulates the table for the new scene.
    this.lastTapRuns = [];
    this.textFields.clear();
    // TN-142: replay every cached state channel the newly active screen
    // implements — the "no blank hero after navigate" property. Screens
    // that never subscribed to a channel are skipped; transient pushes
    // are never replayed. Invalidation fires once after the replay loop
    // (coalesced), so invalidation-driven hosts repaint a single time.
    if (this.stateChannels.size > 0) {
      const session = this.sessions.get(name)!;
      let delivered = false;
      for (const [channel, input] of this.stateChannels) {
        const action = session.actions[channel];
        if (typeof action === "function") {
          action(input);
          delivered = true;
        }
      }
      if (delivered) this.notifyStale();
    }
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
    const { scene, tapRuns, textFields } = layoutScreen(this.theme, tree, this.viewport ?? this.designWidth, {
      active: this.activeTextInput,
      focus: (id) => this.focusTextInput(id),
    });
    // Adopt the whole rendered field table only after layout succeeded. A
    // removed/read-only field ends its activation; ordinary rerenders keep it.
    this.textFields = new Map(textFields.map((binding) => [binding.props.id, binding]));
    const focused = textFields.find((binding) => binding.descriptor.focused)?.descriptor;
    this.activeTextInput = focused ? {
      id: focused.id, sessionId: focused.sessionId, revision: focused.revision,
      text: focused.text, selection: focused.selection, composing: focused.composing,
    } : undefined;
    this.lastTapRuns = tapRuns;
    // TN-169 burst semantics: every commit of the navigation burst carries
    // the stamp; the next dispatch entry clears it (see dispatch).
    if (this.pendingTransition !== null) {
      scene.transition = this.pendingTransition;
    }
    return { scene, tapRuns };
  }

  /**
   * Host-verb dispatch. The verb set is closed (the display-list contract
   * puts lowercase "tap"/"long-press" in scene regions and hosts echo it
   * verbatim, so comparison is case-insensitive):
   *
   *  - "TAP" { id } — run the tap-run the CURRENT render assigned.
   *  - "LONG-PRESS" { id } — same run table; hosts fire it on hold and
   *    must not also dispatch "TAP" for that press (TN-148).
   *  - "TEXT_EDIT" — full text/selection/composition snapshot guarded by
   *    current field id, sessionId and baseRevision (TN-160).
   *  - "TEXT_BLUR" / "TEXT_SUBMIT" — close that guarded edit session;
   *    submit also invokes the field's current onSubmitted callback.
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
    if (normalized === "TEXT_EDIT") {
      const edit = validateTextEditEvent(payload);
      // Controller state can change without a subscribed host repaint. Resolve
      // that newer value/removal/readOnly state before accepting an old IME echo.
      this.render();
      const field = this.requireTextInput(edit);
      const previous = this.activeTextInput!;
      const next: TextInputSessionState = {
        id: edit.id, sessionId: edit.sessionId, revision: nextTextRevision(previous.revision),
        text: edit.text, selection: edit.selection, composing: edit.composing,
      };
      this.activeTextInput = next;
      if (edit.text !== previous.text) {
        try {
          field.props.onChanged(edit.text);
        } catch (error) {
          // Preserve cancellation/navigation performed by a callback. Controller
          // side effects are its own contract; the pending edit itself is not adopted.
          if (this.activeTextInput === next) this.activeTextInput = previous;
          throw error;
        }
      }
      return;
    }
    if (normalized === "TEXT_BLUR" || normalized === "TEXT_SUBMIT") {
      const identity = validateTextInputIdentity(payload);
      this.render();
      const field = this.requireTextInput(identity);
      this.endTextInput();
      if (normalized === "TEXT_SUBMIT") field.props.onSubmitted?.();
      return;
    }
    if (normalized === "TAP" || normalized === "LONG-PRESS") {
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

  private focusTextInput(id: string): void {
    this.assertLive();
    const field = this.textFields.get(id);
    if (!field || field.props.readOnly) {
      throw new TextInputError("STALE_TEXT_SESSION", `TextField "${id}" is not editable in the current scene`);
    }
    if (this.activeTextInput?.id === id) return;
    const sessionId = this.nextTextSessionId;
    if (!Number.isSafeInteger(sessionId)) {
      throw new TextInputError("INVALID_TEXT_EDIT", "Text input session identities are exhausted");
    }
    this.nextTextSessionId++;
    const text = field.props.value;
    this.activeTextInput = { id, sessionId, revision: 0, text,
      selection: { base: text.length, extent: text.length }, composing: null };
  }

  private requireTextInput(identity: TextInputIdentity): TextFieldBinding {
    const active = this.activeTextInput;
    const field = this.textFields.get(identity.id);
    if (!active || active.id !== identity.id || active.sessionId !== identity.sessionId ||
        !field || field.props.readOnly) {
      throw new TextInputError("STALE_TEXT_SESSION", "Text input callback belongs to an ended or different session");
    }
    if (active.revision !== identity.baseRevision) {
      throw new TextInputError("STALE_TEXT_REVISION", "Text input callback does not match the authoritative revision");
    }
    return field;
  }

  private endTextInput(): void {
    // Composition already lives in the controlled string; ending a session
    // clears its transient ranges rather than inventing a rollback of app state.
    this.activeTextInput = undefined;
  }

  // -------------------------------------------------------------------------
  // TN-142 — host→runtime push channel
  // -------------------------------------------------------------------------

  /**
   * Transient push: deliver an out-of-band payload to the ACTIVE
   * screen's action named `channel`, if it has one. No buffering: a
   * channel the active screen doesn't implement is dropped at call time
   * (broadcast semantics — screens subscribe by declaring the action),
   * and nothing is replayed later. Use for routed one-shot events
   * (command results) while the target is on screen.
   */
  push(channel: string, input?: unknown): void {
    this.assertLive();
    this.deliverTo(this.current, channel, input);
  }

  /**
   * State push: like push(), but the payload is cached LATEST-WINS per
   * channel and replayed onto every screen that implements the channel
   * when it becomes active (navigate) — so a host may push before a
   * route is ever mounted and the screen still renders current state,
   * never a blank. Use for live data reality: snapshots, link state.
   *
   * Coalescing/backpressure policy (explicit, frozen): there is no
   * queue anywhere. Active screens receive every push synchronously;
   * pushes that arrive while nobody consumes a channel collapse to the
   * latest one. A screen cannot "fall behind" — it either sees the
   * latest state or is mid-apply of it. Hosts wanting a coarser cadence
   * throttle at the source (their poll loop), not here.
   *
   * restore() is exempt from replay by design: a snapshot is
   * authoritative state replacement, not a route change.
   */
  pushState(channel: string, input?: unknown): void {
    this.assertLive();
    this.stateChannels.set(channel, input);
    this.deliverTo(this.current, channel, input);
  }

  /**
   * Targeted transient push: deliver to a NAMED screen's session —
   * mounted or not — so a result routed back to its origin screen
   * lands even if the user navigated away (the session keeps state;
   * returning shows the outcome). Dropped silently, by contract, when
   * the screen has never been mounted: a result for a screen the user
   * never opened has no session to update (this matches the
   * deliver-if-ever-visited semantics this API replaced). Not cached,
   * never replayed.
   */
  pushTo(screen: string, channel: string, input?: unknown): void {
    this.assertLive();
    this.deliverTo(screen, channel, input);
  }

  /** Shared delivery: session action run + post-apply invalidation. */
  private deliverTo(target: string, channel: string, input: unknown): void {
    const session = this.sessions.get(target);
    if (!session) return;
    const action = session.actions[channel];
    if (typeof action !== "function") return;
    action(input);
    // A delivered sync push mutated state outside a dispatch the host
    // commits after — invalidation-driven hosts repaint; hosts that own
    // their push loop (poll-driven) re-render on their own cadence.
    this.notifyStale();
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
    // Cross-bundle state carry is schema-versioned by contract: a snapshot
    // without a schema cannot be compared and is rejected whole. (A schema
    // LESS restore was previously accepted silently — the review probe that
    // pinned this made it a documented fail-closed edge.)
    if (snapshot.stateSchema === undefined) {
      throw new ApplicationRuntimeError(
        "SNAPSHOT_INVALID",
        "snapshot is missing stateSchema — export via exportState() before restoring"
      );
    }
    if (snapshot.stateSchema !== APPLICATION_STATE_SCHEMA) {
      throw new ApplicationRuntimeError(
        "SNAPSHOT_SCHEMA_MISMATCH",
        `snapshot stateSchema ${String(snapshot.stateSchema)} does not match runtime schema ${APPLICATION_STATE_SCHEMA}`
      );
    }
    if (snapshot.route !== undefined && typeof snapshot.route !== "string") {
      throw new ApplicationRuntimeError("SNAPSHOT_INVALID", "snapshot.route must be a string");
    }
    const ignoreUnknown = options.ignoreUnknownScreens === true;
    const states = snapshot.states;
    if (states !== undefined && (!states || typeof states !== "object")) {
      throw new ApplicationRuntimeError("SNAPSHOT_INVALID", "snapshot.states must be an object");
    }
    // Validate the WHOLE snapshot before touching any session: a rejected
    // restore leaves route and per-screen state exactly as they were
    // (restore is atomic; the previous apply-as-you-iterate shape could
    // half-apply before throwing on a later key).
    if (states !== undefined) {
      for (const name of Object.keys(states)) {
        if (!(name in this.screens) && !ignoreUnknown) {
          throw new ApplicationRuntimeError(
            "UNKNOWN_SCREEN",
            `snapshot references unknown screen "${name}"`
          );
        }
      }
    }
    if (typeof snapshot.route === "string" && !(snapshot.route in this.screens) && !ignoreUnknown) {
      throw new ApplicationRuntimeError(
        "UNKNOWN_SCREEN",
        `snapshot route "${snapshot.route}" is not a registered screen`
      );
    }
    if (states !== undefined) {
      for (const name of Object.keys(states)) {
        if (name in this.screens) {
          this.sessions.set(name, this.mount(name, (states as Record<string, unknown>)[name]));
        }
      }
    }
    if (typeof snapshot.route === "string" && snapshot.route in this.screens) {
      this.current = snapshot.route;
    }
    // The restored screen has not rendered yet: ids from the previously
    // committed scene must not dispatch against it.
    this.lastTapRuns = [];
    this.textFields.clear();
    this.endTextInput();
  }

  /**
   * Subscribe to out-of-band state changes: fired when an async action
   * settles (fulfilled OR rejected) — the moments state may have mutated
   * without a synchronous dispatch the host could commit after. Hosts use
   * this to repaint; the commit-after-TAP path alone cannot see async
   * completion (the review probe pinned a settled action leaving the
   * committed scene stale). A changed setViewport() also uses this signal
   * so subscribed hosts can commit the new layout. Returns an unsubscribe function. Listeners
   * registered on a disposed runtime simply never fire.
   */
  onStateInvalidation(listener: () => void): () => void {
    this.staleListeners.add(listener);
    return () => {
      this.staleListeners.delete(listener);
    };
  }

  /**
   * Terminal teardown: aborts every action signal. Mutating and
   * rendering entry points (navigate, setViewport, render, dispatch, exportState,
   * restore) throw RUNTIME_DISPOSED afterwards — a host must never
   * drive a disposed runtime. Identity reads (route, routes,
   * stateSchema, disposed) survive for post-mortem logging. Active input and
   * its field callbacks are released; edit-session state is never restored.
   */
  dispose(): void {
    if (this.disposedState) return;
    this.endTextInput();
    this.textFields.clear();
    this.lastTapRuns = [];
    this.abort.abort();
    this.disposedState = true;
  }

  private assertLive(): void {
    if (this.disposedState) {
      throw new ApplicationRuntimeError("RUNTIME_DISPOSED", "runtime has been disposed");
    }
  }

  /** Out-of-band state changed (async settle) while still live. */
  private notifyStale(): void {
    if (this.disposedState) return;
    for (const listener of [...this.staleListeners]) listener();
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
          result.then(
            () => {
              this.notifyStale();
            },
            (error: unknown) => {
              this.notifyStale();
              if (this.onAsyncActionError) {
                this.onAsyncActionError({ screen: name, action: key, error });
              } else {
                throw error;
              }
            },
          );
        }
      };
    }
    // TN-153: the controller's optional load() hook runs on FRESH mounts
    // (constructor and first navigate) — never on restore remounts, where
    // the snapshot is authoritative state and re-loading would overwrite
    // what was just restored. An async load settles out-of-band:
    // settlement fires onStateInvalidation exactly like an async action,
    // so invalidation-driven hosts repaint when the data lands (the
    // Android host settles it through the native job drain, TN-151).
    if (restoredState === undefined) {
      const load = (controller as { load?: (ctx: unknown) => unknown }).load;
      if (typeof load === "function") {
        const loaded = load({
          state,
          services: this.services,
          signal: this.abort.signal,
        });
        if (isThenable(loaded)) {
          loaded.then(
            () => {
              this.notifyStale();
            },
            (error: unknown) => {
              this.notifyStale();
              if (this.onAsyncActionError) {
                this.onAsyncActionError({ screen: name, action: "load", error });
              } else {
                throw error;
              }
            },
          );
        }
      }
    }
    return { name, state, actions };
  }
}

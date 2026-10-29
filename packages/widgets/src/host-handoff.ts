/**
 * Host handoff — the public commit/dispatch adapter of the TN-133
 * extraction (slice 2).
 *
 * This is literally the protocol the Android bridge already consumes
 * (previously example-private in embedders/android/tools/gallery-bundle/
 * device-entry.ts), behavior-preserving:
 *
 *  - `commit(sceneJson)` hands each rendered scene to the host. The
 *    default stores the last scene for headless drivers; a host passes
 *    its native bridge function (the QuickJS JNI `tenun_commit`).
 *  - `dispatch(action, payloadJson)` is the synchronous host→app entry:
 *    "__TENUN_EXPORT" returns the state snapshot JSON (hot reload / OTA
 *    carry), "__TENUN_STATE_SCHEMA" returns the schema version, "TAP"
 *    and "LONG-PRESS" run the current scene's gesture table and COMMIT
 *    the new scene (the commit after dispatch is what repaints the
 *    phone; a fired long-press suppresses that press's tap — hosts own
 *    that rule), "TENUN_RESTORE" restores a snapshot and commits. Verb
 *    comparison is case-insensitive because display-list regions carry
 *    lowercase "tap"/"long-press" and hosts echo them verbatim. "TEXT_EDIT",
 *    "TEXT_BLUR", and "TEXT_SUBMIT" also commit authoritative widget input
 *    state. A stale edit republishes authority for host resynchronization
 *    before its typed rejection propagates.
 *  - When the application exposes onStateInvalidation (async action
 *    settlement), the handoff commits a fresh scene out-of-band too —
 *    state that changes without a dispatch still reaches the host.
 *  - Malformed payload JSON degrades to `{}` (hosts may send empty
 *    strings); every other contract violation propagates as
 *    ApplicationRuntimeError to the host — never swallowed here.
 *
 * An install COMMITS the initial scene, matching the legacy adapter:
 * the host sees the first frame without a separate kick.
 *
 * The application side is STRUCTURAL on purpose: ApplicationRuntime
 * satisfies it directly, and an application composition layer (e.g. the
 * gallery's wrapper that adds a back affordance to non-home scenes) can
 * satisfy it too — chrome stays application-side, the protocol stays
 * here.
 */

import type { DisplayListScene, LayoutViewport } from "./display-list";
import { TextInputError } from "./text-input";

/** Anything the handoff can drive: ApplicationRuntime, or a wrapper that
 *  composes one with application chrome and still honors the contract. */
export interface HandoffApplication {
  render(): { scene: DisplayListScene };
  dispatch(action: string, payload?: unknown): void;
  exportState(): unknown;
  stateSchema(): number;
  route(): string;
  /**
   * Optional viewport adoption: when present, the host's "VIEWPORT"
   * dispatch re-lays the application out under the given logical bounds
   * (see dispatch below). ApplicationRuntime provides it; wrappers that
   * own their chrome delegate it after adjusting their own frame — or
   * omit it, in which case VIEWPORT falls through to dispatch() and
   * surfaces as UNKNOWN_ACTION (hosts treat that as "bundle does not
   * negotiate viewports" and keep scaling the committed scene instead).
   */
  setViewport?(viewport: LayoutViewport): void;
  /**
   * Optional out-of-band repaint signal: when application state can
   * change without a synchronous dispatch (async action settlement),
   * the host needs a fresh commit. ApplicationRuntime provides it;
   * wrappers may delegate or omit it (omitting keeps the
   * commit-after-dispatch-only behavior).
   */
  onStateInvalidation?(listener: () => void): () => void;
}

export interface HostHandoff {
  /** Host→app dispatch; returns a small JSON string (route/snapshot). */
  dispatch(action: string, payloadJson: string): string;
  /** Last committed scene JSON when no native commit sink was supplied. */
  lastScene(): string | null;
  /** Unregisters the invalidation listener; safe to call repeatedly. */
  dispose(): void;
}

export interface HostHandoffOptions {
  app: HandoffApplication;
  /** Native commit sink; omitted in headless tests and dev drivers. */
  commit?: (sceneJson: string) => void;
}

export function installHostHandoff(options: HostHandoffOptions): HostHandoff {
  const { app } = options;
  let last: string | null = null;

  const commit = (): void => {
    const json = JSON.stringify(app.render().scene);
    if (typeof options.commit === "function") {
      options.commit(json);
    } else {
      last = json;
    }
  };

  const dispatch = (action: string, payloadJson: string): string => {
    let payload: unknown = {};
    try {
      payload = JSON.parse(payloadJson || "{}");
    } catch {
      payload = {};
    }
    const normalized = action.toUpperCase();
    if (normalized === "__TENUN_EXPORT") {
      return JSON.stringify(app.exportState());
    }
    if (normalized === "__TENUN_STATE_SCHEMA") {
      return JSON.stringify({ stateSchema: app.stateSchema() });
    }
    if (normalized === "VIEWPORT") {
      // Host viewport negotiation (TN-158): a bundle that adopts host
      // bounds re-lays out under them; the resized scene commits through
      // the invalidation subscription (same channel setViewport uses
      // directly). A bundle WITHOUT setViewport falls through to
      // dispatch(), which raises UNKNOWN_ACTION — hosts read that (or a
      // NULL dispatch result across JNI) as "keep scaling the committed
      // scene" and stop delivering viewports. A malformed payload
      // degrades to {} above and fails visibly inside the runtime as
      // INVALID_VIEWPORT rather than being silently ignored.
      if (typeof app.setViewport === "function") {
        app.setViewport(payload as LayoutViewport);
      } else {
        app.dispatch(normalized, payload);
      }
      return JSON.stringify({ route: app.route() });
    }
    const textInput = normalized === "TEXT_EDIT" || normalized === "TEXT_BLUR" || normalized === "TEXT_SUBMIT";
    try {
      app.dispatch(normalized, payload);
    } catch (error) {
      // A delayed InputConnection/DOM callback may lose the revision race.
      // Re-publish authority so the host can replace its optimistic edit, then
      // retain the typed rejection instead of silently treating it as accepted.
      if (textInput && error instanceof TextInputError &&
          (error.code === "STALE_TEXT_SESSION" || error.code === "STALE_TEXT_REVISION")) commit();
      throw error;
    }
    if (normalized === "TAP" || normalized === "LONG-PRESS" || normalized === "TENUN_RESTORE" || textInput) commit();
    return JSON.stringify({ route: app.route() });
  };

  // Async repaint: a settled async action mutates state without a
  // synchronous dispatch to commit after — when the application exposes
  // the invalidation signal, subscribe and commit the fresh scene. (On
  // engines whose job queue the host never drains — the QuickJS bridge
  // today — settlement itself cannot occur, so this path is proven by
  // the browser and headless hosts.)
  const unsubscribe = app.onStateInvalidation?.(() => {
    commit();
  });

  commit();

  return {
    dispatch,
    lastScene: () => last,
    dispose() {
      unsubscribe?.();
    },
  };
}

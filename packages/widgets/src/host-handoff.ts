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
 *    runs the current scene's tap table and COMMITS the new scene (the
 *    commit after TAP is what repaints the phone), "TENUN_RESTORE"
 *    restores a snapshot and commits. Verb comparison is
 *    case-insensitive because display-list regions carry lowercase
 *    "tap" and hosts echo it verbatim.
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

import type { DisplayListScene } from "./display-list";

/** Anything the handoff can drive: ApplicationRuntime, or a wrapper that
 *  composes one with application chrome and still honors the contract. */
export interface HandoffApplication {
  render(): { scene: DisplayListScene };
  dispatch(action: string, payload?: unknown): void;
  exportState(): unknown;
  stateSchema(): number;
  route(): string;
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
    app.dispatch(normalized, payload);
    if (normalized === "TAP" || normalized === "TENUN_RESTORE") commit();
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

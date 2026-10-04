/**
 * Capability contract primitives (TN-141).
 *
 * These types sit on the application↔host seam: an app depends on the
 * SHAPES only, and every host — browser, Android embedder, test double —
 * binds them to its own implementation. Because calls cross the JS/host
 * bridge where exceptions cannot travel, failures are RESULT-shaped, not
 * exception-shaped: every operation resolves to a CapabilityResult and
 * never throws for conditions inside the capability's domain.
 *
 * Deliberately dependency-free (see packages/workspace.test.ts policy):
 * this is the one contract every host and consumer loads, including
 * bundles that must run under QuickJS without pulling @tenunjs/protocol.
 */

/** Semantic version of the capability seam contract as a whole. */
export const CAPABILITY_CONTRACT_VERSION = 1 as const;

// ---------------------------------------------------------------------------
// Failures
// ---------------------------------------------------------------------------

/**
 * The closed failure alphabet. Frozen with the contract: hosts may map
 * platform specifics onto these kinds (message/details carry the rest),
 * but may not invent new kinds across the seam.
 */
export type CapabilityFailureKind =
  /** The host does not implement this capability at all. */
  | "unsupported"
  /** A permission prerequisite was refused by the user or policy. */
  | "denied"
  /** The capability exists but its hardware/service is absent or off. */
  | "unavailable"
  /** The capability is in exclusive use (e.g. an active BLE scan). */
  | "busy"
  /** The operation exceeded its time budget. */
  | "timeout"
  /** The caller's cancel signal aborted the operation. */
  | "cancelled"
  /** Arguments violate the contract (validated before any platform call). */
  | "invalid-argument"
  /** The session's transport died mid-operation (BLE disconnect class). */
  | "link-lost"
  /** Host-specific failure; message/details are diagnostics, not contract. */
  | "platform-error";

export interface CapabilityFailure {
  readonly kind: CapabilityFailureKind;
  /** The refused permission; present iff kind === "denied". */
  readonly permission?: string;
  /** Human-readable diagnostic. Never parsed as contract. */
  readonly message?: string;
  /** Host detail (codes, counts); opaque to the application. */
  readonly details?: Readonly<Record<string, unknown>>;
}

export type CapabilityResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly failure: CapabilityFailure };

export const unsupportedFailure = (capability: string, reason?: string): CapabilityFailure => ({
  kind: "unsupported",
  message: reason ?? `${capability}: this host does not implement the capability`,
});

// ---------------------------------------------------------------------------
// Availability (degradation states)
// ---------------------------------------------------------------------------

/**
 * The degradation vocabulary (TN-141): a capability is never a boolean.
 * `denied` names the refused permission so an app can route to its
 * permission-settings surface; `unavailable` covers absent hardware or a
 * turned-off radio; `unsupported` means the host never had it.
 */
export type CapabilityAvailability =
  | { readonly status: "supported" }
  | { readonly status: "unsupported"; readonly reason?: string }
  | { readonly status: "denied"; readonly permission: string }
  | { readonly status: "unavailable"; readonly reason?: string };

// ---------------------------------------------------------------------------
// Permission prerequisites
// ---------------------------------------------------------------------------

export type CapabilityPlatform = "android" | "ios" | "web";

/**
 * Manifest-level permissions a capability needs on one platform tier.
 * Omitted bounds mean "all versions". Bounds are inclusive; android
 * bounds are API levels, ios bounds are major system versions. Web
 * declares no manifest permissions (prompts are transient) but keeps a
 * tier so permission tables are total across platforms.
 */
export interface PermissionPrerequisite {
  readonly platform: CapabilityPlatform;
  readonly osSince?: number;
  readonly osUntil?: number;
  readonly permissions: readonly string[];
}

// ---------------------------------------------------------------------------
// Cancellation
// ---------------------------------------------------------------------------

/**
 * Minimal abort surface, identical in shape to the subset of AbortSignal
 * the widgets runtime already consumes (app-runtime.ts createAbortSource):
 * `aborted`, an optional reason, and once-only listener notification.
 * The contract never CONSTRUCTS AbortController — QuickJS ships no Web
 * APIs and bundle-eval-time construction is the recorded failure class
 * (TN-133 slice 2) — hosts on platforms that have one adapt via
 * fromAbortSignal.
 */
export interface CapabilityCancelSignal {
  readonly aborted: boolean;
  readonly reason?: unknown;
  /** Registers a listener; returns its unsubscribe. */
  addAbortListener(listener: () => void): () => void;
}

export interface CapabilityCancelSource extends CapabilityCancelSignal {
  cancel(reason?: unknown): void;
}

export function createCancelSource(): CapabilityCancelSource {
  let aborted = false;
  let reason: unknown;
  const listeners = new Set<() => void>();
  return {
    get aborted() {
      return aborted;
    },
    get reason() {
      return reason;
    },
    addAbortListener(listener: () => void) {
      if (aborted) {
        listener();
        return () => undefined;
      }
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    cancel(why?: unknown) {
      if (aborted) return;
      aborted = true;
      reason = why;
      for (const listener of [...listeners]) listener();
      listeners.clear();
    },
  };
}

/**
 * Adapts a platform AbortSignal the CALLER already holds. No Web API is
 * constructed here, so the QuickJS rule is preserved; an already-aborted
 * signal notifies immediately.
 */
export function fromAbortSignal(signal: AbortSignal): CapabilityCancelSignal {
  return {
    get aborted() {
      return signal.aborted;
    },
    get reason() {
      return signal.reason;
    },
    addAbortListener(listener: () => void) {
      if (signal.aborted) {
        listener();
        return () => undefined;
      }
      signal.addEventListener("abort", listener, { once: true });
      return () => signal.removeEventListener("abort", listener);
    },
  };
}

/** Convenience for implementing hosts: the contract's cancelled failure. */
export const cancelledFailure = (message?: string): CapabilityFailure => ({
  kind: "cancelled",
  message,
});

/**
 * Preview-tier net implementation (TN-188): authoring and headless tests
 * with no Android host and no hardware, against the REAL contract.
 *
 * Two pieces, both QuickJS-loadable as a module (platform globals are
 * touched only inside methods; `availability()` degrades to `unavailable`
 * when they are absent):
 *
 *  1. `previewNetCapability` — the browser/bun client half of the
 *     WebSocket↔TCP loopback proxy. `connect()` opens a WebSocket to the
 *     dev proxy, which owns the actual TCP connection; binary frames are
 *     socket bytes in both directions. **TLS is terminated at the proxy**:
 *     TLS option shapes are validated and the pin journey is real (the
 *     proxy hello carries the endpoint fingerprint, pins are enforced
 *     client-side), but the fingerprint is proxy-synthesized — a stable
 *     sha256 over the endpoint identity, NOT a certificate hash. The
 *     native tier does real TLS; this tier exists so pairing flows are
 *     authorable and testable in a browser. The proxy itself is host-side
 *     code (dev server / tests) and speaks this wire:
 *
 *       connect:  ws://<proxy>?host=<host>&port=<port>
 *       proxy → client, first message (text):
 *         {"type":"endpoint","fingerprint":"<64 lowercase hex>","tls":"terminated-at-proxy"}
 *       then binary frames ↔ TCP chunks; ws close = link offline.
 *
 *  2. `createFakeNetEndpoint` — a fully in-memory endpoint (no sockets at
 *     all) for deterministic headless contract tests and example apps:
 *     scriptable greeting/echo, first-use fingerprint delivery, pin
 *     enforcement, remote close, held connects for cancellation, refused
 *     connects. Event delivery is synchronous; the real receive-bound
 *     (buffered-ahead overflow → link-lost) is a HOST property and is
 *     exercised against the native service, not simulated here.
 */
import type { CapabilityCancelSignal, CapabilityResult } from "./capability";
import type { NetCapability, NetLinkState, NetSession } from "./net";
import { NET_PERMISSIONS } from "./net";
import { MAX_NET_WRITE_BYTES, netConnectArgumentError, validCertSha256 } from "./net-validation";

const invalid = (message: string): CapabilityResult<never> => ({
  ok: false,
  failure: { kind: "invalid-argument", message },
});
const unavailable = (message: string): CapabilityResult<never> => ({
  ok: false,
  failure: { kind: "unavailable", message },
});
const linkLost = (message: string): CapabilityResult<never> => ({
  ok: false,
  failure: { kind: "link-lost", message },
});

/**
 * A listener registry; `replayLast` re-delivers the latest value to late
 * subscribers (link state, first-use fingerprint) while stream listeners
 * (data chunks) never see history — a late subscriber must not receive a
 * duplicate chunk.
 */
class ListenerRegistry<T> {
  private readonly listeners = new Set<(value: T) => void>();
  private last: T | undefined;
  private hasLast = false;

  constructor(private readonly replayLast: boolean) {}

  deliver(value: T): void {
    this.last = value;
    this.hasLast = true;
    for (const listener of [...this.listeners]) listener(value);
  }

  subscribe(listener: (value: T) => void): () => void {
    this.listeners.add(listener);
    if (this.replayLast && this.hasLast) listener(this.last!);
    return () => {
      this.listeners.delete(listener);
    };
  }
}

interface PreviewSession {
  readonly link: ListenerRegistry<NetLinkState>;
  readonly data: ListenerRegistry<Uint8Array>;
  readonly certificate: ListenerRegistry<string>;
  goOffline(): void;
}

function makeSession(state: PreviewSession, write: (data: Uint8Array) => CapabilityResult<void>, close: () => void): NetSession {
  return {
    async write(data) {
      if (!(data instanceof Uint8Array)) return invalid("data must be a Uint8Array");
      if (data.length > MAX_NET_WRITE_BYTES) {
        return invalid(`data exceeds ${MAX_NET_WRITE_BYTES} bytes`);
      }
      return write(data);
    },
    onData(listener) {
      return state.data.subscribe(listener);
    },
    onLinkStateChange(listener) {
      return state.link.subscribe(listener);
    },
    onServerCertificate(listener) {
      return state.certificate.subscribe(listener);
    },
    async close() {
      close();
      return { ok: true, value: undefined }; // idempotent
    },
  };
}

/**
 * The preview capability over the loopback proxy. `proxyUrl` builds the
 * WebSocket URL for one endpoint — the dev server and the headless tests
 * each provide their own proxy location.
 */
export function previewNetCapability(options: {
  proxyUrl: (host: string, port: number) => string;
}): NetCapability {
  return {
    contractVersion: 1,
    availability() {
      if (typeof (globalThis as { WebSocket?: unknown }).WebSocket !== "function") {
        return { status: "unavailable", reason: "preview net needs WebSocket for the loopback proxy" };
      }
      return { status: "supported" };
    },
    permissionPrerequisites: () => NET_PERMISSIONS,
    async connect(connectOptions) {
      const argumentError = netConnectArgumentError(connectOptions);
      if (argumentError !== null) return invalid(argumentError);
      if (typeof (globalThis as { WebSocket?: unknown }).WebSocket !== "function") {
        return unavailable("preview net needs WebSocket for the loopback proxy");
      }
      const url = options.proxyUrl(connectOptions.host, connectOptions.port);
      return await new Promise<CapabilityResult<NetSession>>((resolve) => {
        const WebSocketCtor = (globalThis as { WebSocket: new (url: string) => WebSocket }).WebSocket;
        let socket: WebSocket;
        try {
          socket = new WebSocketCtor(url);
        } catch (error) {
          resolve(linkLost(`proxy connection failed: ${String(error)}`));
          return;
        }
        socket.binaryType = "arraybuffer";
        let settled = false;
        let handover: PreviewSession | null = null;
        let offAbort: () => void = () => undefined;
        let offTimeout: (() => void) | undefined;

        const settle = (result: CapabilityResult<NetSession>) => {
          if (settled) return;
          settled = true;
          offAbort();
          if (offTimeout) offTimeout();
          resolve(result);
        };

        const failConnect = (message: string) => {
          try {
            socket.close();
          } catch {
            // already closing
          }
          settle(linkLost(message));
        };

        socket.addEventListener("open", () => {
          // The proxy speaks first (endpoint hello); nothing to do yet.
        });

        socket.addEventListener("message", (event: MessageEvent) => {
          if (typeof event.data === "string") {
            let hello: { type?: unknown; fingerprint?: unknown; tls?: unknown };
            try {
              hello = JSON.parse(event.data);
            } catch {
              failConnect("proxy sent a malformed endpoint hello");
              return;
            }
            if (hello.type !== "endpoint" || !validCertSha256(hello.fingerprint)) {
              failConnect("proxy endpoint hello is not well formed");
              return;
            }
            const fingerprint = hello.fingerprint.toLowerCase();
            const pin = connectOptions.tls?.expectedServerCertSha256;
            if (pin !== undefined && pin.toLowerCase() !== fingerprint) {
              failConnect("pinned server certificate mismatch");
              return;
            }
            const state: PreviewSession = {
              link: new ListenerRegistry<NetLinkState>(true),
              data: new ListenerRegistry<Uint8Array>(false),
              certificate: new ListenerRegistry<string>(true),
              goOffline() {
                try {
                  socket.close();
                } catch {
                  // already closing
                }
                this.link.deliver("offline");
              },
            };
            handover = state;
            state.link.deliver("linked");
            if (pin === undefined) state.certificate.deliver(fingerprint);
            settle({ ok: true, value: makeSession(state, (bytes) => {
              if (socket.readyState !== 1) return linkLost("the session link is offline");
              socket.send(bytes);
              return { ok: true, value: undefined };
            }, () => state.goOffline()) });
          } else if (handover !== null) {
            const chunk = event.data instanceof ArrayBuffer ? new Uint8Array(event.data) : event.data;
            handover.data.deliver(new Uint8Array(chunk));
          }
          // Binary frames before the hello are a protocol violation; the
          // proxy never sends them, so dropping keeps the failure loud.
        });

        const lost = () => {
          if (handover !== null) {
            handover.link.deliver("offline");
          } else if (!settled) {
            settle(linkLost("the proxy connection closed before the session was established"));
          }
        };
        socket.addEventListener("close", lost);
        socket.addEventListener("error", () => {
          if (!settled) failConnect("the proxy connection failed");
        });

        const signal: CapabilityCancelSignal | undefined = connectOptions.signal;
        if (signal) {
          offAbort = signal.addAbortListener(() => {
            if (!settled) {
              try {
                socket.close();
              } catch {
                // already closing
              }
              settle({
                ok: false,
                failure: {
                  kind: "cancelled",
                  message: "connect was cancelled before the session was established",
                },
              });
            }
          });
        }
        const timeout = connectOptions.timeoutMs;
        if (timeout !== undefined && typeof (globalThis as { setTimeout?: unknown }).setTimeout === "function") {
          const timer = (globalThis as unknown as { setTimeout: (fn: () => void, ms: number) => unknown }).setTimeout(
            () => {
              if (!settled) {
                try {
                  socket.close();
                } catch {
                  // already closing
                }
                settle({
                  ok: false,
                  failure: { kind: "timeout", message: "connect timed out" },
                });
              }
            },
            timeout
          );
          const clear = (globalThis as unknown as { clearTimeout?: (t: unknown) => void }).clearTimeout;
          offTimeout = clear ? () => clear(timer) : () => undefined;
        }
      });
    },
  };
}

// ---------------------------------------------------------------------------
// In-memory fake endpoint
// ---------------------------------------------------------------------------

/** Scriptable server side of the in-memory endpoint. */
export interface FakeNetServer {
  /** Fingerprint served in first-use mode (lowercase hex). */
  readonly fingerprint: string;
  setFingerprint(sha256: string): void;
  /** Every write the client handed over, in order. */
  written(): readonly Uint8Array[];
  /** Server → client push while linked (models notifications). */
  send(chunk: Uint8Array): void;
  /** When true (default) client writes are echoed back. */
  setEcho(enabled: boolean): void;
  /** Remote close: the client session goes offline; writes fail link-lost. */
  disconnect(): void;
  /** The next connect is refused at the transport (link-lost). */
  refuseNextConnect(): void;
  /** The next connect stays unsettled until released or cancelled. */
  holdNextConnect(): void;
  releaseHeldConnect(): void;
}

/** A deterministic in-memory endpoint pair: no sockets, no timers. */
export function createFakeNetEndpoint(): {
  capability: NetCapability;
  server: FakeNetServer;
} {
  let fingerprint = "aa".repeat(32);
  let echo = true;
  let refuseNext = false;
  let holdNext = false;
  let heldRelease: (() => void) | null = null;
  const writes: Uint8Array[] = [];
  let active: PreviewSession | null = null;

  const server: FakeNetServer = {
    get fingerprint() {
      return fingerprint;
    },
    setFingerprint(sha256) {
      if (!validCertSha256(sha256)) throw new Error("fingerprint must be 64 hex characters");
      fingerprint = sha256.toLowerCase();
    },
    written() {
      return writes;
    },
    send(chunk) {
      active?.data.deliver(chunk);
    },
    setEcho(enabled) {
      echo = enabled;
    },
    disconnect() {
      active?.goOffline();
    },
    refuseNextConnect() {
      refuseNext = true;
    },
    holdNextConnect() {
      holdNext = true;
    },
    releaseHeldConnect() {
      holdNext = false;
      heldRelease?.();
    },
  };

  const connect = async (
    connectOptions: Parameters<NetCapability["connect"]>[0]
  ): Promise<CapabilityResult<NetSession>> => {
    const argumentError = netConnectArgumentError(connectOptions);
    if (argumentError !== null) return invalid(argumentError);
    if (connectOptions.signal?.aborted) {
      holdNext = false; // a cancelled connect never reaches the transport
      return {
        ok: false,
        failure: { kind: "cancelled", message: "connect was cancelled before it started" },
      };
    }
    if (refuseNext) {
      refuseNext = false;
      return linkLost("connection refused by the fake endpoint");
    }
    const pin = connectOptions.tls?.expectedServerCertSha256;
    if (pin !== undefined && pin.toLowerCase() !== fingerprint) {
      return linkLost("pinned server certificate mismatch");
    }
    const establish = (): CapabilityResult<NetSession> => {
      if (pin !== undefined && pin.toLowerCase() !== fingerprint) {
        return linkLost("pinned server certificate mismatch");
      }
      const state: PreviewSession = {
        link: new ListenerRegistry<NetLinkState>(true),
        data: new ListenerRegistry<Uint8Array>(false),
        certificate: new ListenerRegistry<string>(true),
        goOffline() {
          if (active !== this) return;
          active = null;
          this.link.deliver("offline");
        },
      };
      active = state;
      state.link.deliver("linked");
      if (pin === undefined) state.certificate.deliver(fingerprint);
      return {
        ok: true,
        value: makeSession(state, (bytes) => {
          if (active !== state) return linkLost("the session link is offline");
          writes.push(bytes);
          if (echo) state.data.deliver(bytes);
          return { ok: true, value: undefined };
        }, () => state.goOffline()),
      };
    };
    if (!holdNext) return establish();
    return await new Promise<CapabilityResult<NetSession>>((resolve) => {
      let settled = false;
      let offAbort: () => void = () => undefined;
      const settle = (result: CapabilityResult<NetSession>) => {
        if (settled) return;
        settled = true;
        offAbort();
        heldRelease = null;
        resolve(result);
      };
      heldRelease = () => settle(establish());
      if (connectOptions.signal) {
        offAbort = connectOptions.signal.addAbortListener(() => {
          holdNext = false;
          settle({
            ok: false,
            failure: { kind: "cancelled", message: "connect was cancelled before the session was established" },
          });
        });
      }
    });
  };

  return {
    capability: {
      contractVersion: 1,
      availability: () => ({ status: "supported" }),
      permissionPrerequisites: () => NET_PERMISSIONS,
      connect,
    },
    server,
  };
}

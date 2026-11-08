import { describe, expect, test } from "bun:test";
import { createCancelSource } from "../src/capability";
import { NET_PERMISSIONS } from "../src/net";
import { createHostNetBridge, NET_EVENT_ACTION } from "../src/net-native";
import { MAX_NET_WRITE_BYTES } from "../src/net-validation";
import type { CapabilityResult } from "../src/capability";
import type { NetHostCall } from "../src/net-native";
import type { NetSession } from "../src/net";

/**
 * TN-188 native-adapter tests: the exact wire the Android NetService
 * speaks (mirrored by NetService.kt), driven through a scripted fake
 * bridge. Fail-closed rules: null replies → unsupported, throwing bridge
 * → platform-error, unknown failure kinds → platform-error, malformed
 * events → visible false. The REAL QuickJS→JNI→socket journey is
 * NetBridgeTest on device; this file pins the protocol both sides code
 * against, the same role keys-native.test.ts plays for keys.
 */

function fakeHost(
  replies: Record<string, string | null>,
  options: { throwOn?: string } = {}
): { hostCall: NetHostCall; calls: { method: string; payload: unknown }[] } {
  const calls: { method: string; payload: unknown }[] = [];
  const hostCall: NetHostCall = (service, method, payloadJson) => {
    if (service !== "net") return null;
    calls.push({ method, payload: JSON.parse(payloadJson) });
    if (options.throwOn === method) throw new Error("bridge exploded");
    return replies[method] ?? null;
  };
  return { hostCall, calls };
}

const availabilitySupported = JSON.stringify({ ok: true, value: { status: "supported" } });
const event = (value: Record<string, unknown>): string => JSON.stringify(value);

function failureKind(result: CapabilityResult<unknown>): string {
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("unreachable");
  return result.failure.kind;
}

async function establishedSession(
  hostCall: NetHostCall,
  bridge: ReturnType<typeof createHostNetBridge>,
  sessionId: string,
  connectOptions: { tls?: { expectedServerCertSha256?: string } } = {}
): Promise<NetSession> {
  const pending = bridge.capability.connect({ host: "tv.lan", port: 6466, ...connectOptions });
  expect(bridge.handleHostEvent(event({ type: "connect", sessionId, ok: true }))).toBe(true);
  const result = await pending;
  if (!result.ok) throw new Error(`connect failed: ${JSON.stringify(result.failure)}`);
  return result.value;
}

describe("TN-188 native adapter — availability", () => {
  test("a host without the net service is unsupported, never a fabricated session", async () => {
    const { hostCall } = fakeHost({});
    const { capability } = createHostNetBridge(hostCall);
    expect(capability.availability()).toEqual({
      status: "unsupported",
      reason: "net.availability: this host has no net service",
    });
    expect(capability.permissionPrerequisites()).toBe(NET_PERMISSIONS);
    expect(failureKind(await capability.connect({ host: "tv.lan", port: 1 }))).toBe("unsupported");
  });

  test("supported and degraded statuses pass through structurally", () => {
    const supported = fakeHost({ availability: availabilitySupported });
    expect(createHostNetBridge(supported.hostCall).capability.availability()).toEqual({
      status: "supported",
    });

    const degraded = fakeHost({
      availability: JSON.stringify({
        ok: true,
        value: { status: "unavailable", reason: "sockets disabled by policy" },
      }),
    });
    expect(createHostNetBridge(degraded.hostCall).capability.availability()).toEqual({
      status: "unavailable",
      reason: "sockets disabled by policy",
    });
  });

  test("malformed availability statuses degrade honestly; non-JSON is surfaced", () => {
    const malformed = fakeHost({
      availability: JSON.stringify({ ok: true, value: { status: "maybe" } }),
    });
    expect(createHostNetBridge(malformed.hostCall).capability.availability()).toEqual({
      status: "unavailable",
      reason: "net.availability: malformed status",
    });

    const notJson = fakeHost({ availability: "not-json" });
    expect(createHostNetBridge(notJson.hostCall).capability.availability()).toMatchObject({
      status: "unavailable",
      reason: expect.stringContaining("non-JSON"),
    });
  });
});

describe("TN-188 native adapter — connect wire", () => {
  test("arguments are validated BEFORE the bridge is called", async () => {
    const { hostCall, calls } = fakeHost({});
    const { capability } = createHostNetBridge(hostCall);
    expect(failureKind(await capability.connect({ host: "https://tv.lan", port: 1 }))).toBe(
      "invalid-argument"
    );
    expect(failureKind(await capability.connect({ host: "tv.lan", port: 0 }))).toBe(
      "invalid-argument"
    );
    expect(failureKind(await capability.connect("nope" as never))).toBe("invalid-argument");
    expect(calls.length).toBe(0);
  });

  test("the connect payload mirrors the contract fields; tls is passed through", async () => {
    const { hostCall, calls } = fakeHost({
      connect: JSON.stringify({ ok: true, value: { sessionId: "n:1" } }),
    });
    const { capability, handleHostEvent } = createHostNetBridge(hostCall);
    const pending = capability.connect({
      host: "tv.lan",
      port: 6466,
      timeoutMs: 8000,
      tls: { clientIdentity: "pairing", serverName: "tv.lan" },
    });
    expect(calls[0]!.payload).toEqual({
      host: "tv.lan",
      port: 6466,
      timeoutMs: 8000,
      tls: { clientIdentity: "pairing", serverName: "tv.lan" },
    });
    expect(handleHostEvent(event({ type: "connect", sessionId: "n:1", ok: true }))).toBe(true);
    expect((await pending).ok).toBe(true);
  });

  test("a malformed connect reply (no sessionId) is platform-error", async () => {
    const { hostCall } = fakeHost({ connect: JSON.stringify({ ok: true, value: {} }) });
    const { capability } = createHostNetBridge(hostCall);
    expect(failureKind(await capability.connect({ host: "tv.lan", port: 1 }))).toBe(
      "platform-error"
    );
  });

  test("connect failure kinds pass through; unknown kinds become platform-error", async () => {
    const timeoutHost = fakeHost({ connect: JSON.stringify({ ok: true, value: { sessionId: "n:3" } }) });
    const timeoutBridge = createHostNetBridge(timeoutHost.hostCall);
    const pendingTimeout = timeoutBridge.capability.connect({ host: "192.0.2.1", port: 1, timeoutMs: 250 });
    timeoutBridge.handleHostEvent(
      event({ type: "connect", sessionId: "n:3", ok: false, failure: { kind: "timeout", message: "connect timed out" } })
    );
    expect(failureKind(await pendingTimeout)).toBe("timeout");

    const weirdHost = fakeHost({ connect: JSON.stringify({ ok: true, value: { sessionId: "n:4" } }) });
    const weirdBridge = createHostNetBridge(weirdHost.hostCall);
    const pendingWeird = weirdBridge.capability.connect({ host: "tv.lan", port: 1 });
    weirdBridge.handleHostEvent(
      event({ type: "connect", sessionId: "n:4", ok: false, failure: { kind: "server-said-no" } })
    );
    expect(failureKind(await pendingWeird)).toBe("platform-error");
  });

  test("offline before connect-ok settles the pending connect as link-lost", async () => {
    const { hostCall } = fakeHost({ connect: JSON.stringify({ ok: true, value: { sessionId: "n:5" } }) });
    const { capability, handleHostEvent } = createHostNetBridge(hostCall);
    const pending = capability.connect({ host: "tv.lan", port: 1 });
    expect(handleHostEvent(event({ type: "link", sessionId: "n:5", state: "offline" }))).toBe(true);
    expect(failureKind(await pending)).toBe("link-lost");
  });

  test("a throwing bridge is platform-error", async () => {
    const throwing = fakeHost(
      { connect: JSON.stringify({ ok: true, value: { sessionId: "n:9" } }) },
      { throwOn: "connect" }
    );
    const { capability } = createHostNetBridge(throwing.hostCall);
    expect(failureKind(await capability.connect({ host: "tv.lan", port: 1 }))).toBe(
      "platform-error"
    );
  });
});

describe("TN-188 native adapter — session over the wire", () => {
  test("linked replays on register; data events decode base64; writes encode base64", async () => {
    const { hostCall, calls } = fakeHost({
      connect: JSON.stringify({ ok: true, value: { sessionId: "n:7" } }),
      write: JSON.stringify({ ok: true, value: null }),
    });
    const bridge = createHostNetBridge(hostCall);
    const session = await establishedSession(hostCall, bridge, "n:7");

    const states: string[] = [];
    session.onLinkStateChange((state) => states.push(state));
    expect(states).toEqual(["linked"]); // replay-on-register

    const chunks: number[] = [];
    session.onData((chunk) => chunks.push(...chunk));
    // "3q2+7w==" is the canonical standard-alphabet vector (keys parity).
    expect(bridge.handleHostEvent(event({ type: "data", sessionId: "n:7", data: "3q2+7w==" }))).toBe(true);
    expect(chunks).toEqual([0xde, 0xad, 0xbe, 0xef]);

    expect((await session.write(new Uint8Array([0xde, 0xad, 0xbe, 0xef]))).ok).toBe(true);
    expect(calls.find((call) => call.method === "write")!.payload).toEqual({
      sessionId: "n:7",
      data: "3q2+7w==",
    });
  });

  test("first-use serverCertificate replays to subscribers after handoff (lowercased)", async () => {
    const { hostCall } = fakeHost({ connect: JSON.stringify({ ok: true, value: { sessionId: "n:2" } }) });
    const bridge = createHostNetBridge(hostCall);
    const pending = bridge.capability.connect({ host: "tv.lan", port: 6466 });
    // The host pushes the fingerprint during the handshake, before ok.
    expect(bridge.handleHostEvent(event({ type: "serverCertificate", sessionId: "n:2", sha256: "AB".repeat(32) }))).toBe(true);
    expect(bridge.handleHostEvent(event({ type: "connect", sessionId: "n:2", ok: true }))).toBe(true);
    const result = await pending;
    if (!result.ok) throw new Error("connect failed");
    const pins: string[] = [];
    result.value.onServerCertificate((sha) => pins.push(sha));
    expect(pins).toEqual(["ab".repeat(32)]);
  });

  test("pinned mode never delivers a fingerprint", async () => {
    const { hostCall } = fakeHost({ connect: JSON.stringify({ ok: true, value: { sessionId: "n:12" } }) });
    const bridge = createHostNetBridge(hostCall);
    const session = await establishedSession(hostCall, bridge, "n:12", {
      tls: { expectedServerCertSha256: "cc".repeat(32) },
    });
    const pins: string[] = [];
    session.onServerCertificate((sha) => pins.push(sha));
    expect(pins).toEqual([]);
  });

  test("host write failures pass through; link-lost also moves the session offline", async () => {
    const { hostCall, calls } = fakeHost({
      connect: JSON.stringify({ ok: true, value: { sessionId: "n:13" } }),
      write: JSON.stringify({ ok: false, failure: { kind: "link-lost", message: "ECONNRESET" } }),
    });
    const bridge = createHostNetBridge(hostCall);
    const session = await establishedSession(hostCall, bridge, "n:13");

    const states: string[] = [];
    session.onLinkStateChange((state) => states.push(state));
    expect(failureKind(await session.write(new Uint8Array([1])))).toBe("link-lost");
    expect(states).toEqual(["linked", "offline"]);
    // The next write is refused locally — no dead-socket bridge call.
    const before = calls.length;
    expect(failureKind(await session.write(new Uint8Array([2])))).toBe("link-lost");
    expect(calls.length).toBe(before);
  });

  test("after close the session is unregistered; a late data push is visible, not swallowed", async () => {
    const { hostCall } = fakeHost({ connect: JSON.stringify({ ok: true, value: { sessionId: "n:14" } }) });
    const bridge = createHostNetBridge(hostCall);
    const session = await establishedSession(hostCall, bridge, "n:14");
    await session.close();
    let hits = 0;
    session.onData(() => {
      hits += 1;
    });
    expect(bridge.handleHostEvent(event({ type: "data", sessionId: "n:14", data: "AAAA" }))).toBe(false);
    expect(hits).toBe(0);
  });

  test("malformed event JSON, unknown sessions, and bad shapes return false, never throw", async () => {
    const { hostCall } = fakeHost({ connect: JSON.stringify({ ok: true, value: { sessionId: "n:15" } }) });
    const bridge = createHostNetBridge(hostCall);
    const session = await establishedSession(hostCall, bridge, "n:15");
    void session;
    expect(bridge.handleHostEvent("not-json")).toBe(false);
    expect(bridge.handleHostEvent("[]")).toBe(false);
    expect(bridge.handleHostEvent(event({ type: "data", sessionId: "nope", data: "AAAA" }))).toBe(false);
    expect(bridge.handleHostEvent(event({ type: "data" }))).toBe(false);
    expect(bridge.handleHostEvent(event({ type: "mystery", sessionId: "n:15" }))).toBe(false);
    expect(bridge.handleHostEvent(event({ type: "serverCertificate", sessionId: "n:15", sha256: "zz" }))).toBe(false);
  });
});

describe("TN-188 native adapter — close and cancellation", () => {
  test("close calls the host once; the second close is local and idempotent", async () => {
    const { hostCall, calls } = fakeHost({
      connect: JSON.stringify({ ok: true, value: { sessionId: "n:6" } }),
      close: JSON.stringify({ ok: true, value: null }),
    });
    const bridge = createHostNetBridge(hostCall);
    const session = await establishedSession(hostCall, bridge, "n:6");
    expect((await session.close()).ok).toBe(true);
    expect((await session.close()).ok).toBe(true);
    expect(calls.filter((call) => call.method === "close").length).toBe(1);
    expect(failureKind(await session.write(new Uint8Array([1])))).toBe("link-lost");
  });

  test("cancelling a pending connect settles cancelled locally and closes on the host", async () => {
    const { hostCall, calls } = fakeHost({
      connect: JSON.stringify({ ok: true, value: { sessionId: "n:8" } }),
      close: JSON.stringify({ ok: true, value: null }),
    });
    const { capability, handleHostEvent } = createHostNetBridge(hostCall);
    const source = createCancelSource();
    const pending = capability.connect({ host: "192.0.2.1", port: 9, signal: source });
    source.cancel("user navigated away");
    expect(failureKind(await pending)).toBe("cancelled");
    expect(calls.some((call) => call.method === "close")).toBe(true);
    // A late connect-ok push for the cancelled session stays visible.
    expect(handleHostEvent(event({ type: "connect", sessionId: "n:8", ok: true }))).toBe(false);
  });

  test("an already-aborted signal settles cancelled and still closes the host session", async () => {
    const { hostCall, calls } = fakeHost({
      connect: JSON.stringify({ ok: true, value: { sessionId: "n:10" } }),
      close: JSON.stringify({ ok: true, value: null }),
    });
    const { capability } = createHostNetBridge(hostCall);
    const source = createCancelSource();
    source.cancel();
    expect(failureKind(await capability.connect({ host: "tv.lan", port: 1, signal: source }))).toBe(
      "cancelled"
    );
    expect(calls.some((call) => call.method === "close")).toBe(true);
  });

  test("oversized writes are refused before the bridge", async () => {
    const { hostCall, calls } = fakeHost({
      connect: JSON.stringify({ ok: true, value: { sessionId: "n:11" } }),
    });
    const bridge = createHostNetBridge(hostCall);
    const session = await establishedSession(hostCall, bridge, "n:11");
    expect(failureKind(await session.write(new Uint8Array(MAX_NET_WRITE_BYTES + 1)))).toBe(
      "invalid-argument"
    );
    expect(calls.some((call) => call.method === "write")).toBe(false);
  });
});

test("NET_EVENT_ACTION names the dispatch action hosts route", () => {
  expect(NET_EVENT_ACTION).toBe("NET_EVENT");
});

import { describe, expect, test } from "bun:test";
import { createCancelSource } from "../src/capability";
import { DISCOVERY_PERMISSIONS } from "../src/discovery";
import { createHostDiscoveryBridge, DISCOVERY_EVENT_ACTION } from "../src/discovery-native";
import {
  discoveryBrowseArgumentError,
  isDiscoveredService,
  validServiceName,
  validServiceType,
  validTxtRecord,
} from "../src/discovery-validation";
import type { CapabilityResult } from "../src/capability";
import type { DiscoveryHostCall } from "../src/discovery-native";
import type { DiscoveryBrowse } from "../src/discovery";

/**
 * TN-190 tests: the contract bounds, the exact wire the Android
 * DiscoveryService speaks (mirrored by DiscoveryService.kt), and the
 * browse/resolve semantics — driven through a scripted fake resolver.
 * Fail-closed rules: null replies → unsupported, throwing bridge →
 * platform-error, unknown failure kinds → platform-error, malformed
 * events → visible false. The REAL QuickJS→JNI→NsdManager journey is
 * DiscoveryBridgeTest on device; this file pins the protocol both sides
 * code against, the role net-native.test.ts plays for net.
 */

const SERVICE = {
  serviceType: "_androidtvremote2._tcp",
  serviceName: "Living Room TV",
  domain: "local",
} as const;

function fakeHost(
  replies: Record<string, string | null>,
  options: { throwOn?: string } = {}
): { hostCall: DiscoveryHostCall; calls: { method: string; payload: unknown }[] } {
  const calls: { method: string; payload: unknown }[] = [];
  const hostCall: DiscoveryHostCall = (service, method, payloadJson) => {
    if (service !== "discovery") return null;
    calls.push({ method, payload: JSON.parse(payloadJson) });
    if (options.throwOn === method) throw new Error("bridge exploded");
    return replies[method] ?? null;
  };
  return { hostCall, calls };
}

const availabilitySupported = JSON.stringify({ ok: true, value: { status: "supported" } });
const browseAccepted = JSON.stringify({ ok: true, value: { browseId: "d:1" } });
const resolveAccepted = JSON.stringify({ ok: true, value: { resolveId: "r:1" } });
const event = (value: Record<string, unknown>): string => JSON.stringify(value);

function failureKind(result: CapabilityResult<unknown>): string {
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("unreachable");
  return result.failure.kind;
}

async function startedBrowse(
  hostCall: DiscoveryHostCall,
  bridge: ReturnType<typeof createHostDiscoveryBridge>,
  browseId: string
): Promise<DiscoveryBrowse> {
  const pending = bridge.capability.browse({ serviceType: SERVICE.serviceType });
  expect(bridge.handleHostEvent(event({ type: "browseStarted", browseId }))).toBe(true);
  const result = await pending;
  if (!result.ok) throw new Error(`browse failed: ${JSON.stringify(result.failure)}`);
  return result.value;
}

describe("TN-190 service-type and name bounds", () => {
  test("validServiceType accepts exactly _name._tcp/_name._udp", () => {
    expect(validServiceType("_androidtvremote2._tcp")).toBe(true);
    expect(validServiceType("_http._udp")).toBe(true);
    expect(validServiceType("_a._tcp")).toBe(true);
    expect(validServiceType("_abcdefghijklmnopqrstuvwxyz._tcp")).toBe(true); // ≤ DNS label 63
    // Underscore + label ≤ 63 bytes: 62 chars after '_' is the ceiling.
    expect(validServiceType(`_${"a".repeat(62)}._tcp`)).toBe(true);
    expect(validServiceType(`_${"a".repeat(63)}._tcp`)).toBe(false); // label > 63 bytes
    expect(validServiceType("androidtvremote2._tcp")).toBe(false); // no underscore
    expect(validServiceType("_tv._tcp.local")).toBe(false); // trailing domain
    expect(validServiceType("_tv._tls")).toBe(false); // not a DNS-SD transport
    expect(validServiceType("_-tv._tcp")).toBe(false); // label starts with hyphen
    expect(validServiceType("")).toBe(false);
    expect(validServiceType(42 as never)).toBe(false);
  });

  test("validServiceName enforces the 63-byte instance-name limit and shape", () => {
    expect(validServiceName("Living Room TV")).toBe(true);
    expect(validServiceName("TV di ruang tengah")).toBe(true);
    // 63 bytes is the wire ceiling: 63 ASCII chars pass, 64 do not.
    expect(validServiceName("a".repeat(63))).toBe(true);
    expect(validServiceName("a".repeat(64))).toBe(false);
    // UTF-8 expands: 21 three-byte chars are 63 bytes and pass; 22 are 66.
    expect(validServiceName("日".repeat(21))).toBe(true);
    expect(validServiceName("日".repeat(22))).toBe(false);
    // RFC 6763 §4.1.1: instance names are RAW labels — dots and spaces are
    // legal punctuation a device may advertise ("TV 1.0"); only control
    // characters and the byte ceiling are refused.
    expect(validServiceName("TV 1.0")).toBe(true);
    expect(validServiceName("a.b")).toBe(true);
    expect(validServiceName("")).toBe(false);
    expect(validServiceName(null as never)).toBe(false);
  });

  test("isDiscoveredService checks the whole identity shape", () => {
    expect(isDiscoveredService(SERVICE)).toBe(true);
    expect(isDiscoveredService({ ...SERVICE, serviceType: "tv" })).toBe(false);
    expect(isDiscoveredService({ ...SERVICE, serviceName: "" })).toBe(false);
    expect(isDiscoveredService({ ...SERVICE, domain: "" })).toBe(false);
    expect(isDiscoveredService(null)).toBe(false);
  });

  test("validTxtRecord bounds entries and the complete key=value constituent", () => {
    expect(validTxtRecord({ name: "tv", addr: "10.0.0.5" })).toBe(true);
    expect(validTxtRecord({})).toBe(true);
    expect(validTxtRecord({ "configuration-url": "x" })).toBe(true); // §6.4 keys are a RECOMMENDATION
    expect(validTxtRecord({ k: "line1\nline2" })).toBe(true); // §6.5: arbitrary value bytes
    expect(validTxtRecord({ k: "x".repeat(253) })).toBe(true); // "k=" + 253 = 255 exactly
    expect(validTxtRecord({ k: "x".repeat(254) })).toBe(false); // constituent > 255 bytes
    expect(validTxtRecord({ k2: "x".repeat(255) })).toBe(false); // different key shifts the boundary
    expect(validTxtRecord({ "": "x" })).toBe(false); // empty key
    expect(validTxtRecord({ "k=v": "x" })).toBe(false); // '=' is the constituent grammar separator
    expect(validTxtRecord({ k: 7 as never })).toBe(false);
    expect(validTxtRecord(["a"] as never)).toBe(false);
    const oversize: Record<string, string> = {};
    for (let i = 0; i < 65; i += 1) oversize[`k${i}`] = "v";
    expect(validTxtRecord(oversize)).toBe(false); // > 64 entries
  });

  test("discoveryBrowseArgumentError refuses bad types and non-signal signals", () => {
    expect(discoveryBrowseArgumentError({ serviceType: "_tv._tcp" })).toBeNull();
    expect(discoveryBrowseArgumentError({ serviceType: "tv" })).toMatch(/serviceType/);
    expect(discoveryBrowseArgumentError({ serviceType: "_tv._tcp", signal: "nope" })).toMatch(
      /CapabilityCancelSignal/
    );
    expect(discoveryBrowseArgumentError(null)).toMatch(/object/);
  });
});

describe("TN-190 native adapter — availability", () => {
  test("a host without the discovery service is unsupported, never a fabricated browse", async () => {
    const { hostCall } = fakeHost({});
    const { capability } = createHostDiscoveryBridge(hostCall);
    expect(capability.availability()).toEqual({
      status: "unsupported",
      reason: "discovery.availability: this host has no discovery service",
    });
    expect(capability.permissionPrerequisites()).toBe(DISCOVERY_PERMISSIONS);
    expect(failureKind(await capability.browse({ serviceType: "_tv._tcp" }))).toBe("unsupported");
    expect(failureKind(await capability.resolve(SERVICE))).toBe("unsupported");
  });

  test("supported and degraded statuses pass through structurally", () => {
    const supported = fakeHost({ availability: availabilitySupported });
    expect(createHostDiscoveryBridge(supported.hostCall).capability.availability()).toEqual({
      status: "supported",
    });

    const degraded = fakeHost({
      availability: JSON.stringify({
        ok: true,
        value: { status: "unavailable", reason: "mDNS disabled by policy" },
      }),
    });
    expect(createHostDiscoveryBridge(degraded.hostCall).capability.availability()).toEqual({
      status: "unavailable",
      reason: "mDNS disabled by policy",
    });
  });

  test("denied availability names the refused permission; missing permission degrades honestly", () => {
    const denied = fakeHost({
      availability: JSON.stringify({
        ok: true,
        value: {
          status: "denied",
          permission: "android.permission.CHANGE_WIFI_MULTICAST_STATE",
        },
      }),
    });
    expect(createHostDiscoveryBridge(denied.hostCall).capability.availability()).toEqual({
      status: "denied",
      permission: "android.permission.CHANGE_WIFI_MULTICAST_STATE",
    });

    const deniedNoPermission = fakeHost({
      availability: JSON.stringify({ ok: true, value: { status: "denied" } }),
    });
    expect(createHostDiscoveryBridge(deniedNoPermission.hostCall).capability.availability()).toEqual({
      status: "unavailable",
      reason: "discovery.availability: denied without a permission",
    });
  });

  test("non-boolean ok discriminators fabricate nothing — fail closed", async () => {
    const stringFalse = fakeHost({
      availability: JSON.stringify({ ok: "false", value: { status: "supported" } }),
    });
    expect(createHostDiscoveryBridge(stringFalse.hostCall).capability.availability()).toMatchObject({
      status: "unavailable",
      reason: expect.stringContaining("ok is not a boolean"),
    });

    const browseStringFalse = fakeHost({
      browse: JSON.stringify({ ok: "false", value: { browseId: "d:1" } }),
    });
    expect(
      failureKind(
        await createHostDiscoveryBridge(browseStringFalse.hostCall).capability.browse({
          serviceType: "_tv._tcp",
        })
      )
    ).toBe("platform-error");
  });

  test("malformed availability statuses degrade honestly; non-JSON is surfaced", () => {
    const malformed = fakeHost({
      availability: JSON.stringify({ ok: true, value: { status: "maybe" } }),
    });
    expect(createHostDiscoveryBridge(malformed.hostCall).capability.availability()).toEqual({
      status: "unavailable",
      reason: "discovery.availability: malformed status",
    });

    const notJson = fakeHost({ availability: "not-json" });
    expect(createHostDiscoveryBridge(notJson.hostCall).capability.availability()).toMatchObject({
      status: "unavailable",
      reason: expect.stringContaining("non-JSON"),
    });
  });
});

describe("TN-190 native adapter — browse wire and events", () => {
  test("arguments are validated BEFORE the bridge is called", async () => {
    const { hostCall, calls } = fakeHost({});
    const { capability } = createHostDiscoveryBridge(hostCall);
    expect(failureKind(await capability.browse({ serviceType: "tv" }))).toBe("invalid-argument");
    expect(failureKind(await capability.browse("nope" as never))).toBe("invalid-argument");
    expect(calls.length).toBe(0);
  });

  test("the browse payload carries exactly the serviceType; events flow to listeners", async () => {
    const { hostCall, calls } = fakeHost({ availability: availabilitySupported, browse: browseAccepted });
    const { capability, handleHostEvent } = createHostDiscoveryBridge(hostCall);
    const pending = capability.browse({ serviceType: SERVICE.serviceType });
    expect(calls[0]!.payload).toEqual({ serviceType: SERVICE.serviceType });
    expect(handleHostEvent(event({ type: "browseStarted", browseId: "d:1" }))).toBe(true);
    const started = await pending;
    expect(started.ok).toBe(true);
    if (!started.ok) throw new Error("unreachable");
    const browse = started.value;

    const found: unknown[] = [];
    const lost: unknown[] = [];
    browse.onServiceFound((s) => found.push(s));
    browse.onServiceLost((s) => lost.push(s));

    expect(
      handleHostEvent(event({ type: "serviceFound", browseId: "d:1", service: SERVICE }))
    ).toBe(true);
    expect(found).toEqual([SERVICE]);
    expect(lost).toEqual([]);
    expect(handleHostEvent(event({ type: "serviceLost", browseId: "d:1", service: SERVICE }))).toBe(true);
    expect(lost).toEqual([SERVICE]);
  });

  test("a malformed browse reply (no browseId) is platform-error", async () => {
    const { hostCall } = fakeHost({ browse: JSON.stringify({ ok: true, value: {} }) });
    const { capability } = createHostDiscoveryBridge(hostCall);
    expect(failureKind(await capability.browse({ serviceType: "_tv._tcp" }))).toBe("platform-error");
  });

  test("synchronous host failures pass through with their frozen kind", async () => {
    const { hostCall } = fakeHost({
      browse: JSON.stringify({ ok: false, failure: { kind: "denied", message: "no multicast" } }),
    });
    const { capability } = createHostDiscoveryBridge(hostCall);
    const result = await capability.browse({ serviceType: "_tv._tcp" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.kind).toBe("denied");
      expect(result.failure.message).toBe("no multicast");
    }
  });

  test("stop() is idempotent, crosses the wire once, and silences later events", async () => {
    const { hostCall, calls } = fakeHost({ browse: browseAccepted, stop: JSON.stringify({ ok: true, value: null }) });
    const { capability, handleHostEvent } = createHostDiscoveryBridge(hostCall);
    const pending = capability.browse({ serviceType: SERVICE.serviceType });
    handleHostEvent(event({ type: "browseStarted", browseId: "d:1" }));
    const started = await pending;
    expect(started.ok).toBe(true);
    if (!started.ok) throw new Error("unreachable");
    const browse = started.value;

    browse.stop();
    browse.stop(); // idempotent: no second wire call, no throw
    expect(calls.filter((call) => call.method === "stop").length).toBe(1);

    const found: unknown[] = [];
    browse.onServiceFound((s) => found.push(s));
    expect(
      handleHostEvent(event({ type: "serviceFound", browseId: "d:1", service: SERVICE }))
    ).toBe(false); // unknown browse after stop stays visible, not delivered
    expect(found).toEqual([]);
  });

  test("a cancelled signal settles the pending browse and stops the host best-effort", async () => {
    const { hostCall, calls } = fakeHost({ browse: browseAccepted });
    const { capability } = createHostDiscoveryBridge(hostCall);
    const signal = createCancelSource();
    const pending = capability.browse({ serviceType: SERVICE.serviceType, signal });
    signal.cancel("user navigated away");
    const result = await pending;
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.kind).toBe("cancelled");
    expect(calls.some((call) => call.method === "stop")).toBe(true);
  });

  test("an already-aborted signal settles the browse immediately and still stops the host", async () => {
    const { hostCall, calls } = fakeHost({ browse: browseAccepted });
    const { capability } = createHostDiscoveryBridge(hostCall);
    const aborted = createCancelSource();
    aborted.cancel("too late");
    const result = await capability.browse({ serviceType: SERVICE.serviceType, signal: aborted });
    expect(failureKind(result)).toBe("cancelled");
    // The browse DID reach the host (the reply carried d:1); the stop call
    // must follow so the host is not left browsing for a dead caller.
    expect(calls.some((call) => call.method === "stop")).toBe(true);
  });

  test("cancelling AFTER the browse started silences it too (the frozen contract)", async () => {
    const { hostCall, calls } = fakeHost({ browse: browseAccepted });
    const bridge = createHostDiscoveryBridge(hostCall);
    const signal = createCancelSource();
    const pending = bridge.capability.browse({ serviceType: SERVICE.serviceType, signal });
    bridge.handleHostEvent(event({ type: "browseStarted", browseId: "d:1" }));
    const started = await pending;
    expect(started.ok).toBe(true);
    if (!started.ok) throw new Error("unreachable");

    signal.cancel("screen closed");
    expect(calls.some((call) => call.method === "stop")).toBe(true);
    const found: unknown[] = [];
    started.value.onServiceFound((s) => found.push(s));
    expect(
      bridge.handleHostEvent(event({ type: "serviceFound", browseId: "d:1", service: SERVICE }))
    ).toBe(false); // the cancelled browse no longer exists
    expect(found).toEqual([]);
  });

  test("a host-side browse stop settles the pending start with the host's failure", async () => {
    const { hostCall } = fakeHost({ browse: browseAccepted });
    const { capability, handleHostEvent } = createHostDiscoveryBridge(hostCall);
    const pending = capability.browse({ serviceType: SERVICE.serviceType });
    expect(
      handleHostEvent(
        event({
          type: "browseStopped",
          browseId: "d:1",
          failure: { kind: "unavailable", message: "NSD discovery start failed" },
        })
      )
    ).toBe(true);
    const result = await pending;
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.kind).toBe("unavailable");
      expect(result.failure.message).toBe("NSD discovery start failed");
    }
  });

  test("a browseStopped after a started browse silences events without throwing", async () => {
    const { hostCall } = fakeHost({ browse: browseAccepted });
    const bridge = createHostDiscoveryBridge(hostCall);
    const browse = await startedBrowse(hostCall, bridge, "d:1");
    expect(
      bridge.handleHostEvent(event({ type: "browseStopped", browseId: "d:1" }))
    ).toBe(true);
    const found: unknown[] = [];
    browse.onServiceFound((s) => found.push(s));
    expect(
      bridge.handleHostEvent(event({ type: "serviceFound", browseId: "d:1", service: SERVICE }))
    ).toBe(false); // unknown browse after host stop, stays visible
    expect(found).toEqual([]);
    expect(() => browse.stop()).not.toThrow(); // already dead; still idempotent
  });

  test("malformed events are rejected visibly, never delivered", async () => {
    const { hostCall } = fakeHost({ browse: browseAccepted });
    const { capability, handleHostEvent } = createHostDiscoveryBridge(hostCall);
    const pending = capability.browse({ serviceType: SERVICE.serviceType });
    handleHostEvent(event({ type: "browseStarted", browseId: "d:1" }));
    const result = await pending;
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const found: unknown[] = [];
    result.value.onServiceFound((s) => found.push(s));

    expect(handleHostEvent(event({ type: "serviceFound", browseId: "d:1" }))).toBe(false); // no service
    expect(
      handleHostEvent(event({ type: "serviceFound", browseId: "d:1", service: { serviceType: "tv" } }))
    ).toBe(false); // malformed service
    expect(handleHostEvent(event({ type: "serviceFound", browseId: "d:9", service: SERVICE }))).toBe(false); // unknown browse
    expect(handleHostEvent("not-json")).toBe(false);
    expect(found).toEqual([]);
  });
});

describe("TN-190 native adapter — resolve", () => {
  test("arguments are validated BEFORE the bridge is called", async () => {
    const { hostCall, calls } = fakeHost({});
    const { capability } = createHostDiscoveryBridge(hostCall);
    expect(failureKind(await capability.resolve({ ...SERVICE, serviceType: "tv" }))).toBe(
      "invalid-argument"
    );
    expect(failureKind(await capability.resolve(null as never))).toBe("invalid-argument");
    expect(calls.length).toBe(0);
  });

  test("a successful resolve settles from the host event with host/port/txt", async () => {
    const { hostCall, calls } = fakeHost({ resolve: resolveAccepted });
    const { capability, handleHostEvent } = createHostDiscoveryBridge(hostCall);
    const pending = capability.resolve(SERVICE);
    expect(calls[0]!.payload).toEqual({ service: SERVICE });
    expect(
      handleHostEvent(
        event({
          type: "resolve",
          resolveId: "r:1",
          ok: true,
          host: "10.0.0.5",
          port: 6467,
          txt: { name: "tv" },
        })
      )
    ).toBe(true);
    const result = await pending;
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.host).toBe("10.0.0.5");
      expect(result.value.port).toBe(6467);
      expect(result.value.txt).toEqual({ name: "tv" });
    }
  });

  test("resolve not-found is a structured unavailable failure, never a hang", async () => {
    const { hostCall } = fakeHost({ resolve: resolveAccepted });
    const { capability, handleHostEvent } = createHostDiscoveryBridge(hostCall);
    const pending = capability.resolve(SERVICE);
    expect(
      handleHostEvent(
        event({
          type: "resolve",
          resolveId: "r:1",
          ok: false,
          failure: { kind: "unavailable", message: "the service is no longer on the network" },
        })
      )
    ).toBe(true);
    const result = await pending;
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.kind).toBe("unavailable");
      expect(result.failure.message).toBe("the service is no longer on the network");
    }
  });

  test("malformed resolve endpoints surface as platform-error, not fabricated endpoints", async () => {
    const { hostCall } = fakeHost({ resolve: resolveAccepted });
    const { capability, handleHostEvent } = createHostDiscoveryBridge(hostCall);
    const pending = capability.resolve(SERVICE);
    handleHostEvent(event({ type: "resolve", resolveId: "r:1", ok: true, host: "10.0.0.5", port: 0 }));
    expect(failureKind(await pending)).toBe("platform-error");

    const second = capability.resolve(SERVICE); // ids reuse r:1 in this fake
    handleHostEvent(event({ type: "resolve", resolveId: "r:1", ok: true, host: "h", port: 1, txt: 7 }));
    expect(failureKind(await second)).toBe("platform-error");
  });

  test("duplicate resolve events for a settled id are rejected visibly", async () => {
    const { hostCall } = fakeHost({ resolve: resolveAccepted });
    const { capability, handleHostEvent } = createHostDiscoveryBridge(hostCall);
    const pending = capability.resolve(SERVICE);
    handleHostEvent(event({ type: "resolve", resolveId: "r:1", ok: true, host: "h", port: 1, txt: {} }));
    expect((await pending).ok).toBe(true);
    expect(
      handleHostEvent(event({ type: "resolve", resolveId: "r:1", ok: true, host: "h", port: 1, txt: {} }))
    ).toBe(false);
  });

  test("a throwing bridge is platform-error, never a fabricated browse or endpoint", async () => {
    const { hostCall } = fakeHost({}, { throwOn: "browse" });
    const { capability } = createHostDiscoveryBridge(hostCall);
    expect(failureKind(await capability.browse({ serviceType: "_tv._tcp" }))).toBe("platform-error");
  });

  test("unknown host failure kinds never pass through the frozen alphabet", async () => {
    const { hostCall } = fakeHost({ resolve: resolveAccepted });
    const { capability, handleHostEvent } = createHostDiscoveryBridge(hostCall);
    const pending = capability.resolve(SERVICE);
    handleHostEvent(
      event({ type: "resolve", resolveId: "r:1", ok: false, failure: { kind: "npf-exception" } })
    );
    expect(failureKind(await pending)).toBe("platform-error");
  });
});

import { describe, expect, test } from "bun:test";
import { createHostKeysCapability, type KeysHostCall } from "../src/index";

/**
 * TN-189 native bridge adapter: maps the TN-154 `tenun_host_call` wire
 * protocol (mirrored by KeysService.kt) onto the frozen KeysCapability
 * contract. These tests run against a fake bridge whose replies follow the
 * documented envelope — the real QuickJS→JNI→AndroidKeyStore path is the
 * androidTest KeysBridgeTest — and pin the fail-closed rules: null replies
 * are `unsupported`, malformed payloads are `platform-error`, failure kinds
 * outside the frozen alphabet never pass through, and signatures must be
 * exactly 64 raw bytes.
 */

const PEM = "-----BEGIN CERTIFICATE-----\nAAAAAAAA\n-----END CERTIFICATE-----\n";
const RAW64_B64 = "A".repeat(86) + "=="; // 64 zero bytes in standard base64

function fakeHost(reply: (method: string, payloadJson: string) => string | null): KeysHostCall {
  return (service, method, payloadJson) => {
    if (service !== "keys") return null;
    return reply(method, payloadJson);
  };
}

const envelope = (value: unknown) => JSON.stringify({ ok: true, value });
const failure = (kind: string, message: string) =>
  JSON.stringify({ ok: false, failure: { kind, message } });

describe("TN-189 native adapter happy path", () => {
  test("availability, generate, sign, export, remove map 1:1 onto the wire", async () => {
    const calls: Array<[string, string]> = [];
    const hostCall = fakeHost((method, payloadJson) => {
      calls.push([method, payloadJson]);
      switch (method) {
        case "availability":
          return envelope({ status: "supported" });
        case "generateIdentity":
          return envelope({ handle: "pair.a", certificatePem: PEM });
        case "sign":
          return envelope(RAW64_B64);
        case "exportCertificatePem":
          return envelope(PEM);
        case "removeIdentity":
          return JSON.stringify({ ok: true, value: null });
        default:
          return null;
      }
    });
    const keys = createHostKeysCapability(hostCall);

    expect(keys.availability()).toEqual({ status: "supported" });
    const identity = await keys.generateIdentity("pair.a");
    expect(identity).toEqual({ ok: true, value: { handle: "pair.a", certificatePem: PEM } });

    const data = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
    const signed = await keys.sign("pair.a", data);
    expect(signed.ok).toBe(true);
    if (signed.ok) {
      expect(signed.value.length).toBe(64);
      expect(signed.value[0]).toBe(0);
    }
    // The bridge payload carried STANDARD base64 of the bytes.
    const signCall = calls.find(([m]) => m === "sign")!;
    expect(JSON.parse(signCall[1])).toEqual({ handle: "pair.a", data: "3q2+7w==" });
    // Handles ride through untouched (opaque, never parsed).
    expect(JSON.parse(calls.find(([m]) => m === "generateIdentity")![1])).toEqual({ alias: "pair.a" });

    expect(await keys.exportCertificatePem("pair.a")).toEqual({ ok: true, value: PEM });
    expect(await keys.removeIdentity("pair.a")).toEqual({ ok: true, value: undefined });
  });

  test("empty-byte payloads cross the wire as empty base64", async () => {
    const hostCall = fakeHost((method) => (method === "sign" ? envelope(RAW64_B64) : null));
    const keys = createHostKeysCapability(hostCall);
    const signed = await keys.sign("a", new Uint8Array(0));
    expect(signed.ok).toBe(true);
  });
});

describe("TN-189 native adapter fail-closed behavior", () => {
  test("a host without the keys service (null replies) is unsupported", async () => {
    const keys = createHostKeysCapability(() => null);
    expect(keys.availability()).toEqual({
      status: "unsupported",
      reason: "keys.availability: this host has no keys service",
    });
    const signed = await keys.sign("a", new Uint8Array(1));
    expect(signed.ok).toBe(false);
    if (!signed.ok) expect(signed.failure.kind).toBe("unsupported");
  });

  test("a throwing bridge surfaces as platform-error, never a throw", async () => {
    const keys = createHostKeysCapability(() => {
      throw new Error("jni exploded");
    });
    const signed = await keys.sign("a", new Uint8Array(1));
    expect(signed.ok).toBe(false);
    if (!signed.ok) {
      expect(signed.failure.kind).toBe("platform-error");
      expect(signed.failure.message).toContain("jni exploded");
    }
  });

  test("non-JSON and non-envelope replies are platform-error", async () => {
    for (const reply of ["not json", JSON.stringify({ nope: 1 }), "42"]) {
      const keys = createHostKeysCapability(() => reply);
      const result = await keys.exportCertificatePem("a");
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.failure.kind).toBe("platform-error");
    }
  });

  test("failure kinds outside the frozen alphabet never pass through", async () => {
    const keys = createHostKeysCapability(() => failure("catastrophic", "boom"));
    const result = await keys.removeIdentity("a");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.kind).toBe("platform-error");
  });

  test("frozen-alphabet failures pass through with their message", async () => {
    const keys = createHostKeysCapability(() => failure("invalid-argument", "alias already exists: a"));
    const result = await keys.generateIdentity("a");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.kind).toBe("invalid-argument");
      expect(result.failure.message).toBe("alias already exists: a");
    }
  });

  test("malformed successful values are platform-error", async () => {
    const badIdentity = createHostKeysCapability(fakeHost((m) =>
      m === "generateIdentity" ? envelope({ handle: 7 }) : null
    ));
    expect((await badIdentity.generateIdentity("a")).ok).toBe(false);

    const badPem = createHostKeysCapability(fakeHost((m) =>
      m === "exportCertificatePem" ? envelope("not a pem") : null
    ));
    const pem = await badPem.exportCertificatePem("a");
    expect(pem.ok).toBe(false);
    if (!pem.ok) expect(pem.failure.kind).toBe("platform-error");

    const shortSig = createHostKeysCapability(fakeHost((m) =>
      m === "sign" ? envelope(btoa("six")) : null
    ));
    const signed = await shortSig.sign("a", new Uint8Array(1));
    expect(signed.ok).toBe(false);
    if (!signed.ok) expect(signed.failure.kind).toBe("platform-error");

    const notB64 = createHostKeysCapability(fakeHost((m) => (m === "sign" ? envelope("!!!") : null)));
    const bad = await notB64.sign("a", new Uint8Array(1));
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.failure.kind).toBe("platform-error");
  });

  test("invalid arguments are refused before the bridge is called", async () => {
    let calls = 0;
    const keys = createHostKeysCapability(() => {
      calls += 1;
      return envelope({ status: "supported" });
    });
    await keys.generateIdentity("");
    await keys.generateIdentity("a".repeat(129) as string);
    await keys.sign("a", "nope" as unknown as Uint8Array);
    await keys.sign("a", new Uint8Array(65_537));
    await keys.exportCertificatePem(7 as unknown as string);
    expect(calls).toBe(0);
  });

  test("the adapter needs no Web APIs: works with btoa/atob deleted", async () => {
    const globalAny = globalThis as { btoa?: unknown; atob?: unknown };
    const savedBtoa = globalAny.btoa;
    const savedAtob = globalAny.atob;
    try {
      delete globalAny.btoa;
      delete globalAny.atob;
      const keys = createHostKeysCapability(fakeHost((m) => {
        if (m === "sign") return envelope(RAW64_B64);
        if (m === "generateIdentity") return envelope({ handle: "a", certificatePem: PEM });
        return null;
      }));
      const signed = await keys.sign("a", new Uint8Array([1, 2, 3]));
      expect(signed.ok).toBe(true);
      if (signed.ok) expect(signed.value.length).toBe(64);
    } finally {
      if (savedBtoa !== undefined) globalAny.btoa = savedBtoa;
      if (savedAtob !== undefined) globalAny.atob = savedAtob;
    }
  });

  test("availability passes through structured degradation states", () => {
    const keys = createHostKeysCapability(fakeHost((m) =>
      m === "availability"
        ? envelope({ status: "unavailable", reason: "locked" })
        : null
    ));
    expect(keys.availability()).toEqual({ status: "unavailable", reason: "locked" });
  });
});

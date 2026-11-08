import { describe, expect, test } from "bun:test";
import { createCancelSource } from "../src/capability";
import { createFakeNetEndpoint } from "../src/net-preview";
import { MAX_NET_WRITE_BYTES } from "../src/net-validation";
import type { CapabilityResult } from "../src/capability";
import type { NetSession } from "../src/net";

/**
 * TN-188 headless contract suite against the in-memory fake endpoint —
 * the deterministic tier of the verification list: connect, write/receive
 * round-trip, first-use fingerprint delivered, pin enforcement on a second
 * connect, link-lost on remote close, double close is a no-op, cancelled
 * signal aborts connect, plus the shared argument bounds. The same
 * semantics are asserted again over the WebSocket proxy (net-preview.test)
 * and over the real bridge on device (NetBridgeTest).
 */

const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
const bytes = (s: string) => new TextEncoder().encode(s);

async function connectOk(
  capability: ReturnType<typeof createFakeNetEndpoint>["capability"],
  options: Parameters<typeof capability.connect>[0]
): Promise<NetSession> {
  const result = await capability.connect(options);
  if (!result.ok) throw new Error(`connect failed: ${JSON.stringify(result.failure)}`);
  return result.value;
}

function failureKind(result: CapabilityResult<unknown>): string {
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("unreachable");
  return result.failure.kind;
}

describe("TN-188 fake endpoint — connect and round-trip", () => {
  test("connect resolves linked; writes echo back and reach the server", async () => {
    const { capability, server } = createFakeNetEndpoint();
    const session = await connectOk(capability, { host: "tv.lan", port: 6466 });

    const received: string[] = [];
    session.onData((chunk) => received.push(text(chunk)));
    const states: string[] = [];
    session.onLinkStateChange((state) => states.push(state));

    const written = await session.write(bytes("HELLO"));
    expect(written.ok).toBe(true);
    expect(received).toEqual(["HELLO"]); // synchronous echo, no lost events
    expect(server.written().length).toBe(1);
    expect(text(server.written()[0]!)).toBe("HELLO");
    expect(states).toEqual(["linked"]); // replay-on-register, no spurious transitions

    await session.close();
    expect(states).toEqual(["linked", "offline"]);
  });

  test("server push arrives without a write (notification shape)", async () => {
    const { capability, server } = createFakeNetEndpoint();
    const session = await connectOk(capability, { host: "tv.lan", port: 6466 });
    const received: Uint8Array[] = [];
    session.onData((chunk) => received.push(chunk));
    server.send(bytes("ST:PAIR|1234"));
    expect(received.length).toBe(1);
    expect(text(received[0]!)).toBe("ST:PAIR|1234");
  });

  test("empty writes are valid and recorded as zero bytes", async () => {
    const { capability, server } = createFakeNetEndpoint();
    const session = await connectOk(capability, { host: "tv.lan", port: 6466 });
    const result = await session.write(new Uint8Array(0));
    expect(result.ok).toBe(true);
    expect(server.written()[0]!.length).toBe(0);
  });

  test("oversized and non-binary writes are invalid-argument before the transport", async () => {
    const { capability, server } = createFakeNetEndpoint();
    const session = await connectOk(capability, { host: "tv.lan", port: 6466 });
    expect(failureKind(await session.write(new Uint8Array(MAX_NET_WRITE_BYTES + 1)))).toBe(
      "invalid-argument"
    );
    // @ts-expect-error deliberately wrong type crossing the seam
    expect(failureKind(await session.write("a string"))).toBe("invalid-argument");
    expect(server.written().length).toBe(0);
  });

  test("unsubscribed listeners stop receiving; late link subscribers see the current state", async () => {
    const { capability, server } = createFakeNetEndpoint();
    const session = await connectOk(capability, { host: "tv.lan", port: 6466 });
    let hits = 0;
    const off = session.onData(() => {
      hits += 1;
    });
    off();
    await session.write(bytes("x"));
    server.send(bytes("y"));
    expect(hits).toBe(0);

    const late: string[] = [];
    session.onLinkStateChange((state) => late.push(state));
    expect(late).toEqual(["linked"]); // replay, not silence
    server.disconnect();
    expect(late).toEqual(["linked", "offline"]);
  });

  test("data listeners never replay history — a late subscriber gets no duplicate chunk", async () => {
    const { capability, server } = createFakeNetEndpoint();
    const session = await connectOk(capability, { host: "tv.lan", port: 6466 });
    server.send(bytes("first"));
    let hits = 0;
    session.onData(() => {
      hits += 1;
    });
    expect(hits).toBe(0);
    server.send(bytes("second"));
    expect(hits).toBe(1);
  });
});

describe("TN-188 first-use pairing and pin enforcement", () => {
  test("first-use mode delivers the fingerprint; pinning it on a second connect is silent", async () => {
    const { capability, server } = createFakeNetEndpoint();
    const first = await connectOk(capability, { host: "tv.lan", port: 6466, tls: {} });
    const fingerprints: string[] = [];
    first.onServerCertificate((sha) => fingerprints.push(sha));
    expect(fingerprints).toEqual([server.fingerprint]);
    await first.close();

    // The app pins what it saw; the second connect passes the pin.
    const second = await capability.connect({
      host: "tv.lan",
      port: 6466,
      tls: { expectedServerCertSha256: server.fingerprint },
    });
    expect(second.ok).toBe(true);
    if (second.ok) {
      const pins: string[] = [];
      second.value.onServerCertificate((sha) => pins.push(sha));
      expect(pins).toEqual([]); // pinned mode: no fingerprint to confirm
      await second.value.close();
    }
  });

  test("a wrong pin is link-lost, never a silent connection to another endpoint", async () => {
    const { capability } = createFakeNetEndpoint();
    const result = await capability.connect({
      host: "tv.lan",
      port: 6466,
      tls: { expectedServerCertSha256: "bb".repeat(32) },
    });
    expect(failureKind(result)).toBe("link-lost");
    if (!result.ok) expect(result.failure.message).toContain("mismatch");
  });

  test("upper-case pins compare case-insensitively", async () => {
    const { capability, server } = createFakeNetEndpoint();
    const result = await capability.connect({
      host: "tv.lan",
      port: 6466,
      tls: { expectedServerCertSha256: server.fingerprint.toUpperCase() },
    });
    expect(result.ok).toBe(true);
    if (result.ok) await result.value.close();
  });
});

describe("TN-188 link loss and close semantics", () => {
  test("remote close: offline event, writes fail link-lost, never hang", async () => {
    const { capability, server } = createFakeNetEndpoint();
    const session = await connectOk(capability, { host: "tv.lan", port: 6466 });
    const states: string[] = [];
    session.onLinkStateChange((state) => states.push(state));
    server.disconnect();
    expect(states).toEqual(["linked", "offline"]);
    expect(failureKind(await session.write(bytes("after")))).toBe("link-lost");
  });

  test("double close is a no-op and both resolve ok", async () => {
    const { capability } = createFakeNetEndpoint();
    const session = await connectOk(capability, { host: "tv.lan", port: 6466 });
    expect((await session.close()).ok).toBe(true);
    expect((await session.close()).ok).toBe(true);
    expect(failureKind(await session.write(bytes("late")))).toBe("link-lost");
  });

  test("a refused connect is link-lost", async () => {
    const { capability, server } = createFakeNetEndpoint();
    server.refuseNextConnect();
    expect(failureKind(await capability.connect({ host: "tv.lan", port: 6466 }))).toBe(
      "link-lost"
    );
  });

  test("echo can be disabled for one-way protocols", async () => {
    const { capability, server } = createFakeNetEndpoint();
    server.setEcho(false);
    const session = await connectOk(capability, { host: "tv.lan", port: 6466 });
    const received: string[] = [];
    session.onData((chunk) => received.push(text(chunk)));
    expect((await session.write(bytes("CMD"))).ok).toBe(true);
    expect(received).toEqual([]);
    expect(text(server.written()[0]!)).toBe("CMD");
  });
});

describe("TN-188 cancellation", () => {
  test("a held connect settles cancelled when the signal fires, and never resurrects", async () => {
    const { capability, server } = createFakeNetEndpoint();
    server.holdNextConnect();
    const source = createCancelSource();
    const pending = capability.connect({ host: "tv.lan", port: 6466, signal: source });
    source.cancel("user navigated away");
    expect(failureKind(await pending)).toBe("cancelled");
    // A late server release must not change the settled outcome.
    server.releaseHeldConnect();
    const again = await capability.connect({ host: "tv.lan", port: 6466 });
    expect(again.ok).toBe(true); // hold is consumed; the NEXT connect is normal
    if (again.ok) await again.value.close();
  });

  test("an already-aborted signal refuses the connect before the transport", async () => {
    const { capability, server } = createFakeNetEndpoint();
    const source = createCancelSource();
    source.cancel();
    expect(failureKind(await capability.connect({ host: "tv.lan", port: 6466, signal: source }))).toBe(
      "cancelled"
    );
    expect(server.written().length).toBe(0);
  });

  test("cancelling after the session is established does not tear it down", async () => {
    const { capability } = createFakeNetEndpoint();
    const source = createCancelSource();
    const session = await connectOk(capability, { host: "tv.lan", port: 6466, signal: source });
    source.cancel("late");
    expect((await session.write(bytes("still-here"))).ok).toBe(true);
    await session.close();
  });
});

describe("TN-188 shared argument validation", () => {
  const { capability } = createFakeNetEndpoint();

  test("hosts: empty, URLs, whitespace, control characters, and length are refused", async () => {
    for (const host of ["", "https://tv.lan", "tv .lan", "tv\nlan", `${"a".repeat(254)}`, "tv.lan/patch", "a?b", "a#b"]) {
      const result = await capability.connect({ host, port: 80 });
      if (result.ok) await result.value.close();
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.failure.kind).toBe("invalid-argument");
    }
  });

  test("ports outside 1..65535 (and non-integers) are refused", async () => {
    for (const port of [0, -1, 65536, 1.5, Number.NaN]) {
      expect(failureKind(await capability.connect({ host: "tv.lan", port }))).toBe(
        "invalid-argument"
      );
    }
  });

  test("timeoutMs bounds and signal/tls shapes are enforced", async () => {
    expect(failureKind(await capability.connect({ host: "tv.lan", port: 1, timeoutMs: 0 }))).toBe(
      "invalid-argument"
    );
    expect(
      failureKind(await capability.connect({ host: "tv.lan", port: 1, timeoutMs: 120_001 }))
    ).toBe("invalid-argument");
    expect(
      failureKind(
        await capability.connect({
          host: "tv.lan",
          port: 1,
          // @ts-expect-error deliberately wrong shape crossing the seam
          signal: { aborted: "yes" },
        })
      )
    ).toBe("invalid-argument");
    expect(
      failureKind(
        await capability.connect({
          host: "tv.lan",
          port: 1,
          // @ts-expect-error unknown tls fields are refused, not ignored
          tls: { cipher: "aes" },
        })
      )
    ).toBe("invalid-argument");
    expect(
      failureKind(
        await capability.connect({
          host: "tv.lan",
          port: 1,
          tls: { expectedServerCertSha256: "xyz" },
        })
      )
    ).toBe("invalid-argument");
    expect(
      failureKind(
        await capability.connect({ host: "tv.lan", port: 1, tls: { clientIdentity: "" } })
      )
    ).toBe("invalid-argument");
    expect(
      failureKind(
        await capability.connect({ host: "tv.lan", port: 1, tls: { serverName: "https://x" } })
      )
    ).toBe("invalid-argument");
  });

  test("a valid 253-character host reaches the endpoint", async () => {
    const session = await connectOk(capability, { host: `${"a".repeat(253)}`, port: 6466 });
    await session.close();
  });
});

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { connect as tcpConnect, createServer, type Socket } from "node:net";
import { createCancelSource } from "../src/capability";
import { previewNetCapability } from "../src/net-preview";
import type { CapabilityResult } from "../src/capability";
import type { NetCapability, NetSession } from "../src/net";

/**
 * TN-188 preview-shim verification against REAL loopback TCP: a Bun
 * WebSocket↔TCP proxy (host-side code, the dev-server's role) plus a
 * node:net echo server, then the same contract suite the fake endpoint
 * and the device gate run: connect, write/receive round-trip, first-use
 * fingerprint, pin enforcement, link-lost on remote close, double close,
 * timeout, and cancellation. TLS terminates at the proxy by spec; the
 * fingerprint is proxy-synthesized and the pin journey is exercised for
 * real on top of it.
 */

const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
const bytes = (s: string) => new TextEncoder().encode(s);

function failureKind(result: CapabilityResult<unknown>): string {
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("unreachable");
  return result.failure.kind;
}

// Bun's websocket upgrade needs the request in fetch(); build it properly.
function makeProxy(options: { silent?: boolean } = {}): Promise<{
  url: (host: string, port: number) => string;
  close(): Promise<void>;
}> {
  const fingerprintFor = (host: string, port: number) =>
    createHash("sha256").update(`tenun-preview-endpoint:${host}:${port}`).digest("hex");

  const upstreamByWs = new Map<import("bun").ServerWebSocket<URL>, Socket>();
  return new Promise((resolveReady) => {
    const server = Bun.serve<URL>({
      port: 0,
      fetch(request, server) {
        if (server.upgrade(request, { data: new URL(request.url) })) return;
        return new Response("ws only", { status: 426 });
      },
      websocket: {
        open(ws) {
          const url = ws.data;
          const host = url.searchParams.get("host") ?? "";
          const port = Number(url.searchParams.get("port") ?? "0");
          const upstream = tcpConnect({ host, port }, () => {
            if (!options.silent) {
              ws.send(
                JSON.stringify({
                  type: "endpoint",
                  fingerprint: fingerprintFor(host, port),
                  tls: "terminated-at-proxy",
                })
              );
            }
          });
          upstreamByWs.set(ws, upstream);
          upstream.on("data", (chunk) => ws.send(chunk));
          upstream.on("close", () => ws.close());
          upstream.on("error", () => ws.close());
        },
        message(ws, message) {
          const upstream = upstreamByWs.get(ws);
          if (upstream && typeof message !== "string") {
            upstream.write(Buffer.from(message));
          }
        },
        close(ws) {
          const upstream = upstreamByWs.get(ws);
          if (upstream) {
            upstreamByWs.delete(ws);
            upstream.destroy();
          }
        },
      },
    });
    resolveReady({
      url: (host: string, port: number) =>
        `ws://${server.hostname === "::" ? "localhost" : server.hostname}:${server.port}/?host=${encodeURIComponent(host)}&port=${port}`,
      close: () =>
        new Promise<void>((resolve) => {
          for (const upstream of upstreamByWs.values()) upstream.destroy();
          server.stop(true);
          resolve();
        }),
    });
  });
}

/** A loopback TCP echo server with a greeting and observable closes. */
function startEchoServer(greeting?: Uint8Array): Promise<{
  host: string;
  port: number;
  connections(): number;
  readonly closed: Promise<void>;
  close(): Promise<void>;
}> {
  let connections = 0;
  const sockets = new Set<Socket>();
  let closedResolve: () => void = () => undefined;
  const closed = new Promise<void>((resolve) => {
    closedResolve = resolve;
  });
  const server = createServer((socket) => {
    connections += 1;
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    if (greeting) socket.write(greeting);
    socket.on("data", (chunk) => socket.write(chunk));
  });
  return new Promise((resolveReady) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address() as { address: string; port: number };
      resolveReady({
        host: address.address,
        port: address.port,
        connections: () => connections,
        closed,
        close: () =>
          new Promise<void>((resolve) => {
            for (const socket of sockets) socket.destroy();
            closedResolve();
            server.close(() => resolve());
          }),
      });
    });
  });
}

async function connectOk(
  capability: NetCapability,
  options: Parameters<NetCapability["connect"]>[0]
): Promise<NetSession> {
  const result = await capability.connect(options);
  if (!result.ok) throw new Error(`connect failed: ${JSON.stringify(result.failure)}`);
  return result.value;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("TN-188 preview shim over a real loopback proxy", () => {
  let proxy: Awaited<ReturnType<typeof makeProxy>>;
  let echo: Awaited<ReturnType<typeof startEchoServer>>;

  beforeAll(async () => {
    proxy = await makeProxy();
    echo = await startEchoServer(bytes("HELLO-FROM-SERVER\n"));
  });
  afterAll(async () => {
    await proxy.close();
    await echo.close();
  });

  const capability = () => previewNetCapability({ proxyUrl: proxy.url });

  test("connect resolves linked; the greeting arrives as a data chunk; writes echo back", async () => {
    const session = await connectOk(capability(), { host: echo.host, port: echo.port, timeoutMs: 5000 });
    const states: string[] = [];
    session.onLinkStateChange((state) => states.push(state));
    expect(states).toEqual(["linked"]);

    const received: string[] = [];
    session.onData((chunk) => received.push(text(chunk)));
    await sleep(100); // greeting + echo race across two real sockets
    expect((await session.write(bytes("PING"))).ok).toBe(true);
    await sleep(100);
    expect(received.join("")).toContain("HELLO-FROM-SERVER");
    expect(received.join("")).toContain("PING");
    await session.close();
  });

  test("first-use fingerprint is proxy-synthesized and stable for the endpoint", async () => {
    const session = await connectOk(capability(), { host: echo.host, port: echo.port, timeoutMs: 5000 });
    const pins: string[] = [];
    session.onServerCertificate((sha) => pins.push(sha));
    const expected = createHash("sha256")
      .update(`tenun-preview-endpoint:${echo.host}:${echo.port}`)
      .digest("hex");
    expect(pins).toEqual([expected]);
    await session.close();
  });

  test("pinning the seen fingerprint connects silently; a wrong pin is link-lost", async () => {
    const good = createHash("sha256")
      .update(`tenun-preview-endpoint:${echo.host}:${echo.port}`)
      .digest("hex");
    const pinned = await capability().connect({
      host: echo.host,
      port: echo.port,
      timeoutMs: 5000,
      tls: { expectedServerCertSha256: good },
    });
    expect(pinned.ok).toBe(true);
    if (pinned.ok) {
      const pins: string[] = [];
      pinned.value.onServerCertificate((sha) => pins.push(sha));
      expect(pins).toEqual([]);
      await pinned.value.close();
    }

    const wrong = await capability().connect({
      host: echo.host,
      port: echo.port,
      timeoutMs: 5000,
      tls: { expectedServerCertSha256: "ee".repeat(32) },
    });
    expect(failureKind(wrong)).toBe("link-lost");
  });

  test("remote close: the session sees offline and later writes fail link-lost", async () => {
    const perTestEcho = await startEchoServer();
    try {
      const session = await connectOk(capability(), { host: perTestEcho.host, port: perTestEcho.port, timeoutMs: 5000 });
      const states: string[] = [];
      session.onLinkStateChange((state) => states.push(state));
      expect(states).toEqual(["linked"]);
      await perTestEcho.close();
      await sleep(150);
      expect(states).toEqual(["linked", "offline"]);
      expect(failureKind(await session.write(bytes("after")))).toBe("link-lost");
      expect((await session.close()).ok).toBe(true); // idempotent
      expect((await session.close()).ok).toBe(true);
    } finally {
      await perTestEcho.close();
    }
  });

  test("a connect the proxy cannot establish fails link-lost, never hangs", async () => {
    const dead = createServer();
    await new Promise<void>((resolve) => dead.listen(0, "127.0.0.1", resolve));
    const address = dead.address() as { address: string; port: number };
    await new Promise<void>((resolve) => dead.close(() => resolve())); // nothing listens now

    const result = await capability().connect({ host: address.address, port: address.port, timeoutMs: 5000 });
    expect(failureKind(result)).toBe("link-lost");
  });

  test("timeoutMs bounds the hello wait (silent proxy)", async () => {
    const silent = await makeProxy({ silent: true });
    try {
      const echo2 = await startEchoServer();
      try {
        const silentCapability = previewNetCapability({ proxyUrl: silent.url });
        const result = await silentCapability.connect({
          host: echo2.host,
          port: echo2.port,
          timeoutMs: 150,
        });
        expect(failureKind(result)).toBe("timeout");
      } finally {
        await echo2.close();
      }
    } finally {
      await silent.close();
    }
  });

  test("a cancel signal aborts a silent connect without waiting for the timeout", async () => {
    const silent = await makeProxy({ silent: true });
    try {
      const echo2 = await startEchoServer();
      try {
        const silentCapability = previewNetCapability({ proxyUrl: silent.url });
        const source = createCancelSource();
        const pending = silentCapability.connect({
          host: echo2.host,
          port: echo2.port,
          timeoutMs: 10_000,
          signal: source,
        });
        source.cancel("user navigated away");
        expect(failureKind(await pending)).toBe("cancelled");
      } finally {
        await echo2.close();
      }
    } finally {
      await silent.close();
    }
  });

  test("argument validation refuses before any socket is touched", async () => {
    expect(failureKind(await capability().connect({ host: "https://tv.lan", port: 1 }))).toBe(
      "invalid-argument"
    );
    expect(failureKind(await capability().connect({ host: "tv.lan", port: 0 }))).toBe(
      "invalid-argument"
    );
  });
});

describe("TN-188 preview availability", () => {
  const savedWebSocket = (globalThis as { WebSocket?: unknown }).WebSocket;

  test("without WebSocket the capability degrades to unavailable, honestly", async () => {
    const globalAny = globalThis as { WebSocket?: unknown };
    delete globalAny.WebSocket;
    try {
      const capability = previewNetCapability({ proxyUrl: () => "ws://localhost:1/" });
      expect(capability.availability()).toEqual({
        status: "unavailable",
        reason: "preview net needs WebSocket for the loopback proxy",
      });
      expect(failureKind(await capability.connect({ host: "tv.lan", port: 1 }))).toBe(
        "unavailable"
      );
    } finally {
      globalAny.WebSocket = savedWebSocket;
    }
  });

  test("with WebSocket present the capability is supported and tables its permissions", () => {
    const capability = previewNetCapability({ proxyUrl: () => "ws://localhost:1/" });
    expect(capability.availability()).toEqual({ status: "supported" });
    expect(capability.permissionPrerequisites()[0]!.platform).toBe("android");
  });
});

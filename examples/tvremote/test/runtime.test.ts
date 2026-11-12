import { describe, expect, test } from "bun:test";
import type {
  CapabilityResult,
  DiscoveryBrowse,
  DiscoveryCapability,
  KeysCapability,
  NetCapability,
  NetSession,
  NetLinkState,
  DiscoveredService,
} from "@tenunjs/platform";
import { TvRemoteRuntime } from "../src/runtime";
import {
  decodeFrames,
  frameMessage,
  parseOuterMessage,
  parseRemoteMessage,
  POLO_STATUS,
  RemoteKeyCode,
  RemoteDirection,
} from "../src/protocol";

// ----------------------------------------------------------------------------
// Headless test fakes
// ----------------------------------------------------------------------------

function createFakeDiscovery(): {
  discovery: DiscoveryCapability;
  fireFound(service: DiscoveredService): void;
  fireLost(service: DiscoveredService): void;
} {
  let foundListeners: ((s: DiscoveredService) => void)[] = [];
  let lostListeners: ((s: DiscoveredService) => void)[] = [];

  const browse: DiscoveryBrowse = {
    onServiceFound(listener) {
      foundListeners.push(listener);
      return () => {
        foundListeners = foundListeners.filter((l) => l !== listener);
      };
    },
    onServiceLost(listener) {
      lostListeners.push(listener);
      return () => {
        lostListeners = lostListeners.filter((l) => l !== listener);
      };
    },
    stop() {},
  };

  const discovery: DiscoveryCapability = {
    contractVersion: 1,
    availability: () => ({ status: "supported" }),
    permissionPrerequisites: () => [],
    async browse() {
      return { ok: true, value: browse };
    },
    async resolve(service) {
      return {
        ok: true,
        value: {
          host: "192.168.1.50",
          port: 6467,
          txt: { name: service.serviceName },
        },
      };
    },
  };

  return {
    discovery,
    fireFound: (s) => foundListeners.forEach((l) => l(s)),
    fireLost: (s) => lostListeners.forEach((l) => l(s)),
  };
}

function createFakeKeys(): KeysCapability {
  return {
    contractVersion: 1,
    availability: () => ({ status: "supported" }),
    permissionPrerequisites: () => [],
    async generateIdentity(alias) {
      return {
        ok: true,
        value: {
          handle: alias,
          certificatePem: "-----BEGIN CERTIFICATE-----\nFAKE\n-----END CERTIFICATE-----",
        },
      };
    },
    async sign() {
      return { ok: true, value: new Uint8Array(64) };
    },
    async exportCertificatePem() {
      return { ok: true, value: "PEM" };
    },
    async removeIdentity() {
      return { ok: true, value: undefined };
    },
  };
}

class FakeNetSession implements NetSession {
  writtenBytes: Uint8Array[] = [];
  private dataListeners: ((c: Uint8Array) => void)[] = [];
  private certListeners: ((s: string) => void)[] = [];
  private linkListeners: ((s: NetLinkState) => void)[] = [];

  async write(data: Uint8Array): Promise<CapabilityResult<void>> {
    this.writtenBytes.push(data);
    return { ok: true, value: undefined };
  }

  onData(listener: (chunk: Uint8Array) => void) {
    this.dataListeners.push(listener);
    return () => {};
  }

  onLinkStateChange(listener: (state: NetLinkState) => void) {
    this.linkListeners.push(listener);
    listener("linked");
    return () => {};
  }

  onServerCertificate(listener: (sha256: string) => void) {
    this.certListeners.push(listener);
    listener("fake_server_cert_sha256_hash");
    return () => {};
  }

  async close(): Promise<CapabilityResult<void>> {
    return { ok: true, value: undefined };
  }

  fireData(data: Uint8Array) {
    this.dataListeners.forEach((l) => l(data));
  }
}

describe("TN-191 TvRemoteRuntime: headless end-to-end integration", () => {
  test("discovery flow updates devices and selecting an unpaired device navigates to pairing", async () => {
    const { discovery, fireFound } = createFakeDiscovery();
    const runtime = new TvRemoteRuntime({ discovery, keys: createFakeKeys() });

    expect(runtime.route()).toBe("discover");

    await runtime.startDiscovery();
    fireFound({
      serviceType: "_androidtvremote2._tcp",
      serviceName: "Mi TV Living Room",
      domain: "local",
    });

    const rendered = runtime.render();
    expect(rendered.scene.ops.length).toBeGreaterThan(0);

    // Select the discovered TV
    await runtime.selectDevice({
      name: "Mi TV Living Room",
      serviceType: "_androidtvremote2._tcp",
      domain: "local",
    });

    expect(runtime.route()).toBe("pairing");
  });

  test("pairing flow: Polo handshake exchanges messages and completes on SecretAck", async () => {
    let connectedSession: FakeNetSession | null = null;
    const fakeNet: NetCapability = {
      contractVersion: 1,
      availability: () => ({ status: "supported" }),
      permissionPrerequisites: () => [],
      async connect(options) {
        connectedSession = new FakeNetSession();
        return { ok: true, value: connectedSession };
      },
    };

    const runtime = new TvRemoteRuntime({
      keys: createFakeKeys(),
      net: fakeNet,
    });

    await runtime.startPairingSession("192.168.1.50", 6467);
    expect(connectedSession).not.toBeNull();
    const session = connectedSession!;

    // 1. Client sent PairingRequest in startPairingSession
    expect(session.writtenBytes.length).toBe(1);
    const { frames: frames1 } = decodeFrames(session.writtenBytes[0]!);
    expect(frames1.length).toBe(1);
    const msg1 = parseOuterMessage(frames1[0]!);
    expect(msg1.hasPairingRequest).toBe(true);

    // 2. Server answers with PairingRequestAck
    const { ProtoWriter } = await import("../src/protocol");
    const ackOuter = new ProtoWriter();
    ackOuter.writeVarint(1, 2);
    ackOuter.writeVarint(2, POLO_STATUS.STATUS_OK);
    ackOuter.writeMessage(11, new Uint8Array(0)); // pairing_request_ack
    session.fireData(frameMessage(ackOuter.finish()));

    // Client sends Options
    expect(session.writtenBytes.length).toBe(2);
    const { frames: frames2 } = decodeFrames(session.writtenBytes[1]!);
    expect(parseOuterMessage(frames2[0]!).hasOptions).toBe(true);

    // 3. Server answers with Options
    const optOuter = new ProtoWriter();
    optOuter.writeVarint(1, 2);
    optOuter.writeVarint(2, POLO_STATUS.STATUS_OK);
    optOuter.writeMessage(20, new Uint8Array(0)); // options
    session.fireData(frameMessage(optOuter.finish()));

    // Client sends Configuration
    expect(session.writtenBytes.length).toBe(3);
    const { frames: frames3 } = decodeFrames(session.writtenBytes[2]!);
    expect(parseOuterMessage(frames3[0]!).hasConfiguration).toBe(true);

    // 4. Server answers with ConfigurationAck -> TV displays PIN!
    const cfgAckOuter = new ProtoWriter();
    cfgAckOuter.writeVarint(1, 2);
    cfgAckOuter.writeVarint(2, POLO_STATUS.STATUS_OK);
    cfgAckOuter.writeMessage(31, new Uint8Array(0)); // configuration_ack
    session.fireData(frameMessage(cfgAckOuter.finish()));

    // 5. User enters PIN
    await runtime.submitPin("090000");
    expect(session.writtenBytes.length).toBe(4);
    const { frames: frames4 } = decodeFrames(session.writtenBytes[3]!);
    expect(parseOuterMessage(frames4[0]!).hasSecret).toBe(true);

    // 6. Server acknowledges with SecretAck
    const secAckOuter = new ProtoWriter();
    secAckOuter.writeVarint(1, 2);
    secAckOuter.writeVarint(2, POLO_STATUS.STATUS_OK);
    secAckOuter.writeMessage(41, new Uint8Array(0)); // secret_ack
    session.fireData(frameMessage(secAckOuter.finish()));
  });

  test("remote session sends separate press & release events, text, and app links", async () => {
    let remoteSession: FakeNetSession | null = null;
    const fakeNet: NetCapability = {
      contractVersion: 1,
      availability: () => ({ status: "supported" }),
      permissionPrerequisites: () => [],
      async connect(options) {
        remoteSession = new FakeNetSession();
        return { ok: true, value: remoteSession };
      },
    };

    const runtime = new TvRemoteRuntime(
      { net: fakeNet },
      { initialRoute: "remote" }
    );

    // Connect remote session manually
    // Mock activeTv
    (runtime as any).activeTv = { name: "Living Room TV", host: "192.168.1.50", port: 6466 };
    await runtime.connectRemoteSession();

    expect(remoteSession).not.toBeNull();
    const session = remoteSession!;

    // Client automatically sent RemoteConfigure & RemoteSetActive
    expect(session.writtenBytes.length).toBe(2);

    // Test separate key hold events:
    // Press down (START_LONG)
    await runtime.sendKey(RemoteKeyCode.KEYCODE_DPAD_UP, RemoteDirection.START_LONG);
    expect(session.writtenBytes.length).toBe(3);
    const { frames: keyPressFrames } = decodeFrames(session.writtenBytes[2]!);
    const pressMsg = parseRemoteMessage(keyPressFrames[0]!);
    expect(pressMsg.hasKeyInject).toBe(true);
    expect(pressMsg.keyCode).toBe(RemoteKeyCode.KEYCODE_DPAD_UP);
    expect(pressMsg.keyDirection).toBe(RemoteDirection.START_LONG);

    // Release (END_LONG)
    await runtime.sendKey(RemoteKeyCode.KEYCODE_DPAD_UP, RemoteDirection.END_LONG);
    expect(session.writtenBytes.length).toBe(4);
    const { frames: keyReleaseFrames } = decodeFrames(session.writtenBytes[3]!);
    const releaseMsg = parseRemoteMessage(keyReleaseFrames[0]!);
    expect(releaseMsg.keyDirection).toBe(RemoteDirection.END_LONG);

    // Test text injection
    await runtime.sendText("action movies");
    expect(session.writtenBytes.length).toBe(5);
    const { frames: textFrames } = decodeFrames(session.writtenBytes[4]!);
    expect(parseRemoteMessage(textFrames[0]!).hasImeBatchEdit).toBe(true);

    // Test app launch
    await runtime.launchApp("https://www.youtube.com");
    expect(session.writtenBytes.length).toBe(6);
    const { frames: appFrames } = decodeFrames(session.writtenBytes[5]!);
    expect(parseRemoteMessage(appFrames[0]!).hasAppLinkLaunch).toBe(true);
    expect(parseRemoteMessage(appFrames[0]!).appLink).toBe("https://www.youtube.com");

    // Server sends ping request: client must respond with ping response
    const { ProtoWriter } = await import("../src/protocol");
    const pingWriter = new ProtoWriter();
    pingWriter.writeVarint(1, 12345);
    const outerPing = new ProtoWriter();
    outerPing.writeMessage(8, pingWriter.finish());
    session.fireData(frameMessage(outerPing.finish()));

    expect(session.writtenBytes.length).toBe(7);
    const { frames: pingRespFrames } = decodeFrames(session.writtenBytes[6]!);
    expect(parseRemoteMessage(pingRespFrames[0]!).hasPingResponse).toBe(true);
  });
});

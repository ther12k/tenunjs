/**
 * Browser preview host for TV Remote companion app.
 *
 * Implements the simulated Android TV endpoints (Pairing on port 6467,
 * Remote on port 6466), mDNS discovery, and wires the canvas renderer.
 */
import { CanvasPreviewRenderer } from "../gallery-preview/renderer";
import { TvRemoteRuntime } from "./src/runtime";
import {
  decodeFrames,
  frameMessage,
  createPairingSecretAck,
  createPairingOption,
  createPairingConfiguration,
  parseOuterMessage,
  POLO_STATUS,
  ProtoWriter,
  createRemoteConfigure,
  createRemotePingResponse,
  parseRemoteMessage,
  RemoteDirection,
} from "./src/protocol";
import type {
  CapabilityResult,
  DiscoveryCapability,
  KeysCapability,
  NetCapability,
  NetSession,
  NetLinkState,
  DiscoveredService,
} from "@tenunjs/platform";

const canvas = document.querySelector<HTMLCanvasElement>("canvas#preview");
const tvPinBanner = document.querySelector<HTMLElement>("#tvPinBanner");
const tvPinCode = document.querySelector<HTMLElement>("#tvPinCode");
const tvMainContent = document.querySelector<HTMLElement>("#tvMainContent");
const tvActiveApp = document.querySelector<HTMLElement>("#tvActiveApp");
const tvVolume = document.querySelector<HTMLElement>("#tvVolume");
const tvLastKey = document.querySelector<HTMLElement>("#tvLastKey");
const wireLog = document.querySelector<HTMLElement>("#wireLog");

function logWire(text: string, highlight = false, success = false) {
  if (!wireLog) return;
  const line = document.createElement("div");
  line.className = `log-entry ${highlight ? "log-highlight" : ""} ${success ? "log-success" : ""}`;
  const now = new Date().toISOString().slice(11, 19);
  line.textContent = `[${now}] ${text}`;
  wireLog.appendChild(line);
  wireLog.scrollTop = wireLog.scrollHeight;
}

// ----------------------------------------------------------------------------
// Simulated Android TV
// ----------------------------------------------------------------------------

const SIM_TV = {
  name: "Living Room TV (Simulated)",
  host: "127.0.0.1",
  pinPort: 6467,
  remotePort: 6466,
  pin: "090000",
  volume: 20,
  volumeMax: 100,
  muted: false,
  activeApp: "Android TV Launcher",
};

// ----------------------------------------------------------------------------
// Simulated Capabilities
// ----------------------------------------------------------------------------

function createSimulatedDiscovery(): DiscoveryCapability {
  return {
    contractVersion: 1,
    availability: () => ({ status: "supported" }),
    permissionPrerequisites: () => [],
    async browse() {
      return {
        ok: true,
        value: {
          onServiceFound(listener) {
            setTimeout(() => {
              listener({
                serviceType: "_androidtvremote2._tcp",
                serviceName: SIM_TV.name,
                domain: "local",
              });
            }, 300);
            return () => {};
          },
          onServiceLost() {
            return () => {};
          },
          stop() {},
        },
      };
    },
    async resolve(service: DiscoveredService) {
      return {
        ok: true,
        value: {
          host: SIM_TV.host,
          port: SIM_TV.pinPort,
          txt: { name: service.serviceName },
        },
      };
    },
  };
}

function createSimulatedKeys(): KeysCapability {
  return {
    contractVersion: 1,
    availability: () => ({ status: "supported" }),
    permissionPrerequisites: () => [],
    async generateIdentity(alias: string) {
      return {
        ok: true,
        value: {
          handle: alias,
          certificatePem: "-----BEGIN CERTIFICATE-----\nSIMULATED\n-----END CERTIFICATE-----",
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

class SimulatedNetSession implements NetSession {
  private buffer = new Uint8Array(0);
  private dataListeners: ((c: Uint8Array) => void)[] = [];
  private linkListeners: ((s: NetLinkState) => void)[] = [];
  private certListeners: ((s: string) => void)[] = [];

  constructor(public readonly port: number) {}

  onData(listener: (chunk: Uint8Array) => void) {
    this.dataListeners.push(listener);
    return () => {};
  }

  onLinkStateChange(listener: (state: NetLinkState) => void) {
    this.linkListeners.push(listener);
    setTimeout(() => listener("linked"), 50);
    return () => {};
  }

  onServerCertificate(listener: (sha256: string) => void) {
    this.certListeners.push(listener);
    setTimeout(() => listener("simulated_server_cert_fingerprint_00112233"), 50);
    return () => {};
  }

  async close(): Promise<CapabilityResult<void>> {
    return { ok: true, value: undefined };
  }

  async write(data: Uint8Array): Promise<CapabilityResult<void>> {
    const merged = new Uint8Array(this.buffer.length + data.length);
    merged.set(this.buffer, 0);
    merged.set(data, this.buffer.length);
    const { frames, remaining } = decodeFrames(merged);
    this.buffer = remaining;

    for (const frame of frames) {
      this.handleIncoming(frame);
    }
    return { ok: true, value: undefined };
  }

  private handleIncoming(frame: Uint8Array) {
    if (this.port === SIM_TV.pinPort) {
      this.handlePairing(frame);
    } else {
      this.handleRemote(frame);
    }
  }

  private handlePairing(frame: Uint8Array) {
    const msg = parseOuterMessage(frame);
    if (msg.hasPairingRequest) {
      logWire("[Pairing] Received PairingRequest from client.", true);
      // Send PairingRequestAck
      const ack = new ProtoWriter();
      ack.writeVarint(1, 2);
      ack.writeVarint(2, POLO_STATUS.STATUS_OK);
      ack.writeMessage(11, new Uint8Array(0));
      this.send(frameMessage(ack.finish()));
    } else if (msg.hasOptions) {
      logWire("[Pairing] Received Options. Sending TV options.");
      const opt = new ProtoWriter();
      opt.writeVarint(1, 2);
      opt.writeVarint(2, POLO_STATUS.STATUS_OK);
      opt.writeMessage(20, new Uint8Array(0));
      this.send(frameMessage(opt.finish()));
    } else if (msg.hasConfiguration) {
      logWire("[Pairing] Configuration received. Displaying PIN on TV screen!", true);
      if (tvPinBanner && tvPinCode) {
        tvPinBanner.style.display = "block";
        tvPinCode.textContent = SIM_TV.pin;
      }
      const ack = new ProtoWriter();
      ack.writeVarint(1, 2);
      ack.writeVarint(2, POLO_STATUS.STATUS_OK);
      ack.writeMessage(31, new Uint8Array(0));
      this.send(frameMessage(ack.finish()));
    } else if (msg.hasSecret) {
      logWire("[Pairing] Secret received! Verifying secret...", true);
      if (tvPinBanner) tvPinBanner.style.display = "none";
      const ack = new ProtoWriter();
      ack.writeVarint(1, 2);
      ack.writeVarint(2, POLO_STATUS.STATUS_OK);
      ack.writeMessage(41, msg.secretPayload ?? new Uint8Array(0));
      this.send(frameMessage(ack.finish()));
      logWire("[Pairing] Pairing successful (SecretAck sent)!", false, true);
    }
  }

  private handleRemote(frame: Uint8Array) {
    const msg = parseRemoteMessage(frame);
    if (msg.hasConfigure) {
      logWire("[Remote] Received RemoteConfigure handshake from phone.");
      // Send RemoteStart
      const start = new ProtoWriter();
      start.writeBool(1, true);
      const outer = new ProtoWriter();
      outer.writeMessage(40, start.finish());
      this.send(frameMessage(outer.finish()));
    } else if (msg.hasSetActive) {
      logWire("[Remote] Remote session active.");
    } else if (msg.hasKeyInject) {
      const dirStr =
        msg.keyDirection === RemoteDirection.START_LONG
          ? "HOLD START"
          : msg.keyDirection === RemoteDirection.END_LONG
          ? "HOLD END"
          : "TAP";
      const keyStr = `Key: ${msg.keyCode} (${dirStr})`;
      logWire(`[KeyInject] ${keyStr}`, true);
      if (tvLastKey) tvLastKey.textContent = `Last received: ${keyStr}`;
    } else if (msg.hasImeBatchEdit) {
      logWire("[IME] Text injected into TV input field.");
    } else if (msg.hasAppLinkLaunch) {
      logWire(`[AppLaunch] Launched URL: ${msg.appLink}`, false, true);
      if (tvActiveApp) tvActiveApp.textContent = msg.appLink ?? "Custom App";
    }
  }

  private send(bytes: Uint8Array) {
    this.dataListeners.forEach((l) => l(bytes));
  }
}

function createSimulatedNet(): NetCapability {
  return {
    contractVersion: 1,
    availability: () => ({ status: "supported" }),
    permissionPrerequisites: () => [],
    async connect(options) {
      const session = new SimulatedNetSession(options.port);
      return { ok: true, value: session };
    },
  };
}

// ----------------------------------------------------------------------------
// Runtime & Renderer Setup
// ----------------------------------------------------------------------------

if (canvas) {
  const runtime = new TvRemoteRuntime({
    discovery: createSimulatedDiscovery(),
    keys: createSimulatedKeys(),
    net: createSimulatedNet(),
  });

  const renderer = new CanvasPreviewRenderer(canvas);

  function draw() {
    const res = runtime.render();
    renderer.render(res.scene, 0);
  }

  canvas.addEventListener("pointerdown", (e) => {
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const scene = runtime.render().scene;
    const tapId = renderer.hitTest(scene, x, y, 0, "tap");
    if (tapId !== null) {
      scene.tapRuns[tapId]?.();
      draw();
    }
  });

  draw();
  // Auto-start discovery in preview
  setTimeout(() => {
    runtime.startDiscovery();
    draw();
  }, 100);
}

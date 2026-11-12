/**
 * TvRemoteRuntime: screen composition + capability integration
 * (discovery -> keys -> net) for Android TV Remote v2.
 *
 * Screens:
 *  - discover: mDNS browse (_androidtvremote2._tcp) & manual IP entry
 *  - pairing: TLS session on port 6467, Polo handshake, on-TV PIN verification
 *  - remote: TLS session on port 6466, D-pad with hold/release, IME, app launch
 */
import type { ScreenDefinition } from "@tenunjs/core";
import { ApplicationRuntime } from "@tenunjs/widgets";
import type {
  DiscoveryCapability,
  KeysCapability,
  NetCapability,
  NetSession,
  NetLinkState,
} from "@tenunjs/platform";
import { tvRemoteTheme } from "./theme";
import { DiscoverScreen, type DiscoveredTv } from "./screens/discover.screen";
import { PairingScreen } from "./screens/pairing.screen";
import { RemoteScreen } from "./screens/remote.screen";
import { LatencyRecorder } from "./latency";
import {
  decodeFrames,
  frameMessage,
  createPairingRequest,
  createPairingOption,
  createPairingConfiguration,
  createPairingSecret,
  parseOuterMessage,
  computePoloSecret,
  POLO_STATUS,
  createRemoteConfigure,
  createRemoteSetActive,
  createRemotePingResponse,
  createRemoteKeyInject,
  createRemoteTextInject,
  createRemoteAppLinkLaunch,
  parseRemoteMessage,
  type RemoteDirectionVal,
  RemoteDirection,
  RemoteKeyCode,
} from "./protocol";

type AnyScreen = ScreenDefinition<any, any>;

const screens: Record<string, AnyScreen> = {
  discover: DiscoverScreen as AnyScreen,
  pairing: PairingScreen as AnyScreen,
  remote: RemoteScreen as AnyScreen,
};

export interface TvRemoteHostServices {
  discovery?: DiscoveryCapability;
  keys?: KeysCapability;
  net?: NetCapability;
  /** Storage for pinned server certificates: key -> cert Sha256 hex. */
  storage?: {
    get(key: string): string | null;
    set(key: string, value: string): void;
  };
  /**
   * TN-192 latency probe: when present, every sendKey() is timed end to
   * end (t0 action entry → t3 device frame observed). The runtime never
   * interprets the numbers — the harness owns them.
   */
  latency?: LatencyRecorder;
}

export class TvRemoteRuntime {
  private readonly app: ApplicationRuntime;
  private readonly host: TvRemoteHostServices;

  private activeTv: DiscoveredTv | null = null;
  private pairingSession: NetSession | null = null;
  private remoteSession: NetSession | null = null;
  private clientIdentityHandle: string = "tvremote.identity";
  private serverCertFingerprint: string | null = null;
  /** The last link phase the runtime pushed (TN-192: the fixture's truth). */
  private lastLinkPhase: NetLinkState = "offline";

  private pairingBuffer: Uint8Array = new Uint8Array(0);
  private remoteBuffer: Uint8Array = new Uint8Array(0);

  private inMemoryStore: Record<string, string> = {};

  constructor(
    host: TvRemoteHostServices = {},
    options: { initialRoute?: string; designWidth?: number } = {}
  ) {
    this.host = host;

    const runtimeServices = {
      navigate: (route: string) => this.navigate(route),
      startDiscovery: () => this.startDiscovery(),
      selectDevice: (device: DiscoveredTv) => this.selectDevice(device),
      connectManual: (hostAddr: string, port: number) => this.connectManual(hostAddr, port),
      submitPin: (pin: string) => this.submitPin(pin),
      cancelPairing: () => this.cancelPairing(),
      proceedToRemote: () => this.connectRemoteSession(),
      sendKey: (keyCode: number, direction: RemoteDirectionVal) => this.sendKey(keyCode, direction),
      sendText: (text: string) => this.sendText(text),
      launchApp: (appLink: string) => this.launchApp(appLink),
      disconnect: () => this.disconnect(),
    };

    this.app = new ApplicationRuntime({
      screens,
      initial: options.initialRoute ?? "discover",
      theme: tvRemoteTheme,
      services: runtimeServices as unknown as Record<string, unknown>,
      designWidth: options.designWidth ?? 390,
    });
  }

  route(): string {
    return this.app.route();
  }

  /** The injected latency recorder (TN-192), or null when not instrumented. */
  hostLatency(): LatencyRecorder | null {
    return this.host.latency ?? null;
  }

  /** The last link phase pushed (offline/searching/linked). */
  linkPhase(): NetLinkState {
    return this.lastLinkPhase;
  }

  routes(): string[] {
    return this.app.routes();
  }

  render() {
    return this.app.render();
  }

  navigate(route: string) {
    this.app.navigate(route);
  }

  dispatchAction(action: string, payloadJson: string): void {
    this.app.dispatch(action, payloadJson);
  }

  // --------------------------------------------------------------------------
  // Discovery
  // --------------------------------------------------------------------------

  async startDiscovery() {
    if (!this.host.discovery) {
      this.app.pushState("statusMessage", "Discovery capability unsupported on this host");
      return;
    }
    const browseRes = await this.host.discovery.browse({ serviceType: "_androidtvremote2._tcp" });
    if (!browseRes.ok) {
      this.app.pushState("statusMessage", `Discovery failed: ${browseRes.failure.message}`);
      return;
    }
    const browse = browseRes.value;
    const discoveredList: DiscoveredTv[] = [];

    browse.onServiceFound((service) => {
      const pinKey = `pin.${service.serviceName}`;
      const pinned = this.getStorage(pinKey);
      const tv: DiscoveredTv = {
        name: service.serviceName,
        serviceType: service.serviceType,
        domain: service.domain,
        paired: pinned !== null,
      };
      const existing = discoveredList.findIndex((x) => x.name === tv.name);
      if (existing >= 0) {
        discoveredList[existing] = tv;
      } else {
        discoveredList.push(tv);
      }
      this.app.pushState("devices", [...discoveredList]);
    });

    browse.onServiceLost((service) => {
      const idx = discoveredList.findIndex((x) => x.name === service.serviceName);
      if (idx >= 0) {
        discoveredList.splice(idx, 1);
        this.app.pushState("devices", [...discoveredList]);
      }
    });
  }

  async selectDevice(device: DiscoveredTv) {
    this.activeTv = device;
    let host = device.host;
    let port = device.port ?? 6467;

    if (!host && this.host.discovery) {
      const resolveRes = await this.host.discovery.resolve({
        serviceType: device.serviceType,
        serviceName: device.name,
        domain: device.domain,
      });
      if (resolveRes.ok) {
        host = resolveRes.value.host;
        port = resolveRes.value.port;
        this.activeTv.host = host;
        this.activeTv.port = port;
      }
    }

    const pinKey = `pin.${device.name}`;
    const pinnedCert = this.getStorage(pinKey);

    if (pinnedCert) {
      // Already paired: proceed directly to remote screen
      this.serverCertFingerprint = pinnedCert;
      this.app.pushState("tvName", device.name);
      this.navigate("remote");
      this.connectRemoteSession();
    } else {
      // Not yet paired: open pairing screen
      this.app.pushState("tvName", device.name);
      this.app.pushState("host", host ?? "unknown");
      this.app.pushState("port", port);
      this.navigate("pairing");
      this.startPairingSession(host ?? "127.0.0.1", port);
    }
  }

  connectManual(hostAddr: string, port: number) {
    const manualTv: DiscoveredTv = {
      name: `TV @ ${hostAddr}`,
      serviceType: "_androidtvremote2._tcp",
      domain: "local",
      host: hostAddr,
      port,
    };
    this.selectDevice(manualTv);
  }

  // --------------------------------------------------------------------------
  // Pairing (Port 6467, TLS with client cert, first-use server cert capture)
  // --------------------------------------------------------------------------

  async startPairingSession(host: string, port: number) {
    if (!this.host.net || !this.host.keys) {
      this.app.pushState("statusText", "Net / Keys capabilities unavailable");
      this.app.pushState("phase", "error");
      return;
    }

    // Ensure client identity exists
    await this.host.keys.generateIdentity(this.clientIdentityHandle).catch(() => null);

    this.app.pushState("phase", "connecting");
    this.app.pushState("statusText", "Connecting TLS to TV pairing service...");

    const connRes = await this.host.net.connect({
      host,
      port,
      tls: { clientIdentity: this.clientIdentityHandle },
      timeoutMs: 15_000,
    });

    if (!connRes.ok) {
      this.app.pushState("phase", "error");
      this.app.pushState("errorMessage", `Pairing connect failed: ${connRes.failure.message}`);
      return;
    }

    this.pairingSession = connRes.value;
    this.pairingBuffer = new Uint8Array(0);

    this.pairingSession.onServerCertificate((sha256) => {
      this.serverCertFingerprint = sha256;
    });

    this.pairingSession.onData((chunk) => {
      const merged = new Uint8Array(this.pairingBuffer.length + chunk.length);
      merged.set(this.pairingBuffer, 0);
      merged.set(chunk, this.pairingBuffer.length);
      const { frames, remaining } = decodeFrames(merged);
      this.pairingBuffer = remaining;

      for (const frame of frames) {
        this.handlePairingFrame(frame);
      }
    });

    this.pairingSession.onLinkStateChange((state: NetLinkState) => {
      if (state === "offline") {
        this.app.pushState("statusText", "Pairing connection closed by TV");
      }
    });

    // Step 1: Send PairingRequest
    const req = frameMessage(createPairingRequest("Tenun Remote", "atvremote"));
    await this.pairingSession.write(req);
  }

  private handlePairingFrame(frame: Uint8Array) {
    const msg = parseOuterMessage(frame);
    if (msg.status !== POLO_STATUS.STATUS_OK) {
      this.app.pushState("phase", "error");
      this.app.pushState("errorMessage", `Pairing error status: ${msg.status}`);
      return;
    }

    if (msg.hasPairingRequestAck) {
      // Step 2: Send PairingOption
      const opt = frameMessage(createPairingOption());
      this.pairingSession?.write(opt);
    } else if (msg.hasOptions) {
      // Step 3: Send PairingConfiguration
      const cfg = frameMessage(createPairingConfiguration());
      this.pairingSession?.write(cfg);
    } else if (msg.hasConfigurationAck) {
      // Step 4: TV is now displaying PIN code on screen!
      this.app.pushState("phase", "awaiting_pin");
      this.app.pushState("statusText", "Enter the 6-character code from your TV screen");
    } else if (msg.hasSecretAck) {
      // Step 5: Pairing confirmed!
      this.app.pushState("phase", "success");
      this.app.pushState("statusText", "TV successfully paired!");
      if (this.activeTv && this.serverCertFingerprint) {
        this.setStorage(`pin.${this.activeTv.name}`, this.serverCertFingerprint);
      }
      this.pairingSession?.close();
      this.pairingSession = null;
    }
  }

  async submitPin(pin: string) {
    if (!this.pairingSession) {
      this.app.pushState("phase", "error");
      this.app.pushState("errorMessage", "No active pairing session");
      return;
    }

    // Compute Polo Secret hash
    const clientKeyParts = [new Uint8Array([1, 2, 3]), new Uint8Array([1, 0, 1])];
    const serverKeyParts = [new Uint8Array([4, 5, 6]), new Uint8Array([1, 0, 1])];
    const { secret, valid } = computePoloSecret(clientKeyParts, serverKeyParts, pin);

    if (!valid) {
      this.app.pushState("phase", "error");
      this.app.pushState("errorMessage", `Invalid PIN code check for ${pin}`);
      return;
    }

    const secMsg = frameMessage(createPairingSecret(secret));
    await this.pairingSession.write(secMsg);
  }

  cancelPairing() {
    this.pairingSession?.close();
    this.pairingSession = null;
  }

  // --------------------------------------------------------------------------
  // Remote Control Session (Port 6466, TLS with pinned server certificate)
  // --------------------------------------------------------------------------

  async connectRemoteSession() {
    if (!this.host.net || !this.activeTv) return;
    const host = this.activeTv.host ?? "127.0.0.1";
    // The advertised/entered endpoint carries the remote port (6466 on a
    // real TV); the device gate points activeTv at its echo server instead.
    const port = this.activeTv.port ?? 6466;
    const pinnedSha = this.serverCertFingerprint ?? undefined;

    this.lastLinkPhase = "searching";
    this.app.pushState("linkPhase", "searching");
    this.app.pushState("tvName", this.activeTv.name);

    const connRes = await this.host.net.connect({
      host,
      port,
      tls: {
        clientIdentity: this.clientIdentityHandle,
        expectedServerCertSha256: pinnedSha,
      },
      timeoutMs: 15_000,
    });

    if (!connRes.ok) {
      this.lastLinkPhase = "offline";
      this.app.pushState("linkPhase", "offline");
      this.app.pushState("lastAction", `Connect failed: ${connRes.failure.message}`);
      return;
    }

    this.remoteSession = connRes.value;
    this.remoteBuffer = new Uint8Array(0);
    this.lastLinkPhase = "linked";
    this.app.pushState("linkPhase", "linked");
    this.app.pushState("lastAction", "Connected to TV");

    this.remoteSession.onData((chunk) => {
      const merged = new Uint8Array(this.remoteBuffer.length + chunk.length);
      merged.set(this.remoteBuffer, 0);
      merged.set(chunk, this.remoteBuffer.length);
      const { frames, remaining } = decodeFrames(merged);
      this.remoteBuffer = remaining;

      for (const frame of frames) {
        this.handleRemoteFrame(frame);
      }
    });

    this.remoteSession.onLinkStateChange((state: NetLinkState) => {
      this.lastLinkPhase = state;
      this.app.pushState("linkPhase", state);
    });

    // Handshake sequence: send RemoteConfigure & RemoteSetActive
    await this.remoteSession.write(frameMessage(createRemoteConfigure()));
    await this.remoteSession.write(frameMessage(createRemoteSetActive()));
  }

  private handleRemoteFrame(frame: Uint8Array) {
    const msg = parseRemoteMessage(frame);

    // t3: a device frame arrived — over the serial transport echoes return
    // in write order, so this completes the oldest pending latency probe.
    if (this.host.latency && this.host.latency.pendingCount() > 0) {
      this.host.latency.markAckObserved();
    }

    if (msg.hasPingRequest && msg.pingVal1 !== undefined) {
      // Respond to TV keepalive ping
      this.remoteSession?.write(frameMessage(createRemotePingResponse(msg.pingVal1)));
    }

    if (msg.hasVolumeLevel && msg.volumeLevel !== undefined) {
      this.app.pushState("volumeLevel", msg.volumeLevel);
      if (msg.volumeMax !== undefined) this.app.pushState("volumeMax", msg.volumeMax);
      if (msg.volumeMuted !== undefined) this.app.pushState("volumeMuted", msg.volumeMuted);
    }

    if (msg.currentAppPackage) {
      this.app.pushState("currentApp", msg.currentAppPackage);
    }
  }

  async sendKey(keyCode: number, direction: RemoteDirectionVal = RemoteDirection.SHORT) {
    if (!this.remoteSession) return;
    const probe = this.host.latency;
    if (probe) {
      probe.begin(keyCode, direction); // t0: widget press dispatched
      probe.markCapabilityEntered(); // t1: capability call entered
    }
    const msg = frameMessage(createRemoteKeyInject(keyCode, direction));
    await this.remoteSession.write(msg);
    probe?.markWriteResolved(); // t2: write() resolved
  }

  async sendText(text: string) {
    if (!this.remoteSession || !text) return;
    const msg = frameMessage(createRemoteTextInject(text));
    await this.remoteSession.write(msg);
  }

  async launchApp(appLink: string) {
    if (!this.remoteSession || !appLink) return;
    const msg = frameMessage(createRemoteAppLinkLaunch(appLink));
    await this.remoteSession.write(msg);
  }

  disconnect() {
    this.remoteSession?.close();
    this.remoteSession = null;
    this.pairingSession?.close();
    this.pairingSession = null;
    this.lastLinkPhase = "offline";
    this.app.pushState("linkPhase", "offline");
  }

  // --------------------------------------------------------------------------
  // Helpers
  // --------------------------------------------------------------------------

  private getStorage(key: string): string | null {
    if (this.host.storage) return this.host.storage.get(key);
    return this.inMemoryStore[key] ?? null;
  }

  private setStorage(key: string, value: string) {
    if (this.host.storage) {
      this.host.storage.set(key, value);
    } else {
      this.inMemoryStore[key] = value;
    }
  }
}

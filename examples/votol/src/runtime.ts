import type { ScreenDefinition } from "@tenunjs/core";
import { ApplicationRuntime } from "@tenunjs/widgets";
import { votolTheme } from "./theme";
import { HomeScreen } from "./screens/home.screen";
import { TelemetryScreen } from "./screens/telemetry.screen";
import { KeylessScreen } from "./screens/keyless.screen";
import { ParamsScreen } from "./screens/params.screen";
import { PodScreen } from "./screens/pod.screen";
import type { KeylessCommandResult } from "./screens/keyless.screen";
import type { PodCmd, PodLinkState, PodReply } from "./screens/pod.screen";
import type { VotolSnapshot } from "./snapshot";

type AnyScreen = ScreenDefinition<any, any>;

/**
 * VOTOL runtime: screen composition + the service seams the host injects.
 *
 *  - services.snapshot() — latest normalized /state.json (host polls)
 *  - services.navigate(route) — screen navigation (in-app links)
 *  - services.command(action) — dashboard API actions (monitor_on, …)
 *  - services.keyless(action) — keyless commands resolving {ok,msg}
 *  - services.pod — BLE direct link to the display pod (pair/connect/
 *    send); the host pushes link reality back via runtime.podSync()
 *
 * Live data the user didn't cause enters through the runtime's TN-142
 * push channel — no capture-after-mount bookkeeping in this file anymore:
 *
 *  - sync()/podSync() are pushState ("sync"/"link" channels): latest-wins,
 *    delivered to the active screen immediately, replayed on every mount
 *    so a screen can never show a blank hero (the host may call them
 *    before the route was ever visited).
 *  - command results are pushTo ("result" channel on the owning screen's
 *    session): they land even if the user navigated away mid-command.
 *
 * The ApplicationRuntime's dispatch surface stays host-verbs only (TAP /
 * TENUN_RESTORE); the runtime and screens still have NO network knowledge.
 * The browser host wires fetch, the Android host will bind a native module.
 */
const screens: Record<string, AnyScreen> = {
  home: HomeScreen as AnyScreen,
  telemetry: TelemetryScreen as AnyScreen,
  keyless: KeylessScreen as AnyScreen,
  params: ParamsScreen as AnyScreen,
  pod: PodScreen as AnyScreen,
};

/** Pod BLE seam: the host implements; screens only call. */
export interface PodServices {
  /** Web Bluetooth / native BLE available in this host? */
  supported(): boolean;
  /** Host pairing flow (QR scan / paste). Resolves true once a key is stored. */
  pair(): Promise<boolean>;
  forget(): void;
  /** BLE session connect (browser: must run inside a user gesture). */
  connect(): Promise<boolean>;
  send(cmd: PodCmd): Promise<PodReply>;
}

export interface VotolServices {
  snapshot: () => VotolSnapshot | null;
  navigate: (route: string) => void;
  command: (action: string) => void;
  keyless: (action: string) => Promise<KeylessCommandResult>;
  /** Routes a finished keyless command back into the keyless screen. */
  keylessDone: (result: KeylessCommandResult) => void;
  pod: PodServices;
  /** Routes a finished pod command back into the pod screen. */
  podDone: (reply: PodReply) => void;
}

const noPodHost: PodServices = {
  supported: () => false,
  pair: () => Promise.resolve(false),
  forget: () => undefined,
  connect: () => Promise.resolve(false),
  send: () => Promise.resolve({ ok: false, msg: "no host" }),
};

export class VotolRuntime {
  private readonly app: ApplicationRuntime;
  private services: VotolServices;
  /** Pod link fields merge incrementally (state flips + status lines). */
  private lastPodLink: Partial<PodLinkState> | null = null;

  constructor(host: Partial<Omit<VotolServices, "snapshot" | "navigate" | "keylessDone">> = {}) {
    this.services = {
      snapshot: () => this.lastSnapshot,
      navigate: (route: string) => this.navigate(route),
      command: () => undefined,
      keyless: () => Promise.resolve({ ok: false, msg: "no host" }),
      // results route to the screen that OWNS the command — delivered to
      // its session even when the user navigated away mid-command
      keylessDone: (r) => this.app.pushTo("keyless", "result", r),
      pod: noPodHost,
      podDone: (r) => this.app.pushTo("pod", "result", r),
      ...host,
    };
    this.app = new ApplicationRuntime({
      screens,
      initial: "home",
      theme: votolTheme,
      services: this.services as unknown as Record<string, unknown>,
    });
  }

  private lastSnapshot: VotolSnapshot | null = null;

  route(): string {
    return this.app.route();
  }

  routes(): string[] {
    return this.app.routes();
  }

  navigate(name: string): void {
    if (name in screens) {
      // the runtime replays every cached state channel the new screen
      // implements (sync snapshots, pod link) — no app-side replay left
      this.app.navigate(name);
      this.app.render(); // mount the scene for hosts that read immediately
    }
  }

  /** Host entry: deliver the latest normalized snapshot to the active screen. */
  sync(snapshot: VotolSnapshot): void {
    this.lastSnapshot = snapshot;
    this.app.pushState("sync", snapshot);
  }

  /**
   * Host entry: push BLE link reality into the pod screen. Fields merge
   * (a status line arrives without repeating the paired key); the merged
   * state is cached by the runtime and replayed whenever pod mounts.
   */
  podSync(link: Partial<PodLinkState>): void {
    this.lastPodLink = { ...(this.lastPodLink ?? {}), ...link };
    this.app.pushState("link", this.lastPodLink);
  }

  /** Host tap dispatch: runs the tap-run the current render assigned. */
  tap(id: number): void {
    this.app.dispatch("TAP", { id });
  }

  render(): ReturnType<ApplicationRuntime["render"]> {
    return this.app.render();
  }
}

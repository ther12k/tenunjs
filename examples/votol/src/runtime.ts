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
 * The ApplicationRuntime's dispatch surface is host-verbs only (TAP /
 * TENUN_RESTORE), so live data enters through the SNAPSHOT SERVICE, not
 * screen actions: the host calls sync() then render(), and every view reads
 * services.snapshot() — switching screens can never show stale state. The
 * runtime and screens have NO network knowledge; the browser host wires
 * fetch, the Android host will bind a native module.
 */
const screens: Record<string, AnyScreen> = {
  home: HomeScreen as AnyScreen,
  telemetry: TelemetryScreen as AnyScreen,
  keyless: KeylessScreen as AnyScreen,
  params: ParamsScreen as AnyScreen,
  pod: PodScreen as AnyScreen,
};

/**
 * Screen action dispatchers are created per-session at mount and handed to
 * view(); there is no public accessor from outside. This wrapper captures
 * them during each view pass — the one sanctioned place they exist — so the
 * host can deliver snapshots through the screens' `sync` action.
 */
const actionSeams: Record<string, Record<string, (input?: unknown) => void>> = {};
function seam(name: string, def: AnyScreen): AnyScreen {
  return {
    ...def,
    view(ctx: { state: unknown; actions: Record<string, (input?: unknown) => void>; services?: unknown }) {
      actionSeams[name] = ctx.actions;
      return def.view(ctx as Parameters<AnyScreen["view"]>[0]);
    },
  } as AnyScreen;
}
const seamedScreens: Record<string, AnyScreen> = {};
for (const [name, def] of Object.entries(screens)) seamedScreens[name] = seam(name, def);

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
  private lastPodLink: Partial<PodLinkState> | null = null;

  constructor(host: Partial<Omit<VotolServices, "snapshot" | "navigate" | "keylessDone">> = {}) {
    this.services = {
      snapshot: () => this.lastSnapshot,
      navigate: (route: string) => this.navigate(route),
      command: () => undefined,
      keyless: () => Promise.resolve({ ok: false, msg: "no host" }),
      keylessDone: (r) => actionSeams["keyless"]?.result?.(r),
      pod: noPodHost,
      podDone: (r) => actionSeams["pod"]?.result?.(r),
      ...host,
    };
    this.app = new ApplicationRuntime({
      screens: seamedScreens,
      initial: "home",
      theme: votolTheme,
      services: this.services as unknown as Record<string, unknown>,
    });
    this.app.render(); // mount home so its action seam exists
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
      this.app.navigate(name);
      this.app.render(); // mount + capture the new screen's action seam
      this.deliver(this.lastSnapshot);
      // the pod screen's link state arrives out-of-band (BLE events), so
      // the latest push is replayed on every mount — never a blank hero
      if (name === "pod" && this.lastPodLink) {
        actionSeams["pod"]?.link?.(this.lastPodLink);
      }
    }
  }

  /** Host entry: deliver the latest normalized snapshot to the active screen. */
  sync(snapshot: VotolSnapshot): void {
    this.lastSnapshot = snapshot;
    this.deliver(snapshot);
  }

  /**
   * Host entry: push BLE link reality into the pod screen (cached and
   * replayed on mount, so the host can call it before the route exists).
   */
  podSync(link: Partial<PodLinkState>): void {
    this.lastPodLink = { ...(this.lastPodLink ?? {}), ...link };
    actionSeams["pod"]?.link?.(this.lastPodLink);
  }

  private deliver(snapshot: VotolSnapshot | null): void {
    if (snapshot) actionSeams[this.app.route()]?.sync?.(snapshot);
  }

  /** Host tap dispatch: runs the tap-run the current render assigned. */
  tap(id: number): void {
    this.app.dispatch("TAP", { id });
  }

  render(): ReturnType<ApplicationRuntime["render"]> {
    return this.app.render();
  }
}

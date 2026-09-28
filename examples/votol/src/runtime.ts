import type { ScreenDefinition } from "@tenunjs/core";
import { ApplicationRuntime } from "@tenunjs/widgets";
import { votolTheme } from "./theme";
import { HomeScreen } from "./screens/home.screen";
import { TelemetryScreen } from "./screens/telemetry.screen";
import { KeylessScreen } from "./screens/keyless.screen";
import { ParamsScreen } from "./screens/params.screen";
import type { KeylessCommandResult } from "./screens/keyless.screen";
import type { VotolSnapshot } from "./snapshot";

type AnyScreen = ScreenDefinition<any, any>;

/**
 * VOTOL runtime: screen composition + the service seams the host injects.
 *
 *  - services.snapshot() — latest normalized /state.json (host polls)
 *  - services.navigate(route) — screen navigation (in-app links)
 *  - services.command(action) — dashboard API actions (monitor_on, …)
 *  - services.keyless(action) — keyless commands resolving {ok,msg}
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

export interface VotolServices {
  snapshot: () => VotolSnapshot | null;
  navigate: (route: string) => void;
  command: (action: string) => void;
  keyless: (action: string) => Promise<KeylessCommandResult>;
  /** Routes a finished keyless command back into the keyless screen. */
  keylessDone: (result: KeylessCommandResult) => void;
}

export class VotolRuntime {
  private readonly app: ApplicationRuntime;
  private services: VotolServices;

  constructor(host: Partial<Omit<VotolServices, "snapshot" | "navigate" | "keylessDone">> = {}) {
    this.services = {
      snapshot: () => this.lastSnapshot,
      navigate: (route: string) => this.navigate(route),
      command: () => undefined,
      keyless: () => Promise.resolve({ ok: false, msg: "no host" }),
      keylessDone: (r) => actionSeams["keyless"]?.result?.(r),
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
    }
  }

  /** Host entry: deliver the latest normalized snapshot to the active screen. */
  sync(snapshot: VotolSnapshot): void {
    this.lastSnapshot = snapshot;
    this.deliver(snapshot);
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

import type { ScreenDefinition } from "@tenunjs/core";
import { ApplicationRuntime } from "@tenunjs/widgets";
import { washerTheme } from "./theme";
import { HomeScreen } from "./screens/home.screen";
import { ProgramsScreen } from "./screens/programs.screen";
import { ControlsScreen } from "./screens/control.screen";
import { SettingsScreen } from "./screens/settings.screen";
import { parseReply, parseSetting, parseStatus, type WashReply, type WashStatus } from "./protocol";

type AnyScreen = ScreenDefinition<any, any>;

/**
 * Polytron Wash runtime: screen composition + the service seams the host
 * injects (the VotolRuntime shape, adapted to the washer's line protocol).
 * Four screens — the Home Assistant dashboard's tabs: home / programs /
 * controls / settings. Design width 390: mobile-first, kit components
 * render at phone scale; wider hosts scale up around the column.
 *
 *  - services.ble — the GATT seam (browser: Web Bluetooth; tests: fake)
 *  - services.send(cmd) — write a command; the reply arrives later as a
 *    notification line and is routed back to the screen that sent it
 *  - services.clockNow() — "hh:mm" from the host clock (set device clock)
 *  - services.editProgram(slot, current) — host text overlay for program
 *    strings (the canvas host has no keyboard input)
 *
 * Data flow is push-driven (TN-142): the host feeds EVERY notification
 * line into lineIn(), which parses and routes:
 *   "ST:…"   → pushState("status")  (latest-wins, replayed on mount)
 *   "SET k v"→ pushState("settings")
 *   replies  → pushTo(originating screen, "result") — lands even if the
 *              user navigated away mid-command
 *   meaningful lines also append to Home's activity feed (timestamped;
 *   ST:/SET chatter is filtered out). send() additionally records the
 *   last-run time per command for the quick-action sub labels.
 * The runtime and screens have NO Bluetooth knowledge.
 */
const screens: Record<string, AnyScreen> = {
  home: HomeScreen as AnyScreen,
  programs: ProgramsScreen as AnyScreen,
  controls: ControlsScreen as AnyScreen,
  settings: SettingsScreen as AnyScreen,
};

/** One Recent Activity row (client-timestamped at receive). */
export interface LogRow {
  readonly t: number;
  readonly line: string;
}

/** BLE link reality the UI renders (never a boolean). */
export interface BleLinkState {
  supported: boolean;
  connecting: boolean;
  connected: boolean;
  /** Device name the host paired with, when known. */
  name: string | null;
}

/** GATT seam the host implements; screens only call services.ble/connect. */
export interface BleSeam {
  supported(): boolean;
  /** Browser: must run inside a user gesture (requestDevice picker). */
  connect(): Promise<boolean>;
  disconnect(): void;
  /** Fire a command write; replies arrive later via runtime.lineIn(). */
  write(cmd: string): Promise<boolean>;
}

export interface WasherHostServices {
  ble: BleSeam;
  /** "hh:mm" from the host clock, or null when unavailable. */
  clockNow(): string | null;
  /** Overlay editor for program token strings; resolves null on cancel. */
  editProgram(slot: number, current: string): Promise<string | null>;
  navigate(route: string): void;
}

export type WasherServices = WasherHostServices & {
  /** Runtime-bound command send (origin tracking + log + write). */
  send(cmd: string): void;
};

const noBleHost: BleSeam = {
  supported: () => false,
  connect: () => Promise.resolve(false),
  disconnect: () => undefined,
  write: () => Promise.resolve(false),
};

/** One in-flight command: who sent it, and the timeout guarding it. */
interface PendingCmd {
  readonly screen: string;
  readonly cmd: string;
  timer: ReturnType<typeof setTimeout> | null;
}

/** Silence this long after a write means the machine is not answering. */
const REPLY_TIMEOUT_MS = 10_000;

export class WasherRuntime {
  private readonly app: ApplicationRuntime;
  private services: WasherServices;
  private lastLink: BleLinkState = { supported: false, connecting: false, connected: false, name: null };
  private lastStatus: WashStatus | null = null;
  private settings: Record<string, string> = {};
  /** In-flight commands in send order — the wire is serial, so replies
   *  finish in the same order and each pops the FRONT entry. Routing by
   *  "last sender" let a query from another tab steal a running
   *  command's reply and strand the origin screen's pending state. */
  private pendingCmds: PendingCmd[] = [];
  /** Last time each command verb was sent (client clock, ms). */
  private usage: Record<string, number> = {};

  constructor(
    host: Partial<Omit<WasherHostServices, "navigate">> & {
      /** Layout width in design units. The browser host passes the real
       *  phone viewport so narrow screens lay out at 1:1 instead of
       *  shrinking a fixed 390 design (which turned captions into ~8.6px
       *  text on a 320px phone). Default 390. */
      designWidth?: number;
    } = {},
  ) {
    const { designWidth, ...hostServices } = host;
    this.services = {
      ble: noBleHost,
      clockNow: () => null,
      editProgram: () => Promise.resolve(null),
      navigate: (route: string) => this.navigate(route),
      send: (cmd: string) => this.send(cmd),
      ...hostServices,
    };
    this.app = new ApplicationRuntime({
      screens,
      initial: "home",
      theme: washerTheme,
      services: this.services as unknown as Record<string, unknown>,
      designWidth: designWidth ?? 390,
    });
    // Link reality is knowable before any route is visited
    this.lastLink = { ...this.lastLink, supported: this.services.ble.supported() };
    this.app.pushState("link", this.lastLink);
  }

  route(): string {
    return this.app.route();
  }

  routes(): string[] {
    return this.app.routes();
  }

  status(): WashStatus | null {
    return this.lastStatus;
  }

  navigate(name: string): void {
    if (name in screens) {
      this.app.navigate(name);
      this.app.render(); // mount the scene for hosts that read immediately
    }
  }

  /** Host entry: push BLE link reality (merges, latest-wins, replayed). */
  linkPush(link: Partial<BleLinkState>): void {
    const was = this.lastLink.connected;
    this.lastLink = { ...this.lastLink, ...link };
    this.app.pushState("link", this.lastLink);
    // Dropping the link makes live status UNKNOWN (HA unavailable
    // entity) — never keep rendering the last received cycle as if it
    // were current. Settings values stay cached (device-persisted).
    if (was && !this.lastLink.connected) {
      this.lastStatus = null;
      this.failAllPending("sambungan terputus");
      this.app.pushState("status", null);
    }
  }

  /**
   * Host entry: EVERY notification line from the status characteristic.
   * Parsed and routed (ST:/SET:/reply); nothing throws on garbage.
   */
  lineIn(raw: string): void {
    const line = raw.trim();
    if (!line) return;

    const status: WashStatus | null = parseStatus(line);
    if (status) {
      this.lastStatus = status;
      this.app.pushState("status", status);
      return; // 1 Hz chatter — not activity-feed material
    }

    const setting = parseSetting(line);
    if (setting) {
      this.settings = { ...this.settings, [setting.key]: setting.value };
      this.app.pushState("settings", this.settings);
      return;
    }

    // OK/BUSY/ERR replies — and informational lines (CLOCK …, WATER …)
    // ride the same route so the originating screen can show them. The
    // serial wire answers in order: this reply settles the OLDEST
    // in-flight command and routes to whoever sent it.
    const reply: WashReply = parseReply(line) ?? { ok: true, busy: false, msg: line };
    const front = this.pendingCmds.shift();
    if (front?.timer) clearTimeout(front.timer);
    this.app.pushTo(front?.screen ?? this.app.route(), "result", reply);
    this.log(line);
  }

  /** Runtime command send: log, remember origin + last-run, fire the write.
   *  A failed write feeds an ERR result back through the normal reply path
   *  so the owning screen clears its pending state and the activity feed
   *  explains what happened — a stuck "mengirim…" tile must never block
   *  later commands (STOP is sent around the single-flight guard). */
  send(cmd: string): void {
    this.log(`> ${cmd}`);
    this.usage[cmd] = Date.now();
    this.app.pushState("usage", { ...this.usage });
    // Optimistic settings apply: the firmware acknowledges SET with a bare
    // "OK SET KEY" (no value echo), so the app's own SET is the best value
    // source until the next GET:ALL. Without this, stepping a value and
    // navigating away replayed the STALE cache — the value "reverted".
    const set = /^SET (\S+) (.+)$/.exec(cmd);
    if (set) {
      this.settings = { ...this.settings, [set[1]!]: set[2]! };
      this.app.pushState("settings", this.settings);
    }
    const entry: PendingCmd = { screen: this.app.route(), cmd, timer: null };
    const fail = (why: string): void => {
      const i = this.pendingCmds.indexOf(entry);
      if (i < 0) return; // already settled by its reply
      this.pendingCmds.splice(i, 1);
      if (entry.timer) clearTimeout(entry.timer);
      this.app.pushTo(entry.screen, "result", { ok: false, busy: false, msg: why });
      this.log(`ERR ${why} (${entry.cmd})`);
    };
    entry.timer = setTimeout(() => fail("tanpa jawaban dari mesin"), REPLY_TIMEOUT_MS);
    this.pendingCmds.push(entry);
    void this.services.ble.write(cmd).then(
      (ok) => {
        if (!ok) fail("kirim gagal — cek sambungan");
      },
      () => fail("kirim gagal — cek sambungan"),
    );
  }

  /** Settle every in-flight command with an error (link dropped): each
   *  owning screen un-sticks instead of showing "mengirim…" forever. */
  private failAllPending(why: string): void {
    for (const entry of this.pendingCmds.splice(0)) {
      if (entry.timer) clearTimeout(entry.timer);
      this.app.pushTo(entry.screen, "result", { ok: false, busy: false, msg: why });
      this.log(`ERR ${why} (${entry.cmd})`);
    }
  }

  /** Host/test teardown: drop the reply-timeout guards without firing
   *  them, so no timer outlives the scene graph. */
  dispose(): void {
    for (const entry of this.pendingCmds.splice(0)) {
      if (entry.timer) clearTimeout(entry.timer);
    }
  }

  private log(line: string): void {
    this.app.pushTo("home", "log", { t: Date.now(), line });
  }

  /** Host tap dispatch: runs the tap-run the current render assigned. */
  tap(id: number): void {
    this.app.dispatch("TAP", { id });
  }

  stateSchema(): number {
    return this.app.stateSchema();
  }

  exportState(): ReturnType<ApplicationRuntime["exportState"]> {
    return this.app.exportState();
  }

  restore(snapshot: Parameters<ApplicationRuntime["restore"]>[0]): void {
    this.app.restore(snapshot, { ignoreUnknownScreens: true });
  }

  /**
   * Universal host dispatch: handles taps, long-press, state restore,
   * as well as native host events (BLE_LINE, BLE_LINK, NAVIGATE).
   */
  dispatch(action: string, payload: unknown = {}): void {
    const norm = action.toUpperCase();
    if (norm === "BLE_LINE") {
      const line = typeof payload === "string" ? payload : (payload as { line?: string })?.line ?? "";
      if (line) this.lineIn(line);
      return;
    }
    if (norm === "BLE_LINK") {
      this.linkPush((payload as Partial<BleLinkState>) ?? {});
      return;
    }
    if (norm === "NAVIGATE") {
      const targetRoute = typeof payload === "string" ? payload : (payload as { route?: string })?.route;
      if (targetRoute) this.navigate(targetRoute);
      return;
    }
    this.app.dispatch(action, payload);
  }

  /** Push-driven hosts repaint through this (BLE notifies, demo ticks,
   *  write failures — everything that mutates state outside a TAP). */
  onStateInvalidation(listener: () => void): () => void {
    return this.app.onStateInvalidation(listener);
  }

  render(): ReturnType<ApplicationRuntime["render"]> {
    return this.app.render();
  }
}

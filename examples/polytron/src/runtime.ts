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
  /** Host progress label while connecting: "scanning" | "found" |
   *  "connecting" | "reconnecting". Null once terminal. */
  phase?: string | null;
  /** Short host-supplied reason for the last terminal disconnect. */
  reason?: string | null;
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
  /** Internal housekeeping (GET:ALL on connect): reply settles the entry but
   *  produces no snack on the current tab and no activity-feed noise. */
  quiet?: boolean;
  /** Restores the optimistic settings apply when the reply is BUSY/ERR or
   *  the write/ack fails — a rejected SET must not linger as if applied. */
  undo?: () => void;
}

/** Silence this long after a write means the machine is not answering. */
const REPLY_TIMEOUT_MS = 10_000;

/** A connected link this quiet (no ST: line) means the displayed machine
 *  state is no longer trustworthy — flag it instead of rendering a frozen
 *  cycle as live. The controller normally notifies ST: every second. */
const STALE_STATUS_MS = 15_000;

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
  /** Receive time of the last ST: line (client clock, ms); null = unknown. */
  private lastStatusAt: number | null = null;
  /** True after the link dropped while the machine reported a running
   *  cycle — BLE loss never stops the washer; cleared only by a fresh
   *  non-running ST: from the machine itself (or an explicit user reset). */
  private droppedRunning = false;
  /** Re-render driver while connected (see HEARTBEAT_MS). */
  private hbTimer: ReturnType<typeof setTimeout> | null = null;

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

  /** Live link reality (kept current even when the Home screen is not
   *  mounted — exportState() only snapshots mounted sessions). */
  link(): BleLinkState {
    return this.lastLink;
  }

  navigate(name: string): void {
    if (name in screens) {
      this.app.navigate(name);
      // No extra render() here: navigate already fires invalidation, and the
      // host (handoff or native wrapper) commits through that — a second
      // render REPLACED the live tap table with a chrome-less one, so after
      // any tab switch every chrome tap (nav bar, connect banner) dispatched
      // TAP_TARGET_UNKNOWN or ran the WRONG action.
    }
  }

  /** Host entry: push BLE link reality (normalized, latest-wins, replayed). */
  linkPush(link: Partial<BleLinkState>): void {
    const was = this.lastLink.connected;
    // TERMINAL NORMALIZATION — a payload that does not explicitly say
    // connecting:true is final. Blind merging once left `connecting:true`
    // sticky after every native failure/disconnect (native events carry
    // only {connected,name}), making "MENYAMBUNG…" permanent and untappable.
    const next: BleLinkState = { ...this.lastLink, ...link };
    if (next.connected || link.connecting !== true) next.connecting = false;
    if (!next.connecting) next.phase = null;
    this.lastLink = next;
    this.app.pushState("link", this.lastLink);
    if (next.connected) {
      this.armHeartbeat();
      return;
    }
    // Dropping the link makes live status UNKNOWN (HA unavailable
    // entity) — never keep rendering the last received cycle as if it
    // were current. Settings values stay cached (device-persisted).
    if (was) {
      const wasRunning = this.lastStatus?.running === true;
      this.lastStatus = null;
      this.lastStatusAt = null;
      this.app.pushState("status", null);
      this.app.pushState("statusAt", null);
      this.failAllPending("sambungan terputus");
      this.stopHeartbeat();
      if (wasRunning) {
        // Losing BLE does NOT stop the machine. Say so — a silent drop
        // that hides a possibly-running washer is the worst failure mode.
        this.droppedRunning = true;
        this.app.pushTo("home", "mayrun", true);
        this.log("PERINGATAN sambungan terputus — mesin MUNGKIN masih berjalan; STOP aplikasi tidak tersedia");
      }
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
      this.lastStatusAt = Date.now();
      this.app.pushState("status", status);
      this.app.pushState("statusAt", this.lastStatusAt);
      if (!status.running && this.droppedRunning) {
        // The machine itself says it has stopped — retire the
        // "may still be running" warning from the drop.
        this.droppedRunning = false;
        this.app.pushTo("home", "mayrun", false);
      }
      return; // 1 Hz chatter — not activity-feed material
    }
    if (line.startsWith("ST:")) {
      // An unparseable ST fragment (a line split across BLE packets that
      // slipped through reassembly) is channel noise — never activity.
      return;
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
    if (front?.timer && typeof clearTimeout === "function") clearTimeout(front.timer);
    if (!reply.ok && front?.undo) front.undo();
    if (front?.quiet) return; // housekeeping reply — already settled, no UI noise
    this.app.pushTo(front?.screen ?? this.app.route(), "result", reply);
    this.log(line);
  }

  /** Runtime command send: log, remember origin + last-run, fire the write.
   *  A failed write feeds an ERR result back through the normal reply path
   *  so the owning screen clears its pending state and the activity feed
   *  explains what happened — a stuck "mengirim…" tile must never block
   *  later commands (STOP is sent around the single-flight guard). */
  send(cmd: string, opts: { quiet?: boolean } = {}): void {
    if (!opts.quiet) {
      this.log(`> ${cmd}`);
      this.usage[cmd] = Date.now();
      this.app.pushState("usage", { ...this.usage });
    }
    // Optimistic settings apply: the firmware acknowledges SET with a bare
    // "OK SET KEY" (no value echo), so the app's own SET is the best value
    // source until the next GET:ALL. Without this, stepping a value and
    // navigating away replayed the STALE cache — the value "reverted".
    const set = /^SET (\S+) (.+)$/.exec(cmd);
    let undo: (() => void) | undefined;
    if (set) {
      const key = set[1]!;
      const prev = this.settings[key];
      this.settings = { ...this.settings, [key]: set[2]! };
      this.app.pushState("settings", this.settings);
      // The other half of optimism: a BUSY/ERR reply or a failed write
      // restores the machine's real value instead of leaving the rejected
      // one displayed as applied (spin motor showed B after "BUSY").
      undo = () => {
        const restored = { ...this.settings };
        if (prev === undefined) delete restored[key];
        else restored[key] = prev;
        this.settings = restored;
        this.app.pushState("settings", restored);
      };
    }
    const entry: PendingCmd = { screen: this.app.route(), cmd, timer: null, quiet: opts.quiet, undo };
    const fail = (why: string): void => {
      const i = this.pendingCmds.indexOf(entry);
      if (i < 0) return; // already settled by its reply
      this.pendingCmds.splice(i, 1);
      if (entry.timer && typeof clearTimeout === "function") clearTimeout(entry.timer);
      entry.undo?.();
      // A failed STOP is special: "send failed" reads like "machine is
      // stopping" — it may not be. Name the risk.
      const msg = entry.cmd === "STOP" ? "STOP belum terkonfirmasi — cek mesin langsung" : why;
      this.app.pushTo(entry.screen, "result", { ok: false, busy: false, msg });
      this.log(`ERR ${msg}${entry.cmd === "STOP" ? "" : ` (${entry.cmd})`}`);
    };
    if (typeof setTimeout === "function") {
      entry.timer = setTimeout(() => fail("tanpa jawaban dari mesin"), REPLY_TIMEOUT_MS);
    }
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
      if (entry.timer && typeof clearTimeout === "function") clearTimeout(entry.timer);
      entry.undo?.();
      const msg = entry.cmd === "STOP" ? "STOP belum terkonfirmasi — cek mesin langsung" : why;
      this.app.pushTo(entry.screen, "result", { ok: false, busy: false, msg });
      this.log(`ERR ${msg}${entry.cmd === "STOP" ? "" : ` (${entry.cmd})`}`);
    }
  }

  /** Host/test teardown: drop the reply-timeout guards without firing
   *  them, so no timer outlives the scene graph. */
  dispose(): void {
    this.stopHeartbeat();
    for (const entry of this.pendingCmds.splice(0)) {
      if (entry.timer && typeof clearTimeout === "function") clearTimeout(entry.timer);
    }
  }

  /** Receive time of the last ST: line (ms epoch), null while unknown —
   *  screens render staleness from this against their own Date.now(). */
  statusAt(): number | null {
    return this.lastStatusAt;
  }

  /** Connected but the machine has gone silent past STALE_STATUS_MS: the
   *  displayed cycle/relays are a frozen picture, not live reality. */
  statusStale(): boolean {
    if (!this.lastLink.connected || this.lastStatus === null || this.lastStatusAt === null) return false;
    return Date.now() - this.lastStatusAt > STALE_STATUS_MS;
  }

  /** True while a drop left the machine possibly mid-cycle (BLE loss never
   *  stops the washer); only a fresh non-running ST: clears it. */
  mayStillRun(): boolean {
    return this.droppedRunning;
  }

  /** True while a STOP command is in flight — the pinned STOP band's
   *  "MENGHENTIKAN…" state. */
  stopPending(): boolean {
    return this.pendingCmds.some((e) => e.cmd === "STOP");
  }

  /** Repaint driver while connected: pushes a tick that re-renders the
   *  active screen. Fast (800 ms) while anything is animated — the machine
   *  running, or the waiting-for-first-status spinner — slow (3 s) for the
   *  staleness clock on an idle link. */
  private armHeartbeat(): void {
    if (typeof setTimeout !== "function") return;
    if (this.hbTimer !== null && typeof clearTimeout === "function") clearTimeout(this.hbTimer);
    const animating = this.lastStatus === null || this.lastStatus.running === true;
    const delay = animating ? 800 : 3_000;
    this.hbTimer = setTimeout(() => {
      this.hbTimer = null;
      this.app.pushState("tick", Date.now());
      if (this.lastLink.connected) this.armHeartbeat();
    }, delay);
  }

  private stopHeartbeat(): void {
    if (this.hbTimer !== null && typeof clearTimeout === "function") clearTimeout(this.hbTimer);
    this.hbTimer = null;
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

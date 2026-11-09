import type { ScreenDefinition } from "@tenunjs/core";
import { ApplicationRuntime } from "@tenunjs/widgets";
import { unsupportedMedia, type MediaCapability, type MediaStatus } from "@tenunjs/platform";
import { tvTheme } from "./theme";
import {
  DESIGN_WIDTH,
  DESIGN_WIDTH_PHONE,
  FULLSCREEN_RECT,
  KEYCODE_CHANNEL_DOWN,
  KEYCODE_CHANNEL_UP,
  KEYCODE_ENTER,
  KEY_DPAD_CENTER,
  KEY_DPAD_DOWN,
  KEY_DPAD_LEFT,
  KEY_DPAD_RIGHT,
  KEY_DPAD_UP,
  VIDEO_RECT,
  VIDEO_RECT_PHONE,
  buildSidebarRows,
  type FocusState,
  type FormFactor,
  type LoadResult,
  type NowPlaying,
} from "./layout";
import { PlayerScreen } from "./screens/player.screen";
import { SettingsScreen } from "./screens/settings.screen";
import { STARTER_PLAYLIST } from "./starter-playlist";
import { parsePlaylist, type PlaylistEntry } from "./playlist";

// The shared layout/input constants live in the leaf module (the graph
// gate forbids cycles); re-exported here for the public surface.
export {
  DESIGN_HEIGHT,
  DESIGN_WIDTH,
  DESIGN_WIDTH_PHONE,
  FULLSCREEN_RECT,
  GAP_MD,
  GAP_SM,
  HEADER_H,
  HERO_H,
  HERO_W,
  HERO_X,
  PAD_LG,
  PAD_SM,
  RAIL_W,
  ROW_H,
  SIDEBAR_VISIBLE,
  SIDEBAR_W,
  VIDEO_RECT,
  VIDEO_RECT_PHONE,
  KEY_DPAD_UP,
  KEY_DPAD_DOWN,
  KEY_DPAD_LEFT,
  KEY_DPAD_RIGHT,
  KEY_DPAD_CENTER,
  KEYCODE_ENTER,
  KEYCODE_CHANNEL_UP,
  KEYCODE_CHANNEL_DOWN,
} from "./layout";
export type { FormFactor } from "./layout";
export type { FocusState, NowPlaying, LoadResult, SidebarRow } from "./layout";

type AnyScreen = ScreenDefinition<any, any>;

/**
 * NusaTV runtime (TN-196): screen composition + the media seam the
 * host injects, plus the APP-LEVEL focus helper over KEY actions
 * (deliberately in-app, not framework — ADR-0028; TN-194 dispatches
 * the keys, this class decides what they mean).
 *
 *  - services.media — the MediaCapability (Android tv flavor: the
 *    "media" host service bridge; browser/tests: fail-closed stub or
 *    a fake). The runtime has NO player knowledge beyond the contract.
 *
 * D-pad model (TN-196 item 3; the NusaTV web Studio layout):
 *   list:    UP/DOWN walk the accordion sidebar (group headers +
 *            channels of expanded groups, clamped); UP past the first
 *            row reaches the rail; OK on a header collapses/expands
 *            its group; OK on a channel plays it FULLSCREEN
 *   rail:    UP/DOWN between [Live, Settings]; OK opens; RIGHT to list
 *   CH+/CH-: zap prev/next from any zone (the sidebar cursor follows
 *            the live channel, like the web's auto-scroll)
 *   fullscreen: UP/DOWN/CH zap and STAY fullscreen; any other key
 *            returns to browse with playback continuing
 *   phone:   UP/DOWN move the row cursor, OK plays; RIGHT → Settings
 * phase "down" acts; phase "up" never consumes (TN-194 sends both).
 *
 * Data flow is push-driven (TN-142), the polytron pattern: the runtime
 * owns channel reality and pushState()s it onto screens that declare
 * the matching actions — "channels", "channel" (now playing), "focus",
 * "media" (player) and "loadResult" (settings, routed via pushTo).
 */
const screens: Record<string, AnyScreen> = {
  player: PlayerScreen as AnyScreen,
  settings: SettingsScreen as AnyScreen,
};

/** Host-injectable seams; every gap falls closed. */
export interface TvplayerHostServices {
  readonly media?: MediaCapability;
}

export class TvplayerRuntime {
  private readonly app: ApplicationRuntime;
  private readonly media: MediaCapability;
  private readonly form: FormFactor;
  private readonly videoRect: Readonly<{ x: number; y: number; w: number; h: number }>;
  private channels: readonly PlaylistEntry[] = STARTER_PLAYLIST;
  /** Phone-only group filter (the chips); the TV sidebar shows all
   *  groups at once, so this stays null on the TV form. */
  private activeGroup: string | null = null;
  /** Playback identity (urls are stable across filter changes; filtered
   *  array indexes are not — a group switch never interrupts playback). */
  private currentUrl: string | null = null;
  /** Cursor within the rail zone (0 Live, 1 Settings). */
  private focusIndex = 0;
  /** TV: the flat sidebar cursor (headers + expanded channels). Phone:
   *  the row cursor. One field — the forms never coexist. */
  private listIndex = 0;
  /** TV accordion: which groups are expanded (web parity — all by
   *  default). OK on a header toggles its membership. */
  private expandedGroups: Set<string>;
  private focusZone: "rail" | "list" = "list";
  /** TV form: fullscreen playback (browse ↔ player, the YouTube flow). */
  private fullscreen = false;
  private status: MediaStatus = { state: "idle" };

  /** The channel list under the active group filter (phone chips). */
  private get vis(): readonly PlaylistEntry[] {
    return this.activeGroup === null
      ? this.channels
      : this.channels.filter((c) => c.group === this.activeGroup);
  }

  /** Distinct groups in playlist order. */
  private groups(): string[] {
    return [...new Set(this.channels.map((c) => c.group).filter((g) => g !== ""))];
  }

  /** ALL groups including the ungrouped "" bucket (the sidebar's
   *  "Lainnya" header) — the accordion starts with every group
   *  expanded, so the default expansion set must include it. */
  private allGroups(): string[] {
    return [...new Set(this.channels.map((c) => c.group))];
  }

  /** The playing channel's position in the VISIBLE list; -1 when the
   *  active filter hides it (playback continues regardless). */
  private get currentIndex(): number {
    if (this.currentUrl === null) return -1;
    return this.vis.findIndex((c) => c.url === this.currentUrl);
  }

  /** The TV sidebar's flat walk order (the shared leaf derivation —
   *  the screen builds the SAME rows from the pushed state). */
  private flatRows() {
    return buildSidebarRows(this.vis, this.expandedGroups);
  }

  /** The flat-row position of a channel url (-1 when hidden/collapsed). */
  private flatIndexOf(url: string): number {
    return this.flatRows().findIndex(
      (r) => r.type === "channel" && r.channel.url === url
    );
  }

  /**
   * @param formFactor "tv" (default — 960-unit 10-foot layout: icon
   *        rail, accordion sidebar, video hero) or "phone" (390-unit
   *        layout: video hero on top, the channel list below as
   *        tappable rows). The video rect is static per session either
   *        way (ADR-0028).
   */
  constructor(
    host: TvplayerHostServices & { designWidth?: number; formFactor?: FormFactor } = {}
  ) {
    const { media, designWidth, formFactor } = host;
    this.media = media ?? unsupportedMedia("tvplayer: no media host bound");
    this.form = formFactor ?? "tv";
    this.videoRect = this.form === "phone" ? VIDEO_RECT_PHONE : VIDEO_RECT;
    this.expandedGroups = new Set(this.allGroups());

    const services = {
      media: this.media,
      navigate: (route: string) => this.navigate(route),
      loadPlaylist: (url: string) => void this.loadPlaylist(url),
      select: (index: number) => this.select(index),
      setGroup: (group: string | null) => this.setGroup(group),
    };
    this.app = new ApplicationRuntime({
      screens,
      initial: "player",
      theme: tvTheme,
      services: services as unknown as Record<string, unknown>,
      designWidth: designWidth ?? (this.form === "phone" ? DESIGN_WIDTH_PHONE : DESIGN_WIDTH),
    });
    this.app.pushState("form", this.form);
    this.pushChannels();
    this.pushFocus();
    this.pushNowPlaying();
    this.pushMedia();
    this.ensureVideoRect();
    this.startClock();
  }

  /**
   * The wall clock (the reference UI's top-right time): pushed as
   * "HH.MM" now and on every minute boundary. The re-arm is a plain
   * setTimeout — the bundle entry's timer shim on device (the host's
   * system.scheduleTimer drains it), a real timer in browsers/tests.
   */
  private startClock(): void {
    const push = () => {
      const d = new Date();
      const hh = String(d.getHours()).padStart(2, "0");
      const mm = String(d.getMinutes()).padStart(2, "0");
      this.app.pushState("clock", `${hh}.${mm}`);
    };
    push();
    const rearm = () => {
      setTimeout(() => {
        push();
        rearm();
      }, 60_000 - (Date.now() % 60_000) + 50);
    };
    rearm();
  }

  // ------------------------------------------------------------------
  // Handoff surface (the HandoffApplication shape + KEY entry point)
  // ------------------------------------------------------------------

  route(): string {
    return this.app.route();
  }

  routes(): readonly string[] {
    return this.app.routes();
  }

  stateSchema(): number {
    return this.app.stateSchema();
  }

  exportState(): unknown {
    return this.app.exportState();
  }

  onStateInvalidation(listener: () => void): () => void {
    return this.app.onStateInvalidation(listener);
  }

  render() {
    return this.app.render();
  }

  navigate(route: string): void {
    this.app.navigate(route);
  }

  /** Plan B2 back ownership: fullscreen exits to browse first, then
   *  Settings returns to the player; the browse player is the root, so
   *  BACK there stays the host's decision. */
  goBack(): boolean {
    if (this.fullscreen) {
      this.exitFullscreen();
      return true;
    }
    if (this.app.route() === "settings") {
      this.navigate("player");
      return true;
    }
    return false;
  }

  /** Host-pushed verb dispatch. KEY arrives here from the entry
   *  wrapper / preview keyboard; MEDIA_STATE from the media service's
   *  event funnel. Everything else is the runtime's normal verbs. */
  dispatch(action: string, payload: unknown = {}): void {
    const norm = action.toUpperCase();
    if (norm === "KEY") {
      const p = (payload ?? {}) as { keyCode?: unknown; phase?: unknown };
      this.keyPress(Number(p.keyCode ?? -1), String(p.phase ?? "down"));
      return;
    }
    if (norm === "MEDIA_STATE") {
      const p = (payload ?? {}) as Partial<MediaStatus> & { type?: unknown };
      this.mediaPush({
        state: (p.state ?? "idle") as MediaStatus["state"],
        url: p.url,
        message: p.message,
      });
      return;
    }
    this.app.dispatch(action, payload);
  }

  // ------------------------------------------------------------------
  // The app-level focus helper (TN-194's consumer)
  // ------------------------------------------------------------------

  /** Handles one key event; true means "consumed" — the host replies
   *  {handled:true} and keeps the key. phase "down" acts, "up" never
   *  does (the host sends both phases of every key). */
  keyPress(keyCode: number, phase: string): boolean {
    if (phase !== "down") return false;
    const route = this.app.route();
    if (route === "player") return this.playerKey(keyCode);
    if (route === "settings") {
      if (keyCode === KEY_DPAD_LEFT) {
        this.navigate("player");
        return true;
      }
      return false; // the IME path owns typing keys in Settings
    }
    return false;
  }

  private playerKey(keyCode: number): boolean {
    // Fullscreen playback (TV): the classic IPTV remote flow — UP/DOWN
    // and CH+/CH- zap the prev/next channel and STAY fullscreen (browse
    // without leaving the video); any OTHER key returns to the browse
    // layout with playback continuing (BACK arrives through goBack()).
    if (this.fullscreen) {
      if (keyCode === KEY_DPAD_DOWN || keyCode === KEYCODE_CHANNEL_UP) {
        this.zapStep(1);
        return true;
      }
      if (keyCode === KEY_DPAD_UP || keyCode === KEYCODE_CHANNEL_DOWN) {
        this.zapStep(-1);
        return true;
      }
      this.exitFullscreen();
      return true;
    }

    // Phone form: the list is vertical — UP/DOWN move the cursor
    // (wrapping), OK plays; RIGHT opens Settings. (Phone chips are
    // tapped directly.)
    if (this.form === "phone") {
      const count = this.vis.length;
      if (keyCode === KEY_DPAD_RIGHT) {
        this.navigate("settings");
        return true;
      }
      if (keyCode === KEY_DPAD_DOWN && count > 0) {
        this.setListIndex((this.listIndex + 1) % count);
        return true;
      }
      if (keyCode === KEY_DPAD_UP && count > 0) {
        this.setListIndex((this.listIndex - 1 + count) % count);
        return true;
      }
      if (keyCode === KEY_DPAD_CENTER || keyCode === KEYCODE_ENTER) {
        if (count === 0) return false;
        this.select(this.listIndex);
        return true;
      }
      return false;
    }

    // CH+/CH- zap from the browse zones too: playback switches, the
    // view stays put (the live-row highlight and the sidebar cursor
    // follow the live channel).
    if (keyCode === KEYCODE_CHANNEL_UP || keyCode === KEYCODE_CHANNEL_DOWN) {
      this.zapStep(keyCode === KEYCODE_CHANNEL_UP ? 1 : -1);
      return true;
    }

    // The icon rail: UP/DOWN between [Live, Settings]; OK opens;
    // RIGHT returns to the sidebar.
    if (this.focusZone === "rail") {
      if (keyCode === KEY_DPAD_UP) {
        this.focusIndex = Math.max(0, this.focusIndex - 1);
        this.pushFocus();
        return true;
      }
      if (keyCode === KEY_DPAD_DOWN) {
        this.focusIndex = Math.min(1, this.focusIndex + 1);
        this.pushFocus();
        return true;
      }
      if (keyCode === KEY_DPAD_CENTER || keyCode === KEYCODE_ENTER) {
        if (this.focusIndex === 1) this.navigate("settings");
        return true; // Live is already the open route
      }
      if (keyCode === KEY_DPAD_RIGHT) {
        this.toZone("list");
        return true;
      }
      return false;
    }

    // The accordion sidebar: UP/DOWN walk the flat rows (headers +
    // expanded channels, clamped — UP past the first row reaches the
    // rail); OK toggles a group or watches a channel fullscreen.
    const rows = this.flatRows();
    if (rows.length === 0) {
      if (keyCode === KEY_DPAD_UP) {
        this.toZone("rail");
        return true;
      }
      return false;
    }
    if (keyCode === KEY_DPAD_DOWN) {
      this.setListIndex(Math.min(rows.length - 1, this.listIndex + 1));
      return true;
    }
    if (keyCode === KEY_DPAD_UP) {
      if (this.listIndex === 0) this.toZone("rail");
      else this.setListIndex(this.listIndex - 1);
      return true;
    }
    if (keyCode === KEY_DPAD_LEFT) {
      this.toZone("rail");
      return true;
    }
    if (keyCode === KEY_DPAD_CENTER || keyCode === KEYCODE_ENTER) {
      const row = rows[this.listIndex];
      if (!row) return false;
      if (row.type === "header") {
        this.toggleGroup(row.group);
        return true;
      }
      // OK: the reference flow — the focused channel plays FULLSCREEN
      // (edge-to-edge video). A different channel switches playback
      // first; the live channel enters fullscreen without a re-prepare.
      if (row.index !== this.currentIndex) this.zapTo(row.index);
      this.enterFullscreen();
      return true;
    }
    return false;
  }

  /** Moves the ring to a zone; each zone gets its natural cursor (the
   *  sidebar restores its row, the rail Live). */
  private toZone(zone: "rail" | "list"): void {
    if (zone === "list") {
      this.listIndex = Math.min(this.listIndex, Math.max(0, this.flatRows().length - 1));
    } else {
      this.focusIndex = 0; // Live
    }
    this.focusZone = zone;
    this.pushFocus();
  }

  /** Sets the list cursor; the ring rides along (list zone). */
  private setListIndex(index: number): void {
    this.listIndex = index;
    this.pushFocus();
  }

  /** Collapses/expands an accordion group. The cursor stays on the
   *  header (its flat position never moves — only the rows BELOW it
   *  appear/disappear); clamped if the list shrank past it. */
  private toggleGroup(group: string): void {
    if (this.expandedGroups.has(group)) this.expandedGroups.delete(group);
    else this.expandedGroups.add(group);
    this.listIndex = Math.min(this.listIndex, Math.max(0, this.flatRows().length - 1));
    this.pushChannels();
    this.pushFocus();
  }

  /** Expands the video edge-to-edge; the scene renders nothing. */
  private enterFullscreen(): void {
    if (this.form !== "tv") return; // phone keeps its video-hero layout
    this.fullscreen = true;
    this.focusZone = "list";
    this.ensureVideoRect();
    this.pushFocus();
  }

  /** Returns to the browse layout with playback continuing. */
  exitFullscreen(): void {
    if (!this.fullscreen) return;
    this.fullscreen = false;
    this.focusZone = "list";
    if (this.form === "phone") {
      this.setListIndex(Math.max(0, this.currentIndex));
    } else {
      // The sidebar cursor lands on the live channel's row (web parity:
      // exiting fullscreen is an auto-scroll to the on-air row).
      const flat = this.currentUrl === null ? -1 : this.flatIndexOf(this.currentUrl);
      this.setListIndex(Math.max(0, flat));
    }
    this.ensureVideoRect();
  }

  /** Zaps ±1 from the LIVE channel (CH± keys; UP/DOWN in fullscreen).
   *  No current channel (fresh boot) tunes channel 01; a single-channel
   *  list is a no-op (a re-prepare of the same url would flicker). */
  private zapStep(dir: number): void {
    const count = this.vis.length;
    if (count === 0) return;
    if (this.currentIndex < 0) {
      this.zapTo(0);
      return;
    }
    const next = (this.currentIndex + dir + count) % count;
    if (next !== this.currentIndex) this.zapTo(next);
  }

  /** Group selection from the UI (phone chip taps / screen action).
   *  The TV sidebar shows every group at once — no filter to set. */
  setGroup(group: string | null): void {
    this.activeGroup = group === null || group === "" ? null : group;
    this.listIndex = 0;
    this.focusZone = "list";
    this.pushChannels();
    this.pushFocus();
  }

  // ------------------------------------------------------------------
  // Media orchestration
  // ------------------------------------------------------------------

  /** Plays channel [index]: prepare (releases any previous item — one
   *  player per host), then play. A refused prepare is FAIL-VISIBLE: it
   *  surfaces as a pushed error state (the browser preview's stub answers
   *  unsupported, and the scene must say so — never a silent idle). */
  zapTo(index: number): void {
    const channel = this.vis[index];
    if (!channel) return;
    this.currentUrl = channel.url;
    if (this.form === "phone") {
      this.listIndex = index;
    } else {
      // The sidebar cursor follows the live channel; its group is
      // auto-expanded so the row is always reachable (web parity).
      this.expandedGroups.add(channel.group || "");
      const flat = this.flatIndexOf(channel.url);
      if (flat >= 0) this.listIndex = flat;
    }
    this.pushChannels();
    this.pushNowPlaying();
    this.pushFocus();
    this.ensureVideoRect();
    void this.media.prepare(channel.url).then((prepared) => {
      if (!prepared.ok) {
        this.mediaPush({
          state: "error",
          message: prepared.failure.message ?? prepared.failure.kind,
        });
        return;
      }
      return this.media.play().then((played) => {
        // The invoke reply carries the post-play status snapshot; the
        // MEDIA_STATE events remain the live source on device (the two
        // agree — media.md). Pushing the reply keeps the pill/scene
        // honest on hosts that are slow to send the first event.
        if (!played.ok) {
          this.mediaPush({
            state: "error",
            message: played.failure.message ?? played.failure.kind,
          });
          return;
        }
        this.mediaPush(played.value);
      });
    });
  }

  /** Asserts the video region (design units → the host's next frame).
   *  Idempotent on the host side; re-asserted on every zap so a hot
   *  reload or viewport change can never leave the overlay stale. */
  private ensureVideoRect(): void {
    // Fullscreen swaps the rect edge-to-edge (TV form); browse uses the
    // layout-derived slot. Still no scene-graph overlap — the scene
    // renders nothing while fullscreen.
    const r =
      this.fullscreen && this.form === "tv"
        ? FULLSCREEN_RECT
        : this.videoRect;
    void this.media.setRect(r.x, r.y, r.w, r.h);
  }

  /** Direct channel selection (the phone list's tap path; also what
   *  the D-pad OK resolves to). Indexes the VISIBLE list; selecting the
   *  live channel is a no-op re-prepare-wise. */
  select(index: number): void {
    if (index < 0 || index >= this.vis.length) return;
    if (index !== this.currentIndex) this.zapTo(index);
    else this.pushFocus();
  }

  /** Settings screen: fetch a playlist URL through the media seam's
   *  bounded fetchText and adopt it as the channel list. The result is
   *  delivered to the Settings session even if the user navigated
   *  away (pushTo, the polytron reply pattern). */
  async loadPlaylist(url: string): Promise<void> {
    const fetched = await this.media.fetchText(url);
    if (!fetched.ok) {
      this.app.pushTo("settings", "loadResult", {
        ok: false,
        message: fetched.failure.message ?? fetched.failure.kind,
      } satisfies LoadResult);
      return;
    }
    const entries = parsePlaylist(fetched.value);
    if (entries.length === 0) {
      this.app.pushTo("settings", "loadResult", {
        ok: false,
        message: "playlist parsed to zero channels",
      } satisfies LoadResult);
      return;
    }
    this.channels = entries;
    this.activeGroup = null;
    this.currentUrl = null;
    this.expandedGroups = new Set(this.allGroups());
    this.pushChannels();
    this.zapTo(0);
    this.focusZone = "list";
    this.pushFocus();
    this.navigate("player");
    this.app.pushTo("settings", "loadResult", {
      ok: true,
      message: `${entries.length} channels`,
    } satisfies LoadResult);
  }

  /** MEDIA_STATE event landing (the entry wrapper / dispatch route). */
  mediaPush(status: MediaStatus): void {
    this.status = status;
    this.pushMedia();
  }

  // ------------------------------------------------------------------
  // Push channels (TN-142; latest-wins, replayed on mount)
  // ------------------------------------------------------------------

  private pushChannels(): void {
    this.app.pushState("channels", {
      channels: this.vis,
      groups: this.groups(),
      activeGroup: this.activeGroup,
      expanded: [...this.expandedGroups],
    });
  }

  private pushFocus(): void {
    const focus: FocusState = {
      index: this.focusZone === "rail" ? this.focusIndex : this.listIndex,
      listIndex: this.listIndex,
      zone: this.focusZone,
      fullscreen: this.fullscreen,
    };
    this.app.pushState("focus", focus);
  }

  private pushNowPlaying(): void {
    const channel = this.channels.find((c) => c.url === this.currentUrl);
    if (!channel) return;
    const now: NowPlaying = {
      index: Math.max(0, this.currentIndex),
      title: channel.title,
      url: channel.url,
    };
    this.app.pushState("channel", now);
  }

  private pushMedia(): void {
    this.app.pushState("media", this.status);
  }
}

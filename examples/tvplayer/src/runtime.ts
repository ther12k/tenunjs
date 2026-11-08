import type { ScreenDefinition } from "@tenunjs/core";
import { ApplicationRuntime } from "@tenunjs/widgets";
import { unsupportedMedia, type MediaCapability, type MediaStatus } from "@tenunjs/platform";
import { tvTheme } from "./theme";
import {
  DESIGN_WIDTH,
  DESIGN_WIDTH_PHONE,
  KEYCODE_ENTER,
  KEY_DPAD_CENTER,
  KEY_DPAD_DOWN,
  KEY_DPAD_LEFT,
  KEY_DPAD_RIGHT,
  KEY_DPAD_UP,
  VIDEO_RECT,
  VIDEO_RECT_PHONE,
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
  DESIGN_WIDTH,
  DESIGN_WIDTH_PHONE,
  VIDEO_RECT,
  VIDEO_RECT_PHONE,
  KEY_DPAD_UP,
  KEY_DPAD_DOWN,
  KEY_DPAD_LEFT,
  KEY_DPAD_RIGHT,
  KEY_DPAD_CENTER,
  KEYCODE_ENTER,
} from "./layout";
export type { FormFactor } from "./layout";
export type { FocusState, NowPlaying, LoadResult } from "./layout";

type AnyScreen = ScreenDefinition<any, any>;

/**
 * Tenun TV runtime (TN-196): screen composition + the media seam the
 * host injects, plus the APP-LEVEL focus helper over KEY actions
 * (deliberately in-app, not framework — ADR-0028; TN-194 dispatches
 * the keys, this class decides what they mean).
 *
 *  - services.media — the MediaCapability (Android tv flavor: the
 *    "media" host service bridge; browser/tests: fail-closed stub or
 *    a fake). The runtime has NO player knowledge beyond the contract.
 *
 * D-pad model (TN-196 item 3, the YouTube-TV browsing shape):
 *   UP/DOWN: opens the channel list AT the live channel when hidden
 *            (playback never interrupts), then moves the focus ring
 *   OK:      hidden — opens the list at the live channel; visible —
 *            switches to the focused channel (the live channel just
 *            closes the list) and closes it
 *   LEFT:    closes the list
 *   RIGHT:   opens Settings
 *   Settings: LEFT returns to the player; everything else belongs to
 *            the IME path
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
  private currentIndex = 0;
  private focusIndex = 0;
  private sidebar = true; // discoverable first boot: the grid is open
  private status: MediaStatus = { state: "idle" };

  /**
   * @param formFactor "tv" (default — 960-unit 10-foot layout, sidebar
   *        carousel beside the video) or "phone" (390-unit layout: video
   *        hero on top, the channel list below as tappable rows). The
   *        video rect is static per session either way (ADR-0028).
   */
  constructor(
    host: TvplayerHostServices & { designWidth?: number; formFactor?: FormFactor } = {}
  ) {
    const { media, designWidth, formFactor } = host;
    this.media = media ?? unsupportedMedia("tvplayer: no media host bound");
    this.form = formFactor ?? "tv";
    this.videoRect = this.form === "phone" ? VIDEO_RECT_PHONE : VIDEO_RECT;

    const services = {
      media: this.media,
      navigate: (route: string) => this.navigate(route),
      loadPlaylist: (url: string) => void this.loadPlaylist(url),
      select: (index: number) => this.select(index),
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

  /** Plan B2 back ownership: Settings returns to the player; the
   *  player is the root, so BACK there stays the host's decision. */
  goBack(): boolean {
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
    const count = this.channels.length;
    if (keyCode === KEY_DPAD_RIGHT) {
      this.navigate("settings");
      return true;
    }
    if (count === 0) return false;
    const step = keyCode === KEY_DPAD_UP ? -1 : keyCode === KEY_DPAD_DOWN ? 1 : 0;
    if (step !== 0) {
      if (!this.sidebar) {
        // YouTube-style: the pad OPENS the list at the live channel —
        // browsing happens over uninterrupted playback, never a blind
        // zap. The first press only opens; further presses move.
        this.sidebar = true;
        this.focusIndex = this.currentIndex;
      } else {
        this.focusIndex = (this.focusIndex + step + count) % count;
      }
      this.pushFocus();
      return true;
    }
    if (keyCode === KEY_DPAD_CENTER || keyCode === KEYCODE_ENTER) {
      if (!this.sidebar) {
        this.sidebar = true;
        this.focusIndex = this.currentIndex;
        this.pushFocus();
        return true;
      }
      // OK on the live channel just closes the list; a different
      // channel switches playback (the old stream runs until the new
      // prepare lands — one player per host).
      if (this.focusIndex !== this.currentIndex) this.zapTo(this.focusIndex);
      this.sidebar = false;
      this.pushFocus();
      return true;
    }
    if (keyCode === KEY_DPAD_LEFT) {
      if (!this.sidebar) return false;
      this.sidebar = false;
      this.pushFocus();
      return true;
    }
    return false;
  }

  // ------------------------------------------------------------------
  // Media orchestration
  // ------------------------------------------------------------------

  /** Plays channel [index]: prepare (releases any previous item — one
   *  player per host), then play. A refused prepare is FAIL-VISIBLE: it
   *  surfaces as a pushed error state (the browser preview's stub answers
   *  unsupported, and the scene must say so — never a silent idle). */
  zapTo(index: number): void {
    const channel = this.channels[index];
    if (!channel) return;
    this.currentIndex = index;
    this.focusIndex = index;
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
      return this.media.play();
    });
  }

  /** Asserts the video region (design units → the host's next frame).
   *  Idempotent on the host side; re-asserted on every zap so a hot
   *  reload or viewport change can never leave the overlay stale. */
  private ensureVideoRect(): void {
    void this.media.setRect(this.videoRect.x, this.videoRect.y, this.videoRect.w, this.videoRect.h);
  }

  /** Direct channel selection (the phone list's tap path; also what
   *  the D-pad OK resolves to). Selecting the live channel is a no-op
   *  re-prepare-wise. */
  select(index: number): void {
    if (index < 0 || index >= this.channels.length) return;
    this.focusIndex = index;
    if (index !== this.currentIndex) this.zapTo(index);
    this.pushFocus();
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
    this.pushChannels();
    this.zapTo(0);
    this.sidebar = true;
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
    this.app.pushState("channels", { channels: this.channels, index: this.currentIndex });
  }

  private pushFocus(): void {
    const focus: FocusState = { sidebar: this.sidebar, index: this.focusIndex };
    this.app.pushState("focus", focus);
  }

  private pushNowPlaying(): void {
    const channel = this.channels[this.currentIndex];
    if (!channel) return;
    const now: NowPlaying = { index: this.currentIndex, title: channel.title, url: channel.url };
    this.app.pushState("channel", now);
  }

  private pushMedia(): void {
    this.app.pushState("media", this.status);
  }
}

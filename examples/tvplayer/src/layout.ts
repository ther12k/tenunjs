/**
 * Shared layout + input constants for the Tenun TV app (TN-196). A leaf
 * module: the runtime and the screens both import it, so it must import
 * nothing (the application module graph gate forbids cycles).
 */

export const DESIGN_WIDTH = 960;

/**
 * Layout geometry, DERIVED so the scene and the native video overlay can
 * never drift apart (the 2026-11-07 device finding: a hand-written rect
 * overlapped the sidebar's edge by 16px). The player screen is
 *   padding-lg(24) | sidebar(240) | gap-sm(8) | video slot | padding-lg(24)
 * and the video slot is exactly VIDEO_RECT — the same box the runtime
 * asserts via media.setRect and the TextureView occupies on device.
 */
export const PAD_LG = 24;
export const GAP_SM = 8;
export const GAP_MD = 16;

/** Design canvas height (1920×1080 host at the 960 design width). */
export const DESIGN_HEIGHT = 540;

/**
 * TV browse layout — the IPTV reference shape (the 10-screen dark
 * project): a narrow icon RAIL on the left, the VIDEO as a huge hero
 * right of it, then the group TABS and a HORIZONTAL row of channel
 * cards below (the list stays visible; only its arrangement changed).
 * Every block's geometry is DERIVED here so VIDEO_RECT — the box the
 * runtime asserts via media.setRect and the native TextureView
 * occupies — is exactly the slot the scene draws around (the
 * 2026-11-07 device finding: a hand-written rect overlapped by 16px).
 */
export const RAIL_W = 72;
export const PAD_SM = 16; // the reference's outer breathing room

/** The video hero: full width right of the rail, 300 tall (the
 *  reference's dominant backdrop block; the player letterboxes). */
export const HERO_W = DESIGN_WIDTH - RAIL_W - 2 * PAD_SM; // 856
export const HERO_H = 300;

/** The video region in design units. ADR-0028 documented ceiling: ONE
 *  static rect — the scene composes AROUND the video (no scene-graph
 *  ordering, clipping, or transitions over it in v1). The app paints an
 *  idle/error placeholder INSIDE the slot; the native overlay covers it
 *  whenever frames render. */
export const VIDEO_RECT = {
  x: RAIL_W + PAD_SM,
  y: PAD_SM,
  w: HERO_W,
  h: HERO_H,
} as const;

/** Group tabs strip and the horizontal channel cards below it. */
export const TABS_H = 40; // caption line 24 + chip padding-sm ×2
export const CARD_W = 136;
export const CARD_H = 112; // number tile 64 + gap 8 + title 24 + padding 16
export const CARDS_VISIBLE = 6; // 6×136 + 5×8 = 856 = HERO_W (exact fit)

/**
 * Phone form factor (the polytron design width): the video is the hero
 * at the top, full-bleed 16:9; the channel list follows below it. The
 * rect stays static per session — same ADR-0028 ceiling, phone-shaped.
 */
export const DESIGN_WIDTH_PHONE = 390;

export const VIDEO_RECT_PHONE = {
  x: 0,
  y: 0,
  w: DESIGN_WIDTH_PHONE,
  h: Math.round((DESIGN_WIDTH_PHONE * 9) / 16), // 219
} as const;

export type FormFactor = "tv" | "phone";

/**
 * Fullscreen playback rect (TV form, the YouTube flow's second half):
 * selecting a channel expands the video edge-to-edge — the scene
 * renders nothing (the overlay covers everything) and any key returns
 * to the browse layout. Exact for 16:9 hosts (1920×1080 → 960×540).
 */
export const FULLSCREEN_RECT = { x: 0, y: 0, w: DESIGN_WIDTH, h: DESIGN_HEIGHT } as const;

/** android.view.KeyEvent codes the helper consumes (mirrored app-side). */
export const KEY_DPAD_UP = 19;
export const KEY_DPAD_DOWN = 20;
export const KEY_DPAD_LEFT = 21;
export const KEY_DPAD_RIGHT = 22;
export const KEY_DPAD_CENTER = 23;
export const KEYCODE_ENTER = 66;
/** CH+/CH- — the classic TV remote zap keys (many remotes ship them
 *  beside the D-pad); the app treats them as next/prev channel from
 *  any zone, fullscreen included. */
export const KEYCODE_CHANNEL_UP = 166;
export const KEYCODE_CHANNEL_DOWN = 167;

export interface FocusState {
  /** The cursor WITHIN the current zone: a rail item, a tab chip, or a
   *  channel card — whichever `zone` says. */
  readonly index: number;
  /** The channel-card cursor regardless of zone (the card window and
   *  the hero's preview caption track it even while the ring is on the
   *  tabs or the rail). */
  readonly cardIndex: number;
  /** Which zone the D-pad ring is on (TV form): the left icon rail,
   *  the group tabs, or the horizontal channel cards. The phone form
   *  taps chips/rows directly and keeps "cards" for keyboard parity. */
  readonly zone: "rail" | "tabs" | "cards";
  /** TV form: fullscreen playback — the video covers the screen and
   *  the scene renders nothing; any key returns to browse. */
  readonly fullscreen: boolean;
}

export interface NowPlaying {
  readonly index: number;
  readonly title: string;
  readonly url: string;
}

export interface LoadResult {
  readonly ok: boolean;
  readonly message: string;
}

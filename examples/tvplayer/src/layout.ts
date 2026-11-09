/**
 * Shared layout + input constants for the NusaTV app (TN-196). A leaf
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
 * TV browse layout — the NusaTV web Studio shape, remote-first: a
 * narrow icon RAIL, then the category-accordion SIDEBAR (the web's
 * collapsible groups walked with ↑↓), and the VIDEO hero filling the
 * remaining width. Every block's geometry is DERIVED here so
 * VIDEO_RECT — the box the runtime asserts via media.setRect and the
 * native TextureView occupies — is exactly the slot the scene draws
 * around (the 2026-11-07 device finding: a hand-written rect
 * overlapped by 16px).
 */
export const RAIL_W = 72;
export const PAD_SM = 16; // the reference's outer breathing room

/** The channel sidebar: accordion headers + rows, D-pad walked. */
export const SIDEBAR_W = 240;
export const HEADER_H = 36; // accordion group header row
export const ROW_H = 40; // channel row (40 tile + gap + title)
/** Rows kept on screen at once (windowed like the card carousel was —
 *  D-pad focus cannot scroll a host region in v1). */
export const SIDEBAR_VISIBLE = 6;

/** The video hero: everything right of the rail+sidebar, 300 tall
 *  (the reference's dominant backdrop block; the player letterboxes). */
export const HERO_X = RAIL_W + PAD_SM + SIDEBAR_W + GAP_SM; // 336
export const HERO_W = DESIGN_WIDTH - HERO_X - PAD_SM; // 608
export const HERO_H = 300;

/** The video region in design units. ADR-0028 documented ceiling: ONE
 *  static rect — the scene composes AROUND the video (no scene-graph
 *  ordering, clipping, or transitions over it in v1). The app paints an
 *  idle/error placeholder INSIDE the slot; the native overlay covers it
 *  whenever frames render. */
export const VIDEO_RECT = {
  x: HERO_X,
  y: PAD_SM,
  w: HERO_W,
  h: HERO_H,
} as const;

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
  /** The cursor WITHIN the current zone: a rail item, or — in the
   *  "list" zone — the flat sidebar row (group header or channel). */
  readonly index: number;
  /** The sidebar's flat-row cursor (TV) / phone row cursor, tracked
   *  regardless of zone so the window follows the live channel. */
  readonly listIndex: number;
  /** Which zone the D-pad ring is on (TV form): the left icon rail or
   *  the accordion sidebar list. The phone form taps chips/rows
   *  directly and keeps "list" for keyboard parity. */
  readonly zone: "rail" | "list";
  /** TV form: fullscreen playback — the video covers the screen and
   *  the scene renders nothing; any key returns to browse. */
  readonly fullscreen: boolean;
}

export interface NowPlaying {
  readonly index: number;
  readonly title: string;
  readonly url: string;
}

/** One row of the TV sidebar's flat walk order (the web accordion's
 *  D-pad translation: headers and the channels of expanded groups).
 *  Lives here — the leaf — so the runtime and the screen derive the
 *  SAME rows without an import cycle. */
export type SidebarRow<T extends { url: string; group: string }> =
  | { readonly type: "header"; readonly group: string }
  | { readonly type: "channel"; readonly group: string; readonly channel: T; readonly index: number };

/** Groups channels (playlist order) into accordion rows: a header per
 *  group, then that group's channels when expanded. `index` is the
 *  channel's position in the source list (its true channel number). */
export function buildSidebarRows<T extends { url: string; group: string }>(
  channels: readonly T[],
  expanded: ReadonlySet<string>,
): SidebarRow<T>[] {
  const rows: SidebarRow<T>[] = [];
  const byGroup = new Map<string, number[]>();
  channels.forEach((channel, index) => {
    const g = channel.group || "";
    if (!byGroup.has(g)) byGroup.set(g, []);
    byGroup.get(g)!.push(index);
  });
  for (const [group, indexes] of byGroup) {
    rows.push({ type: "header", group });
    if (!expanded.has(group)) continue;
    for (const index of indexes) {
      rows.push({ type: "channel", group, channel: channels[index] as T, index });
    }
  }
  return rows;
}

export interface LoadResult {
  readonly ok: boolean;
  readonly message: string;
}

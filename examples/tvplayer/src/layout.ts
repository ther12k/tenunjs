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
export const SIDEBAR_W = 240;
export const GAP_SM = 8;

/** The video region in design units. ADR-0028 documented ceiling: ONE
 *  static rect — the scene composes AROUND the video (no scene-graph
 *  ordering, clipping, or transitions over it in v1). The app paints an
 *  idle/error placeholder INSIDE the slot; the native overlay covers it
 *  whenever frames render. */
export const VIDEO_RECT = {
  x: PAD_LG + SIDEBAR_W + GAP_SM,
  y: 96,
  w: DESIGN_WIDTH - (PAD_LG + SIDEBAR_W + GAP_SM) - PAD_LG,
  h: 360,
} as const;

/** android.view.KeyEvent codes the helper consumes (mirrored app-side). */
export const KEY_DPAD_UP = 19;
export const KEY_DPAD_DOWN = 20;
export const KEY_DPAD_LEFT = 21;
export const KEY_DPAD_RIGHT = 22;
export const KEY_DPAD_CENTER = 23;
export const KEYCODE_ENTER = 66;

export interface FocusState {
  readonly sidebar: boolean;
  readonly index: number;
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

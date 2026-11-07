/**
 * Shared layout + input constants for the Tenun TV app (TN-196). A leaf
 * module: the runtime and the screens both import it, so it must import
 * nothing (the application module graph gate forbids cycles).
 */

export const DESIGN_WIDTH = 960;

/**
 * The video region in design units — sidebar (240 + 8 gap) and the top
 * bar (24 padding + 38 title + 16 gap) stay clear of it; the status
 * line renders below. ADR-0028 documented ceiling: ONE static rect;
 * the scene composes AROUND the video (no scene-graph ordering,
 * clipping, or transitions over it in v1).
 */
export const VIDEO_RECT = { x: 248, y: 96, w: 704, h: 360 } as const;

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

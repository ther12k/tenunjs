/**
 * NusaTV composition entry (the votol/polytron pattern): the runtime
 * IS the app; hosts (native tv flavor, browser preview, tests) bind
 * the media seam and drive dispatch.
 */
export { TvplayerRuntime } from "./runtime";
export type {
  TvplayerHostServices,
  FocusState,
  NowPlaying,
  LoadResult,
} from "./runtime";
export { DESIGN_WIDTH, VIDEO_RECT } from "./runtime";
export type { PlaylistEntry } from "./playlist";
export { parsePlaylist } from "./playlist";
export { STARTER_PLAYLIST } from "./starter-playlist";
export { tvTheme } from "./theme";

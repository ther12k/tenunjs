/**
 * TN-196 starter playlist — the channels bundled with the app.
 *
 * Content boundary (ADR-0028, standing): the example app is a generic
 * m3u/m3u8 playlist player with a starter list of official free
 * Indonesian streams plus a public test stream. No third-party panel
 * integration or reverse-engineering, no bundled unofficial endpoints.
 * Where a user points the player is their choice, as with any media
 * player (the Settings screen accepts any playlist URL).
 */
import type { PlaylistEntry } from "./playlist";

export const STARTER_PLAYLIST: readonly PlaylistEntry[] = [
  {
    // Official TVRI live endpoint (tvri.go.id's own ott-balancer);
    // verified reachable at build time (TN-196 item 4).
    title: "TVRI Nasional",
    url: "https://ott-balancer.tvri.go.id/live/eds/Nasional/hls/Nasional.m3u8",
    group: "TVRI",
    tvgName: null,
    tvgLogo: null,
  },
  {
    // Public mux HLS test stream — the development stream the device
    // acceptance journey plays first (MediaServicePlaybackTest uses it).
    title: "Mux Test Stream (dev)",
    url: "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8",
    group: "Test",
    tvgName: null,
    tvgLogo: null,
  },
];

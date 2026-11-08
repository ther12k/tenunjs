/**
 * TN-196 starter playlist — the channels bundled with the app.
 *
 * Content boundary (ADR-0028, standing): the example app is a generic
 * m3u/m3u8 playlist player with a starter list of official free
 * Indonesian streams plus a public test stream. No third-party panel
 * integration or reverse-engineering, no bundled unofficial endpoints.
 * Where a user points the player is their choice, as with any media
 * player (the Settings screen accepts any playlist URL the user
 * legitimately holds).
 *
 * Every TVRI endpoint below is the broadcaster's own public
 * ott-balancer.tvri.go.id infrastructure (the same host as the
 * National channel), each verified reachable (HTTP 200) at build time.
 */
import type { PlaylistEntry } from "./playlist";

function tvri(title: string, slug: string): PlaylistEntry {
  return {
    title,
    url: `https://ott-balancer.tvri.go.id/live/eds/${slug}/hls/${slug}.m3u8`,
    group: "TVRI",
    tvgName: null,
    tvgLogo: null,
  };
}

export const STARTER_PLAYLIST: readonly PlaylistEntry[] = [
  tvri("TVRI Nasional", "Nasional"),
  tvri("TVRI DKI Jakarta", "DKI"),
  tvri("TVRI Jawa Barat", "Jabar"),
  tvri("TVRI Jawa Tengah", "Jateng"),
  tvri("TVRI Jawa Timur", "Jatim"),
  tvri("TVRI Bali", "Bali"),
  tvri("TVRI Sumatera Utara", "Sumut"),
  tvri("TVRI Sumatera Selatan", "Sumsel"),
  tvri("TVRI Sulawesi Selatan", "Sulsel"),
  tvri("TVRI Sulawesi Utara", "Sulut"),
  tvri("TVRI Sulawesi Tengah", "Sulteng"),
  tvri("TVRI Sulawesi Tenggara", "Sultra"),
  tvri("TVRI Kalimantan Timur", "Kaltim"),
  tvri("TVRI Kalimantan Barat", "Kalbar"),
  tvri("TVRI Aceh", "Aceh"),
  tvri("TVRI Riau", "Riau"),
  tvri("TVRI Bengkulu", "Bengkulu"),
  tvri("TVRI Lampung", "Lampung"),
  tvri("TVRI Kep. Bangka Belitung", "Babel"),
  tvri("TVRI Nusa Tenggara Barat", "NTB"),
  tvri("TVRI Nusa Tenggara Timur", "NTT"),
  tvri("TVRI Gorontalo", "Gorontalo"),
  tvri("TVRI Papua", "Papua"),
  {
    // Public mux HLS test stream — the development stream the device
    // acceptance journey plays first (MediaServicePlaybackTest uses it).
    title: "Mux Test",
    url: "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8",
    group: "Test",
    tvgName: null,
    tvgLogo: null,
  },
];

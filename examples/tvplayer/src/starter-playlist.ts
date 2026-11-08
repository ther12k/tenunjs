/**
 * TN-196 starter playlist — the channels bundled with the app.
 *
 * Content boundary (ADR-0028, standing): the example app is a generic
 * m3u/m3u8 playlist player with a starter list of OFFICIAL FREE public
 * streams — the broadcasters' own publicly published endpoints, nothing
 * extracted from third-party apps. No third-party panel integration or
 * reverse-engineering, no bundled unofficial endpoints. Where a user
 * points the player is their choice, as with any media player (the
 * Settings screen accepts any playlist URL the user legitimately holds).
 *
 * Every endpoint below was verified reachable (HTTP 200, #EXTM3U) on
 * 2026-11-08: the 23 TVRI channels on the broadcaster's own public
 * ott-balancer.tvri.go.id infrastructure, plus international channels
 * on the broadcasters' own CDN configs (DW's Akamai stream, France 24's
 * static.france24.com, Red Bull TV's BoRB Akamai config, NASA's NTV1).
 * Al Jazeera's former getaj.net HLS host now NXDOMAINs and TRT World
 * TLS-refuses this region — both excluded rather than bundled unverified.
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

/** An official-free international channel on its broadcaster's CDN. */
function chan(title: string, url: string, group: string): PlaylistEntry {
  return { title, url, group, tvgName: null, tvgLogo: null };
}

export const STARTER_PLAYLIST: readonly PlaylistEntry[] = [
  // The non-TVRI channels LEAD the list: with 23 TVRI channels bundled,
  // putting them first made the default view wall-to-wall TVRI (the
  // user's "why only tvri" — 2026-11-09). Variety first, regions after.
  //
  // International news — the broadcasters' own publicly published
  // free streams (their live web players use these same CDN configs).
  chan(
    "DW English",
    "https://dwamdstream102.akamaized.net/hls/live/2015525/dwstream102/index.m3u8",
    "Internasional"
  ),
  chan(
    "France 24 English",
    "https://static.france24.com/live/F24_EN_LO_HLS/live_web.m3u8",
    "Internasional"
  ),
  // NASA TV Public — NASA's own NTV1 Akamai config (the feed behind
  // nasa.gov live coverage; NASA+ is the newer platform, NTV1 stays up).
  chan(
    "NASA TV Public",
    "https://ntv1.akamaized.net/hls/live/2014075/NASA-NTV1-HLS/master.m3u8",
    "Sains"
  ),
  // Red Bull TV — the broadcaster's own BoRB Akamai config (free
  // 24/7 sports feed, the same stream redbull.tv's apps play).
  chan(
    "Red Bull TV",
    "https://rbmn-live.akamaized.net/hls/live/590964/BoRB-AT/master.m3u8",
    "Olahraga"
  ),
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

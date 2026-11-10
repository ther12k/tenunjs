/**
 * TN-196: BitTV-style live channel feed — a third-party JSON lineup fetched
 * at boot through the media seam's bounded fetchText, with the bundled
 * starter playlist as the always-available fallback.
 *
 * BitTV (com.live_streaming_tv.online_tv, the Bang-Yadi / Duktek mod) ships
 * no channel list in its APK — its lineup is a JSON feed fetched at runtime
 * from the mod author's server (https://duktetek.id/?device=<id>). We mimic
 * that capability: when the feed succeeds it REPLACES the starter playlist
 * (just as BitTV shows only its feed); any failure (network, DNS, unparseable,
 * zero channels) keeps the starter list so the app is never empty.
 *
 * The exact payload shape could not be inspected while that domain is down
 * (it is NXDOMAIN at the .id registry), so parseFeedText is deliberately
 * tolerant: it accepts an array, or an object carrying the array under a
 * small set of common keys, and reads each channel's fields from a set of
 * aliases. Live-only: movie/VOD entries (is_movie) are skipped.
 *
 * Pure TS, no host dependency, no framework import — the same constraints as
 * playlist.ts, so it ships in the QuickJS bundle untouched and is testable
 * headlessly.
 */

import type { PlaylistEntry } from "./playlist";

/** Where the feed is fetched from by default. */
export const FEED_URL = "https://duktetek.id/?device=bittv";

const CONTAINER_KEYS = ["channels", "data", "list", "result", "items", "streams"] as const;
const TITLE_KEYS = ["name", "title", "channel_name", "channel", "tv_name"] as const;
const URL_KEYS = ["source", "url", "stream", "link", "stream_url"] as const;
const GROUP_KEYS = ["group", "country", "menu_name", "group_title", "category", "genre"] as const;

const MAX_CHANNELS = 2000;

function firstString(obj: Record<string, unknown>, keys: readonly string[]): string {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

function isTruthy(v: unknown): boolean {
  return v === true || v === 1 || v === "1" || v === "true";
}

/**
 * Parse a BitTV-shaped JSON feed into playable entries (title/url/group).
 * Tolerant of the common container shapes and key aliases; live-only.
 * Returns null for non-JSON or zero valid entries (fail-closed — the caller
 * keeps the starter playlist).
 */
export function parseFeedText(text: string): PlaylistEntry[] | null {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }

  let arr: unknown[] = [];
  if (Array.isArray(data)) {
    arr = data;
  } else if (data && typeof data === "object") {
    const obj = data as Record<string, unknown>;
    for (const key of CONTAINER_KEYS) {
      if (Array.isArray(obj[key])) {
        arr = obj[key] as unknown[];
        break;
      }
    }
  }
  if (arr.length === 0) return null;

  const out: PlaylistEntry[] = [];
  const seen = new Set<string>();
  for (const item of arr) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    if (isTruthy(o.is_movie)) continue; // live lineup only
    const title = firstString(o, TITLE_KEYS);
    const url = firstString(o, URL_KEYS);
    if (!title || !url) continue;
    const key = title.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
    if (key && seen.has(key)) continue; // de-dupe by normalized title
    if (key) seen.add(key);
    const group = firstString(o, GROUP_KEYS) || "BitTV";
    out.push({ title, url, group, tvgName: null, tvgLogo: null });
    if (out.length >= MAX_CHANNELS) break;
  }
  return out.length > 0 ? out : null;
}

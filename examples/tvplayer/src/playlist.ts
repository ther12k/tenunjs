/**
 * TN-196: pure-TS M3U/M3U8 playlist parser — no host dependency, no
 * framework import. Handles the extended-M3U vocabulary playlists
 * actually use: #EXTM3U headers, #EXTINF with tvg-* / group-title
 * attributes, #EXTGRP group lines, and plain URL entries. Malformed
 * lines are skipped, never thrown: a playlist that half-parses still
 * yields its good channels (fail-visible via what renders, not a
 * crashed bundle).
 */

/** One playable channel exactly as the player renders it. */
export interface PlaylistEntry {
  /** Display title (#EXTINF name, falling back to tvg-name). */
  readonly title: string;
  /** The stream URL (HLS m3u8 or otherwise) — passed to media.prepare. */
  readonly url: string;
  /** Group title from group-title / #EXTGRP; "" when ungrouped. */
  readonly group: string;
  readonly tvgName: string | null;
  readonly tvgLogo: string | null;
}

/** #EXTINF attribute block: ` tvg-id="x" tvg-name="y"` … */
const ATTR_RE = /([A-Za-z][\w-]*)="([^"]*)"/g;

function attrs(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const match of block.matchAll(ATTR_RE)) {
    out[match[1]!.toLowerCase()] = match[2]!;
  }
  return out;
}

/**
 * Splits "#EXTINF:<duration> <attrs>,<title>" at the first comma that
 * is NOT inside a double-quoted attribute value — titles and attribute
 * values both contain commas routinely (e.g. tvg-name="a,b channel",
 * "Live, News, 24 jam").
 */
function splitExtinf(line: string): { attrBlock: string; title: string } {
  const rest = line.slice("#EXTINF:".length);
  let inQuote = false;
  for (let i = 0; i < rest.length; i++) {
    const ch = rest[i]!;
    if (ch === '"') inQuote = !inQuote;
    else if (ch === "," && !inQuote) {
      return { attrBlock: rest.slice(0, i), title: rest.slice(i + 1).trim() };
    }
  }
  return { attrBlock: rest, title: "" };
}

/**
 * Parses an M3U/M3U8 document into its entries, in file order.
 * Accepts CRLF; ignores blank lines, comments, and directive tags it
 * does not know (#EXT-X-* etc.). An #EXTINF whose URL never arrives is
 * dropped; a URL line without a preceding #EXTINF is dropped (it has
 * no display metadata the UI can render).
 */
export function parsePlaylist(text: string): PlaylistEntry[] {
  const entries: PlaylistEntry[] = [];
  let pending: {
    title: string | null;
    tvgName: string | null;
    tvgLogo: string | null;
    group: string | null;
  } | null = null;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#EXTM3U") || line.startsWith("#EXT-X-")) {
      continue;
    }
    if (line.startsWith("#EXTINF:")) {
      const { attrBlock, title } = splitExtinf(line);
      const attr = attrs(attrBlock);
      pending = {
        title: title || attr["tvg-name"] || null,
        tvgName: attr["tvg-name"] ?? null,
        tvgLogo: attr["tvg-logo"] ?? null,
        group: attr["group-title"] ?? null,
      };
      continue;
    }
    if (line.startsWith("#EXTGRP:")) {
      const group = line.slice("#EXTGRP:".length).trim();
      // group-title (on the #EXTINF) is authoritative; #EXTGRP only
      // fills the gap for entries that carry no attribute.
      if (pending && pending.group === null) pending.group = group || null;
      continue;
    }
    if (line.startsWith("#")) {
      continue; // unknown directive or comment
    }
    // A URL line completes the pending #EXTINF (if any).
    if (pending) {
      entries.push({
        title: pending.title ?? "(unnamed)",
        url: line,
        group: pending.group ?? "",
        tvgName: pending.tvgName,
        tvgLogo: pending.tvgLogo,
      });
      pending = null;
    }
    // A URL with no #EXTINF carries no metadata — skipped by design.
  }
  return entries;
}

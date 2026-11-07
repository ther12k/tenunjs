import { describe, expect, test } from "bun:test";
import { parsePlaylist } from "../src/playlist";

/**
 * TN-196 item 2: the pure-TS M3U/M3U8 parser. No host dependency —
 * these vectors run anywhere bun runs, and pin the vocabulary
 * playlists actually use (tvg-* attributes, group-title, #EXTGRP).
 */

describe("TN-196 M3U parser", () => {
  test("parses basic #EXTINF entries in file order", () => {
    const text = [
      "#EXTM3U",
      "#EXTINF:-1,TVRI Nasional",
      "https://ott-balancer.tvri.go.id/live/eds/Nasional/hls/Nasional.m3u8",
      "#EXTINF:-1,Mux Test Stream",
      "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8",
    ].join("\n");
    const entries = parsePlaylist(text);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toEqual({
      title: "TVRI Nasional",
      url: "https://ott-balancer.tvri.go.id/live/eds/Nasional/hls/Nasional.m3u8",
      group: "",
      tvgName: null,
      tvgLogo: null,
    });
    expect(entries[1]!.title).toBe("Mux Test Stream");
  });

  test("extracts tvg-* attributes and group-title", () => {
    const text = [
      "#EXTM3U",
      '#EXTINF:-1 tvg-id="tvri.id" tvg-name="TVRI Nasional HD" tvg-logo="https://example/tvri.png" group-title="Nasional",TVRI Nasional',
      "https://example/stream.m3u8",
    ].join("\n");
    const [entry] = parsePlaylist(text);
    expect(entry!.title).toBe("TVRI Nasional");
    expect(entry!.tvgName).toBe("TVRI Nasional HD");
    expect(entry!.tvgLogo).toBe("https://example/tvri.png");
    expect(entry!.group).toBe("Nasional");
  });

  test("#EXTGRP assigns the group for the following entry", () => {
    const text = [
      "#EXTM3U",
      "#EXTINF:-1,Channel One",
      "#EXTGRP:Berita",
      "https://example/one.m3u8",
    ].join("\n");
    expect(parsePlaylist(text)[0]!.group).toBe("Berita");
  });

  test("group-title wins over a later #EXTGRP? no — #EXTGRP refines, attr wins at EXTINF time", () => {
    // group-title arrives WITH the #EXTINF, so it is authoritative;
    // #EXTGRP only fills entries that lack the attribute.
    const withAttr = parsePlaylist(
      ['#EXTINF:-1 group-title="A",X', "#EXTGRP:B", "https://e/x.m3u8"].join("\n")
    );
    expect(withAttr[0]!.group).toBe("A");
  });

  test("titles may contain commas; the split happens after the attribute block", () => {
    const text = '#EXTINF:-1 tvg-name="a,b channel",Live, News, 24 jam\nhttps://e/x.m3u8\n';
    const [entry] = parsePlaylist(text);
    expect(entry!.title).toBe("Live, News, 24 jam");
    expect(entry!.tvgName).toBe("a,b channel");
  });

  test("CRLF input parses identically", () => {
    const text = "#EXTINF:-1,Ch\r\nhttps://e/x.m3u8\r\n";
    expect(parsePlaylist(text)[0]!.url).toBe("https://e/x.m3u8");
  });

  test("malformed input is skipped, never thrown: empty, orphan URLs, dangling EXTINF, junk", () => {
    expect(parsePlaylist("")).toEqual([]);
    expect(parsePlaylist("#EXTM3U\n#EXT-X-VERSION:3\n")).toEqual([]);
    // URL without a preceding #EXTINF carries no metadata — dropped.
    expect(parsePlaylist("https://e/orphan.m3u8\n")).toEqual([]);
    // #EXTINF whose URL never arrives — dropped.
    expect(parsePlaylist("#EXTINF:-1,never follows\n")).toEqual([]);
    // Junk lines and comments pass through silently.
    const entries = parsePlaylist("# a comment\nnot a directive just junk\n#EXTINF:-1,OK\nhttps://e/ok.m3u8\n");
    expect(entries).toHaveLength(1);
    expect(entries[0]!.title).toBe("OK");
  });

  test("tvg-name backs the title when the display name is blank", () => {
    const text = '#EXTINF:-1 tvg-name="Backup Name",\nhttps://e/x.m3u8\n';
    expect(parsePlaylist(text)[0]!.title).toBe("Backup Name");
  });

  test("duration may be float or missing", () => {
    const a = parsePlaylist("#EXTINF:12.5,T\nhttps://e/a.m3u8\n")[0]!;
    const b = parsePlaylist("#EXTINF:,T\nhttps://e/b.m3u8\n")[0]!;
    expect(a.title).toBe("T");
    expect(b.title).toBe("T");
  });
});

import { describe, expect, test } from "bun:test";
import { FEED_URL, parseFeedText } from "../src/feed";
import { STARTER_PLAYLIST } from "../src/starter-playlist";
import { TvplayerRuntime } from "../src/runtime";
import type { MediaCapability } from "@tenunjs/platform";

/**
 * TN-196: the BitTV-style JSON channel feed.
 *
 * Part 1 is the tolerant parser (pure TS — the exact live payload shape is
 * unpinned while duktetek.id is NXDOMAIN, so the vectors pin the CONTRACT:
 * container shapes, key aliases, live-only, fail-closed). Part 2 drives the
 * runtime boot path: feed adopted → the lineup is replaced (the BitTV mimic),
 * feed failure → the starter playlist stays (fail-closed, never empty).
 */

const SETTLE = (): Promise<void> => new Promise<void>((resolve) => setTimeout(resolve, 0));

function fakeFeedMedia(body: string | { ok: false; message: string }): {
  media: MediaCapability;
  calls: string[];
} {
  const calls: string[] = [];
  const media: MediaCapability = {
    contractVersion: 1,
    async prepare(url) {
      calls.push(`prepare:${url}`);
      return { ok: true, value: { state: "ready", url } };
    },
    async play() {
      calls.push("play");
      return { ok: true, value: { state: "playing" } };
    },
    async pause() {
      return { ok: true, value: { state: "paused" } };
    },
    async stop() {
      return { ok: true, value: { state: "idle" } };
    },
    async setRect() {
      return { ok: true, value: null };
    },
    async status() {
      return { ok: true, value: { state: "idle" } };
    },
    async fetchText(url) {
      calls.push(`fetch:${url}`);
      if (typeof body === "object") {
        return { ok: false, failure: { kind: "unavailable", message: body.message } };
      }
      return { ok: true, value: body };
    },
  };
  return { media, calls };
}

describe("TN-196 bittv feed parser", () => {
  test("a bare array of {name, source, country} parses", () => {
    const out = parseFeedText(
      JSON.stringify([
        { name: "Metro TV HD", source: "https://a/1.m3u8", country: "Indonesia" },
        { name: "RTV", source: "https://b/2.m3u8", country: "Indonesia" },
      ])
    );
    expect(out).toEqual([
      { title: "Metro TV HD", url: "https://a/1.m3u8", group: "Indonesia", tvgName: null, tvgLogo: null },
      { title: "RTV", url: "https://b/2.m3u8", group: "Indonesia", tvgName: null, tvgLogo: null },
    ]);
  });

  test("the BitTV container shape {channels:[…]} and the aliases parse", () => {
    const out = parseFeedText(
      JSON.stringify({
        t_stamp: 1794303088,
        channels: [
          { title: "CNN Indonesia", url: "https://c/3.m3u8", group: "Berita", is_movie: 0 },
          { name: "DW English", stream: "https://d/4.m3u8", menu_name: "Internasional", is_movie: "false" },
        ],
      })
    );
    expect(out).toEqual([
      { title: "CNN Indonesia", url: "https://c/3.m3u8", group: "Berita", tvgName: null, tvgLogo: null },
      { title: "DW English", url: "https://d/4.m3u8", group: "Internasional", tvgName: null, tvgLogo: null },
    ]);
  });

  test("the data/list/result containers are recognised", () => {
    for (const key of ["data", "list", "result"]) {
      const out = parseFeedText(JSON.stringify({ [key]: [{ name: "X", source: "https://x/1.m3u8" }] }));
      expect(out).not.toBeNull();
      expect(out![0]!.title).toBe("X");
    }
  });

  test("movie/VOD entries (is_movie) are skipped — live lineup only", () => {
    const out = parseFeedText(
      JSON.stringify([
        { name: "Live A", source: "https://a/1.m3u8", is_movie: 1 },
        { name: "Live B", source: "https://b/2.m3u8", is_movie: 0 },
        { name: "Movie C", source: "https://c/movie.mp4", is_movie: true },
        { name: "Live D", source: "https://d/4.m3u8", is_movie: "1" },
        { name: "Live E", source: "https://e/5.m3u8" },
      ])
    );
    expect(out?.map((e) => e.title)).toEqual(["Live B", "Live E"]);
  });

  test("entries missing a title or url are dropped; the rest survive", () => {
    const out = parseFeedText(
      JSON.stringify([
        { source: "https://a/1.m3u8" }, // no title
        { name: "No URL" }, // no url
        { name: "Good", url: "https://g/1.m3u8", group: "" },
      ])
    );
    expect(out).toEqual([
      { title: "Good", url: "https://g/1.m3u8", group: "BitTV", tvgName: null, tvgLogo: null },
    ]);
  });

  test("duplicate titles de-dupe; the group default is BitTV", () => {
    const out = parseFeedText(
      JSON.stringify([
        { name: "Metro", url: "https://a/1.m3u8" },
        { name: "Metro (Alt)", url: "https://b/2.m3u8" },
      ])
    );
    expect(out).toHaveLength(2); // normalised key strips the "(Alt)" tag → same key
  });

  test("garbage / non-JSON / empty payloads fail closed (null)", () => {
    expect(parseFeedText("not json")).toBeNull();
    expect(parseFeedText("")).toBeNull();
    expect(parseFeedText("null")).toBeNull();
    expect(parseFeedText("[]")).toBeNull();
    expect(parseFeedText("{}")).toBeNull();
    expect(parseFeedText(JSON.stringify({ channels: "nope" }))).toBeNull();
    expect(parseFeedText(JSON.stringify([{ name: "only a movie", is_movie: true }]))).toBeNull();
  });
});

describe("TN-196 bittv feed at boot (the runtime mimic)", () => {
  test("a live feed REPLACES the starter playlist and plays its first channel", async () => {
    const feed = JSON.stringify([
      { name: "Feed A", source: "https://feed/a.m3u8", country: "FeedGroup" },
      { name: "Feed B", source: "https://feed/b.m3u8", country: "FeedGroup" },
    ]);
    const { media, calls } = fakeFeedMedia(feed);
    const runtime = new TvplayerRuntime({ media, feedUrl: "https://feed.example/list.json" });
    await SETTLE();

    // The boot fetch went out; the starter URL never prepared instead…
    expect(calls).toContain("fetch:https://feed.example/list.json");
    expect(calls).toContain("prepare:https://feed/a.m3u8");
    expect(runtime.feedSource()).toBe("feed");
    // …and the scene shows the feed lineup, not the starter channels.
    const texts = JSON.stringify(runtime.render());
    expect(texts).toContain("Feed A");
    expect(texts).toContain("Feed B");
    expect(texts).toContain("FeedGroup");
    expect(texts).not.toContain(STARTER_PLAYLIST[0]!.title);
  });

  test("a failed feed fetch keeps the starter playlist (fail-closed, never empty)", async () => {
    const { media, calls } = fakeFeedMedia({ ok: false, message: "HTTP 502" });
    const runtime = new TvplayerRuntime({ media });
    await SETTLE();

    expect(calls).toContain(`fetch:${FEED_URL}`); // the default URL
    expect(runtime.feedSource()).toBe("builtin");
    const texts = JSON.stringify(runtime.render());
    expect(texts).toContain(STARTER_PLAYLIST[0]!.title); // starter intact
  });

  test("an unparseable feed body keeps the starter playlist", async () => {
    const { media } = fakeFeedMedia("<html>gateway timeout</html>");
    const runtime = new TvplayerRuntime({ media });
    await SETTLE();

    expect(runtime.feedSource()).toBe("builtin");
    expect(JSON.stringify(runtime.render())).toContain(STARTER_PLAYLIST[0]!.title);
  });

  test("feedSourceUrl reports the configured feed endpoint", async () => {
    const { media } = fakeFeedMedia({ ok: false, message: "down" });
    const runtime = new TvplayerRuntime({ media, feedUrl: "https://custom.example/feed" });
    await SETTLE();
    expect(runtime.feedSourceUrl()).toBe("https://custom.example/feed");
  });
});

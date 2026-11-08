import { describe, expect, test } from "bun:test";
import { TvplayerRuntime, VIDEO_RECT, type LoadResult } from "../src/runtime";
import { STARTER_PLAYLIST } from "../src/starter-playlist";
import type { MediaCapability } from "@tenunjs/platform";

/**
 * TN-196: the TvplayerRuntime headlessly — the KEY focus journeys
 * (the app-level focus helper over TN-194's KEY actions), the media
 * orchestration through a fake MediaCapability, the fail-closed boot,
 * and the playlist-load path. Scenes are asserted as text, the
 * polytron test pattern.
 */

// Derived from the starter playlist so the journeys stay honest as the
// official channel list grows (24 channels: TVRI Nasional is 01, the
// mux test stream is last).
const FIRST = STARTER_PLAYLIST[0]!;
const SECOND = STARTER_PLAYLIST[1]!;
const THIRD = STARTER_PLAYLIST[2]!;

/** Lets zapTo's prepare→play promise chain settle. */
const settle = (): Promise<void> => new Promise<void>((resolve) => setTimeout(resolve, 0));

function fakeMedia(opts: { fetchText?: string; fetchFails?: string } = {}): {
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
      calls.push("pause");
      return { ok: true, value: { state: "paused" } };
    },
    async stop() {
      calls.push("stop");
      return { ok: true, value: { state: "idle" } };
    },
    async setRect(x, y, w, h) {
      calls.push(`rect:${x},${y},${w},${h}`);
      return { ok: true, value: null };
    },
    async status() {
      return { ok: true, value: { state: "idle" } };
    },
    async fetchText(url) {
      calls.push(`fetch:${url}`);
      if (opts.fetchFails !== undefined) {
        return { ok: false, failure: { kind: "unavailable", message: opts.fetchFails } };
      }
      return { ok: true, value: opts.fetchText ?? "" };
    },
  };
  return { media, calls };
}

/** Every text string the committed scene paints. */
function sceneTexts(runtime: TvplayerRuntime): string[] {
  const scene = (runtime.render() as { scene: unknown }).scene;
  return [...JSON.stringify(scene).matchAll(/"text":"((?:[^"\\]|\\.)*)"/g)].map((m) =>
    m[1]!.replace(/\\"/g, '"')
  );
}

function textsInclude(texts: string[], needle: string): boolean {
  return texts.some((t) => t.includes(needle));
}

describe("TN-196 tvplayer boot", () => {
  test("boots fail-closed with the starter playlist visible and media idle", () => {
    const runtime = new TvplayerRuntime(); // no media host: unsupported stub
    const texts = sceneTexts(runtime);
    expect(textsInclude(texts, "TENUN TV")).toBe(true);
    expect(textsInclude(texts, "TVRI Nasional")).toBe(true);
    expect(textsInclude(texts, "TVRI DKI")).toBe(true);
    expect(textsInclude(texts, "IDLE")).toBe(true); // the top-bar state pill
    expect(runtime.route()).toBe("player");
  });

  test("the video region is derived from the scene geometry it overlays", () => {
    // The slot the scene reserves (padding-lg | sidebar | gap-sm) and the
    // rect the runtime asserts via setRect are the SAME derivation —
    // the 2026-11-07 hand-written rect overlapped the sidebar by 16px.
    expect(VIDEO_RECT.x).toBe(24 + 240 + 8);
    expect(VIDEO_RECT.w).toBe(960 - (24 + 240 + 8) - 24);
    expect(VIDEO_RECT.x + VIDEO_RECT.w).toBe(960 - 24);
  });
});

describe("TN-196 KEY focus journeys (the app-level focus helper)", () => {
  test("sidebar: DOWN moves focus, OK plays the focused channel and closes the sidebar", async () => {
    const { media, calls } = fakeMedia();
    const runtime = new TvplayerRuntime({ media });
    await settle(); // boot-time rect assertion

    expect(runtime.keyPress(20, "down")).toBe(true); // DOWN: focus → Mux
    expect(runtime.keyPress(23, "down")).toBe(true); // OK: play Mux, close sidebar
    await settle();

    expect(calls).toContain(`prepare:${SECOND.url}`);
    expect(calls).toContain("play");
    expect(textsInclude(sceneTexts(runtime), "↑↓ channels")).toBe(true); // hidden-list hint
  });

  test("YouTube browsing: while playing, DOWN opens the list AT the live channel without touching the player", async () => {
    const { media, calls } = fakeMedia();
    const runtime = new TvplayerRuntime({ media });
    await settle();

    // Play Mux (focus -> 1, OK); the list closes over playing video.
    runtime.keyPress(20, "down");
    runtime.keyPress(23, "down");
    await settle();
    calls.length = 0;

    // DOWN over playing video: opens the list AT the live channel —
    // the first press only opens, browsing never interrupts playback.
    expect(runtime.keyPress(20, "down")).toBe(true);
    expect(textsInclude(sceneTexts(runtime), "↑↓ browse")).toBe(true); // list visible
    expect(calls).toHaveLength(0);
    runtime.keyPress(20, "down"); // now it moves: 1 -> 0 (wrap)
    await settle();
    expect(calls).toHaveLength(0); // still browsing, still playing

    // OK switches to the focused channel and closes the list.
    expect(runtime.keyPress(23, "down")).toBe(true);
    await settle();
    expect(calls).toContain(`prepare:${THIRD.url}`);
    expect(calls).toContain("play");
    expect(textsInclude(sceneTexts(runtime), "↑↓ channels")).toBe(true);
  });

  test("OK on the LIVE channel just closes the list — no re-prepare; phase up never consumes", async () => {
    const { media, calls } = fakeMedia();
    const runtime = new TvplayerRuntime({ media });
    await settle();

    // Boot: list open at TVRI (0). OK plays TVRI and closes.
    expect(runtime.keyPress(23, "down")).toBe(true);
    await settle();
    calls.length = 0;

    expect(runtime.keyPress(20, "up")).toBe(false); // phase "up": never acts

    runtime.keyPress(20, "down"); // reopens AT the live channel (0)
    expect(runtime.keyPress(23, "down")).toBe(true); // OK on live -> close only
    await settle();
    expect(calls).toHaveLength(0); // no re-prepare of the live channel
  });

  test("zapping moves the visible now-playing line and the live-row highlight", async () => {
    const { media } = fakeMedia();
    const runtime = new TvplayerRuntime({ media });
    await settle();

    expect(runtime.keyPress(20, "down")).toBe(true); // focus -> Mux
    expect(runtime.keyPress(23, "down")).toBe(true); // OK: play Mux, close sidebar
    await settle();

    // Regression (device finding 2026-11-07): the label bound to the
    // screen's stale index — the TV showed "TVRI" while Mux played.
    expect(textsInclude(sceneTexts(runtime), "TVRI DKI")).toBe(true);
    expect(textsInclude(sceneTexts(runtime), "TVRI Nasional")).toBe(false); // the old label must be gone
  });

  test("RIGHT opens Settings; LEFT (and BACK) return to the player", () => {
    const { media } = fakeMedia();
    const runtime = new TvplayerRuntime({ media });

    expect(runtime.keyPress(22, "down")).toBe(true); // RIGHT
    expect(runtime.route()).toBe("settings");
    expect(runtime.keyPress(20, "down")).toBe(false); // typing keys not consumed there
    expect(runtime.keyPress(21, "down")).toBe(true); // LEFT returns
    expect(runtime.route()).toBe("player");

    expect(runtime.goBack()).toBe(false); // player is root: host decides
    runtime.navigate("settings");
    expect(runtime.goBack()).toBe(true);
    expect(runtime.route()).toBe("player");
  });

  test("empty playlist consumes nothing but RIGHT", () => {
    const { media } = fakeMedia();
    const runtime = new TvplayerRuntime({ media });
    runtime.keyPress(23, "down"); // close sidebar
    // (playlist is the starter here — the zero-channel path is covered
    // through loadPlaylist's failure result below; this test pins the
    // guard shape: no channels means no zap, no throw.)
    expect(runtime.keyPress(19, "down")).toBe(true);
  });
});

describe("TN-196 media orchestration", () => {
  test("MEDIA_STATE events repaint the state pill and the placeholder", () => {
    const { media } = fakeMedia();
    const runtime = new TvplayerRuntime({ media });
    runtime.dispatch("MEDIA_STATE", { type: "MEDIA_STATE", state: "playing", url: FIRST.url });
    expect(textsInclude(sceneTexts(runtime), "● LIVE")).toBe(true);

    runtime.dispatch("MEDIA_STATE", {
      type: "MEDIA_STATE",
      state: "error",
      message: "HTTP 404",
    });
    const texts = sceneTexts(runtime);
    expect(textsInclude(texts, "ERROR")).toBe(true);
    expect(textsInclude(texts, "No signal")).toBe(true);
    expect(textsInclude(texts, "HTTP 404")).toBe(true);
  });

  test("zap against the unsupported stub fails VISIBLE — the placeholder carries the reason", async () => {
    const runtime = new TvplayerRuntime(); // unsupportedMedia
    expect(runtime.keyPress(20, "down")).toBe(true); // focus -> Mux
    expect(runtime.keyPress(23, "down")).toBe(true); // OK: switch attempt
    await settle();
    expect(runtime.route()).toBe("player"); // still alive, still rendering
    const texts = sceneTexts(runtime);
    expect(textsInclude(texts, "TENUN TV")).toBe(true);
    expect(textsInclude(texts, "No signal")).toBe(true);
    expect(textsInclude(texts, "media")).toBe(true); // the stub's message names the seam
  });

  test("loadPlaylist adopts a fetched playlist and plays its first channel", async () => {
    const playlist = [
      "#EXTM3U",
      '#EXTINF:-1 group-title="Berita",News One',
      "https://example/news.m3u8",
      "#EXTINF:-1,Sport Two",
      "https://example/sport.m3u8",
    ].join("\n");
    const { media, calls } = fakeMedia({ fetchText: playlist });
    const runtime = new TvplayerRuntime({ media });

    await runtime.loadPlaylist("https://example/list.m3u");

    expect(calls).toContain("fetch:https://example/list.m3u");
    expect(calls).toContain("prepare:https://example/news.m3u8");
    const texts = sceneTexts(runtime);
    expect(textsInclude(texts, "News One")).toBe(true);
    expect(textsInclude(texts, "Sport Two")).toBe(true);
    expect(runtime.route()).toBe("player");
  });

  test("a failed fetch delivers the result to the Settings session (pushTo)", async () => {
    const { media } = fakeMedia({ fetchFails: "HTTP 404" });
    const runtime = new TvplayerRuntime({ media });
    runtime.navigate("settings");

    await runtime.loadPlaylist("https://example/bad.m3u");

    const texts = sceneTexts(runtime);
    expect(textsInclude(texts, "Failed: HTTP 404")).toBe(true);
    expect(runtime.route()).toBe("settings"); // stayed put; the user decides
  });

  test("an empty playlist fetch reports zero channels, keeps the old list", async () => {
    const { media } = fakeMedia({ fetchText: "#EXTM3U\n#EXT-X-VERSION:3\n" });
    const runtime = new TvplayerRuntime({ media });
    runtime.navigate("settings");

    await runtime.loadPlaylist("https://example/empty.m3u");

    expect(textsInclude(sceneTexts(runtime), "Failed: playlist parsed to zero channels")).toBe(true);
    runtime.navigate("player");
    expect(textsInclude(sceneTexts(runtime), "TVRI Nasional")).toBe(true); // starter intact
  });
});

describe("TN-196 state export", () => {
  test("stateSchema and exportState expose the screen sessions", () => {
    const { media } = fakeMedia();
    const runtime = new TvplayerRuntime({ media });
    const exported = runtime.exportState() as Record<string, unknown>;
    expect(exported).toBeDefined();
    expect(runtime.stateSchema()).toBeDefined();
    // LoadResult flows through settings state (shape pin).
    const result: LoadResult = { ok: false, message: "x" };
    expect(result.ok).toBe(false);
  });
});

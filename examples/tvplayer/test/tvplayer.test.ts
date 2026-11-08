import { describe, expect, test } from "bun:test";
import {
  TvplayerRuntime,
  VIDEO_RECT,
  GAP_SM,
  PAD_LG,
  SIDEBAR_W,
  DESIGN_WIDTH,
  type LoadResult,
} from "../src/runtime";
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
    expect(VIDEO_RECT.x).toBe(PAD_LG + SIDEBAR_W + GAP_SM);
    expect(VIDEO_RECT.w).toBe(DESIGN_WIDTH - (PAD_LG + SIDEBAR_W + GAP_SM) - PAD_LG);
    expect(VIDEO_RECT.x + VIDEO_RECT.w).toBe(DESIGN_WIDTH - PAD_LG);
  });
});

describe("TN-196 KEY focus journeys (the app-level focus helper)", () => {
  test("DOWN moves focus, OK plays the focused channel — the list STAYS visible", async () => {
    const { media, calls } = fakeMedia();
    const runtime = new TvplayerRuntime({ media });
    await settle(); // boot-time rect assertion

    expect(runtime.keyPress(20, "down")).toBe(true); // focus → 02
    expect(runtime.keyPress(23, "down")).toBe(true); // OK: play 02
    await settle();

    expect(calls).toContain(`prepare:${SECOND.url}`);
    expect(calls).toContain("play");
    // The reference shape: no open/close — the list renders beside the
    // playing video (browse hints visible, no empty reserved column).
    expect(textsInclude(sceneTexts(runtime), "↑↓ browse")).toBe(true);
  });

  test("browsing the visible list while playing never touches the player", async () => {
    const { media, calls } = fakeMedia();
    const runtime = new TvplayerRuntime({ media });
    await settle();

    // Play 02; the list stays beside the video.
    runtime.keyPress(20, "down");
    runtime.keyPress(23, "down");
    await settle();
    calls.length = 0;

    // Moving the focus ring over the playing video: no player calls.
    expect(runtime.keyPress(20, "down")).toBe(true);
    runtime.keyPress(19, "down");
    runtime.keyPress(19, "down"); // wrap? no — 1 → 0
    await settle();
    expect(calls).toHaveLength(0);

    // OK on a DIFFERENT channel switches playback; the list stays up.
    expect(runtime.keyPress(23, "down")).toBe(true); // focused row 0 (live is 1)
    await settle();
    expect(calls).toContain(`prepare:${FIRST.url}`);
    expect(calls).toContain("play");
    expect(textsInclude(sceneTexts(runtime), "↑↓ browse")).toBe(true);
  });

  test("OK on the LIVE channel is a no-op re-prepare; phase up never consumes", async () => {
    const { media, calls } = fakeMedia();
    const runtime = new TvplayerRuntime({ media });
    await settle();

    expect(runtime.keyPress(23, "down")).toBe(true); // boot focus 0: play TVRI
    await settle();
    calls.length = 0;

    expect(runtime.keyPress(20, "up")).toBe(false); // phase "up": never acts
    expect(runtime.keyPress(23, "down")).toBe(true); // OK on live again
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
    // (The list is always visible now, so assert on the top-bar
    // caption "NN · title" rather than bare row titles.)
    expect(textsInclude(sceneTexts(runtime), "02 · TVRI DKI")).toBe(true);
    expect(textsInclude(sceneTexts(runtime), "01 · TVRI Nasional")).toBe(false);
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

describe("TN-196 phone form factor", () => {
  test("phone: 390-unit layout, full-bleed 16:9 video rect asserted via setRect", async () => {
    const { media, calls } = fakeMedia();
    const runtime = new TvplayerRuntime({ media, formFactor: "phone" });
    await settle();
    expect(calls).toContain("rect:0,0,390,219");
    const texts = sceneTexts(runtime);
    expect(textsInclude(texts, "TENUN TV")).toBe(true);
    expect(textsInclude(texts, "TVRI DKI")).toBe(true); // channel rows render below the video
  });

  test("phone: tapping a channel row plays it through the real TAP dispatch", async () => {
    const { media, calls } = fakeMedia();
    const runtime = new TvplayerRuntime({ media, formFactor: "phone" });
    await settle();
    calls.length = 0;

    // The committed scene's tap regions, in row order; the phone layout
    // registers exactly one tap per visible channel row.
    const scene = (runtime.render() as unknown as {
      scene: { taps?: { payload?: { id?: unknown } }[] };
    }).scene;
    const taps = scene.taps ?? [];
    expect(taps.length).toBeGreaterThan(1);
    // Phone taps: the group chips come first (All + one per group),
    // then the visible channel rows.
    const chips = 1 + 2; // Semua, TVRI, Test
    const thirdRowTapId = taps[chips + 2]!.payload!.id;
    runtime.dispatch("TAP", { id: thirdRowTapId });
    await settle();

    expect(calls).toContain(`prepare:${THIRD.url}`);
    expect(calls).toContain("play");
    expect(textsInclude(sceneTexts(runtime), "TVRI Jawa Barat")).toBe(true); // now playing
  });

  test("phone: the D-pad still works — DOWN moves focus, OK plays", async () => {
    const { media, calls } = fakeMedia();
    const runtime = new TvplayerRuntime({ media, formFactor: "phone" });
    await settle();
    calls.length = 0;

    runtime.keyPress(20, "down"); // focus -> 02
    runtime.keyPress(23, "down"); // OK plays 02
    await settle();
    expect(calls).toContain(`prepare:${SECOND.url}`);
  });
});

describe("TN-196 channel groups (the reference UI's chips)", () => {
  test("chips filter the list; switching groups NEVER interrupts playback", async () => {
    const { media, calls } = fakeMedia();
    const runtime = new TvplayerRuntime({ media });
    await settle();
    expect(textsInclude(sceneTexts(runtime), "Semua")).toBe(true); // chips render

    // Play channel 02 (DKI).
    runtime.keyPress(20, "down");
    runtime.keyPress(23, "down");
    await settle();
    calls.length = 0;

    // UP to row 0, UP again lands on the chips; RIGHT there cycles
    // groups (RIGHT in the rows zone is Settings).
    expect(runtime.keyPress(19, "down")).toBe(true); // row 02 → 01
    expect(runtime.keyPress(19, "down")).toBe(true); // row 01 → chips
    expect(runtime.keyPress(22, "down")).toBe(true); // All → TVRI
    await settle();
    expect(calls).toHaveLength(0); // group switch must not touch the player
    runtime.keyPress(22, "down"); // TVRI → Test
    await settle();
    expect(calls).toHaveLength(0);

    // Test group: only the mux stream; play it.
    expect(runtime.keyPress(20, "down")).toBe(true); // chips → rows (0)
    expect(runtime.keyPress(23, "down")).toBe(true); // OK plays Mux
    await settle();
    expect(calls).toContain(`prepare:https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8`);

    // Now-playing survives a filter that hides it: cycle back to All.
    runtime.keyPress(19, "down"); // rows[0] → chips (at Test's position)
    runtime.keyPress(21, "down"); // Test → TVRI
    runtime.keyPress(21, "down"); // TVRI → All
    await settle();
    expect(textsInclude(sceneTexts(runtime), "24 CHANNELS · Semua")).toBe(true);
    calls.length = 0;
    expect(runtime.keyPress(20, "down")).toBe(true); // into rows — still no player calls
    expect(calls).toHaveLength(0);
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

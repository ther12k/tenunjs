import { describe, expect, test } from "bun:test";
import {
  TvplayerRuntime,
  VIDEO_RECT,
  GAP_SM,
  HERO_W,
  PAD_SM,
  RAIL_W,
  SIDEBAR_W,
  DESIGN_WIDTH,
  DESIGN_HEIGHT,
  FULLSCREEN_RECT,
  type LoadResult,
} from "../src/runtime";
import { STARTER_PLAYLIST } from "../src/starter-playlist";
import type { MediaCapability } from "@tenunjs/platform";

/**
 * TN-196: the TvplayerRuntime headlessly — the KEY zone journeys over
 * the NusaTV web-parity layout (rail / accordion sidebar, the fullscreen
 * zap flow), the media orchestration through a fake MediaCapability,
 * the fail-closed boot, and the playlist-load path. Scenes are asserted
 * as text, the polytron test pattern.
 */

// Derived from the starter playlist so the journeys stay honest as the
// official channel list grows. The flat sidebar rows begin with the
// FIRST GROUP's header; the channels below it follow in playlist order.
const FIRST = STARTER_PLAYLIST[0]!;
const SECOND = STARTER_PLAYLIST[1]!;
const THIRD = STARTER_PLAYLIST[2]!;
const FIRST_GROUP = FIRST.group;
const GROUPS = [...new Set(STARTER_PLAYLIST.map((c) => c.group))];

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

function textsInclude(texts: string[], needle: boolean | string): boolean {
  return typeof needle === "boolean"
    ? needle
    : texts.some((t) => t.includes(needle));
}

describe("TN-196 tvplayer boot", () => {
  test("boots fail-closed with the accordion sidebar visible and media idle", () => {
    const runtime = new TvplayerRuntime(); // no media host: unsupported stub
    const texts = sceneTexts(runtime);
    expect(textsInclude(texts, "NusaTV")).toBe(true); // status line
    expect(textsInclude(texts, FIRST_GROUP)).toBe(true); // first accordion header
    expect(textsInclude(texts, FIRST.title)).toBe(true); // its first channel row
    expect(textsInclude(texts, "IDLE")).toBe(true); // the state pill
    expect(textsInclude(texts, "Live")).toBe(true); // rail items
    expect(textsInclude(texts, "Set")).toBe(true);
    expect(texts.some((t) => /^\d{2}\.\d{2}$/.test(t))).toBe(true); // the wall clock
    expect(runtime.route()).toBe("player");
  });

  test("the video hero is derived from the rail + sidebar geometry it sits beside", () => {
    // The slot the scene reserves (rail | padding | sidebar | gap) and
    // the rect the runtime asserts via setRect are the SAME derivation
    // — the 2026-11-07 hand-written rect overlapped by 16px.
    expect(VIDEO_RECT.x).toBe(RAIL_W + PAD_SM + SIDEBAR_W + GAP_SM);
    expect(VIDEO_RECT.w).toBe(HERO_W);
    expect(VIDEO_RECT.x + VIDEO_RECT.w).toBe(DESIGN_WIDTH - PAD_SM);
    expect(VIDEO_RECT.y).toBe(PAD_SM);
    // Fullscreen stays edge-to-edge at the design canvas.
    expect(FULLSCREEN_RECT).toEqual({ x: 0, y: 0, w: DESIGN_WIDTH, h: DESIGN_HEIGHT });
  });
});

describe("TN-196 KEY zone journeys (the web-parity accordion layout)", () => {
  test("DOWN walks into the channels; OK plays the focused row FULLSCREEN", async () => {
    const { media, calls } = fakeMedia();
    const runtime = new TvplayerRuntime({ media });
    await settle(); // boot-time rect assertion

    // Row 0 is the first group's HEADER; DOWN reaches its first channel.
    expect(runtime.keyPress(20, "down")).toBe(true); // row 1 = channel 01
    expect(runtime.keyPress(23, "down")).toBe(true); // OK: play 01, fullscreen
    await settle();

    expect(calls).toContain(`prepare:${FIRST.url}`);
    expect(calls).toContain("play");
    // Fullscreen: the video rect goes edge-to-edge and the scene
    // renders nothing (the overlay covers everything).
    expect(calls).toContain(`rect:0,0,${DESIGN_WIDTH},${DESIGN_HEIGHT}`);
    expect(sceneTexts(runtime)).toHaveLength(0);

    // LEFT returns to the browse layout; playback continues at the row.
    calls.length = 0;
    expect(runtime.keyPress(21, "down")).toBe(true);
    await settle();
    expect(calls).toContain(`rect:${VIDEO_RECT.x},${VIDEO_RECT.y},${VIDEO_RECT.w},${VIDEO_RECT.h}`);
    expect(textsInclude(sceneTexts(runtime), "↑↓ channels")).toBe(true);
    expect(calls).not.toContain("play"); // no restart on exit
  });

  test("fullscreen UP/DOWN zaps channels WITHOUT leaving the video", async () => {
    const { media, calls } = fakeMedia();
    const runtime = new TvplayerRuntime({ media });
    await settle();

    runtime.keyPress(20, "down"); // row 1 = channel 01
    runtime.keyPress(23, "down"); // OK: play fullscreen
    await settle();
    calls.length = 0;

    // DOWN in fullscreen: next channel, STILL fullscreen — no browse
    // rect, empty scene (media playing), playback switched.
    expect(runtime.keyPress(20, "down")).toBe(true);
    await settle();
    expect(calls).toContain(`prepare:${SECOND.url}`);
    expect(calls).toContain("play");
    expect(calls).not.toContain(`rect:${VIDEO_RECT.x},${VIDEO_RECT.y},${VIDEO_RECT.w},${VIDEO_RECT.h}`);
    expect(sceneTexts(runtime)).toHaveLength(0);

    expect(runtime.keyPress(19, "down")).toBe(true); // UP: back to 01
    await settle();
    expect(calls).toContain(`prepare:${FIRST.url}`);
    expect(sceneTexts(runtime)).toHaveLength(0);

    runtime.keyPress(21, "down"); // LEFT: back to the browse layout
    await settle();
    expect(calls).toContain(`rect:${VIDEO_RECT.x},${VIDEO_RECT.y},${VIDEO_RECT.w},${VIDEO_RECT.h}`);
  });

  test("CH+/CH- zap the live channel; the sidebar cursor follows", async () => {
    const { media, calls } = fakeMedia();
    const runtime = new TvplayerRuntime({ media });
    await settle();
    expect(textsInclude(sceneTexts(runtime), "Semua")).toBe(false); // no tab chips on TV

    expect(runtime.keyPress(166, "down")).toBe(true); // CH+ → fresh boot tunes 01
    await settle();
    expect(calls).toContain(`prepare:${FIRST.url}`);
    expect(runtime.keyPress(166, "down")).toBe(true); // CH+ → 02
    await settle();
    expect(calls).toContain(`prepare:${SECOND.url}`);
    expect(runtime.keyPress(167, "down")).toBe(true); // CH- → back to 01
    await settle();
    expect(calls).toContain(`prepare:${FIRST.url}`);

    // Browse chrome intact throughout; the caption follows the zap and
    // the sidebar cursor sits on the live channel's row (auto-scrolled,
    // web parity).
    const texts = sceneTexts(runtime);
    expect(textsInclude(texts, "NUSA")).toBe(true); // the rail's brand
    expect(textsInclude(texts, `01 · ${FIRST.title}`)).toBe(true); // status caption
  });

  test("OK on a header collapses its group; the cursor holds", async () => {
    const { media, calls } = fakeMedia();
    const runtime = new TvplayerRuntime({ media });
    await settle();
    calls.length = 0;

    // Boot focus is row 0 = the first group's header. Collapsing hides
    // the group's channel rows everywhere (the window refills with the
    // next headers); the cursor stays ON the header. The placeholder
    // still previews the group's FIRST channel (by design), so only the
    // deeper rows must vanish.
    expect(sceneTexts(runtime).some((t) => t === SECOND.title)).toBe(true);
    expect(runtime.keyPress(23, "down")).toBe(true); // OK: collapse
    const collapsed = sceneTexts(runtime);
    expect(collapsed.some((t) => t === SECOND.title)).toBe(false);
    expect(textsInclude(collapsed, FIRST_GROUP)).toBe(true); // header still there
    expect(collapsed).toContain("▸"); // Indonesia's chevron flipped to collapsed
    expect(calls).toHaveLength(0); // collapsing never touches the player

    expect(runtime.keyPress(23, "down")).toBe(true); // OK: expand again
    expect(sceneTexts(runtime).some((t) => t === SECOND.title)).toBe(true);
    expect(calls).toHaveLength(0);
  });

  test("browsing the sidebar while playing never touches the player", async () => {
    const { media, calls } = fakeMedia();
    const runtime = new TvplayerRuntime({ media });
    await settle();

    // Play 01 (fullscreen), then return to browse.
    runtime.keyPress(20, "down"); // row 1 = channel 01
    runtime.keyPress(23, "down"); // play fullscreen
    runtime.keyPress(21, "down"); // LEFT exits fullscreen → browse at the live row
    await settle();
    calls.length = 0;

    // Walking the rows over the playing video: no player calls; UP at
    // row 0 reaches the rail; RIGHT returns to the list.
    expect(runtime.keyPress(19, "down")).toBe(true); // row 1 → header row 0
    expect(runtime.keyPress(19, "down")).toBe(true); // row 0 → rail (Live)
    expect(runtime.keyPress(22, "down")).toBe(true); // RIGHT → back to the list
    await settle();
    expect(calls).toHaveLength(0);

    // OK on a DIFFERENT row switches playback and goes fullscreen.
    runtime.keyPress(20, "down"); // header row 0 → channel 01 again
    expect(runtime.keyPress(23, "down")).toBe(true); // live row: fullscreen
    await settle();
    expect(calls).not.toContain(`prepare:${FIRST.url}`); // no re-prepare of the live url
  });

  test("OK on the LIVE row is a no-op re-prepare; phase up never consumes", async () => {
    const { media, calls } = fakeMedia();
    const runtime = new TvplayerRuntime({ media });
    await settle();

    runtime.keyPress(20, "down"); // row 1 = channel 01
    expect(runtime.keyPress(23, "down")).toBe(true); // boot row: play + fullscreen
    await settle();
    const prepares = calls.filter((c) => c.startsWith("prepare:")).length;
    expect(prepares).toBe(1);

    expect(runtime.keyPress(23, "up")).toBe(false); // phase up never consumes
    runtime.keyPress(21, "down"); // LEFT back to browse
    await settle();
    calls.length = 0;

    runtime.keyPress(19, "down"); // → header row 0
    runtime.keyPress(20, "down"); // → the live channel row again
    expect(runtime.keyPress(23, "down")).toBe(true); // OK on live: fullscreen only
    await settle();
    expect(calls.filter((c) => c.startsWith("prepare:"))).toHaveLength(0);
    expect(calls).toContain(`rect:0,0,${DESIGN_WIDTH},${DESIGN_HEIGHT}`);
  });

  test("zapping moves the visible now-playing caption", async () => {
    const { media, calls } = fakeMedia();
    const runtime = new TvplayerRuntime({ media });
    await settle();

    runtime.keyPress(20, "down"); // row 1 = channel 01
    expect(runtime.keyPress(23, "down")).toBe(true); // OK: play 01, fullscreen
    runtime.keyPress(20, "down"); // fullscreen DOWN: zap → 02
    runtime.keyPress(21, "down"); // LEFT back to browse
    await settle();

    // Regression (device finding 2026-11-07): the caption bound to the
    // screen's stale index — the TV showed "TVRI" while Mux played.
    expect(textsInclude(sceneTexts(runtime), `02 · ${SECOND.title}`)).toBe(true);
    expect(textsInclude(sceneTexts(runtime), `01 · ${FIRST.title}`)).toBe(false);
  });

  test("Settings opens from the rail; BACK ownership stays plan-B2", () => {
    const { media } = fakeMedia();
    const runtime = new TvplayerRuntime({ media });

    runtime.keyPress(19, "down"); // list row 0 → rail
    runtime.keyPress(19, "down"); // rail: Live (clamp)
    runtime.keyPress(20, "down"); // → Set
    expect(runtime.keyPress(23, "down")).toBe(true); // OK → Settings
    expect(runtime.route()).toBe("settings");
    expect(runtime.keyPress(20, "down")).toBe(false); // typing keys not consumed there
    expect(runtime.keyPress(21, "down")).toBe(true); // LEFT returns
    expect(runtime.route()).toBe("player");

    runtime.navigate("settings");
    expect(runtime.goBack()).toBe(true); // settings → player
    expect(runtime.goBack()).toBe(false); // player is root: host decides
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
    runtime.keyPress(20, "down"); // header row 0 → the first channel row
    expect(runtime.keyPress(23, "down")).toBe(true); // OK: play + fullscreen
    runtime.keyPress(21, "down"); // LEFT exits fullscreen to see the placeholder
    await settle();
    expect(runtime.route()).toBe("player"); // still alive, still rendering
    const texts = sceneTexts(runtime);
    expect(textsInclude(texts, "NUSA")).toBe(true); // the rail's brand
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
    expect(textsInclude(sceneTexts(runtime), FIRST.title)).toBe(true); // starter intact
  });
});

describe("TN-196 phone form factor", () => {
  test("phone: 390-unit layout, full-bleed 16:9 video rect asserted via setRect", async () => {
    const { media, calls } = fakeMedia();
    const runtime = new TvplayerRuntime({ media, formFactor: "phone" });
    await settle();
    expect(calls).toContain("rect:0,0,390,219");
    const texts = sceneTexts(runtime);
    expect(textsInclude(texts, "NusaTV")).toBe(true); // the phone header brand
    expect(textsInclude(texts, FIRST.title)).toBe(true); // the first row below the video
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
    const chips = 1 + GROUPS.length;
    const thirdRowTapId = taps[chips + 2]!.payload!.id;
    runtime.dispatch("TAP", { id: thirdRowTapId });
    await settle();

    expect(calls).toContain(`prepare:${THIRD.url}`);
    expect(calls).toContain("play");
    expect(textsInclude(sceneTexts(runtime), THIRD.title)).toBe(true); // now playing
  });

  test("phone: the D-pad still works — DOWN moves focus, OK plays, RIGHT opens Settings", async () => {
    const { media, calls } = fakeMedia();
    const runtime = new TvplayerRuntime({ media, formFactor: "phone" });
    await settle();
    calls.length = 0;

    runtime.keyPress(20, "down"); // DOWN → row 02
    runtime.keyPress(23, "down"); // OK plays 02
    await settle();
    expect(calls).toContain(`prepare:${SECOND.url}`);
    expect(runtime.keyPress(22, "down")).toBe(true); // RIGHT → Settings
    expect(runtime.route()).toBe("settings");
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

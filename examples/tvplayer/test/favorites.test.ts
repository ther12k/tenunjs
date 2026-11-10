import { describe, expect, test } from "bun:test";
import { TvplayerRuntime } from "../src/runtime";
import { STARTER_PLAYLIST } from "../src/starter-playlist";
import type { MediaCapability, StorageCapability } from "@tenunjs/platform";

/**
 * TN-196: the IPTV feature set — favorites (star/persist/filter/prune),
 * recents ("Lanjut Nonton"), the search overlay, the TV MENU-key favorite
 * and the number-pad zap. Storage rides an in-memory fake (the
 * unsupportedStorage path is the fail-closed baseline the boot tests
 * already cover).
 */

const SETTLE = (): Promise<void> => new Promise<void>((resolve) => setTimeout(resolve, 0));

function fakeStorage(seed: Record<string, string> = {}): {
  storage: StorageCapability;
  written: Record<string, string>;
} {
  const written: Record<string, string> = { ...seed };
  const storage: StorageCapability = {
    contractVersion: 1,
    availability: () => ({ status: "supported" }),
    permissionPrerequisites: () => [],
    async get(key) {
      return { ok: true, value: key in written ? written[key]! : null };
    },
    async set(key, value) {
      written[key] = value;
      return { ok: true, value: undefined };
    },
    async remove(key) {
      delete written[key];
      return { ok: true, value: undefined };
    },
    async keys() {
      return { ok: true, value: Object.keys(written) };
    },
  };
  return { storage, written };
}

function fakeMedia() {
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
      return { ok: true, value: { state: "idle" } };
    },
    async setRect() {
      return { ok: true, value: null };
    },
    async status() {
      return { ok: true, value: { state: "idle" } };
    },
    async fetchText() {
      return { ok: false, failure: { kind: "unavailable", message: "down" } };
    },
  };
  return { media, calls };
}

/** Booted phone runtime + its scene taps (fresh ids per render). */
async function phoneTaps(runtime: TvplayerRuntime): Promise<unknown[]> {
  await SETTLE();
  return ((runtime.render() as { scene: { taps?: { payload?: { id?: unknown } }[] } }).scene.taps ?? [])
    .map((t) => t.payload!.id);
}

function sceneTexts(runtime: TvplayerRuntime): string[] {
  const scene = (runtime.render() as { scene: unknown }).scene;
  return [...JSON.stringify(scene).matchAll(/"text":"((?:[^"\\]|\\.)*)"/g)].map((m) =>
    m[1]!.replace(/\\"/g, '"')
  );
}

describe("TN-196 favorites", () => {
  test("toggling a star persists through the storage seam", async () => {
    const { storage, written } = fakeStorage();
    const { media } = fakeMedia();
    const runtime = new TvplayerRuntime({ media, storage, formFactor: "phone" });
    await SETTLE();

    expect(runtime.isFavorite(STARTER_PLAYLIST[0]!.url)).toBe(false);
    runtime.toggleFavorite(STARTER_PLAYLIST[0]!.url);
    expect(runtime.isFavorite(STARTER_PLAYLIST[0]!.url)).toBe(true);
    await SETTLE();
    expect(JSON.parse(written["favorites.v1"]!)).toEqual([STARTER_PLAYLIST[0]!.url]);
  });

  test("a persisted favorite hydrates at boot (survives relaunch)", async () => {
    const fav = STARTER_PLAYLIST[2]!.url;
    const { storage } = fakeStorage({ "favorites.v1": JSON.stringify([fav]) });
    const { media } = fakeMedia();
    const runtime = new TvplayerRuntime({ media, storage, formFactor: "phone" });
    await SETTLE();
    expect(runtime.isFavorite(fav)).toBe(true);
  });

  test("the phone star tap toggles (sibling region, not the row's play)", async () => {
    const { storage, written } = fakeStorage();
    const { media } = fakeMedia();
    const runtime = new TvplayerRuntime({ media, storage, formFactor: "phone" });
    const taps = await phoneTaps(runtime);
    const first = STARTER_PLAYLIST[0]!.url;
    expect(runtime.isFavorite(first)).toBe(false);

    // Row 0's STAR sits one tap after its play body (prefix: hero, ⌕,
    // 4 chips, row0 body → star = 6 + 1).
    runtime.dispatch("TAP", { id: taps[7] });
    await SETTLE();
    expect(runtime.isFavorite(first)).toBe(true);
    expect(JSON.parse(written["favorites.v1"]!)).toEqual([first]);
  });

  test("the ★ Favorit chip filters the lineup to the starred channels", async () => {
    const { storage } = fakeStorage();
    const { media } = fakeMedia();
    const runtime = new TvplayerRuntime({ media, storage, formFactor: "phone" });
    await SETTLE();
    // Star channels[1] (NOT [0] — the hero previews the focused row, so
    // Metro's title renders regardless of the filter).
    const fav = STARTER_PLAYLIST[1]!;
    runtime.toggleFavorite(fav.url);

    runtime.dispatch("TAP", { id: (await phoneTaps(runtime))[2] }); // the ★ chip
    await SETTLE();
    const texts = sceneTexts(runtime).join("\n");
    expect(texts).toContain(fav.title);
    expect(texts).not.toContain(STARTER_PLAYLIST[2]!.title);
  });

  test("favorites prune when a lineup adoption drops their channels", async () => {
    // Pre-seeded star points at a starter channel; a feed WITHOUT it
    // adopts on boot → the stale star dies (hydrate and adoption both
    // prune, so the outcome holds whichever lands first).
    const stale = STARTER_PLAYLIST[0]!.url;
    const { storage } = fakeStorage({ "favorites.v1": JSON.stringify([stale]) });
    const feed = JSON.stringify([
      { name: "Feed Only", source: "https://feed/only.m3u8", country: "G" },
    ]);
    const media: MediaCapability = {
      contractVersion: 1,
      async prepare() { return { ok: true, value: { state: "ready" as const, url: "https://feed/only.m3u8" } }; },
      async play() { return { ok: true, value: { state: "playing" as const } }; },
      async pause() { return { ok: true, value: { state: "paused" as const } }; },
      async stop() { return { ok: true, value: { state: "idle" as const } }; },
      async setRect() { return { ok: true, value: null }; },
      async status() { return { ok: true, value: { state: "idle" as const } }; },
      async fetchText() { return { ok: true, value: feed }; },
    };
    const runtime = new TvplayerRuntime({ media, storage, formFactor: "phone" });
    await SETTLE();
    expect(runtime.isFavorite(stale)).toBe(false);
    expect(runtime.feedSource()).toBe("feed");
  });
});

describe("TN-196 search overlay", () => {
  /** Opens the overlay and types `query` through the REAL IME path: the
   *  text-input op in the committed scene carries the session identity.
   *  The intermediate render() mirrors the host commit that lands between
   *  the ⌕ tap and the runtime's scheduled field focus on device. */
  async function openAndType(runtime: TvplayerRuntime, query: string) {
    runtime.dispatch("TAP", { id: (await phoneTaps(runtime))[1] }); // the header ⌕
    runtime.render(); // the host commit that adopts the overlay's field
    await SETTLE(); // the scheduled focusTextField fires here
    runtime.render();
    const scene = (runtime.render() as { scene: { ops?: { op?: string }[] } }).scene;
    const field = (scene.ops ?? []).find((op) => op.op === "text-input") as {
      id: string;
      sessionId: number;
      revision: number;
    };
    runtime.dispatch("TEXT_EDIT", {
      id: field.id,
      sessionId: field.sessionId,
      baseRevision: field.revision,
      revision: field.revision + 1,
      text: query,
      selection: { base: query.length, extent: query.length },
      composing: null,
    });
    await SETTLE();
  }

  test("opening renders the card; typing filters; a result tap plays and closes", async () => {
    const { media, calls } = fakeMedia();
    const runtime = new TvplayerRuntime({ media, formFactor: "phone" });
    await SETTLE();
    await openAndType(runtime, "metro");

    const texts = sceneTexts(runtime).join("\n");
    expect(texts).toContain("Cari channel");
    // Two matches, source order: Metro TV HD + Metro Globe Network.
    expect(texts).toContain("Metro TV HD");
    expect(texts).toContain("Metro Globe Network");

    // Locate the first result row GEOMETRICALLY: the search field's op
    // carries its frame; the first result tap is the next region below
    // it (the scrim's region registers last — the GD wrapper wins
    // topmost — so positional lookup beats index math here).
    const rendered = runtime.render() as {
      scene: {
        ops?: { op?: string; x?: number; y?: number; h?: number }[];
        taps?: { payload?: { id?: unknown }; x?: number; y?: number }[];
      };
    };
    const field = (rendered.scene.ops ?? []).find((op) => op.op === "text-input")!;
    const fieldBottom = field.y! + field.h!;
    const resultTapId = (rendered.scene.taps ?? []).find(
      (t) => t.x === field.x && t.y! > fieldBottom
    )!.payload!.id;
    calls.length = 0;
    runtime.dispatch("TAP", { id: resultTapId }); // first result row
    await SETTLE();
    expect(calls).toContain(`prepare:${STARTER_PLAYLIST[0]!.url}`);
    expect(sceneTexts(runtime).join("\n")).not.toContain("Cari channel"); // closed by selection
  });

  test("no match shows the empty state, not results", async () => {
    const { media } = fakeMedia();
    const runtime = new TvplayerRuntime({ media, formFactor: "phone" });
    await SETTLE();
    await openAndType(runtime, "zzzz tidak ada");
    const texts = sceneTexts(runtime).join("\n");
    expect(texts).toContain("Tidak ada hasil");
    // The no-match hint carries the query echo.
    expect(texts).toContain("zzzz");
  });

  test("BACK over an open overlay closes it before anything else", async () => {
    const { media } = fakeMedia();
    const runtime = new TvplayerRuntime({ media, formFactor: "phone" });
    await SETTLE();
    runtime.dispatch("TAP", { id: (await phoneTaps(runtime))[1] }); // ⌕
    await SETTLE();
    expect(sceneTexts(runtime).join("\n")).toContain("Cari channel");
    expect(runtime.goBack()).toBe(true);
    await SETTLE();
    expect(sceneTexts(runtime).join("\n")).not.toContain("Cari channel");
    // A second BACK on the browse player is the host's decision.
    expect(runtime.goBack()).toBe(false);
  });
});

describe("TN-196 TV: MENU favorite + number-pad zap", () => {
  test("MENU stars the live channel (persisted)", async () => {
    const { storage, written } = fakeStorage();
    const { media } = fakeMedia();
    const runtime = new TvplayerRuntime({ media, storage });
    await SETTLE();
    runtime.zapTo(0); // live = FIRST
    await SETTLE();

    runtime.dispatch("KEY", { keyCode: 82, phase: "down" }); // MENU
    await SETTLE();
    expect(runtime.isFavorite(STARTER_PLAYLIST[0]!.url)).toBe(true);
    expect(JSON.parse(written["favorites.v1"]!)).toEqual([STARTER_PLAYLIST[0]!.url]);
    // The favorites section renders above the groups in the accordion.
    expect(sceneTexts(runtime)).toContain("★ Favorit");
  });

  test("digits zap by channel number: 0,8 → channel 08 after the timeout", async () => {
    const { media, calls } = fakeMedia();
    const runtime = new TvplayerRuntime({ media });
    await SETTLE();
    calls.length = 0;

    runtime.dispatch("KEY", { keyCode: 15, phase: "down" }); // KEYCODE_8
    await SETTLE();
    expect(sceneTexts(runtime).join("\n")).toContain("8"); // the zap bubble

    await new Promise((r) => setTimeout(r, 1400)); // the 1.2 s flush
    await SETTLE();
    expect(calls).toContain(`prepare:${STARTER_PLAYLIST[7]!.url}`);
    expect(sceneTexts(runtime).join("\n")).not.toBeUndefined();
  });
});

describe("TN-196 hero tap + recents", () => {
  test("hero tap pauses a playing channel and resumes", async () => {
    const { media, calls } = fakeMedia();
    const runtime = new TvplayerRuntime({ media, formFactor: "phone" });
    await SETTLE();
    runtime.dispatch("MEDIA_STATE", { state: "playing", url: STARTER_PLAYLIST[0]!.url });
    await SETTLE();
    calls.length = 0;

    runtime.dispatch("TAP", { id: (await phoneTaps(runtime))[0] }); // hero
    await SETTLE();
    expect(calls).toContain("pause");

    runtime.dispatch("TAP", { id: (await phoneTaps(runtime))[0] });
    await SETTLE();
    expect(calls).toContain("play");
  });

  test("zapping records 'Lanjut Nonton' and the rail zaps by url", async () => {
    const { media, calls } = fakeMedia();
    const runtime = new TvplayerRuntime({ media, formFactor: "phone" });
    await SETTLE();
    runtime.zapTo(0);
    await SETTLE();
    runtime.zapTo(3);
    await SETTLE();

    runtime.dispatch("TAP", { id: (await phoneTaps(runtime))[1] }); // ⌕ → close check only
    await SETTLE();

    // The recents rail chips are the taps right after the 4 chips:
    // prefix = hero(1) + ⌕(1) + chips(4) = 6 → recents chips start there.
    const taps = await phoneTaps(runtime);
    calls.length = 0;
    runtime.dispatch("TAP", { id: taps[6] }); // most recent = channel[3]
    await SETTLE();
    expect(calls).toContain(`prepare:${STARTER_PLAYLIST[3]!.url}`);
  });
});

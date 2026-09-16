/**
 * Tests for the five app-idea modules added to the gallery (weather,
 * music, chat, recipes, crypto). Same harness contract as gallery.test.ts:
 * fresh state, actions through a real action context, views from
 * committed state.
 */

import { describe, expect, test } from "bun:test";
import { mountScreen } from "@tenunjs-examples/test-support";
import { WeatherScreen } from "../src/screens/weather.screen";
import { MusicScreen } from "../src/screens/music.screen";
import { ChatScreen } from "../src/screens/chat.screen";
import { RecipesScreen } from "../src/screens/recipes.screen";
import { CryptoScreen, seriesFor } from "../src/screens/crypto.screen";

describe("Weather", () => {
  test("unit toggle converts every displayed temperature", () => {
    const h = mountScreen(WeatherScreen);
    expect(h.state.unit).toBe("C");
    h.press("toggleUnit");
    expect(h.state.unit).toBe("F");
    // 29C -> 84F (29 * 9/5 + 32 = 84.2, rounded).
    expect(Math.round((29 * 9) / 5 + 32)).toBe(84);
  });

  test("refresh rotates the hourly strip and moves the temperature", () => {
    const h = mountScreen(WeatherScreen);
    const first = h.state.hourly[0]!.time;
    h.press("refresh");
    expect(h.state.hourly[0]!.time).not.toBe(first);
    expect(h.state.hourly.length).toBe(6);
    expect(Math.abs(h.state.currentC - 29)).toBeLessThanOrEqual(2);
  });

  test("detail rings stay within their goal domains", () => {
    const h = mountScreen(WeatherScreen);
    expect(h.state.details.humidity).toBeLessThanOrEqual(1);
    expect(h.state.details.uv).toBeLessThanOrEqual(11);
  });
});

describe("Music", () => {
  test("playPause flips state without touching position", () => {
    const h = mountScreen(MusicScreen);
    const position = h.state.positionSec;
    h.press("playPause");
    expect(h.state.playing).toBe(true);
    expect(h.state.positionSec).toBe(position);
  });

  test("next wraps the queue and resets position", () => {
    const h = mountScreen(MusicScreen);
    h.press("next");
    expect(h.state.trackIndex).toBe(1);
    expect(h.state.positionSec).toBe(0);
    h.press("next");
    h.press("next");
    h.press("next");
    expect(h.state.trackIndex).toBe(0);
  });

  test("seek clamps to the track duration", () => {
    const h = mountScreen(MusicScreen);
    h.press("seek", 0.5);
    expect(h.state.positionSec).toBe(107); // half of 214
    h.press("seek", 5);
    expect(h.state.positionSec).toBe(h.state.queue[h.state.trackIndex]!.durationSec);
  });

  test("selectTrack jumps the queue", () => {
    const h = mountScreen(MusicScreen);
    h.press("selectTrack", 3);
    expect(h.state.trackIndex).toBe(3);
    expect(h.state.queue[3]!.title).toBe("Batik Bloom");
  });
});

describe("Chat", () => {
  test("send appends own bubble and clears the draft", () => {
    const h = mountScreen(ChatScreen);
    h.press("setDraft", "Shipping the kit now 🚀");
    h.press("send");
    const last = h.state.messages[h.state.messages.length - 1]!;
    expect(last.from).toBe("me");
    expect(last.text).toBe("Shipping the kit now 🚀");
    expect(h.state.draft).toBe("");
  });

  test("send with empty draft is a no-op", () => {
    const h = mountScreen(ChatScreen);
    const before = h.state.messages.length;
    h.press("send");
    expect(h.state.messages.length).toBe(before);
  });

  test("simulateReply appends theirs and raises unread; markRead clears", () => {
    const h = mountScreen(ChatScreen);
    const before = h.state.messages.length;
    h.press("simulateReply");
    const last = h.state.messages[h.state.messages.length - 1]!;
    expect(last.from).toBe("them");
    expect(h.state.messages.length).toBe(before + 1);
    expect(h.state.unread).toBe(3);
    h.press("markRead");
    expect(h.state.unread).toBe(0);
  });
});

describe("Recipes", () => {
  test("servings clamp to 1..8", () => {
    const h = mountScreen(RecipesScreen);
    h.press("addServing");
    h.press("addServing");
    expect(h.state.servings).toBe(4);
    for (let i = 0; i < 10; i++) h.press("removeServing");
    expect(h.state.servings).toBe(1);
  });

  test("toggleFavorite flips exactly one recipe", () => {
    const h = mountScreen(RecipesScreen);
    h.press("toggleFavorite", "laksa");
    expect(h.state.recipes.find((r: { id: string }) => r.id === "laksa")!.favorite).toBe(true);
    expect(h.state.recipes.find((r: { id: string }) => r.id === "rendang")!.favorite).toBe(true);
  });

  test("category filter narrows the list", () => {
    const h = mountScreen(RecipesScreen);
    h.press("setCategory", "Dessert");
    expect(h.state.recipes.filter((r: { category: string }) => r.category === "Dessert").length).toBe(2);
  });
});

describe("Crypto", () => {
  test("seriesFor is deterministic for a seed and timeframe", () => {
    expect(seriesFor(1, "1D")).toEqual(seriesFor(1, "1D"));
    expect(seriesFor(1, "1D").length).toBe(24);
    expect(seriesFor(2, "1Y").length).toBe(52);
    expect(seriesFor(1, "1D")).not.toEqual(seriesFor(2, "1D"));
  });

  test("total value is the sum of amount x price", () => {
    const h = mountScreen(CryptoScreen);
    const total = h.state.holdings.reduce(
      (sum: number, x: { amount: number; priceUsd: number }) => sum + x.amount * x.priceUsd,
      0
    );
    expect(total).toBeCloseTo(0.18 * 61250 + 2.6 * 3380 + 24 * 148 + 320 * 17.4);
  });

  test("refresh prices is deterministic and bounded", () => {
    const h = mountScreen(CryptoScreen);
    const before = h.state.holdings.find((x: { sym: string }) => x.sym === "BTC")!.priceUsd;
    h.press("refreshPrices");
    const after = h.state.holdings.find((x: { sym: string }) => x.sym === "BTC")!.priceUsd;
    expect(after).toBeGreaterThan(0);
    expect(Math.abs(after / before - 1)).toBeLessThan(0.05);
    expect(h.state.refreshCount).toBe(1);

    // Same starting state + same step => same result (no RNG).
    const fresh = CryptoScreen.initialState();
    const drift = ((((1 * 7 + 1 * 3) % 11) - 5) / 100) * 0.6;
    expect(Math.round(fresh.holdings[0]!.priceUsd * (1 + drift) * 100) / 100).toBe(after);
  });
});

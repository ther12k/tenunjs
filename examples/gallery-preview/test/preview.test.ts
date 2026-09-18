import { describe, expect, test } from "bun:test";
import { GalleryRuntime } from "../runtime";
import { colorSchemeFromSeed } from "../../ui-kit/src/scheme";
import type { DisplayListScene } from "../../ui-kit/src/display-list";

function sceneWithTap(): DisplayListScene {
  return {
    tenun: "display-list",
    version: 1,
    designWidth: 720,
    contentHeight: 1600,
    background: "#101014",
    ops: [],
    taps: [{ x: 24, y: 120, w: 200, h: 56, action: "tap", payload: { id: 0 } }],
  };
}

describe("GalleryRuntime", () => {
  test("renders home, navigates by route, and preserves screen state", () => {
    const runtime = new GalleryRuntime();
    expect(runtime.route()).toBe("home");
    expect(runtime.routes()).toEqual([
      "home",
      "views",
      "onboarding",
      "plants",
      "profile",
      "themeLab",
      "banking",
      "smartHome",
      "fitness",
      "store",
      "settings",
      "weather",
      "music",
      "chat",
      "recipes",
      "crypto",
    ]);
    const home = runtime.render().scene;
    // 15 module Open buttons + the app-bar burger.
    expect(home.taps.length).toBe(16);

    // First tile is the widget showcase (tap 0 is the app-bar burger);
    // banking sits after the four Flutter-recreation tiles + the lab.
    const viewsTap = home.taps[1]!;
    runtime.dispatch("TAP", viewsTap.payload.id);
    expect(runtime.route()).toBe("views");
    const views = runtime.render().scene;
    expect(views.ops.some((op) => op.op === "text" && op.text === "Buttons")).toBe(true);

    runtime.navigate("home");
    const homeAgain = runtime.render().scene;
    const bankingTap = homeAgain.taps[6]!;
    runtime.dispatch("TAP", bankingTap.payload.id);
    expect(runtime.route()).toBe("banking");
    const banking = runtime.render().scene;
    expect(banking.ops.some((op) => op.op === "text" && op.text === "Banking")).toBe(true);

    const transfer = banking.taps.find((tap) =>
      banking.ops.some((op) => op.op === "text" && op.text.startsWith("Transfer 100") && op.y >= tap.y && op.y <= tap.y + tap.h)
    );
    expect(transfer).toBeDefined();
    runtime.dispatch("TAP", transfer!.payload.id);
    const exported = runtime.exportState();
    expect((exported.states.banking as any).accounts[0].balance).toBe(2331.5);

    runtime.dispatch("TAP", banking.taps[0]!.payload.id);
    expect(runtime.route()).toBe("home");
  });

  test("onboarding walkthrough advances pages, finishes, and restarts", () => {
    const runtime = new GalleryRuntime();
    runtime.navigate("onboarding");
    const page1 = runtime.render().scene;
    expect(page1.ops.some((op) => op.op === "text" && op.text === "Grow your world")).toBe(true);

    const tapUnderText = (scene: DisplayListScene, text: string) => scene.taps.find((tap) =>
      scene.ops.some(
        (op) =>
          op.op === "text" && op.text === text &&
          op.y >= tap.y && op.y <= tap.y + tap.h &&
          op.x >= tap.x && op.x <= tap.x + tap.w
      )
    );

    runtime.dispatch("TAP", tapUnderText(page1, "Next")!.payload.id);
    const page2 = runtime.render().scene;
    expect(page2.ops.some((op) => op.op === "text" && op.text === "Identify instantly")).toBe(true);

    runtime.dispatch("TAP", tapUnderText(page2, "Next")!.payload.id);
    const page3 = runtime.render().scene;
    expect(page3.ops.some((op) => op.op === "text" && op.text === "Never forget again")).toBe(true);

    runtime.dispatch("TAP", tapUnderText(page3, "Get started")!.payload.id);
    const signUp = runtime.render().scene;
    expect(signUp.ops.some((op) => op.op === "text" && op.text === "Create your account")).toBe(true);

    // "Back to walkthrough" restarts from page one.
    runtime.dispatch("TAP", tapUnderText(signUp, "Back to walkthrough")!.payload.id);
    const restarted = runtime.render().scene;
    expect(restarted.ops.some((op) => op.op === "text" && op.text === "Grow your world")).toBe(true);

    // Skip jumps straight past the pages.
    runtime.dispatch("TAP", tapUnderText(restarted, "Skip")!.payload.id);
    expect(runtime.render().scene.ops.some((op) => op.op === "text" && op.text === "Create your account")).toBe(true);
  });

  test("plant shop filters categories, favorites, and carts through taps", () => {
    const runtime = new GalleryRuntime();
    runtime.navigate("plants");
    const scene = runtime.render().scene;
    expect(scene.ops.some((op) => op.op === "text" && op.text === "Find your plant")).toBe(true);
    expect(scene.ops.some((op) => op.op === "text" && op.text === "Monstera")).toBe(true);

    const tapUnderText = (current: DisplayListScene, text: string) => current.taps.find((tap) =>
      current.ops.some(
        (op) =>
          op.op === "text" && op.text === text &&
          op.y >= tap.y && op.y <= tap.y + tap.h &&
          op.x >= tap.x && op.x <= tap.x + tap.w
      )
    );

    // Favorite the first plant: the hollow heart fills.
    runtime.dispatch("TAP", tapUnderText(scene, "♡")!.payload.id);
    const favorited = runtime.render().scene;
    expect(favorited.ops.some((op) => op.op === "text" && op.text === "♥")).toBe(true);

    // Add to cart via the card's "+" button; the price line and the
    // checkout bar both react.
    runtime.dispatch("TAP", tapUnderText(favorited, "+")!.payload.id);
    const withCart = runtime.render().scene;
    expect(withCart.ops.some((op) => op.op === "text" && op.text === "$24 · 1 in cart")).toBe(true);
    expect(withCart.ops.some((op) => op.op === "text" && op.text === "Checkout")).toBe(true);

    // The Cactus category narrows the grid. The featured carousel also uses
    // that word, so select the category-region match below the carousel.
    const cactusCategoryTap = withCart.taps.find((tap) =>
      withCart.ops.some(
        (op) =>
          op.op === "text" && op.text === "Cactus" &&
          op.y >= tap.y && op.y <= tap.y + tap.h &&
          op.x >= tap.x && op.x <= tap.x + tap.w &&
          tap.y > 700
      )
    );
    expect(cactusCategoryTap).toBeDefined();
    runtime.dispatch("TAP", cactusCategoryTap!.payload.id);
    const cactus = runtime.render().scene;
    expect(cactus.ops.some((op) => op.op === "text" && op.text === "Candelabra")).toBe(true);
    // The featured carousel remains above the category grid, so scope the
    // absence check to product-card text below the category row.
    expect(cactus.ops.some((op) => op.op === "text" && op.op === "text" && op.text === "Monstera" && op.y > 1000)).toBe(false);
  });

  test("profile hero and stats render and tabs switch sections", () => {
    const runtime = new GalleryRuntime();
    runtime.navigate("profile");
    const scene = runtime.render().scene;
    expect(scene.ops.some((op) => op.op === "text" && op.text === "Rizky Zulkarnaen")).toBe(true);
    expect(scene.ops.some((op) => op.op === "text" && op.text === "2.4k")).toBe(true);
    expect(scene.ops.some((op) => op.op === "text" && op.text === "★")).toBe(true);

    const activityTap = scene.taps.find((tap) =>
      scene.ops.some(
        (op) =>
          op.op === "text" && op.text === "Activity" &&
          op.y >= tap.y && op.y <= tap.y + tap.h &&
          op.x >= tap.x && op.x <= tap.x + tap.w
      )
    );
    runtime.dispatch("TAP", activityTap!.payload.id);
    const activity = runtime.render().scene;
    expect(activity.ops.some((op) => op.op === "text" && op.text === "This week")).toBe(true);
    expect(activity.ops.some((op) => op.op === "text" && op.text === "Order #1042")).toBe(true);
  });

  test("theme lab renders scoped schemes and switches seeds live", () => {
    const runtime = new GalleryRuntime();
    runtime.navigate("themeLab");
    const scene = runtime.render().scene;
    expect(scene.ops.some((op) => op.op === "text" && op.text === "Theme lab")).toBe(true);
    expect(scene.ops.some((op) => op.op === "text" && op.text === "Light · your seed")).toBe(true);

    // Tap the second seed swatch (screen tap id 1 = "Leaf"): the "your
    // seed" panel re-tones to the leaf scheme's container fill.
    runtime.dispatch("TAP", 1);
    const state = runtime.exportState().states.themeLab as { seedIndex: number };
    expect(state.seedIndex).toBe(1);
    const leaf = colorSchemeFromSeed("#3DD68C", false);
    const retoned = runtime.render().scene;
    expect(retoned.ops.some((op) => op.op === "rect" && op.color === leaf.primaryContainer)).toBe(true);
  });

  test("export and restore carry route plus mutated state", () => {
    const runtime = new GalleryRuntime();
    runtime.navigate("settings");
    const snapshot = runtime.exportState();
    (snapshot.states.settings as any).preferences.notifications = true;

    const fresh = new GalleryRuntime();
    fresh.restore(snapshot);
    expect(fresh.route()).toBe("settings");
    expect((fresh.exportState().states.settings as any).preferences.notifications).toBe(true);
  });

  test("unknown routes are ignored during navigation and restore", () => {
    const runtime = new GalleryRuntime();
    runtime.navigate("ghost");
    expect(runtime.route()).toBe("home");
    runtime.restore({ route: "ghost", states: { ghost: { value: 1 } } });
    expect(runtime.route()).toBe("home");
  });
});

describe("display-list renderer contract", () => {
  test("tap scene preserves design units and bounded content height", () => {
    const scene = sceneWithTap();
    expect(scene.designWidth).toBe(720);
    expect(scene.contentHeight).toBeGreaterThan(0);
    expect(scene.taps[0]!.x + scene.taps[0]!.w).toBe(224);
  });
});

import { describe, expect, test } from "bun:test";
import { mountScreen } from "@tenunjs-examples/test-support";
import {
  LAUNCHER_PERMISSIONS,
  type CapabilityFailureKind,
  type LauncherAppEntry,
  type LauncherCapability,
} from "@tenunjs/platform";
import { layoutScreen } from "@tenunjs/widgets";
import { HomeScreen, type LauncherHomeState } from "../src/screens/home.screen";
import { appTheme } from "../src/theme";

/**
 * TN-149 launcher-sample tests: the drawer driven the way a host would,
 * through a fake launcher capability typed against the frozen TN-147
 * contract — plus a layoutScreen pass proving the ready state lowers to
 * a real display-list scene with per-tile long-press regions (TN-148).
 */

const FIXTURE_APPS: readonly LauncherAppEntry[] = [
  { appId: "com.android.camera", label: "Camera", iconGlyph: null },
  { appId: "dev.ther12k.notes", label: "Notes", iconGlyph: "📝" },
  { appId: "com.example.gallery", label: "Gallery", iconGlyph: "🖼" },
];

function fakeLauncher(
  apps: readonly LauncherAppEntry[] = FIXTURE_APPS,
  launchFailureKind?: CapabilityFailureKind
): LauncherCapability & { launched: string[] } {
  const launched: string[] = [];
  return {
    launched,
    contractVersion: 1,
    availability: () => ({ status: "supported" }),
    permissionPrerequisites: () => LAUNCHER_PERMISSIONS,
    async listApps() {
      return { ok: true, value: apps };
    },
    async launch(appId) {
      if (launchFailureKind) {
        return { ok: false, failure: { kind: launchFailureKind } };
      }
      launched.push(appId);
      return { ok: true, value: undefined };
    },
  };
}

function harness(services: Record<string, unknown> = { launcher: fakeLauncher() }) {
  return mountScreen<LauncherHomeState, never>(HomeScreen as never, { services });
}

describe("HomeScreen — load", () => {
  test("loading → listApps populates state and clears the failure surface", async () => {
    const home = harness();
    expect(home.state.status).toBe("loading");
    await home.press("loadApps");
    expect(home.state.status).toBe("ready");
    expect(home.state.apps.map((a) => a.appId)).toEqual([
      "com.android.camera",
      "dev.ther12k.notes",
      "com.example.gallery",
    ]);
    expect(home.state.failureKind).toBeNull();
  });

  test("a host without the capability renders the degradation surface, not a broken grid", async () => {
    const home = harness({});
    await home.press("loadApps");
    expect(home.state.status).toBe("failed");
    expect(home.state.failureKind).toBe("unsupported");
    expect(JSON.stringify(home.render())).not.toContain("com.android.camera");
  });

  test("a denied capability surfaces the permission-shaped failure", async () => {
    const denied: LauncherCapability = {
      contractVersion: 1,
      availability: () => ({ status: "denied", permission: "android.permission.QUERY_ALL_PACKAGES" }),
      permissionPrerequisites: () => LAUNCHER_PERMISSIONS,
      async listApps() {
        return {
          ok: false,
          failure: { kind: "denied", permission: "android.permission.QUERY_ALL_PACKAGES" },
        };
      },
      async launch() {
        return { ok: false, failure: { kind: "denied" } };
      },
    };
    const home = harness({ launcher: denied });
    await home.press("loadApps");
    expect(home.state.status).toBe("failed");
    expect(home.state.failureKind).toBe("denied");
    // The denied branch carries the grant-in-settings wording.
    expect(JSON.stringify(home.render())).toContain("permission");
  });
});

describe("HomeScreen — launch and options", () => {
  test("tap-shaped action launches through the capability and records the effect", async () => {
    const launcher = fakeLauncher();
    const home = harness({ launcher });
    await home.press("loadApps");
    await home.press("launchApp", FIXTURE_APPS[0]);
    expect(launcher.launched).toEqual(["com.android.camera"]);
    expect(home.state.lastLaunched).toBe("com.android.camera");
    expect(home.state.failureKind).toBeNull();
  });

  test("a failed launch surfaces the failure kind without losing the grid", async () => {
    const home = harness({ launcher: fakeLauncher(FIXTURE_APPS, "unavailable") });
    await home.press("loadApps");
    await home.press("launchApp", FIXTURE_APPS[0]);
    expect(home.state.lastLaunched).toBeNull();
    expect(home.state.failureKind).toBe("unavailable");
    expect(home.state.apps).toHaveLength(3);
  });

  test("long-press-shaped action opens and closes the options panel", async () => {
    const home = harness();
    await home.press("loadApps");
    await home.press("openOptions", FIXTURE_APPS[1]);
    expect(home.state.optionsFor?.appId).toBe("dev.ther12k.notes");
    // The panel shows the appId as TEXT; the grid tile carries it only as
    // a node key, so the serialized-children form distinguishes the two.
    expect(JSON.stringify(home.render())).toContain('["dev.ther12k.notes"]');

    await home.press("closeOptions");
    expect(home.state.optionsFor).toBeNull();
    expect(JSON.stringify(home.render())).not.toContain('["dev.ther12k.notes"]');
  });
});

describe("HomeScreen — scene lowering", () => {
  test("the ready grid lowers to a display-list scene with tap + long-press regions per tile", async () => {
    const home = harness();
    await home.press("loadApps");
    const { scene } = layoutScreen(appTheme as never, home.render() as never, 720);

    const texts = JSON.stringify(scene.ops.filter((op) => op.op === "text"));
    for (const label of ["Camera", "Notes", "Gallery"]) {
      expect(texts).toContain(`"${label}"`);
    }
    // Monogram fallback: the glyph-less Camera tile renders its initial.
    expect(texts).toContain('"C"');
    expect(texts).toContain("📝");

    const taps = scene.taps;
    expect(taps.filter((t) => t.action === "tap")).toHaveLength(3);
    expect(taps.filter((t) => t.action === "long-press")).toHaveLength(3);
  });
});

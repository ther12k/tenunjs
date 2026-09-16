/**
 * Tests for the gallery device bundle: the display-list layout engine and
 * the phone dispatch loop (route switch + tap -> action -> re-render),
 * driven through the same tenun_commit/__tenun_dispatch_action contract the
 * Android bridge installs.
 */

import { describe, expect, test } from "bun:test";
import {
  AppBar,
  Button,
  Card,
  Column,
  Row,
  Scaffold,
  Text,
} from "@tenunjs/widgets";
import { galleryTheme } from "../../gallery/src/theme";
import { BankingScreen } from "../../gallery/src/screens/banking.screen";
import { SmartHomeScreen } from "../../gallery/src/screens/smart-home.screen";
import { layoutScreen, wrapText } from "../src/display-list";
import * as deviceEntry from "../../../embedders/android/tools/gallery-bundle/device-entry";

void deviceEntry;

const __device = (globalThis as any).__tenun_device_test;
if (!__device) throw new Error("device test surface missing");

function longText(): string {
  return "One app, five reference layouts: banking, smart home, fitness, store, and settings.";
}

describe("display-list layout engine", () => {
  test("scaffold produces a background, an app bar, and content ops", () => {
    const tree = (
      <Scaffold appBar={<AppBar title="Banking" />}>
        <Column padding="lg" gap="sm">
          <Text variant="title">Total balance</Text>
          <Text variant="display">12331.75</Text>
        </Column>
      </Scaffold>
    );
    const { scene } = layoutScreen(galleryTheme, tree);

    expect(scene.tenun).toBe("display-list");
    expect(scene.designWidth).toBe(720);
    expect(scene.contentHeight).toBeGreaterThan(96);
    expect(scene.background).toBe("#101014");
    // Full-bleed scaffold background + app bar bar + accent line + text ops.
    expect(scene.ops[0]).toMatchObject({ op: "rect", x: 0, y: 0, r: 0 });
    const texts = scene.ops.filter((op) => op.op === "text");
    expect(texts.map((op) => (op as any).text)).toContain("Banking");
    expect(texts.map((op) => (op as any).text)).toContain("Total balance");
    expect(texts.map((op) => (op as any).text)).toContain("12331.75");
  });

  test("long body text wraps within the design width", () => {
    const lines = wrapText(longText(), 17, 640);
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) {
      expect(line.length * 17 * 0.56).toBeLessThanOrEqual(640);
    }

    const tree = (
      <Scaffold appBar={null}>
        <Column padding="lg">
          <Text variant="body">{longText()}</Text>
        </Column>
      </Scaffold>
    );
    const { scene } = layoutScreen(galleryTheme, tree);
    // The column's inner width is 720 - 2*24; body text renders at size 17.
    const placedLines = wrapText(longText(), 17, 720 - 48);
    const bodyOps = scene.ops.filter((op) => op.op === "text" && (op as any).size === 17);
    expect(bodyOps.length).toBe(placedLines.length);
  });

  test("buttons emit a visual op and an index-aligned tap region", () => {
    let pressed = 0;
    const tree = (
      <Scaffold appBar={null}>
        <Column padding="lg">
          <Button variant="secondary" onPress={() => pressed++}>
            Transfer 100
          </Button>
        </Column>
      </Scaffold>
    );
    const { scene, tapRuns } = layoutScreen(galleryTheme, tree);

    expect(scene.taps.length).toBe(1);
    const tap = scene.taps[0]!;
    expect(tap.action).toBe("tap");
    expect(tap.payload).toEqual({ id: 0 });
    expect(tapRuns.length).toBe(1);

    tapRuns[0]!();
    expect(pressed).toBe(1);

    // The visual button rect and the label are centered on the tap region.
    const outline = scene.ops.find((op) => op.op === "outline");
    expect(outline).toBeDefined();
    expect((outline as any).x).toBe(tap.x);
  });

  test("row with justify between spreads children across the content width", () => {
    const tree = (
      <Scaffold appBar={null}>
        <Column padding="md">
          <Row gap="sm" justify="between">
            <Text variant="title">Everyday</Text>
            <Text variant="title">2431.50</Text>
          </Row>
        </Column>
      </Scaffold>
    );
    const { scene } = layoutScreen(galleryTheme, tree);
    const texts = scene.ops.filter((op) => op.op === "text") as Array<
      Extract<(typeof scene)["ops"][number], { op: "text" }>
    >;
    const everyday = texts.find((op) => op.text === "Everyday")!;
    const balance = texts.find((op) => op.text === "2431.50")!;
    expect(everyday.x).toBeLessThan(balance.x);
    // Right edge of the balance text reaches the content's right padding.
    expect(balance.x + balance.text.length * balance.size * 0.56).toBeGreaterThan(600);
  });
});

describe("gallery device loop", () => {
  test("initial scene is the home hub with ten module buttons", () => {
    const scene = JSON.parse(__device.lastScene());
    expect(scene.tenun).toBe("display-list");
    const labels = scene.ops
      .filter((op: any) => op.op === "text")
      .map((op: any) => op.text);
    expect(labels).toContain("Tenun Gallery");
    expect(labels).toContain("Rally-style banking");
    expect(labels).toContain("Grouped settings");
    // No back-tap on home: taps == module Open buttons only.
    expect(scene.taps.length).toBe(10);
  });

  test("tapping a home card navigates to the banking screen", () => {
    const before = JSON.parse(__device.lastScene());
    const openTap = before.taps.find(
      (tap: any) =>
        before.ops.some((op: any) => op.op === "text" && op.text.includes("Rally-style banking") &&
          op.y >= tap.y && op.y <= tap.y + tap.h)
    );
    expect(openTap).toBeDefined();

    // EXACTLY what the Android host sends: the scene region's action string
    // is lowercase "tap" and TenunSurfaceView echoes it back verbatim
    // (regression: uppercase-only handling made every phone tap a no-op).
    expect(openTap.action).toBe("tap");
    __device.dispatch(openTap.action, JSON.stringify({ id: openTap.payload.id }));

    expect(__device.route()).toBe("banking");
    const scene = JSON.parse(__device.lastScene());
    const labels = scene.ops
      .filter((op: any) => op.op === "text")
      .map((op: any) => op.text);
    expect(labels).toContain("Banking");
    expect(labels).toContain("Total balance");
    // Back affordance added on non-home routes.
    expect(scene.taps.length).toBeGreaterThan(1);
  });

  test("tapping Transfer moves money between accounts on the phone scene", () => {
    expect(__device.route()).toBe("banking");
    const scene = JSON.parse(__device.lastScene());
    const transferTap = scene.taps.find((tap: any) =>
      scene.ops.some(
        (op: any) => op.op === "text" && op.text === "Transfer 100 to savings" &&
          op.y >= tap.y && op.y <= tap.y + tap.h
      )
    );
    expect(transferTap).toBeDefined();

    __device.dispatch("TAP", JSON.stringify({ id: transferTap.payload.id }));

    const after = JSON.parse(__device.lastScene());
    const labels = after.ops
      .filter((op: any) => op.op === "text")
      .map((op: any) => op.text);
    expect(labels).toContain("2331.50");
    expect(labels).toContain("9220.25");
  });

  test("smart home toggle flips a device through the real action", () => {
    // Navigate: back to home, then into the smart home module.
    const scene = JSON.parse(__device.lastScene());
    __device.dispatch("TAP", JSON.stringify({ id: scene.taps[0]!.payload.id })); // app bar -> home
    expect(__device.route()).toBe("home");

    const home = JSON.parse(__device.lastScene());
    const smartTap = home.taps.find((tap: any) =>
      home.ops.some(
        (op: any) => op.op === "text" && op.text.includes("Smart home dashboard") &&
          op.y >= tap.y && op.y <= tap.y + tap.h
      )
    );
    __device.dispatch("TAP", JSON.stringify({ id: smartTap!.payload.id }));
    expect(__device.route()).toBe("smartHome");

    const module = JSON.parse(__device.lastScene());
    const turnOff = module.taps.find((tap: any) =>
      module.ops.some(
        (op: any) => op.op === "text" && op.text === "Turn off" &&
          op.y >= tap.y && op.y <= tap.y + tap.h
      )
    );
    expect(turnOff).toBeDefined();
    __device.dispatch("TAP", JSON.stringify({ id: turnOff!.payload.id }));

    const after = JSON.parse(__device.lastScene());
    const labels = after.ops
      .filter((op: any) => op.op === "text")
      .map((op: any) => op.text);
    expect(labels).toContain("Turn on");
    expect(labels.filter((t: string) => t === "Turn off").length).toBe(0);
  });

  test("module sessions persist while the bundle lives", () => {
    // Sessions are kept per route in a Map; initialState only runs on
    // first mount (and on explicit TENUN_RESTORE).
    expect(typeof BankingScreen.initialState).toBe("function");
    const fresh = BankingScreen.initialState();
    expect(fresh.accounts.length).toBe(3);
    expect(SmartHomeScreen.initialState().devices.length).toBe(4);
  });

  test("hot reload: __TENUN_EXPORT carries the route and mutated states", () => {
    // Get to banking and make a state change worth carrying over.
    const scene = JSON.parse(__device.lastScene());
    __device.dispatch("TAP", JSON.stringify({ id: scene.taps[0]!.payload.id })); // app bar -> home
    const home = JSON.parse(__device.lastScene());
    const bankingTap = home.taps.find((tap: any) =>
      home.ops.some((op: any) => op.op === "text" && op.text.includes("Rally-style banking") &&
        op.y >= tap.y && op.y <= tap.y + tap.h)
    );
    __device.dispatch("TAP", JSON.stringify({ id: bankingTap!.payload.id }));
    const module = JSON.parse(__device.lastScene());
    const transfer = module.taps.find((tap: any) =>
      module.ops.some((op: any) => op.op === "text" && op.text.startsWith("Transfer 100") &&
        op.y >= tap.y && op.y <= tap.y + tap.h)
    );
    const before = JSON.parse(__device.dispatch("__TENUN_EXPORT", "{}"));
    const checkingBefore = before.states.banking.accounts.find(
      (a: any) => a.kind === "checking"
    ).balance as number;
    __device.dispatch("TAP", JSON.stringify({ id: transfer!.payload.id }));

    const exported = JSON.parse(__device.dispatch("__TENUN_EXPORT", "{}"));
    expect(exported.route).toBe("banking");
    const checking = exported.states.banking.accounts.find(
      (a: any) => a.kind === "checking"
    );
    // Sessions persist across tests, so the moved amount is relative.
    expect(checking.balance).toBeCloseTo(checkingBefore - 100);
  });

  test("hot reload: TENUN_RESTORE rehydrates states and re-renders", () => {
    const exported = JSON.parse(__device.dispatch("__TENUN_EXPORT", "{}"));
    // Simulate what a fresh bundle receives: the exported snapshot, with a
    // value the "new code" would render differently.
    exported.states.banking.accounts[0]!.balance = 123.45;
    exported.route = "store";
    __device.dispatch("TENUN_RESTORE", JSON.stringify(exported));
    expect(__device.route()).toBe("store");

    // Navigate back to banking through the UI; the restored state (not a
    // fresh mount) must be what renders.
    const store = JSON.parse(__device.lastScene());
    __device.dispatch("TAP", JSON.stringify({ id: store.taps[0]!.payload.id })); // app bar -> home
    const home = JSON.parse(__device.lastScene());
    const back = home.taps.find((tap: any) =>
      home.ops.some((op: any) => op.op === "text" && op.text.includes("Rally-style banking") &&
        op.y >= tap.y && op.y <= tap.y + tap.h)
    );
    __device.dispatch("TAP", JSON.stringify({ id: back!.payload.id }));

    const labels = JSON.parse(__device.lastScene()).ops
      .filter((op: any) => op.op === "text")
      .map((op: any) => op.text);
    expect(labels).toContain("123.45");
  });

  test("hot reload: export declares stateSchema 1 and the host can query it", () => {
    // The host gates state carry on this value: bundles that disagree
    // restart with clean state instead of importing foreign state.
    const exported = JSON.parse(__device.dispatch("__TENUN_EXPORT", "{}"));
    expect(exported.stateSchema).toBe(1);

    const response = JSON.parse(__device.dispatch("__TENUN_STATE_SCHEMA", "{}"));
    expect(response.stateSchema).toBe(1);
  });

  test("hot reload: restore tolerates unknown routes and screens", () => {
    const before = __device.route();
    const result = JSON.parse(
      __device.dispatch(
        "TENUN_RESTORE",
        JSON.stringify({ route: "ghost", states: { ghost: { x: 1 } } })
      )
    );
    expect(result.route).toBe(before);
    expect(__device.route()).toBe(before);
  });
});

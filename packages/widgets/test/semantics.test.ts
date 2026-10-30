import { describe, expect, test } from "bun:test";
import { defineScreen } from "@tenunjs/core";
import {
  ApplicationRuntime, AppBar, Button, Card, Column, Expanded, GestureDetector, Scaffold, ScrollView,
  Text, TextField, installHostHandoff, layoutScreen,
  type DisplayListScene, type SemanticNode,
} from "../src/index";

const viewport = { width: 300, height: 600 };

function nodes(scene: DisplayListScene): SemanticNode[] {
  return scene.semantics?.nodes ?? [];
}

function screen(tree: ReturnType<typeof Column>): DisplayListScene {
  const app = new ApplicationRuntime({
    screens: { s: defineScreen({ name: "S", initialState: () => ({}), actions: {}, view: () => tree }) },
    initial: "s", theme: {}, viewport,
  });
  return app.render().scene;
}

describe("accessibility semantics wire contract (TN-179)", () => {
  test("text emits static/header nodes; decorative paint never does", () => {
    const scene = screen(Column({ children: [
      Text({ variant: "title", children: "Heading" }),
      Text({ children: "Body copy" }),
      Card({ children: [] }), // decorative: no semantics opt-in, no node
    ] }));
    const roles = nodes(scene).map((n) => n.role);
    expect(roles).toContain("header");
    expect(roles).toContain("text");
    // Only the two text nodes — the card's rect paint is invisible to a11y.
    expect(nodes(scene)).toHaveLength(2);
    expect(nodes(scene).every((n) => typeof n.label === "string" && n.label.length > 0)).toBe(true);
  });

  test("a button's label is absorbed into one actionable node wired to the tap table", () => {
    let presses = 0;
    const scene = screen(Column({ children: [
      Button({ onPress: () => { presses++; }, children: "Start wash" }),
    ] }));
    const button = nodes(scene).find((n) => n.role === "button")!;
    expect(button.label).toBe("Start wash");
    const action = button.actions?.[0];
    expect(action?.name).toBe("press");
    // The action's tapId names a REAL region in this scene's tap table.
    const region = scene.taps.find((t) => t.payload.id === action?.tapId);
    expect(region).toBeDefined();
    expect(region!.x).toBe(button.bounds.x);
    expect(region!.y).toBe(button.bounds.y);
  });

  test("an accessibility activation runs the same action a touch runs", () => {
    // accessibility-requirements.md:16 — platform actions dispatch the same
    // typed controller actions as touch. A host echoes the node's tapId as
    // an ordinary TAP; no separate dispatch verb exists.
    const state = { taps: 0 };
    const app = new ApplicationRuntime({
      screens: { s: defineScreen({
        name: "S",
        initialState: () => state,
        actions: { hit({ state: s }: { state: typeof state }) { s.taps++; } },
        view: ({ state, actions }) => Column({ children: [
          Button({ onPress: actions.hit, semanticsId: "the-button", children: "Go" }),
          Text({ children: `t${state.taps}` }),
        ] }),
      }) },
      initial: "s", theme: {}, viewport,
    });
    let committed: DisplayListScene | null = null;
    const handoff = installHostHandoff({ app, commit: (json) => { committed = JSON.parse(json); } });
    const button = nodes(app.render().scene).find((n) => n.id === "the-button")!;
    handoff.dispatch("TAP", JSON.stringify({ id: button.actions![0]!.tapId }));
    expect(state.taps).toBe(1);
    expect(JSON.stringify(committed)).toContain('"t1"');
    handoff.dispose();
  });

  test("GestureDetector absorbs descendant text and exposes both gestures", () => {
    const scene = screen(Column({ children: [
      GestureDetector({
        onTap: () => {}, onLongPress: () => {},
        children: [Text({ children: "Machine " }), Text({ children: "status" })],
      }),
    ] }));
    const detector = nodes(scene).find((n) => n.role === "generic")!;
    expect(detector.label).toBe("Machine status"); // deep absorption
    expect(detector.actions?.map((a) => a.name)).toEqual(["press", "long-press"]);
    // The absorbed Text children do not announce separately.
    expect(nodes(scene).filter((n) => n.role === "text")).toHaveLength(0);
  });

  test("a text field is one editable node with value, state, and a working focus action", () => {
    const app = new ApplicationRuntime({
      screens: { s: defineScreen({
        name: "S",
        initialState: () => ({ title: "Plan" }),
        actions: { set({ state, input }: { state: { title: string }; input: string }) { state.title = input; } },
        view: ({ state, actions }) => Column({ children: [
          TextField({ id: "title", value: state.title, onChanged: actions.set }),
        ] }),
      }) },
      initial: "s", theme: {}, viewport,
    });
    const scene = app.render().scene;
    const field = nodes(scene).find((n) => n.role === "textfield")!;
    expect(field.id).toBe("title"); // the stable field id IS the semantic id
    expect(field.value).toBe("Plan");
    expect(field.state?.focused).toBe(false);
    // The focus action is the same tap a touch uses.
    app.dispatch("TAP", { id: field.actions![0]!.tapId });
    const focused = nodes(app.render().scene).find((n) => n.role === "textfield")!;
    expect(focused.state?.focused).toBe(true);
  });

  test("Card opts in explicitly; alert implies a live region", () => {
    const scene = screen(Column({ children: [
      Card({ semantics: { id: "status-card", label: "Connection status", role: "alert" }, children: [
        Text({ children: "Online" }),
      ] }),
      Card({ children: [Text({ children: "decorative body" })] }),
    ] }));
    const card = nodes(scene).find((n) => n.id === "status-card")!;
    expect(card.role).toBe("alert");
    expect(card.liveRegion).toBe(true); // implied by the alert role
    // The opted-out card emits NO container node of its own; both cards'
    // inner text still announces individually.
    expect(nodes(scene).filter((n) => n.role === "container" || n.role === "alert" || n.role === "group")).toHaveLength(1);
    expect(nodes(scene).some((n) => n.label === "Online")).toBe(true);
    expect(nodes(scene).some((n) => n.label === "decorative body")).toBe(true);
  });

  test("an app bar announces its title as a header and its menu as a button", () => {
    const scene = screen(Scaffold({ appBar: AppBar({ title: "Polytron", onMenu: () => {} }), children: Column({ children: [] }) }));
    const header = nodes(scene).find((n) => n.role === "header")!;
    expect(header.label).toBe("Polytron");
    const menu = nodes(scene).find((n) => n.label === "Menu")!;
    expect(menu.role).toBe("button");
    expect(menu.actions?.[0]).toMatchObject({ name: "press" });
  });

  test("scroll-region content nodes carry the region tag, like their taps", () => {
    const scene = screen(Scaffold({ children: Column({ children: [
      Text({ children: "outside" }),
      Expanded({ child: ScrollView({ id: "checklist", children: [
        Button({ onPress: () => {}, children: "Item 1" }),
      ] }) }),
    ] }) }));
    const inScroll = nodes(scene).find((n) => n.label === "Item 1")!;
    expect(inScroll.scroll).toBe("checklist");
    expect(inScroll.bounds.y).toBe(0); // content-space coordinates
    expect(nodes(scene).find((n) => n.label === "outside")!.scroll).toBeUndefined();
  });

  test("ids are stable across identical re-renders and honor explicit overrides", () => {
    const tree = Column({ children: [
      Text({ semanticsId: "named", children: "Sticky" }),
      Button({ onPress: () => {}, children: "B" }),
    ] });
    const first = layoutScreen({}, tree as never, viewport).scene;
    const second = layoutScreen({}, tree as never, viewport).scene;
    expect(nodes(first).map((n) => n.id)).toEqual(nodes(second).map((n) => n.id));
    expect(nodes(first).some((n) => n.id === "named")).toBe(true);
    // Byte-identical semantics across hosts: the projection is a pure
    // function of the scene (no epoch counters ride the wire).
    expect(JSON.stringify(first.semantics)).toBe(JSON.stringify(second.semantics));
  });
});

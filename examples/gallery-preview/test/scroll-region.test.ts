import { describe, expect, test } from "bun:test";
import { defineScreen, type ScreenActionContext } from "@tenunjs/core";
import { jsx, jsxs } from "@tenunjs/jsx-runtime";
import {
  ApplicationRuntime, Button, Column, Container, Expanded, ScrollView, Text, TextField,
  defineTheme, installHostHandoff, layoutScreen,
  type DisplayListScene, type DisplayOp, type SerializedTap, type TextInputOp,
} from "@tenunjs/widgets";
import { CanvasPreviewRenderer, sceneContractError } from "../renderer";
import { BrowserTextInput } from "../text-input";

// Real widgets and lowering; only the paint surface is a recording fake.
// The context logs rect/clip/text coordinates in CANVAS space, which under
// the render() transform equals scene space at scale 1 — the same harness
// shape the readiness probes used to expose the TN-166 defects.

interface Recorded {
  kind: "clip-rect" | "paint-rect" | "paint-text";
  x: number;
  y: number;
  w?: number;
  h?: number;
  text?: string;
}

function recordingCanvas(width: number, height: number): { canvas: HTMLCanvasElement; logs: Recorded[] } {
  const logs: Recorded[] = [];
  let matrix = { x: 0, y: 0, sx: 1, sy: 1 };
  const states: typeof matrix[] = [];
  const context = {
    setTransform(_a: number, _b: number, _c: number, _d: number, x: number, y: number) { matrix = { x, y, sx: 1, sy: 1 }; },
    save() { states.push({ ...matrix }); },
    restore() { matrix = states.pop()!; },
    scale() {},
    translate(x: number, y: number) { matrix = { x: matrix.x + x, y: matrix.y + y, sx: 1, sy: 1 }; },
    clearRect() {}, fillRect() {}, beginPath() {}, clip() {}, fill() {}, stroke() {},
    moveTo() {}, lineTo() {}, arc() {},
    rect(x: number, y: number, w: number, h: number) { logs.push({ kind: "clip-rect", x: matrix.x + x, y: matrix.y + y, w, h }); },
    roundRect(x: number, y: number, w: number, h: number) { logs.push({ kind: "paint-rect", x: matrix.x + x, y: matrix.y + y, w, h }); },
    fillText(text: string, x: number, y: number) { logs.push({ kind: "paint-text", text, x: matrix.x + x, y: matrix.y + y }); },
    measureText(text: string) { return { width: text.length * 8 }; },
  };
  const canvas = {
    width, height, clientWidth: width, clientHeight: height,
    getContext: () => context,
    getBoundingClientRect: () => ({ left: 0, top: 0, width, height }),
  } as unknown as HTMLCanvasElement;
  (globalThis as { window?: unknown }).window = { devicePixelRatio: 1 };
  return { canvas, logs };
}

const theme = defineTheme({} as never) as unknown as Record<string, unknown>;
const viewport = { width: 300, height: 500 };
const buttons = (n: number) => Array.from({ length: n }, (_, i) =>
  jsx(Button, { children: `task ${i}`, onPress: () => {} }));
type LaidOut = ReturnType<typeof layoutScreen>;

function layOut(children: ReturnType<typeof buttons>): { scene: DisplayListScene } {
  return layoutScreen(
    { colors: { surface: "#101014", text: "#FFFFFF", accent: "#3366FF" } } as never,
    jsxs(Container, { padding: 20, children: jsxs(Column, { align: "stretch", children: [
      jsx(Text, { children: "header" }),
      jsx(Expanded, { child: jsx(ScrollView, { id: "positioned", children }) }),
    ] }) }),
    viewport
  ) as unknown as LaidOut;
}

function regionOf(scene: DisplayListScene): Extract<DisplayOp, { op: "scroll-region" }> {
  const region = scene.ops.find((op): op is Extract<DisplayOp, { op: "scroll-region" }> => op.op === "scroll-region");
  if (!region) throw new Error("scene has no scroll region");
  return region;
}

describe("browser scroll-region paint, hit-testing, and offset lifecycle (TN-166)", () => {
  test("positioned region children paint at the region origin, inside the region clip", () => {
    const { canvas, logs } = recordingCanvas(300, 500);
    const renderer = new CanvasPreviewRenderer(canvas);
    const scene = layOut(buttons(10)).scene;
    const region = regionOf(scene);
    expect(region.x).toBe(20);
    expect(region.y).toBe(44); // 20 padding + header line

    renderer.render(scene, 0);
    // Pre-TN-166 the first child painted at (0,0) — outside the region's
    // clip at (20,44) — invisible content whose taps still hit.
    const firstRect = logs.find((l) => l.kind === "paint-rect")!;
    expect([firstRect.x, firstRect.y]).toEqual([20, 44]);
    const firstText = logs.find((l) => l.kind === "paint-text" && l.text === "task 0")!;
    expect(firstText.x).toBeGreaterThan(region.x);
    expect(firstText.y).toBeGreaterThan(region.y);
    const clip = logs.find((l) => l.kind === "clip-rect" && l.x === region.x && l.y === region.y)!;
    expect(clip.w).toBe(region.w);
    // The same scene point that paints is the one that hit-tests.
    expect(renderer.hitTest(scene, region.x + 20, region.y + 10, 0, "tap")).not.toBeNull();
  });

  test("a stored offset left over from taller content normalizes on render and hit-testing agrees", () => {
    const { canvas } = recordingCanvas(300, 500);
    const renderer = new CanvasPreviewRenderer(canvas);
    const long = layOut(buttons(20)).scene;
    const short = layOut(buttons(8)).scene;
    const shortRegion = regionOf(short);
    const maxOffset = shortRegion.contentHeight - shortRegion.h;

    renderer.setRegionOffset(long, "positioned", 700);
    expect(renderer.regionOffset("positioned")).toBeGreaterThan(maxOffset); // the stale precondition
    renderer.render(short, 0);
    // The stored offset is normalized to THIS scene's bounds...
    expect(renderer.regionOffset("positioned")).toBe(maxOffset);
    // ...and the row visible at the region's top is hittable exactly where
    // it paints. Pre-TN-166 painting clamped locally while hit-testing read
    // the raw stored 700, so a tap on the visible top row returned nothing.
    const contentX = 10; // region.x + 10 minus region.x
    const contentY = 10 + maxOffset; // the content row under the region's top edge
    const expected = short.taps.findIndex((tap: SerializedTap) => tap.scroll === "positioned" &&
      tap.x <= contentX && contentX <= tap.x + tap.w && tap.y <= contentY && contentY <= tap.y + tap.h);
    expect(expected).toBeGreaterThanOrEqual(0);
    const hit = renderer.hitTest(short, shortRegion.x + 10, shortRegion.y + 10, 0, "tap");
    expect(hit).toBe(expected);
  });
});

// --- nested editor discovery through the real widget handoff ---

class InputElement extends EventTarget {
  value = "";
  selectionStart = 0;
  selectionEnd = 0;
  selectionDirection = "none";
  style: Record<string, string> = {};
  attributes: Record<string, string> = {};
  constructor(readonly owner: TestDocument) { super(); }
  setAttribute(name: string, value: string) { this.attributes[name] = value; }
  setSelectionRange(start: number, end: number, direction = "none") {
    this.selectionStart = start; this.selectionEnd = end; this.selectionDirection = direction;
  }
  focus() { this.owner.activeElement = this; }
  blur() { if (this.owner.activeElement === this) this.owner.activeElement = null; }
  remove() { this.owner.inputs = this.owner.inputs.filter((input) => input !== this); }
}

class TestDocument extends EventTarget {
  activeElement: InputElement | null = null;
  inputs: InputElement[] = [];
  body = { appendChild: (input: InputElement) => { this.inputs.push(input); return input; } };
  createElement(name: string) {
    if (name !== "input") throw new Error(`Unexpected platform element: ${name}`);
    return new InputElement(this);
  }
}

interface EditorState { title: string }
const editorScreen = defineScreen({
  name: "Editor",
  initialState: (): EditorState => ({ title: "Plan" }),
  actions: {
    change({ state, input }: ScreenActionContext<EditorState>) { state.title = input as string; },
  },
  view({ state, actions }) {
    return jsx(ScrollView, { id: "editor-list", children:
      jsx(TextField, { id: "title", label: "Title", value: state.title, onChanged: actions.change }) });
  },
});

function nestedFixture(regionScroll: number) {
  const app: ApplicationRuntime = new ApplicationRuntime({
    screens: { editor: editorScreen }, initial: "editor", theme: defineTheme({}),
    viewport: { width: 360, height: 640 },
  });
  let scene: DisplayListScene;
  const handoff = installHostHandoff({ app, commit: (json) => { scene = JSON.parse(json); } });
  const dom = new TestDocument();
  const errors: string[] = [];
  const bridge = new BrowserTextInput({
    canvas: { getBoundingClientRect: () => ({ left: 10, top: 20, width: 360, height: 640 }) } as HTMLCanvasElement,
    document: dom as unknown as Document,
    dispatch: handoff.dispatch,
    scene: () => scene,
    onError: (message) => errors.push(message),
    regionOffset: () => regionScroll,
  });
  const field = () => {
    const region = scene.ops.find((op): op is Extract<DisplayOp, { op: "scroll-region" }> => op.op === "scroll-region");
    if (!region) throw new Error("nested fixture scene has no scroll region");
    return region.ops.find((op): op is TextInputOp => op.op === "text-input")!;
  };
  const region = () => {
    const found = scene.ops.find((op): op is Extract<DisplayOp, { op: "scroll-region" }> => op.op === "scroll-region");
    if (!found) throw new Error("nested fixture scene has no scroll region");
    return found;
  };
  return { app, handoff, dom, bridge, errors, field, region, scene: () => scene };
}

describe("browser nested text input inside a scroll region (TN-166)", () => {
  test("a focused TextField inside a ScrollView adopts and positions a platform editor", () => {
    const f = nestedFixture(30);
    const op = f.field();
    const tap = f.scene().taps.find((t) => t.scroll === "editor-list" &&
      t.x <= op.x + 1 && t.y <= op.y + 1 && t.x + t.w > op.x + 1 && t.y + t.h > op.y + 1)!;
    f.handoff.dispatch("TAP", JSON.stringify(tap.payload));
    f.bridge.sync();
    // Pre-TN-166 root-only discovery found no descriptor and no editor
    // element was ever created for this focused field.
    expect(f.dom.inputs).toHaveLength(1);
    expect(f.field().focused).toBe(true);
    // The editor overlays the field's ON-SCREEN position: region origin
    // plus content coordinates minus the region's paint offset.
    const region = f.region();
    const input = f.dom.inputs[0]!;
    expect(input.style.left).toBe(`${10 + (region.x + op.x) * 1}px`);
    expect(input.style.top).toBe(`${20 + (region.y + op.y - 30) * 1}px`);
    input.value = "typed in the scrolled list";
    input.setSelectionRange(input.value.length, input.value.length);
    input.dispatchEvent(new Event("input", { cancelable: true }));
    expect((f.app.exportState().states.editor as EditorState).title).toBe("typed in the scrolled list");
    expect(f.errors).toEqual([]);
    f.bridge.dispose();
  });

  test("nested contract violations reject the whole browser scene like Android", () => {
    const f = nestedFixture(0);
    // Focus the field through its real tap region so the committed scene
    // carries a focused nested descriptor, exactly like a user session.
    const op = f.field();
    const tap = f.scene().taps.find((t) => t.scroll === "editor-list" &&
      t.x <= op.x + 1 && t.y <= op.y + 1 && t.x + t.w > op.x + 1 && t.y + t.h > op.y + 1)!;
    f.handoff.dispatch("TAP", JSON.stringify(tap.payload));
    const scene = f.scene();
    const base = JSON.parse(JSON.stringify(scene)) as DisplayListScene;
    expect(sceneContractError(base)).toBeNull();
    const region = base.ops.find((op): op is Extract<DisplayOp, { op: "scroll-region" }> => op.op === "scroll-region")!;
    const nested = region.ops.find((candidate): candidate is TextInputOp => candidate.op === "text-input")!;
    expect(nested.focused).toBe(true);

    const invalidSelection = JSON.parse(JSON.stringify(base)) as DisplayListScene;
    (((invalidSelection.ops[0] as Extract<DisplayOp, { op: "scroll-region" }>).ops.find((c): c is TextInputOp => c.op === "text-input"))!).selection = { base: -1, extent: 0 };
    expect(sceneContractError(invalidSelection)).toContain("invalid text input");
    expect(sceneContractError(invalidSelection)).toContain("editor-list");

    const duplicate = JSON.parse(JSON.stringify(base)) as DisplayListScene;
    (duplicate.ops as DisplayOp[]).push(JSON.parse(JSON.stringify(nested)));
    expect(sceneContractError(duplicate)).toContain("duplicate text input id");

    const secondFocused = JSON.parse(JSON.stringify(base)) as DisplayListScene;
    (secondFocused.ops as DisplayOp[]).push({ ...JSON.parse(JSON.stringify(nested)), id: "other" });
    expect(sceneContractError(secondFocused)).toContain("more than one focused");

    const badClip = JSON.parse(JSON.stringify(base)) as DisplayListScene;
    ((badClip.ops[0] as Extract<DisplayOp, { op: "scroll-region" }>).ops as DisplayOp[]).unshift({
      op: "text", text: "bad", x: 0, y: 20, size: 17, weight: 400, color: "#FFFFFF",
      clip: { x: 0, y: 0, w: -1, h: 20 },
    } as DisplayOp);
    expect(sceneContractError(badClip)).toContain("invalid text clip");
    expect(sceneContractError(badClip)).toContain("editor-list");
    f.bridge.dispose();
  });
});

import { describe, expect, test } from "bun:test";
import { defineScreen } from "@tenunjs/core";
import {
  ApplicationRuntime, Column, Text, defineTheme, installHostHandoff,
  type DisplayListScene,
} from "@tenunjs/widgets";
import { CanvasPreviewRenderer, sceneContractError } from "../renderer";

// Recorded-canvas harness (the scroll-region suite's shape): the context
// logs fill/translate/alpha operations so transition frames are assertable
// as coordinates, not pixels.

interface FrameOp { kind: "translate" | "alpha" | "fill" | "text"; a?: number; b?: number; text?: string }

function recordingCanvas(width: number, height: number): { canvas: HTMLCanvasElement; ops: FrameOp[] } {
  const ops: FrameOp[] = [];
  let matrix = { x: 0, y: 0 };
  const states: typeof matrix[] = [];
  let alpha = 1;
  const context = {
    setTransform() { matrix = { x: 0, y: 0 }; alpha = 1; },
    save() { states.push({ ...matrix }); },
    restore() { if (states.length) matrix = states.pop()!; },
    scale() {}, clip() {}, beginPath() {}, rect() {}, clearRect() {}, fill() {}, stroke() {},
    moveTo() {}, lineTo() {}, arc() {}, roundRect() {},
    fillRect(a: number, b: number) { ops.push({ kind: "fill", a: matrix.x + a, b: matrix.y + b }); },
    fillText(text: string, a: number, b: number) { ops.push({ kind: "text", text, a: matrix.x + a, b: matrix.y + b }); },
    translate(a: number, b: number) { matrix = { x: matrix.x + a, y: matrix.y + b }; ops.push({ kind: "translate", a: matrix.x, b: matrix.y }); },
    measureText(text: string) { return { width: text.length * 8 }; },
  };
  Object.defineProperty(context, "globalAlpha", {
    get: () => alpha,
    set: (value: number) => { alpha = value; ops.push({ kind: "alpha", a: value }); },
  });
  const canvas = {
    width, height, clientWidth: width, clientHeight: height,
    getContext: () => context,
    getBoundingClientRect: () => ({ left: 0, top: 0, width, height }),
  } as unknown as HTMLCanvasElement;
  (globalThis as { window?: unknown }).window = { devicePixelRatio: 1 };
  return { canvas, ops };
}

/** Manual rAF pump: callbacks run in generations — one advance() drains
 *  the entries queued so far; anything they schedule runs on the NEXT
 *  generation (fuel-capped so a runaway loop fails instead of hanging). */
function framePump() {
  let now = 0;
  let pending: Array<{ id: number; callback: (t: number) => void }> = [];
  let nextId = 1;
  return {
    raf: (callback: (t: number) => void) => {
      const entry = { id: nextId++, callback };
      pending.push(entry);
      return entry.id;
    },
    cancel: (h: number) => { pending = pending.filter((entry) => entry.id !== h); },
    now: () => now,
    advance(ms: number): void {
      now += ms;
      let fuel = 100;
      while (pending.length > 0 && fuel-- > 0) {
        const batch = pending;
        pending = [];
        for (const entry of batch) entry.callback(now);
      }
    },
  };
}

const theme = defineTheme({});
const screen = (label: string) => defineScreen({
  name: label, initialState: () => ({}), actions: {}, view: () => Text({ children: label }),
});

function sceneWith(label: string, transition?: DisplayListScene["transition"]): DisplayListScene {
  const app = new ApplicationRuntime({
    screens: { a: screen("A-route"), b: screen("B-route") }, initial: "a", theme,
    viewport: { width: 300, height: 500 },
  });
  if (transition) app.navigate("b", { transition });
  const scene = app.render().scene;
  return JSON.parse(JSON.stringify(scene).replace('"A-route"', `"${label}"`));
}

describe("browser host-evaluated route transitions (TN-169)", () => {
  test("slide forward: outgoing scene exits left as the incoming enters from the right", () => {
    const { canvas, ops } = recordingCanvas(300, 500);
    const pump = framePump();
    const renderer = new CanvasPreviewRenderer(canvas, { raf: pump.raf, cancelRaf: pump.cancel, now: pump.now });
    const from = sceneWith("A-route");
    const to = sceneWith("B-route", { kind: "slide", direction: "forward", durationMs: 240 });
    renderer.render(from, 0);
    ops.length = 0;
    renderer.render(to, 0);
    // First frame at t=0: incoming fully off-screen right (translate ≈ width).
    const earlyTranslates = ops.filter((o) => o.kind === "translate");
    expect(earlyTranslates.some((o) => o.a !== undefined && Math.abs(o.a - 300) < 1)).toBe(true);
    pump.advance(240);
    // Final frame: the settled incoming scene at translate 0 (its own text
    // paints at x=0 again) and the outgoing scene is gone.
    const finalTexts = ops.filter((o) => o.kind === "text").map((o) => o.text);
    expect(finalTexts).toContain("B-route");
    const lateTranslates = ops.filter((o) => o.kind === "translate" && o.a === 0);
    expect(lateTranslates.length).toBeGreaterThan(0);
  });

  test("fade cross-fades alpha between the two scenes", () => {
    const { canvas, ops } = recordingCanvas(300, 500);
    const pump = framePump();
    const renderer = new CanvasPreviewRenderer(canvas, { raf: pump.raf, cancelRaf: pump.cancel, now: pump.now });
    renderer.render(sceneWith("A-route"), 0);
    ops.length = 0;
    renderer.render(sceneWith("B-route", { kind: "fade", direction: "forward", durationMs: 200 }), 0);
    pump.advance(100); // midway
    const alphas = ops.filter((o) => o.kind === "alpha").map((o) => o.a);
    expect(alphas).toContain(0.5); // transitionEasing(0.5) === 0.5
    expect(alphas.some((a) => a !== undefined && a > 0 && a < 1)).toBe(true);
    pump.advance(100);
    const texts = ops.filter((o) => o.kind === "text").map((o) => o.text);
    expect(texts).toContain("B-route");
  });

  test("a plain commit mid-transition cuts to the new scene", () => {
    const { canvas, ops } = recordingCanvas(300, 500);
    const pump = framePump();
    const renderer = new CanvasPreviewRenderer(canvas, { raf: pump.raf, cancelRaf: pump.cancel, now: pump.now });
    renderer.render(sceneWith("A-route"), 0);
    renderer.render(sceneWith("B-route", { kind: "slide", direction: "forward", durationMs: 500 }), 0);
    pump.advance(100); // mid-flight
    ops.length = 0;
    const plain = sceneWith("C-route");
    renderer.render(plain, 0);
    pump.advance(1000); // nothing left to animate
    const texts = ops.filter((o) => o.kind === "text").map((o) => o.text);
    expect(texts).toContain("C-route");
    expect(texts).not.toContain("B-route");
  });

  test("a malformed transition block rejects the whole scene", () => {
    const good = sceneWith("A-route", { kind: "fade", direction: "forward", durationMs: 200 });
    expect(sceneContractError(good)).toBeNull();
    expect(sceneContractError({ ...good, transition: { kind: "zoom" } as never })).toContain("transition");
    expect(sceneContractError({ ...good, transition: { kind: "fade", durationMs: 0, direction: "forward" } as never }))
      .toContain("durationMs");
    expect(sceneContractError({ ...good, transition: [] as never })).toContain("transition");
  });
});

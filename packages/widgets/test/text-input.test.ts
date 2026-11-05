import { describe, expect, test } from "bun:test";
import { defineScreen } from "@tenunjs/core";
import { jsx, jsxs, type WidgetNode } from "@tenunjs/jsx-runtime";
import {
  ApplicationRuntime, ApplicationRuntimeError, Canvas, Column, Container, SizedBox, Text,
  TextField, TextInputError, installHostHandoff, layoutScreen, numericDraftError,
  resolveTextFieldProps, textInputContractError, validateTextEditEvent, validateTextInputOp,
  type CanvasProps, type DisplayListScene, type TextEditEvent, type TextFieldProps,
  type TextInputErrorCode, type TextInputOp,
} from "../src/index";

const theme = { colors: { surface: "#101014", text: "#FFFFFF", accent: "#3366FF" } };

function expectCode(run: () => unknown, code: TextInputErrorCode): void {
  try { run(); } catch (error) {
    expect(error).toBeInstanceOf(TextInputError);
    if (!(error instanceof TextInputError)) throw error;
    expect(error.code).toBe(code);
    return;
  }
  throw new Error(`Expected ${code}`);
}

function descriptor(overrides: Partial<TextInputOp> = {}): TextInputOp {
  return { op: "text-input", id: "title", x: 10, y: 20, w: 280, h: 72,
    text: "A😀e\u0301 אב", selection: { base: 8, extent: 3 }, composing: { start: 3, end: 5 },
    focused: true, sessionId: 1, revision: 2, keyboardType: "text", returnAction: "done",
    readOnly: false, label: "Title", ...overrides };
}

function identity(op: TextInputOp) {
  return { id: op.id, sessionId: op.sessionId, baseRevision: op.revision };
}

function edit(op: TextInputOp, text: string, patch: Partial<TextEditEvent> = {}): TextEditEvent {
  return { ...identity(op), text, selection: { base: text.length, extent: text.length }, composing: null, ...patch };
}

function fixture(transform: (value: string) => string = (value) => value) {
  const state = { value: "Plan", other: "Other", visible: true, readOnly: false, duplicate: false };
  const changed: string[] = [];
  const submitted: string[] = [];
  let componentCalls = 0;
  function Field() {
    componentCalls++;
    return jsx(TextField, { id: "title", value: state.value, label: "Title", readOnly: state.readOnly,
      onChanged: (value: string) => { changed.push(value); state.value = transform(value); },
      onSubmitted: () => { submitted.push(state.value); } });
  }
  const screen = defineScreen({
    name: "Editor", initialState: () => state, actions: {},
    view: () => jsxs(Column, { padding: 10, gap: 8, children: [
      state.visible ? jsx(Field, {}) : null,
      jsx(TextField, { id: "other", value: state.other, onChanged: (value: string) => { state.other = value; } }),
      state.duplicate ? jsx(TextField, { id: "title", value: "duplicate", onChanged: () => undefined }) : null,
    ] }),
  });
  const away = defineScreen({ name: "Away", initialState: () => ({}), actions: {},
    view: () => jsx(Text, { children: "Away" }) });
  const app = new ApplicationRuntime({ screens: { editor: screen, away }, initial: "editor", theme,
    viewport: { width: 320, height: 480 } });
  const commits: string[] = [];
  const handoff = installHostHandoff({ app, commit: (json) => commits.push(json) });
  const scene = (): DisplayListScene => JSON.parse(commits.at(-1)!);
  const field = (id = "title"): TextInputOp => {
    const op = scene().ops.find((op): op is TextInputOp => op.op === "text-input" && op.id === id);
    if (!op) throw new Error(`Missing field ${id}`);
    return op;
  };
  const focus = (id = "title"): TextInputOp => {
    const op = field(id);
    const tap = scene().taps.find((tap) => tap.x === op.x && tap.y === op.y && tap.w === op.w && tap.h === op.h);
    if (!tap) throw new Error(`Missing focus tap ${id}`);
    handoff.dispatch("TAP", JSON.stringify(tap.payload));
    return field(id);
  };
  const dispatch = (action: string, payload: unknown) => handoff.dispatch(action, JSON.stringify(payload));
  return { app, handoff, state, changed, submitted, commits, scene, field, focus, dispatch,
    componentCalls: () => componentCalls };
}

describe("TN-160 text input boundary", () => {
  test("descriptor validates full UTF-16 editing state and snapshots nested ranges", () => {
    const source = descriptor();
    const result = validateTextInputOp(source);
    expect(result).toEqual(source);
    expect(result).not.toBe(source);
    expect(result.selection).not.toBe(source.selection);
    expect(result.composing).not.toBe(source.composing);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.selection)).toBe(true);
    expect(Object.isFrozen(result.composing)).toBe(true);
    expect(textInputContractError(source)).toBe(null);
    // Offsets are UTF-16 code units, not a claim about grapheme segmentation.
    expect(validateTextInputOp(descriptor({ selection: { base: 2, extent: 2 } })).selection.base).toBe(2);
  });

  test("malformed descriptors fail before any candidate is adopted", () => {
    for (const patch of [
      { id: " " }, { x: NaN }, { y: Infinity }, { w: -1 }, { h: -1 },
      { text: 1 }, { selection: { base: -1, extent: 0 } }, { selection: { base: 0, extent: 99 } },
      { selection: { base: 0.5, extent: 1 } }, { composing: { start: 3, end: 3 } },
      { composing: { start: 4, end: 2 } }, { composing: { start: 0, end: 99 } },
      { composing: undefined }, { focused: true, sessionId: 0 }, { focused: false },
      { sessionId: Number.MAX_SAFE_INTEGER + 1 }, { revision: -1 }, { revision: 1.2 },
      { readOnly: true }, { keyboardType: "password" }, { returnAction: "send" },
      { label: null }, { fixed: 1 }, { anchor: "left" }, { anchorSize: Infinity },
    ]) {
      expectCode(() => validateTextInputOp({ ...descriptor(), ...patch }), "INVALID_TEXT_INPUT");
      expect(textInputContractError({ ...descriptor(), ...patch })).not.toBe(null);
    }
  });

  test("getter inputs are read once and copied before validation", () => {
    let reads = 0;
    const source = { ...descriptor(), get text() { reads++; return reads === 1 ? "Plan" : ""; },
      selection: { base: 4, extent: 4 }, composing: null };
    expect(validateTextInputOp(source).text).toBe("Plan");
    expect(reads).toBe(1);
  });

  test("edit identity and ranges reject malformed input without coercion", () => {
    const event = edit(descriptor(), "日本語 😀");
    expect(validateTextEditEvent(event)).toEqual(event);
    for (const patch of [{ id: "" }, { sessionId: 0 }, { sessionId: "1" },
      { baseRevision: -1 }, { baseRevision: Number.MAX_SAFE_INTEGER + 1 },
      { selection: { base: 99, extent: 0 } }, { composing: { start: 0, end: 0 } }]) {
      expectCode(() => validateTextEditEvent({ ...event, ...patch }), "INVALID_TEXT_EDIT");
    }
  });

  test("single-line text rejects CR/LF at every boundary without normalizing composition", () => {
    for (const text of ["a\nb", "a\rb", "a\r\nb"]) {
      expectCode(() => TextField({ id: "title", value: text, onChanged: () => undefined }), "INVALID_TEXT_FIELD");
      expectCode(() => validateTextInputOp(descriptor({ text, selection: { base: 0, extent: 0 }, composing: null })), "INVALID_TEXT_INPUT");
      expectCode(() => validateTextEditEvent(edit(descriptor(), text, { composing: { start: 0, end: text.length } })), "INVALID_TEXT_EDIT");
      const f = fixture();
      const active = f.focus();
      expectCode(() => f.dispatch("TEXT_EDIT", edit(active, text)), "INVALID_TEXT_EDIT");
      expect(f.state.value).toBe("Plan");
      expect(f.changed).toEqual([]);
    }
  });

  test("public widget props are validated and the controller callback stays typed", () => {
    const valid: TextFieldProps = { id: "title", value: "", onChanged: (value) => { value.toUpperCase(); } };
    expect(TextField(valid).children).toEqual([]);
    for (const patch of [{ id: "" }, { value: null }, { onChanged: null }, { readOnly: "true" },
      { label: 7 }, { placeholder: [] }, { onSubmitted: true }]) {
      expectCode(() => TextField({ ...valid, ...patch } as TextFieldProps), "INVALID_TEXT_FIELD");
    }
    if (false) {
      // @ts-expect-error onChanged receives a string, not a platform event object.
      TextField({ id: "bad", value: "", onChanged: (_value: number) => undefined });
      // @ts-expect-error a controlled value is required.
      TextField({ id: "bad", onChanged: () => undefined });
    }
  });

  test("native-visible error messages include the exact stable failure code", () => {
    const error = new TextInputError("STALE_TEXT_SESSION", "callback belongs to an ended session");
    expect(error.message).toBe("[TENUN_TEXT_INPUT] STALE_TEXT_SESSION: callback belongs to an ended session");
  });
});

describe("TN-160 ordinary TextField lowering", () => {
  test("emits a required input descriptor and matching ordinary focus tap", () => {
    const f = fixture();
    expect(f.field()).toMatchObject({ x: 10, y: 10, w: 300, h: 72, text: "Plan",
      label: "Title", focused: false, sessionId: 0, revision: 0, composing: null });
    expect(f.scene().ops.some((op) => op.op === "text" && op.text === "Plan")).toBe(true);
    expect(f.componentCalls()).toBe(1);
    const first = f.focus();
    expect(first.focused).toBe(true);
    expect(first.sessionId).toBeGreaterThan(0);
    expect(first.revision).toBe(0);
    expect(f.scene().ops.some((op) => op.op === "line" && op.x1 === op.x2)).toBe(true);
    expect(f.focus().sessionId).toBe(first.sessionId);
  });

  test("duplicate field ids reject a whole render without replacing the prior table", () => {
    const f = fixture();
    const active = f.focus();
    f.state.duplicate = true;
    expectCode(() => f.app.render(), "DUPLICATE_TEXT_FIELD");
    expect(f.field()).toEqual(active);
    f.state.duplicate = false;
    f.dispatch("TEXT_EDIT", edit(active, "accepted"));
    expect(f.state.value).toBe("accepted");
  });

  test("standalone lowering does not pretend it can activate an edit session", () => {
    const result = layoutScreen(theme, jsx(TextField, { id: "name", value: "", onChanged: () => undefined }));
    expectCode(() => result.tapRuns[0]!(), "TEXT_INPUT_RUNTIME_REQUIRED");
    const readOnly = layoutScreen(theme, jsx(TextField, { id: "name", value: "Ada", readOnly: true, onChanged: () => undefined }));
    expect(readOnly.scene.taps).toEqual([]);
  });

  test("narrow fields retain full text and hard-clip label/value ink independently of approximate widths", () => {
    const value = "WWWWWWWWWWWW 😀";
    const result = layoutScreen(theme, jsx(SizedBox, { width: 90, height: 72,
      child: jsx(TextField, { id: "title", label: "WWWWWWWWWWW", value, onChanged: () => undefined }) }));
    const input = result.scene.ops.find((op) => op.op === "text-input")!;
    expect(input).toMatchObject({ text: value, w: 90 });
    const texts = result.scene.ops.filter((op) => op.op === "text");
    expect(texts).toHaveLength(2);
    for (const text of texts) {
      expect(text.clip).toEqual({ x: 12, y: 2, w: 66, h: 68 });
    }
  });

  test("field surfaces and visible text use the current light/dark theme pair", () => {
    for (const colors of [
      { surface: "#F4F7FC", surfaceRaised: "#FFFFFF", text: "#1B243B" },
      { surface: "#101014", surfaceRaised: "#232330", text: "#F2F2F7" },
    ]) {
      const node = jsx(TextField, { id: "title", label: "Title", value: "Readable", onChanged: () => undefined });
      const scene = layoutScreen({ colors }, node, 320).scene;
      expect(scene.ops.find((op) => op.op === "rect")).toMatchObject({ color: colors.surfaceRaised });
      const texts = scene.ops.filter((op) => op.op === "text");
      expect(texts.every((op) => op.color === colors.text)).toBe(true);
      const fallback = layoutScreen({ colors: { surface: colors.surface, text: colors.text } }, node, 320).scene;
      expect(fallback.ops.find((op) => op.op === "rect")).toMatchObject({ color: colors.surface });
      const focused = layoutScreen({ colors }, node, 320, {
        active: { id: "title", sessionId: 1, revision: 0, text: "Readable",
          selection: { base: 0, extent: 4 }, composing: null }, focus: () => undefined,
      }).scene;
      const highlight = focused.ops.find((op) => op.op === "rect" && op.color === "#223354");
      const selectedText = focused.ops.find((op) => op.op === "text" && op.color === "#D6E4FF");
      if (highlight?.op !== "rect" || selectedText?.op !== "text") throw new Error("Selection paint pair is missing");
      expect(selectedText.text).toBe("Readable");
      expect(selectedText.clip).toEqual({ x: highlight.x, y: highlight.y, w: highlight.w, h: highlight.h });
    }
  });

  test("Canvas offsets translate text clips together and preserve fixed coordinates", () => {
    const clip = { x: 1, y: 2, w: 30, h: 15 };
    const makeCanvas = (fixed: boolean): WidgetNode => ({ kind: Canvas, key: null, children: [], props: {
      height: 30, fixed,
      paint: (_origin, put) => put({ op: "text", x: 3, y: 14, text: "W", size: 17, weight: 400, color: "#FFFFFF", clip }),
    } satisfies CanvasProps }) as unknown as WidgetNode;
    const normal = layoutScreen(theme, Container({ padding: 10, child: makeCanvas(false) })).scene;
    expect(normal.ops[0]).toMatchObject({ x: 13, y: 24, clip: { x: 11, y: 12, w: 30, h: 15 } });
    const fixed = layoutScreen(theme, Container({ padding: 10, child: makeCanvas(true) })).scene;
    expect(fixed.ops[0]).toMatchObject({ x: 3, y: 14, fixed: true, clip });
    expect(clip).toEqual({ x: 1, y: 2, w: 30, h: 15 });
  });
});

describe("TN-160 revisioned controlled edit sessions", () => {
  test("IME composition replaces text and commits without duplicating the composing span", () => {
    const f = fixture();
    let current = f.focus();
    for (const [text, composing] of [
      ["k", { start: 0, end: 1 }], ["ka", { start: 0, end: 2 }], ["か", null],
    ] as const) {
      f.dispatch("TEXT_EDIT", edit(current, text, { composing }));
      current = f.field();
      expect(current.text).toBe(text);
      expect(current.composing).toEqual(composing);
      expect(f.state.value).toBe(text);
    }
    expect(f.changed).toEqual(["k", "ka", "か"]);
    expect(current.revision).toBe(3);
  });

  test("directional selection, replacement, emoji, combining marks and bidi survive the handoff", () => {
    const f = fixture();
    let current = f.focus();
    const text = "A😀e\u0301 אב";
    f.dispatch("TEXT_EDIT", edit(current, text, { selection: { base: 8, extent: 3 }, composing: { start: 3, end: 5 } }));
    current = f.field();
    expect(current).toMatchObject({ text, selection: { base: 8, extent: 3 }, composing: { start: 3, end: 5 } });
    expect(f.scene().ops.some((op) => op.op === "rect" && op.r === 0 && op.w > 0)).toBe(true);
    f.dispatch("TEXT_EDIT", edit(current, "A😀Z", { selection: { base: 4, extent: 4 } }));
    expect(f.state.value).toBe("A😀Z");
    expect(f.field().composing).toBe(null);
  });

  test("selection/composition-only changes commit and advance revision without onChanged", () => {
    const f = fixture();
    let current = f.focus();
    f.dispatch("TEXT_EDIT", edit(current, "Plan", { selection: { base: 3, extent: 1 }, composing: { start: 1, end: 3 } }));
    current = f.field();
    expect(current.revision).toBe(1);
    expect(f.changed).toEqual([]);
    f.dispatch("TEXT_EDIT", edit(current, "Plan", { selection: current.selection }));
    expect(f.field().composing).toBe(null);
    expect(f.field().revision).toBe(2);
    expect(f.changed).toEqual([]);
  });

  test("stale revisions reject atomically and republish authoritative state", () => {
    const f = fixture();
    const first = f.focus();
    f.dispatch("TEXT_EDIT", edit(first, "new"));
    const before = f.commits.at(-1);
    expectCode(() => f.dispatch("TEXT_EDIT", edit(first, "stale")), "STALE_TEXT_REVISION");
    expect(f.state.value).toBe("new");
    expect(f.changed).toEqual(["new"]);
    expect(f.commits.at(-1)).toBe(before);
  });

  test("malformed editing ranges cannot change application state or commit a candidate", () => {
    const f = fixture();
    const first = f.focus();
    const before = f.commits.length;
    expectCode(() => f.dispatch("TEXT_EDIT", edit(first, "bad", { selection: { base: 99, extent: 0 } })), "INVALID_TEXT_EDIT");
    expect(f.state.value).toBe("Plan");
    expect(f.changed).toEqual([]);
    expect(f.commits).toHaveLength(before);
    expect(f.field()).toEqual(first);
  });

  test("controller overwrites clear composition and invalidate an old platform revision", () => {
    const f = fixture();
    const first = f.focus();
    f.dispatch("TEXT_EDIT", edit(first, "ka", { composing: { start: 0, end: 2 } }));
    const composing = f.field();
    // No host repaint has happened for this newer controlled value yet.
    f.state.value = "server";
    expectCode(() => f.dispatch("TEXT_EDIT", edit(composing, "old callback")), "STALE_TEXT_REVISION");
    expect(f.state.value).toBe("server");
    expect(f.field()).toMatchObject({ text: "server", composing: null, selection: { base: 6, extent: 6 } });
    expect(f.field().revision).toBeGreaterThan(composing.revision);
    expect(f.changed).toEqual(["ka"]);
  });

  test("a controlled callback can reject or replace a proposal and the committed descriptor wins", () => {
    const f = fixture((value) => value.toUpperCase());
    const first = f.focus();
    f.dispatch("TEXT_EDIT", edit(first, "new", { composing: { start: 0, end: 3 } }));
    expect(f.changed).toEqual(["new"]);
    expect(f.state.value).toBe("NEW");
    expect(f.field()).toMatchObject({ text: "NEW", composing: null, selection: { base: 3, extent: 3 } });
    expect(f.field().revision).toBe(2);
  });

  test("rerender and viewport reflow preserve the live session and composing ranges", () => {
    const f = fixture();
    f.dispatch("TEXT_EDIT", edit(f.focus(), "ka", { selection: { base: 1, extent: 2 }, composing: { start: 0, end: 2 } }));
    const before = f.field();
    f.app.render();
    f.app.setViewport({ width: 480, height: 300 });
    expect(f.field()).toMatchObject({ sessionId: before.sessionId, revision: before.revision,
      text: "ka", selection: before.selection, composing: before.composing, w: 460 });
  });

  test("focus transfer rejects the old connection without bleeding text into the next field", () => {
    const f = fixture();
    const first = f.focus();
    const second = f.focus("other");
    expect(second.sessionId).toBeGreaterThan(first.sessionId);
    expect(f.field()).toMatchObject({ focused: false, sessionId: 0, revision: 0, composing: null });
    expectCode(() => f.dispatch("TEXT_EDIT", edit(first, "wrong field")), "STALE_TEXT_SESSION");
    expectCode(() => f.dispatch("TEXT_BLUR", identity(first)), "STALE_TEXT_SESSION");
    expect(f.state).toMatchObject({ value: "Plan", other: "Other" });
    expect(f.field("other").focused).toBe(true);
  });

  test("explicit blur and done end sessions, retain controlled text, and submit once", () => {
    const f = fixture();
    const first = f.focus();
    f.dispatch("TEXT_BLUR", identity(first));
    expect(f.field().focused).toBe(false);
    expectCode(() => f.dispatch("TEXT_EDIT", edit(first, "late")), "STALE_TEXT_SESSION");
    const second = f.focus();
    f.dispatch("TEXT_SUBMIT", identity(second));
    expect(f.submitted).toEqual(["Plan"]);
    expect(f.field().focused).toBe(false);
    expectCode(() => f.dispatch("TEXT_SUBMIT", identity(second)), "STALE_TEXT_SESSION");
    expect(f.submitted).toEqual(["Plan"]);
  });

  test("removal and readOnly cancel editing before a queued callback can mutate state", () => {
    for (const change of ["visible", "readOnly"] as const) {
      const f = fixture();
      const active = f.focus();
      if (change === "visible") f.state.visible = false;
      else f.state.readOnly = true;
      expectCode(() => f.dispatch("TEXT_EDIT", edit(active, "late")), "STALE_TEXT_SESSION");
      expect(f.changed).toEqual([]);
      expect(f.state.value).toBe("Plan");
      expect(f.scene().ops.some((op) => op.op === "text-input" && op.focused)).toBe(false);
    }
  });

  test("navigation and snapshot restore never resurrect an old edit session", () => {
    const f = fixture();
    f.dispatch("TEXT_EDIT", edit(f.focus(), "retained"));
    const active = f.field();
    const snapshot = JSON.parse(JSON.stringify(f.app.exportState()));
    expect(Object.keys(snapshot).sort()).toEqual(["route", "stateSchema", "states"]);
    expect(JSON.stringify(snapshot)).not.toContain("sessionId");
    expect(JSON.stringify(snapshot)).not.toContain("composing");
    f.app.navigate("away");
    expectCode(() => f.dispatch("TEXT_EDIT", edit(active, "late")), "STALE_TEXT_SESSION");
    f.app.navigate("editor");
    f.dispatch("TENUN_RESTORE", snapshot);
    expect(f.field()).toMatchObject({ text: "retained", focused: false, sessionId: 0 });
    const next = f.focus();
    expect(next.sessionId).toBeGreaterThan(active.sessionId);
    f.dispatch("TENUN_RESTORE", snapshot);
    expectCode(() => f.dispatch("TEXT_EDIT", edit(next, "late restore")), "STALE_TEXT_SESSION");
  });

  test("invalid restore leaves a current session intact; disposal rejects all later input", () => {
    const f = fixture();
    const active = f.focus();
    expect(() => f.app.restore({ stateSchema: 999 })).toThrow(ApplicationRuntimeError);
    f.dispatch("TEXT_EDIT", edit(active, "valid"));
    const last = f.field();
    const before = f.commits.length;
    f.app.dispose();
    expect(() => f.dispatch("TEXT_EDIT", edit(last, "disposed"))).toThrow(ApplicationRuntimeError);
    expect(f.commits).toHaveLength(before);
    expect(f.changed).toEqual(["valid"]);
  });
});

describe("TN-160 numeric keyboard intent", () => {
  test("props default to text, reject unknown intents, and gate the initial value", () => {
    expectCode(() => resolveTextFieldProps({ id: "w", value: "0", onChanged: () => undefined,
      keyboardType: "phone" }), "INVALID_TEXT_FIELD");
    expectCode(() => resolveTextFieldProps({ id: "w", value: "abc", onChanged: () => undefined,
      keyboardType: "number" }), "INVALID_TEXT_CONTENT");
    const resolved = resolveTextFieldProps({ id: "w", value: "12.5", onChanged: () => undefined,
      keyboardType: "decimal" });
    expect(resolved.keyboardType).toBe("decimal");
    expect(resolveTextFieldProps({ id: "w", value: "x", onChanged: () => undefined }).keyboardType).toBe("text");
  });

  test("draft gate keeps editing intermediates and rejects out-of-contract content", () => {
    for (const draft of ["", "-", "42", "007", "-3"]) {
      expect(numericDraftError("number", draft)).toBe(null);
      expect(numericDraftError("decimal", draft)).toBe(null);
    }
    for (const draft of ["12.", "12,5", ".5", "-,", "12.", "1.0", "1,0"]) {
      expect(numericDraftError("decimal", draft)).toBe(null);
    }
    for (const [type, draft] of [
      ["number", "4.2"], ["number", "4,2"], ["number", "abc"], ["number", "1 2"], ["number", "1-2"],
      ["decimal", "1.2.3"], ["decimal", "1,2.3"], ["decimal", "12 kg"], ["decimal", "abc"], ["decimal", "1 2"],
    ] as const) {
      expect(numericDraftError(type, draft)).not.toBe(null);
    }
    expect(numericDraftError("text", "any text 🙂")).toBe(null);
  });

  test("lowering carries the numeric intent into the descriptor and wire validators accept it", () => {
    const state = { weight: "62.5" };
    const screen = defineScreen({ name: "W", initialState: () => state, actions: {},
      view: () => jsx(TextField, { id: "weight", value: state.weight, label: "Weight",
        keyboardType: "decimal", onChanged: (value: string) => { state.weight = value; } }) });
    const app = new ApplicationRuntime({ screens: { w: screen }, initial: "w", theme,
      viewport: { width: 320, height: 480 } });
    const commits: string[] = [];
    installHostHandoff({ app, commit: (json) => commits.push(json) });
    const op = (JSON.parse(commits.at(-1)!).ops as TextInputOp[]).find((op) => op.op === "text-input");
    expect(op).toMatchObject({ id: "weight", keyboardType: "decimal", returnAction: "done" });
    expect(validateTextInputOp(op!).keyboardType).toBe("decimal");
    expect(textInputContractError({ ...op, keyboardType: "phone" })).not.toBe(null);
    expectCode(() => validateTextInputOp({ ...op, text: "heavy", selection: { base: 5, extent: 5 } }),
      "INVALID_TEXT_CONTENT");
  });

  test("numeric fields keep decimal drafts through the session and reject letter edits without adopting them", () => {
    const state = { weight: "60" };
    const changed: string[] = [];
    const screen = defineScreen({ name: "W", initialState: () => state, actions: {},
      view: () => jsx(TextField, { id: "weight", value: state.weight, label: "Weight",
        keyboardType: "decimal", onChanged: (value: string) => { changed.push(value); state.weight = value; } }) });
    const app = new ApplicationRuntime({ screens: { w: screen }, initial: "w", theme,
      viewport: { width: 320, height: 480 } });
    const commits: string[] = [];
    const handoff = installHostHandoff({ app, commit: (json) => commits.push(json) });
    const scene = (): DisplayListScene => JSON.parse(commits.at(-1)!);
    const op = (): TextInputOp =>
      scene().ops.find((op): op is TextInputOp => op.op === "text-input" && op.id === "weight")!;
    const tap = scene().taps.find((tap) => tap.x === op().x && tap.w === op().w)!;
    handoff.dispatch("TAP", JSON.stringify(tap.payload));
    expect(op().focused).toBe(true);
    const active = op();

    // Trailing separator and locale-comma drafts are ordinary editing intermediates.
    for (const draft of ["6", "62", "62.", "62,5"]) {
      handoff.dispatch("TEXT_EDIT", JSON.stringify({ id: "weight", sessionId: active.sessionId,
        baseRevision: op().revision, text: draft, selection: { base: draft.length, extent: draft.length },
        composing: null }));
      expect(state.weight).toBe(draft);
    }

    // A paste-style letter leak fails closed: rejected, not adopted, authority intact.
    const authoritative = op();
    expectCode(() => handoff.dispatch("TEXT_EDIT", JSON.stringify({ id: "weight", sessionId: active.sessionId,
      baseRevision: authoritative.revision, text: "62,5kg", selection: { base: 6, extent: 6 },
      composing: null })), "INVALID_TEXT_CONTENT");
    expect(state.weight).toBe("62,5");
    expect(op()).toMatchObject({ text: "62,5", revision: authoritative.revision,
      sessionId: active.sessionId, focused: true });
  });
});

describe("TN-160 input action and focus transfer", () => {
  test("props default to done, reject unknown actions, and the descriptor carries next", () => {
    expectCode(() => resolveTextFieldProps({ id: "a", value: "x", onChanged: () => undefined,
      inputAction: "previous" }), "INVALID_TEXT_FIELD");
    const resolved = resolveTextFieldProps({ id: "a", value: "x", onChanged: () => undefined,
      inputAction: "next" });
    expect(resolved.inputAction).toBe("next");
    expect(resolveTextFieldProps({ id: "a", value: "x", onChanged: () => undefined }).inputAction).toBe("done");
    const op = validateTextInputOp({ ...descriptor(), returnAction: "next" });
    expect(op.returnAction).toBe("next");
    expect(textInputContractError({ ...descriptor(), returnAction: "send" })).not.toBe(null);
  });

  test("submit with next advances to the following editable field and stops at the end", () => {
    const state = { one: "1", two: "2", three: "3", locked: "r" };
    const screen = defineScreen({ name: "Flow", initialState: () => state, actions: {},
      view: () => jsxs(Column, { padding: 8, gap: 8, children: [
        jsx(TextField, { id: "one", value: state.one, inputAction: "next", onChanged: (v: string) => { state.one = v; } }),
        jsx(TextField, { id: "two", value: state.two, inputAction: "next", onChanged: (v: string) => { state.two = v; } }),
        jsx(TextField, { id: "locked", value: state.locked, readOnly: true, onChanged: (v: string) => { state.locked = v; } }),
        jsx(TextField, { id: "three", value: state.three, onChanged: (v: string) => { state.three = v; } }),
      ] }) });
    const app = new ApplicationRuntime({ screens: { flow: screen }, initial: "flow", theme,
      viewport: { width: 320, height: 480 } });
    const commits: string[] = [];
    const handoff = installHostHandoff({ app, commit: (json) => commits.push(json) });
    const fieldOp = (id: string): TextInputOp => {
      const op = (JSON.parse(commits.at(-1)!).ops as TextInputOp[]).find((op) => op.op === "text-input" && op.id === id);
      if (!op) throw new Error(`Missing field ${id}`);
      return op;
    };
    const focusViaTap = (id: string): TextInputOp => {
      const op = fieldOp(id);
      const tap = (JSON.parse(commits.at(-1)!).taps as Array<{ x: number; y: number; w: number; h: number; payload: { id: number } }>)
        .find((tap) => tap.x === op.x && tap.y === op.y && tap.w === op.w && tap.h === op.h);
      handoff.dispatch("TAP", JSON.stringify(tap!.payload));
      return fieldOp(id);
    };
    const active = focusViaTap("one");
    expect(active.returnAction).toBe("next");
    // IME NEXT: TEXT_SUBMIT advances past the readOnly field to "three"... no —
    // to the NEXT editable field in layout order, which is "two" ("locked" follows later).
    handoff.dispatch("TEXT_SUBMIT", JSON.stringify({ id: active.id, sessionId: active.sessionId, baseRevision: active.revision }));
    const afterOne = fieldOp("two");
    expect(afterOne.focused).toBe(true);
    expect(afterOne.sessionId).toBeGreaterThan(active.sessionId);
    expect(fieldOp("one").focused).toBe(false);
    // Chain: "two" also carries next → submit lands on "three".
    handoff.dispatch("TEXT_SUBMIT", JSON.stringify({ id: afterOne.id, sessionId: afterOne.sessionId, baseRevision: afterOne.revision }));
    expect(fieldOp("three").focused).toBe(true);
    expect(fieldOp("three").returnAction).toBe("done");
    // Submitting the last field just ends the session.
    const last = fieldOp("three");
    handoff.dispatch("TEXT_SUBMIT", JSON.stringify({ id: last.id, sessionId: last.sessionId, baseRevision: last.revision }));
    expect(fieldOp("three").focused).toBe(false);
  });

  test("submit with next when the origin field disappears leaves no session", () => {
    const state = { visible: true, a: "a", b: "b" };
    const screen = defineScreen({ name: "Vanish", initialState: () => state, actions: {},
      view: () => jsxs(Column, { padding: 8, gap: 8, children: [
        state.visible ? jsx(TextField, { id: "a", value: state.a, inputAction: "next",
          onSubmitted: () => { state.visible = false; }, onChanged: (v: string) => { state.a = v; } }) : null,
        jsx(TextField, { id: "b", value: state.b, onChanged: (v: string) => { state.b = v; } }),
      ] }) });
    const app = new ApplicationRuntime({ screens: { v: screen }, initial: "v", theme,
      viewport: { width: 320, height: 480 } });
    const commits: string[] = [];
    const handoff = installHostHandoff({ app, commit: (json) => commits.push(json) });
    const focusViaTap = (id: string): TextInputOp => {
      const scene = JSON.parse(commits.at(-1)!);
      const op = (scene.ops as TextInputOp[]).find((op) => op.op === "text-input" && op.id === id)!;
      const tap = (scene.taps as Array<{ x: number; y: number; w: number; h: number; payload: { id: number } }>)
        .find((tap) => tap.x === op.x && tap.y === op.y && tap.w === op.w && tap.h === op.h)!;
      handoff.dispatch("TAP", JSON.stringify(tap.payload));
      return (JSON.parse(commits.at(-1)!).ops as TextInputOp[]).find((op) => op.op === "text-input" && op.id === id)!;
    };
    const active = focusViaTap("a");
    handoff.dispatch("TEXT_SUBMIT", JSON.stringify({ id: active.id, sessionId: active.sessionId, baseRevision: active.revision }));
    // onSubmitted removed the field; the transfer no-ops instead of focusing a stale table entry.
    const scene = JSON.parse(commits.at(-1)!);
    expect((scene.ops as TextInputOp[]).some((op) => op.op === "text-input" && op.focused)).toBe(false);
  });
});

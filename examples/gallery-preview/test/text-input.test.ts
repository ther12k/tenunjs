import { describe, expect, test } from "bun:test";
import { defineScreen, type ScreenActionContext } from "@tenunjs/core";
import { jsx, jsxs } from "@tenunjs/jsx-runtime";
import {
  ApplicationRuntime, Button, Column, Text, TextField, defineTheme, installHostHandoff,
  type DisplayListScene, type TextInputOp,
} from "@tenunjs/widgets";
import { BrowserTextInput } from "../text-input";
import { sceneContractError } from "../renderer";

// Only the DOM boundary is fake. Real widgets, layout, sessions, controller
// actions, and the host dispatch/commit contract drive every adapter test.
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
  blur() {
    if (this.owner.activeElement !== this) return;
    this.owner.activeElement = null;
    this.dispatchEvent(new Event("blur"));
  }
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

function event(target: EventTarget, name: string, fields: Record<string, unknown> = {}): void {
  const value = new Event(name, { cancelable: true });
  Object.assign(value, fields);
  target.dispatchEvent(value);
}

interface State { title: string; readOnly: boolean; submissions: number }
const screen = defineScreen({
  name: "Editor",
  initialState: (): State => ({ title: "Release day", readOnly: false, submissions: 0 }),
  actions: {
    change({ state, input }: ScreenActionContext<State>) { state.title = input as string; },
    replace({ state, input }: ScreenActionContext<State>) { state.title = input as string; },
    lock({ state }: ScreenActionContext<State>) { state.readOnly = true; },
    submit({ state }: ScreenActionContext<State>) { state.submissions++; },
    leave({ services }: ScreenActionContext<State>) {
      if (typeof services?.navigate !== "function") throw new Error("Missing fixture navigation service");
      services.navigate();
    },
  },
  view({ state, actions }) {
    return jsxs(Column, { children: [
      jsx(TextField, { id: "title", label: "Plan title", value: state.title, onChanged: actions.change,
        onSubmitted: actions.submit, readOnly: state.readOnly }),
      jsx(Text, { children: "Editor fixture" }),
      jsx(Button, { children: "Leave editor", onPress: actions.leave }),
    ] });
  },
});
const other = defineScreen({ name: "Other", initialState: () => ({}), actions: {}, view: () => jsx(Text, { children: "Other" }) });

function fixture(dispatchOverride?: (dispatch: (action: string, payload: string) => string, action: string, payload: string) => string) {
  const app: ApplicationRuntime = new ApplicationRuntime({ screens: { editor: screen, other }, initial: "editor", theme: defineTheme({}),
    viewport: { width: 360, height: 640 }, services: { navigate: () => app.navigate("other") } });
  let scene: DisplayListScene;
  const handoff = installHostHandoff({ app, commit: (json) => { scene = JSON.parse(json); } });
  const dom = new TestDocument();
  const errors: string[] = [];
  const bridge = new BrowserTextInput({
    canvas: { getBoundingClientRect: () => ({ left: 10, top: 20, width: 360, height: 640 }) } as HTMLCanvasElement,
    document: dom as unknown as Document,
    dispatch: (action, payload) => dispatchOverride ? dispatchOverride(handoff.dispatch, action, payload) : handoff.dispatch(action, payload),
    scene: () => scene, onError: (message) => errors.push(message),
  });
  const field = () => scene.ops.find((op): op is TextInputOp => op.op === "text-input")!;
  const focus = () => {
    const op = field();
    const tap = [...scene.taps].reverse().find((tap) => tap.x <= op.x + 1 && tap.y <= op.y + 1 &&
      tap.x + tap.w > op.x + 1 && tap.y + tap.h > op.y + 1)!;
    handoff.dispatch("TAP", JSON.stringify(tap.payload));
    bridge.sync();
    return dom.inputs[0]!;
  };
  const state = () => app.exportState().states.editor as State;
  return { app, handoff, dom, bridge, errors, field, focus, state, scene: () => scene };
}

describe("browser platform text input through the real widget handoff", () => {
  test("an acknowledged Unicode edit preserves the native element across viewport and scene updates", () => {
    const f = fixture();
    const input = f.focus();
    const session = f.field().sessionId;
    expect(input.attributes["aria-label"]).toBe("Plan title");
    expect(input.style.left).toBe("10px");
    input.value = "出荷 🚀 e\u0301";
    input.setSelectionRange(input.value.length, input.value.length);
    event(input, "input", { data: "e\u0301", isComposing: false });
    expect(f.state().title).toBe("出荷 🚀 e\u0301");
    expect(f.dom.inputs[0]).toBe(input);
    expect(f.field().revision).toBe(1);
    f.handoff.dispatch("VIEWPORT", '{"width":480,"height":840}');
    f.bridge.sync();
    expect(f.field().sessionId).toBe(session);
    expect(f.dom.inputs[0]).toBe(input);
    expect(f.errors).toEqual([]);
    f.bridge.dispose();
  });

  test("composition replacement and final commit preserve text and authoritative composing ranges", () => {
    const f = fixture();
    const input = f.focus();
    input.setSelectionRange(0, input.value.length);
    event(input, "compositionstart");
    event(input, "compositionupdate", { data: "に" });
    input.value = "に"; input.setSelectionRange(1, 1);
    event(input, "input", { data: "に", isComposing: true });
    expect(f.field().composing).toEqual({ start: 0, end: 1 });
    event(input, "compositionupdate", { data: "日本" });
    input.value = "日本"; input.setSelectionRange(2, 2);
    event(input, "input", { data: "日本", isComposing: true });
    expect(f.state().title).toBe("日本");
    expect(f.field().composing).toEqual({ start: 0, end: 2 });
    expect(f.dom.inputs[0]).toBe(input);
    event(input, "compositionend", { data: "日本" });
    expect(f.field().composing).toBeNull();
    expect(f.field().revision).toBe(3);
    expect(f.state().title).toBe("日本");
    expect(f.errors).toEqual([]);
    f.bridge.dispose();
  });

  test("backward selection is directional and selection-only events do not rewrite controller text", () => {
    const f = fixture();
    const input = f.focus();
    input.setSelectionRange(1, 4, "backward");
    event(input, "select");
    expect(f.field().selection).toEqual({ base: 4, extent: 1 });
    expect(f.state().title).toBe("Release day");
    const revision = f.field().revision;
    event(f.dom, "selectionchange");
    expect(f.field().revision).toBe(revision);
    expect(f.dom.inputs[0]).toBe(input);
    f.bridge.dispose();
  });

  test("controller replacement retires the element; queued events cannot overwrite the new text", () => {
    const f = fixture();
    const old = f.focus();
    f.app.push("replace", "New controller value");
    f.bridge.sync();
    expect(f.dom.inputs[0]).not.toBe(old);
    expect(f.dom.inputs[0]!.value).toBe("New controller value");
    old.value = "late composition";
    event(old, "compositionend", { data: "late composition" });
    event(old, "input", { isComposing: false });
    expect(f.state().title).toBe("New controller value");
    expect(f.errors).toEqual([]);
    f.bridge.dispose();
  });

  test("a rejected platform value restores the authoritative editor instead of retaining optimistic text", () => {
    const f = fixture();
    const old = f.focus();
    // A real type=text input strips line breaks. An invalid adapter/IME
    // candidate must still fail closed at the runtime boundary.
    old.value = "two\nlines";
    old.setSelectionRange(old.value.length, old.value.length);
    event(old, "input", { isComposing: false });
    expect(f.state().title).toBe("Release day");
    expect(f.dom.inputs[0]).not.toBe(old);
    expect(f.dom.inputs[0]!.value).toBe("Release day");
    expect(f.field().revision).toBe(0);
    expect(f.errors).toHaveLength(1);
    f.bridge.dispose();
  });

  test("a successful reply without an accepted scene retires the unacknowledged native edit", () => {
    // A host can keep the last valid scene when a bundle returns success
    // but commits an invalid candidate. A reply is not a value acknowledgement.
    const f = fixture((dispatch, action, payload) => action === "TEXT_EDIT"
      ? '{"route":"editor"}' : dispatch(action, payload));
    const old = f.focus();
    old.value = "unaccepted composition";
    old.setSelectionRange(old.value.length, old.value.length);
    event(old, "input", { isComposing: false });
    expect(f.state().title).toBe("Release day");
    expect(f.field().revision).toBe(0);
    expect(f.dom.inputs[0]).not.toBe(old);
    expect(f.dom.inputs[0]!.value).toBe("Release day");
    old.value = "late event";
    event(old, "input", { isComposing: false });
    expect(f.state().title).toBe("Release day");
    f.bridge.dispose();
  });

  test("read-only, navigation, restore, and adapter disposal retire old native callbacks", () => {
    const f = fixture();
    let old = f.focus();
    const snapshot = f.handoff.dispatch("__TENUN_EXPORT", "{}");
    f.app.push("lock"); f.bridge.sync();
    expect(f.dom.inputs).toHaveLength(0);
    old.value = "late locked edit"; event(old, "input");
    expect(f.state().title).toBe("Release day");
    f.handoff.dispatch("TENUN_RESTORE", snapshot); f.bridge.sync();
    old = f.focus();
    const button = f.scene().ops.find((op) => op.op === "text" && op.text === "Leave editor")!;
    if (button.op !== "text") throw new Error("Missing leave button");
    const tap = f.scene().taps.find((tap) => tap.x <= button.x + 2 && tap.x + tap.w >= button.x + 2 &&
      tap.y <= button.y - 2 && tap.y + tap.h >= button.y - 2)!;
    f.handoff.dispatch("TAP", JSON.stringify(tap.payload)); f.bridge.sync();
    expect(f.dom.inputs).toHaveLength(0);
    old.value = "late route edit"; event(old, "input");
    expect(f.state().title).toBe("Release day");
    f.handoff.dispatch("TENUN_RESTORE", snapshot); f.bridge.sync();
    old = f.focus();
    f.handoff.dispatch("TENUN_RESTORE", snapshot); f.bridge.sync();
    expect(f.dom.inputs).toHaveLength(0);
    old.value = "late restore edit"; event(old, "input");
    const live = f.focus();
    f.bridge.dispose(); f.bridge.dispose();
    live.value = "late disposed edit"; event(live, "input");
    expect(f.dom.inputs).toHaveLength(0);
    expect(f.state().title).toBe("Release day");
    expect(f.errors).toEqual([]);
  });

  test("Enter submits once, closes the platform editor, and ignores later key events", () => {
    const f = fixture();
    const input = f.focus();
    event(input, "keydown", { key: "Enter", isComposing: false });
    expect(f.state().submissions).toBe(1);
    expect(f.dom.inputs).toHaveLength(0);
    event(input, "keydown", { key: "Enter", isComposing: false });
    expect(f.state().submissions).toBe(1);
    f.bridge.dispose();
  });

  test("malformed, duplicate, or competing input descriptors reject the whole browser scene", () => {
    const f = fixture();
    f.focus();
    const original = f.scene();
    expect(sceneContractError(original)).toBeNull();
    expect(sceneContractError({ ...original, ops: [...original.ops, { ...f.field() }] })).toContain("duplicate");
    expect(sceneContractError({ ...original, ops: [...original.ops, { ...f.field(), id: "other" }] })).toContain("more than one");
    expect(sceneContractError({ ...original, ops: [...original.ops, { ...f.field(), id: "bad", selection: { base: -1, extent: 0 } }] })).toContain("invalid text input");
    f.bridge.dispose();
  });
});

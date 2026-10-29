import type { DisplayListScene, DisplayOp, TextInputOp } from "@tenunjs/widgets";

type ScrollRegionOp = Extract<DisplayOp, { op: "scroll-region" }>;

interface EditingValue {
  text: string;
  selection: { base: number; extent: number };
  composing: { start: number; end: number } | null;
}

interface Editor {
  element: HTMLInputElement;
  descriptor: TextInputOp;
  composing: boolean;
  compositionStart: number;
  compositionText: string;
  removeListeners: () => void;
}

export interface BrowserTextInputOptions {
  canvas: HTMLCanvasElement;
  /** The existing public handoff. Empty replies denote host dispatch failure. */
  dispatch: (action: string, payload: string) => string;
  scene: () => DisplayListScene | null;
  onError: (message: string) => void;
  /** Injectable DOM boundary for the adapter's event/lifecycle tests. */
  document?: Document;
  /** TN-166: a scroll region's current paint offset, so an editor nested
   *  in that region positions at its on-screen location. The host wires
   *  this to its renderer's offset state; omitted treats it as zero. */
  regionOffset?: (regionId: string) => number;
}

/**
 * TN-166: the focused, editable text-input descriptor — at the scene root
 * OR nested inside a scroll region's content ops (a TextField inside a
 * ScrollView). Root-only lookup left nested fields with no editor on a
 * scene the contract accepts. Read-only fields never adopt an editor.
 */
function focusedEditableInput(scene: DisplayListScene): { op: TextInputOp; region: ScrollRegionOp | null } | null {
  for (const op of scene.ops) {
    if (op.op === "text-input") {
      if (op.focused && !op.readOnly) return { op, region: null };
    } else if (op.op === "scroll-region") {
      for (const nested of op.ops) {
        if (nested.op === "text-input" && nested.focused && !nested.readOnly) {
          return { op: nested, region: op };
        }
      }
    }
  }
  return null;
}

function selectionOf(input: HTMLInputElement): EditingValue["selection"] {
  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? start;
  return input.selectionDirection === "backward"
    ? { base: end, extent: start }
    : { base: start, extent: end };
}

function equalValue(a: EditingValue, b: EditingValue): boolean {
  return a.text === b.text && a.selection.base === b.selection.base && a.selection.extent === b.selection.extent &&
    a.composing?.start === b.composing?.start && a.composing?.end === b.composing?.end;
}

/**
 * Platform input for a scene-declared TextField. The transparent native
 * input supplies the browser's keyboard, clipboard, selection, and IME;
 * ordinary display-list operations paint the field and its editing state.
 *
 * sync() runs after dispatch returns, never from inside tenun_commit. An
 * editor element belongs to one session/generation: replacing it removes
 * listeners, so a delayed composition event cannot edit a later field.
 */
export class BrowserTextInput {
  private readonly dom: Document;
  private editor: Editor | null = null;
  private ownEdit: { editor: Editor; value: EditingValue; accepted: boolean } | null = null;
  private disposed = false;
  private scrollY = 0;

  constructor(private readonly options: BrowserTextInputOptions) {
    this.dom = options.document ?? document;
  }

  sync(scene = this.options.scene(), scrollY = this.scrollY): void {
    if (this.disposed) return;
    this.scrollY = scrollY;
    const found = scene ? focusedEditableInput(scene) : null;
    const focused = found?.op;
    if (!focused) {
      this.removeEditor();
      return;
    }
    let editor = this.editor;
    const sameSession = editor && editor.descriptor.id === focused.id && editor.descriptor.sessionId === focused.sessionId;
    const changedValue = editor && !equalValue(editor.descriptor, focused);
    const changedRevision = editor && editor.descriptor.revision !== focused.revision;
    const ownAcknowledgement = editor && this.ownEdit?.editor === editor && this.ownEdit.accepted &&
      focused.revision === editor.descriptor.revision + 1 &&
      equalValue(this.ownEdit.value, focused);
    // A nonempty dispatch reply alone is not an acknowledgement: the host
    // may have rejected its scene and kept the previous descriptor. Retire
    // that optimistic element even when authority is byte-for-byte unchanged.
    const unacknowledgedEdit = editor && this.ownEdit?.editor === editor && !ownAcknowledgement;
    if (!sameSession || unacknowledgedEdit || ((changedValue || changedRevision) && !ownAcknowledgement)) {
      this.removeEditor();
      editor = this.createEditor(focused);
      this.editor = editor;
      this.position(editor, scene!, found.region);
      editor.element.focus({ preventScroll: true });
    } else if (editor) {
      // An acknowledged native edit must not rewrite value/selection: doing
      // so can cancel the browser's still-active composing span.
      editor.descriptor = focused;
      editor.element.setAttribute("aria-label", focused.label || focused.id);
      this.position(editor, scene!, found.region);
    }
  }

  /** Called for actual outside focus loss or a host teardown. */
  blur(): void {
    const editor = this.editor;
    if (editor) this.send(editor, "TEXT_BLUR");
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.removeEditor();
  }

  private live(editor: Editor): boolean {
    return !this.disposed && this.editor === editor;
  }

  private position(editor: Editor, scene: DisplayListScene, region: ScrollRegionOp | null): void {
    const rect = this.options.canvas.getBoundingClientRect();
    const scale = rect.width / scene.designWidth;
    const op = editor.descriptor;
    const visibleHeight = rect.height / scale;
    const anchor = op.fixed && op.anchorSize !== undefined
      ? op.anchor === "bottom" ? visibleHeight - op.anchorSize
        : op.anchor === "center" ? (visibleHeight - op.anchorSize) / 2 : 0
      : 0;
    let x = op.x;
    let y = op.fixed ? op.y + anchor : op.y - this.scrollY;
    if (region) {
      // TN-166: the descriptor lives in the region's CONTENT space — its
      // on-screen position is the region's viewport-box origin plus the
      // content coordinates, lifted by the region's current paint offset
      // (the same math the renderer paints with).
      const offset = this.options.regionOffset ? this.options.regionOffset(region.id) : 0;
      x = region.x + op.x;
      y = region.y + op.y - offset;
    }
    const style = editor.element.style;
    style.left = `${rect.left + x * scale}px`;
    style.top = `${rect.top + y * scale}px`;
    style.width = `${Math.max(1, op.w * scale)}px`;
    style.height = `${Math.max(1, op.h * scale)}px`;
  }

  private createEditor(descriptor: TextInputOp): Editor {
    const element = this.dom.createElement("input");
    element.type = "text";
    element.tabIndex = -1;
    element.autocomplete = "off";
    element.spellcheck = false;
    element.inputMode = "text";
    element.enterKeyHint = "done";
    element.setAttribute("aria-label", descriptor.label || descriptor.id);
    element.setAttribute("data-tenun-text-input", descriptor.id);
    Object.assign(element.style, {
      position: "fixed", opacity: "0", pointerEvents: "none", margin: "0",
      padding: "0", border: "0", fontSize: "16px", caretColor: "transparent",
    });
    element.value = descriptor.text;
    const { base, extent } = descriptor.selection;
    element.setSelectionRange(Math.min(base, extent), Math.max(base, extent), base > extent ? "backward" : "forward");
    const editor: Editor = {
      element, descriptor, composing: false, compositionStart: 0, compositionText: "",
      removeListeners: () => {},
    };
    const listeners: Array<[EventTarget, string, EventListener]> = [];
    const listen = (target: EventTarget, name: string, handler: EventListener): void => {
      target.addEventListener(name, handler);
      listeners.push([target, name, handler]);
    };
    listen(element, "compositionstart", () => {
      if (!this.live(editor)) return;
      editor.composing = true;
      editor.compositionStart = Math.min(element.selectionStart ?? 0, element.selectionEnd ?? 0);
      editor.compositionText = "";
    });
    listen(element, "compositionupdate", (event) => {
      if (!this.live(editor)) return;
      editor.compositionText = (event as CompositionEvent).data;
    });
    listen(element, "compositionend", () => {
      if (!this.live(editor)) return;
      editor.composing = false;
      editor.compositionText = "";
      this.publish(editor);
    });
    listen(element, "input", (event) => {
      if (!this.live(editor)) return;
      const input = event as InputEvent;
      // compositionupdate usually precedes input. Preserve its whole
      // composing string rather than treating every update as an append.
      if (input.isComposing && !editor.composing) {
        editor.composing = true;
        editor.compositionStart = Math.max(0, (element.selectionEnd ?? element.value.length) - (input.data?.length ?? 0));
        editor.compositionText = input.data ?? "";
      }
      this.publish(editor);
    });
    const selectionChanged = (): void => {
      if (this.live(editor) && this.dom.activeElement === element && !editor.composing) this.publish(editor);
    };
    listen(element, "select", selectionChanged);
    listen(element, "selectionchange", selectionChanged);
    listen(this.dom, "selectionchange", selectionChanged);
    listen(element, "keydown", (event) => {
      if (!this.live(editor)) return;
      const key = event as KeyboardEvent;
      if (key.key === "Enter" && !key.isComposing && !editor.composing) {
        key.preventDefault();
        this.send(editor, "TEXT_SUBMIT");
      } else if (key.key === "Escape") {
        key.preventDefault();
        this.send(editor, "TEXT_BLUR");
      }
    });
    listen(element, "blur", () => {
      if (this.live(editor)) this.send(editor, "TEXT_BLUR");
    });
    editor.removeListeners = () => {
      for (const [target, name, handler] of listeners) target.removeEventListener(name, handler);
    };
    this.dom.body.appendChild(element);
    return editor;
  }

  private publish(editor: Editor): void {
    if (!this.live(editor)) return;
    const { element } = editor;
    const start = Math.min(editor.compositionStart, element.value.length);
    const end = Math.min(start + editor.compositionText.length, element.value.length);
    const value: EditingValue = {
      text: element.value,
      selection: selectionOf(element),
      composing: editor.composing && end > start ? { start, end } : null,
    };
    if (!equalValue(value, editor.descriptor)) this.send(editor, "TEXT_EDIT", value);
  }

  private send(editor: Editor, action: "TEXT_EDIT" | "TEXT_BLUR" | "TEXT_SUBMIT", value?: EditingValue): void {
    if (!this.live(editor)) return;
    const op = editor.descriptor;
    const payload = { id: op.id, sessionId: op.sessionId, baseRevision: op.revision, ...value };
    const attempt = value ? { editor, value, accepted: false } : null;
    this.ownEdit = attempt;
    try {
      const reply = this.options.dispatch(action, JSON.stringify(payload));
      if (attempt) attempt.accepted = reply !== "";
    } catch (error) {
      this.options.onError(`host: text input failed: ${(error as Error).message}`);
    } finally {
      // Reconcile even a rejected edit against the last authoritative scene.
      // A normal host dispatch also syncs, but that happens before we know
      // its reply; the caller leaves text synchronization to this boundary.
      this.sync();
      this.ownEdit = null;
    }
  }

  private removeEditor(): void {
    const editor = this.editor;
    if (!editor) return;
    this.editor = null;
    editor.removeListeners();
    editor.element.blur();
    editor.element.remove();
  }
}

/**
 * Controlled, single-line widget input (TN-160). Application state owns the
 * string; the runtime owns the current focus session and UTF-16 editing ranges.
 * This prototype does not claim native shaping, secure entry, autofill, forms,
 * or the full focus-tree contract of TN-075–TN-081.
 */
import type { WidgetNode } from "@tenunjs/jsx-runtime";
import type { FixedPosition } from "./display-list";

export interface TextSelection {
  /** UTF-16 offsets; base may exceed extent for a backwards selection. */
  readonly base: number;
  readonly extent: number;
}

export interface TextComposingRange {
  /** Ordered, nonempty UTF-16 range. An absent composition is null. */
  readonly start: number;
  readonly end: number;
}

export interface TextEditingValue {
  readonly text: string;
  readonly selection: TextSelection;
  readonly composing: TextComposingRange | null;
}

/** Keyboard intent for a field. Numeric values are intents (and content gates), not validators. */
export type TextKeyboardType = "text" | "number" | "decimal";

/** Required host capability marker: older hosts reject this unknown operation. */
export interface TextInputOp extends FixedPosition, TextEditingValue {
  readonly op: "text-input";
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly focused: boolean;
  /** Zero while unfocused; positive, runtime-local activation identity otherwise. */
  readonly sessionId: number;
  readonly revision: number;
  readonly keyboardType: TextKeyboardType;
  readonly returnAction: "done";
  readonly readOnly: boolean;
  readonly label: string;
}

export interface TextInputIdentity {
  readonly id: string;
  readonly sessionId: number;
  readonly baseRevision: number;
}

export interface TextEditEvent extends TextInputIdentity, TextEditingValue {}

export interface TextFieldProps {
  /** Stable and unique within the active screen; independent of render/tap order. */
  readonly id: string;
  /** Single-line text: CR/LF are rejected, never silently normalized. */
  readonly value: string;
  /** Echo the proposed string into controller state synchronously to accept it. */
  readonly onChanged: (value: string) => void;
  readonly label?: string;
  readonly placeholder?: string;
  readonly readOnly?: boolean;
  readonly onSubmitted?: () => void;
  /** Keyboard intent; default "text". Numeric fields keep editing drafts ("", "12.") and reject other content. */
  readonly keyboardType?: TextKeyboardType;
}

export type TextInputErrorCode =
  | "INVALID_TEXT_FIELD" | "DUPLICATE_TEXT_FIELD" | "INVALID_TEXT_EDIT"
  | "INVALID_TEXT_INPUT" | "INVALID_TEXT_CONTENT" | "STALE_TEXT_SESSION"
  | "STALE_TEXT_REVISION" | "TEXT_INPUT_RUNTIME_REQUIRED";

export class TextInputError extends Error {
  constructor(readonly code: TextInputErrorCode, message: string) {
    super(`[TENUN_TEXT_INPUT] ${code}: ${message}`);
    this.name = "TextInputError";
  }
}

export const TextFieldKind = Symbol.for("tenun.widgets.text-field");

export interface ResolvedTextFieldProps extends TextFieldProps {
  readonly label: string;
  readonly placeholder: string;
  readonly readOnly: boolean;
  readonly keyboardType: TextKeyboardType;
}

/**
 * Fail-closed numeric draft gate. A numeric-intent field keeps ordinary editing
 * intermediates (empty, a lone sign, a trailing separator such as "12." or the
 * locale separator "12,5") but never adopts letters or a doubled separator.
 * Committed-value validation (ranges, precision, separator normalization)
 * stays application-owned.
 */
const NUMERIC_DRAFT_PATTERNS: Record<Exclude<TextKeyboardType, "text">, RegExp> = {
  number: /^-?[0-9]*$/,
  decimal: /^-?[0-9]*([.,][0-9]*)?$/,
};

/** Returns null when the draft is admissible for the keyboard intent, or a reason string. */
export function numericDraftError(keyboardType: TextKeyboardType, text: string): string | null {
  if (keyboardType === "text") return null;
  return NUMERIC_DRAFT_PATTERNS[keyboardType].test(text)
    ? null
    : `numeric "${keyboardType}" draft ${JSON.stringify(text)} is not admissible`;
}

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function fail(code: TextInputErrorCode, message: string): never {
  throw new TextInputError(code, message);
}

function identifier(value: unknown, code: TextInputErrorCode): string {
  if (typeof value !== "string" || value.trim().length === 0) fail(code, "id must be a nonempty string");
  return value;
}

function integer(value: unknown, minimum: number, code: TextInputErrorCode, name: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum) {
    fail(code, `${name} must be a safe integer >= ${minimum}`);
  }
  return value;
}

/** Snapshot first: validation and subsequent rendering use the same values. */
export function resolveTextFieldProps(value: unknown): Readonly<ResolvedTextFieldProps> {
  if (!record(value)) fail("INVALID_TEXT_FIELD", "TextField props must be an object");
  const { id, value: text, onChanged, label = "", placeholder = "", readOnly = false, onSubmitted,
    keyboardType = "text" } = value;
  const fieldId = identifier(id, "INVALID_TEXT_FIELD");
  if (typeof text !== "string" || typeof label !== "string" || typeof placeholder !== "string" ||
      typeof readOnly !== "boolean" || typeof onChanged !== "function" ||
      (onSubmitted !== undefined && typeof onSubmitted !== "function")) {
    fail("INVALID_TEXT_FIELD", "TextField requires string value/labels, boolean readOnly, and typed callbacks");
  }
  if (/[\r\n]/.test(text)) fail("INVALID_TEXT_FIELD", "Single-line TextField value must not contain CR or LF");
  if (keyboardType !== "text" && keyboardType !== "number" && keyboardType !== "decimal") {
    fail("INVALID_TEXT_FIELD", "keyboardType must be \"text\", \"number\", or \"decimal\"");
  }
  const contentError = numericDraftError(keyboardType, text);
  if (contentError !== null) fail("INVALID_TEXT_CONTENT", contentError);
  return Object.freeze({ id: fieldId, value: text, label, placeholder, readOnly, keyboardType,
    onChanged: onChanged as (value: string) => void,
    ...(onSubmitted === undefined ? {} : { onSubmitted: onSubmitted as () => void }) });
}

/** Ordinary TSX widget; the virtual kind leaves the numeric host ABI untouched. */
export function TextField(props: TextFieldProps): WidgetNode {
  return { kind: TextFieldKind, key: null, props: resolveTextFieldProps(props), children: [] } as unknown as WidgetNode;
}

function editingValue(value: Record<string, unknown>, code: TextInputErrorCode): Readonly<TextEditingValue> {
  const { text, selection, composing } = value;
  if (typeof text !== "string" || !record(selection)) fail(code, "text and selection are required");
  if (/[\r\n]/.test(text)) fail(code, "Single-line text input must not contain CR or LF");
  const base = integer(selection.base, 0, code, "selection.base");
  const extent = integer(selection.extent, 0, code, "selection.extent");
  if (base > text.length || extent > text.length) fail(code, "selection is outside the UTF-16 text range");
  let range: TextComposingRange | null = null;
  if (composing !== null) {
    if (!record(composing)) fail(code, "composing must be null or an ordered nonempty range");
    const start = integer(composing.start, 0, code, "composing.start");
    const end = integer(composing.end, 0, code, "composing.end");
    if (start >= end || end > text.length) fail(code, "composing is outside the UTF-16 text range or empty");
    range = Object.freeze({ start, end });
  }
  return Object.freeze({ text, selection: Object.freeze({ base, extent }), composing: range });
}

export function validateTextInputIdentity(value: unknown): Readonly<TextInputIdentity> {
  if (!record(value)) fail("INVALID_TEXT_EDIT", "text input event must be an object");
  const { id, sessionId, baseRevision } = value;
  return Object.freeze({ id: identifier(id, "INVALID_TEXT_EDIT"),
    sessionId: integer(sessionId, 1, "INVALID_TEXT_EDIT", "sessionId"),
    baseRevision: integer(baseRevision, 0, "INVALID_TEXT_EDIT", "baseRevision") });
}

export function validateTextEditEvent(value: unknown): Readonly<TextEditEvent> {
  if (!record(value)) fail("INVALID_TEXT_EDIT", "text edit event must be an object");
  // One shallow copy prevents getters from changing between identity and state validation.
  const copy = { ...value };
  return Object.freeze({ ...validateTextInputIdentity(copy), ...editingValue(copy, "INVALID_TEXT_EDIT") });
}

/** Shared browser/TS boundary validator; returns an immutable, independent copy. */
export function validateTextInputOp(value: unknown): Readonly<TextInputOp> {
  const code = "INVALID_TEXT_INPUT";
  if (!record(value)) fail(code, "text-input descriptor must be an object");
  const copy = { ...value };
  const { op, id, x, y, w, h, focused, sessionId, revision, keyboardType, returnAction, readOnly, label,
    fixed, anchor, anchorSize } = copy;
  if (op !== "text-input" || typeof focused !== "boolean" || typeof readOnly !== "boolean" ||
      typeof label !== "string" || (keyboardType !== "text" && keyboardType !== "number" && keyboardType !== "decimal") ||
      returnAction !== "done") {
    fail(code, "invalid text-input descriptor flags, label, or keyboard intent");
  }
  for (const [name, dimension] of Object.entries({ x, y, w, h })) {
    if (typeof dimension !== "number" || !Number.isFinite(dimension) ||
        ((name === "w" || name === "h") && dimension < 0)) fail(code, `${name} must be valid finite geometry`);
  }
  const sid = integer(sessionId, 0, code, "sessionId");
  const rev = integer(revision, 0, code, "revision");
  const state = editingValue(copy, code);
  const contentError = numericDraftError(keyboardType as TextKeyboardType, state.text);
  if (contentError !== null) fail("INVALID_TEXT_CONTENT", contentError);
  if ((focused && (sid === 0 || readOnly)) ||
      (!focused && (sid !== 0 || rev !== 0 || state.composing !== null))) {
    fail(code, "focus, session, revision, readOnly and composition disagree");
  }
  if ((fixed !== undefined && typeof fixed !== "boolean") ||
      (anchor !== undefined && anchor !== "bottom" && anchor !== "center") ||
      (anchorSize !== undefined && (typeof anchorSize !== "number" || !Number.isFinite(anchorSize) || anchorSize < 0))) {
    fail(code, "invalid fixed-position metadata");
  }
  return Object.freeze({ op, id: identifier(id, code), x: x as number, y: y as number, w: w as number, h: h as number,
    ...state, focused, sessionId: sid, revision: rev, keyboardType, returnAction, readOnly, label,
    ...(fixed === undefined ? {} : { fixed }),
    ...(anchor === undefined ? {} : { anchor }),
    ...(anchorSize === undefined ? {} : { anchorSize }) });
}

/** Diagnostic adapter for hosts that validate a whole scene before adopting it. */
export function textInputContractError(value: unknown): string | null {
  try {
    validateTextInputOp(value);
    return null;
  } catch (error) {
    if (error instanceof TextInputError) return error.message;
    throw error;
  }
}

/** Framework-only transient state. Never serialize this into application snapshots. */
export interface TextInputSessionState extends TextEditingValue {
  readonly id: string;
  readonly sessionId: number;
  readonly revision: number;
}

/** The existing layout walk discovers fields, preserving one component invocation. */
export interface TextInputLayoutDelegate {
  readonly active?: TextInputSessionState;
  focus(id: string): void;
}

export interface TextFieldBinding {
  readonly props: Readonly<ResolvedTextFieldProps>;
  readonly descriptor: Readonly<TextInputOp>;
}

export function nextTextRevision(revision: number): number {
  return integer(revision + 1, 0, "INVALID_TEXT_EDIT", "next revision");
}

/** Pure render reconciliation: a failed layout cannot partially adopt new text. */
export function textInputDescriptor(
  props: Readonly<ResolvedTextFieldProps>,
  frame: { x: number; y: number; w: number; h: number },
  active?: TextInputSessionState,
): Readonly<TextInputOp> {
  const focused = !props.readOnly && active?.id === props.id;
  const echoed = focused && active.text === props.value;
  return validateTextInputOp({ op: "text-input", ...frame, id: props.id, text: props.value,
    selection: echoed ? active.selection : { base: props.value.length, extent: props.value.length },
    composing: echoed ? active.composing : null,
    focused, sessionId: focused ? active.sessionId : 0,
    revision: focused ? (echoed ? active.revision : nextTextRevision(active.revision)) : 0,
    keyboardType: props.keyboardType, returnAction: "done", readOnly: props.readOnly, label: props.label });
}

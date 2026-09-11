/**
 * @tenunjs/protocol
 *
 * Versioned atomic mutation protocol ABI between JavaScript reconciliation
 * and the native engine (ADR-0012, TN-035).
 */

export const PROTOCOL_VERSION = 1;

/**
 * Mutation operation names executed in atomic transactions.
 *
 * Deliberately a const object, NOT a `const enum`: these names are the
 * public identity until TN-035 specifies the binary format. No numeric
 * wire values exist yet, so none can be accidentally inlined or frozen
 * into published declarations.
 */
export const MutationOpCode = {
  BEGIN_TRANSACTION: "begin_transaction",
  CREATE_NODE: "create_node",
  SET_PROPS: "set_props",
  SET_TEXT: "set_text",
  INSERT_CHILD: "insert_child",
  MOVE_CHILD: "move_child",
  REMOVE_CHILD: "remove_child",
  DESTROY_NODE: "destroy_node",
  COMMIT_TRANSACTION: "commit_transaction",
} as const;

export type MutationOpCode = (typeof MutationOpCode)[keyof typeof MutationOpCode];

/**
 * Host widget kinds.
 *
 * Symbolic identities only — TN-034 owns the authoritative kind map,
 * property schemas, and any numeric ABI binding. The values here are
 * provisional scaffolding from TN-019 (see the scaffolding note on
 * TN-034) and may be replaced without ceremony.
 */
export const HostWidgetKind = {
  ROOT: "root",
  COLUMN: "column",
  ROW: "row",
  TEXT: "text",
  BUTTON: "button",
  INPUT: "input",
  LIST_ITEM: "list-item",
  SCROLL_VIEW: "scroll-view",
  CARD: "card",
  SCAFFOLD: "scaffold",
  APP_BAR: "app-bar",
  SPACER: "spacer",
} as const;

export type HostWidgetKind = (typeof HostWidgetKind)[keyof typeof HostWidgetKind];

export type NodeId = number;
export type ActionHandle = number;

/**
 * Structured error codes emitted when transactions violate invariants.
 */
export const ProtocolErrorCode = {
  INVALID_HEADER: "TJ_ERR_PROTO_HEADER",
  INVALID_VERSION: "TJ_ERR_PROTO_VERSION",
  INVALID_OPCODE: "TJ_ERR_PROTO_OPCODE",
  NODE_NOT_FOUND: "TJ_ERR_NODE_NOT_FOUND",
  DUPLICATE_NODE: "TJ_ERR_NODE_DUPLICATE",
  CYCLIC_HIERARCHY: "TJ_ERR_CYCLIC_HIERARCHY",
  INVALID_PROPERTY: "TJ_ERR_INVALID_PROP",
  BUFFER_OVERFLOW: "TJ_ERR_BUFFER_OVERFLOW",
  CHECKSUM_MISMATCH: "TJ_ERR_CHECKSUM_MISMATCH",
} as const;

export type ProtocolErrorCode = (typeof ProtocolErrorCode)[keyof typeof ProtocolErrorCode];

export class TenunProtocolError extends Error {
  readonly code: ProtocolErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(code: ProtocolErrorCode, message: string, details?: Record<string, unknown>) {
    super(`[${code}] ${message}`);
    this.name = "TenunProtocolError";
    this.code = code;
    this.details = details;
  }
}

const OPCODES: ReadonlySet<string> = new Set(Object.values(MutationOpCode));
const WIDGET_KINDS: ReadonlySet<string> = new Set(Object.values(HostWidgetKind));

export function isValidOpCode(code: string): code is MutationOpCode {
  return OPCODES.has(code);
}

export function isValidWidgetKind(kind: string): kind is HostWidgetKind {
  return WIDGET_KINDS.has(kind);
}

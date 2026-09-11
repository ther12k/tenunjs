/**
 * @tenunjs/protocol
 *
 * Versioned atomic mutation protocol ABI between JavaScript reconciliation
 * and the native engine (ADR-0012, TN-035).
 */

export const PROTOCOL_VERSION = 1;

/**
 * Mutation operation codes executed in atomic transactions.
 */
export const enum MutationOpCode {
  BEGIN_TRANSACTION = 0x01,
  CREATE_NODE = 0x02,
  SET_PROPS = 0x03,
  SET_TEXT = 0x04,
  INSERT_CHILD = 0x05,
  MOVE_CHILD = 0x06,
  REMOVE_CHILD = 0x07,
  DESTROY_NODE = 0x08,
  COMMIT_TRANSACTION = 0x09,
}

/**
 * Interned numeric host widget kinds recognized by the native engine.
 */
export const enum HostWidgetKind {
  ROOT = 0,
  COLUMN = 1,
  ROW = 2,
  TEXT = 3,
  BUTTON = 4,
  INPUT = 5,
  LIST_ITEM = 6,
  SCROLL_VIEW = 7,
  CARD = 8,
  SCAFFOLD = 9,
  APP_BAR = 10,
  SPACER = 11,
}

export type NodeId = number;
export type ActionHandle = number;

/**
 * Structured error codes emitted when transactions violate invariants.
 */
export const enum ProtocolErrorCode {
  INVALID_HEADER = "TJ_ERR_PROTO_HEADER",
  INVALID_VERSION = "TJ_ERR_PROTO_VERSION",
  INVALID_OPCODE = "TJ_ERR_PROTO_OPCODE",
  NODE_NOT_FOUND = "TJ_ERR_NODE_NOT_FOUND",
  DUPLICATE_NODE = "TJ_ERR_NODE_DUPLICATE",
  CYCLIC_HIERARCHY = "TJ_ERR_CYCLIC_HIERARCHY",
  INVALID_PROPERTY = "TJ_ERR_INVALID_PROP",
  BUFFER_OVERFLOW = "TJ_ERR_BUFFER_OVERFLOW",
  CHECKSUM_MISMATCH = "TJ_ERR_CHECKSUM_MISMATCH",
}

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

export function isValidOpCode(code: number): boolean {
  return code >= MutationOpCode.BEGIN_TRANSACTION && code <= MutationOpCode.COMMIT_TRANSACTION;
}

export function isValidWidgetKind(kind: number): boolean {
  return kind >= HostWidgetKind.ROOT && kind <= HostWidgetKind.SPACER;
}

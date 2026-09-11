import { describe, expect, test } from "bun:test";
import {
  HostWidgetKind,
  MutationOpCode,
  PROTOCOL_VERSION,
  ProtocolErrorCode,
  TenunProtocolError,
  isValidOpCode,
  isValidWidgetKind,
} from "../src/index";

describe("@tenunjs/protocol", () => {
  test("defines PROTOCOL_VERSION 1", () => {
    expect(PROTOCOL_VERSION).toBe(1);
  });

  test("validates mutation opcodes within range", () => {
    expect(isValidOpCode(MutationOpCode.BEGIN_TRANSACTION)).toBe(true);
    expect(isValidOpCode(MutationOpCode.COMMIT_TRANSACTION)).toBe(true);
    expect(isValidOpCode(0x00)).toBe(false);
    expect(isValidOpCode(0x10)).toBe(false);
  });

  test("validates host widget kinds within range", () => {
    expect(isValidWidgetKind(HostWidgetKind.ROOT)).toBe(true);
    expect(isValidWidgetKind(HostWidgetKind.BUTTON)).toBe(true);
    expect(isValidWidgetKind(HostWidgetKind.SPACER)).toBe(true);
    expect(isValidWidgetKind(-1)).toBe(false);
    expect(isValidWidgetKind(999)).toBe(false);
  });

  test("formats TenunProtocolError with structured codes", () => {
    const err = new TenunProtocolError(
      ProtocolErrorCode.CYCLIC_HIERARCHY,
      "Detected parent cycle",
      { parent: 1, child: 2 }
    );
    expect(err.code).toBe(ProtocolErrorCode.CYCLIC_HIERARCHY);
    expect(err.message).toContain("[TJ_ERR_CYCLIC_HIERARCHY]");
    expect(err.details).toEqual({ parent: 1, child: 2 });
  });
});

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

  test("validates mutation opcodes by membership", () => {
    expect(isValidOpCode(MutationOpCode.BEGIN_TRANSACTION)).toBe(true);
    expect(isValidOpCode(MutationOpCode.COMMIT_TRANSACTION)).toBe(true);
    expect(isValidOpCode("nope")).toBe(false);
    expect(isValidOpCode("")).toBe(false);
  });

  test("validates host widget kinds by membership", () => {
    expect(isValidWidgetKind(HostWidgetKind.ROOT)).toBe(true);
    expect(isValidWidgetKind(HostWidgetKind.BUTTON)).toBe(true);
    expect(isValidWidgetKind(HostWidgetKind.SPACER)).toBe(true);
    expect(isValidWidgetKind("widget")).toBe(false);
    expect(isValidWidgetKind("")).toBe(false);
  });

  test("host widget kinds are symbolic and carry no numeric ABI values", () => {
    // The numeric binding belongs to TN-034; nothing here may freeze one.
    for (const value of Object.values(HostWidgetKind)) {
      expect(typeof value).toBe("string");
      expect(Number.isNaN(Number(value))).toBe(true);
    }
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

import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const fixtures = ["hello.js", "callback.js", "stall.js"];
const header = readFileSync(new URL("./tenun_js_adapter.h", import.meta.url), "utf8");

describe("runtime host adapter contract", () => {
  test("header declares ABI v1 with fail-closed statuses", () => {
    expect(header).toContain("#define TENUN_JS_ABI_VERSION 1u");
    expect(header).toContain('extern \"C\"');
    expect(header).toContain("_Static_assert");
    expect(header).toContain(
      "tenun_js_register_host_fn(tenun_js_vm* vm, const char* name, tenun_js_host_fn fn);"
    );
    for (const status of [
      "TENUN_JS_ERR_BUNDLE_DIGEST",
      "TENUN_JS_ERR_TIMEOUT",
      "TENUN_JS_ERR_VALUE_BOUNDS",
      "TENUN_JS_ERR_HANDLE",
      "tenun_js_last_result",
    ]) {
      expect(header).toContain(status);
    }
  });

  test("argument limit and source-type kinds are documented in the header", () => {
    expect(header).toContain("TENUN_JS_MAX_ARGS 8u");
    expect(header).toContain("VK_I64 is reserved for BigInt");
  });

  test("pump context and pending-job failure semantics are documented (review 12)", () => {
    expect(header).toContain("Pump execution context (review 12)");
    expect(header).toContain("THAT VM's registered callback with THAT VM's handle");
    expect(header).toContain('is NOT "queue empty"');
    const contract = readFileSync(
      new URL("../../02-architecture/runtime-host-adapter-contract.md", import.meta.url),
      "utf8"
    );
    expect(contract).toContain("Pumped host-call context (review 12)");
    expect(contract).toContain("Pending-job failure visibility (review 12)");
    expect(contract).toContain("never collapsed into \"queue empty\"");
  });

  test("unhandled-rejection policy and exception-text coverage are documented (review 13)", () => {
    expect(header).toContain("Unhandled promise rejections (review 13)");
    expect(header).toContain("the turn: tenun_js_pump returns -1 with a TJERR:EVAL diagnostic");
    expect(header).toContain("A STALE (unresolvable) handle returns -1");
    const contract = readFileSync(
      new URL("../../02-architecture/runtime-host-adapter-contract.md", import.meta.url),
      "utf8"
    );
    expect(contract).toContain("Unhandled promise-rejection visibility (review 13)");
    expect(contract).toContain("Exception text for every value kind (review 13)");
    expect(contract).toContain("handled transition");
    expect(contract).toContain("single aggregated diagnostic in report order");
  });

  test("per-scope storage budgets and payload lifetime are documented (review 8/10)", () => {
    expect(header).toContain("PER-SCOPE budgets");
    expect(header).toContain("~10 MiB");
    expect(header).toContain("TENUN_JS_MAX_ARGS * TENUN_JS_MAX_BYTES");
    expect(header).toContain("invalidated by exactly two events");
    expect(header).toContain("they never coerce to null");
    expect(header).toContain("callback-visible");
    expect(header).toContain("clean callback never inherits");
  });

  test("architecture contract states the same per-scope model as the header (review 10)", () => {
    const contract = readFileSync(
      new URL("../../02-architecture/runtime-host-adapter-contract.md", import.meta.url),
      "utf8"
    );
    expect(contract).toContain("Per-scope budgets (review 10)");
    expect(contract).toContain("invalidated by exactly two events");
    expect(contract).toContain("≈10 MiB plus allocator overhead");
    expect(contract).toContain("clean callback never inherits");
    // the stale aggregate model must stay gone
    expect(contract).not.toContain("released at the next `last_result` call or adapter operation");
    expect(contract).not.toContain("retains at most 8 MiB of marshalled string/byte storage");
  });

  test("handle registry semantics are documented in the header", () => {
    expect(header).toContain("registry tokens (slot + generation)");
    expect(header).toContain("double destroy is a safe no-op");
    expect(header).toContain("never reissued");
    // reentrancy identity is the full handle, not the slot (review 11)
    expect(header).toContain("Reentrancy identity (review 11)");
    expect(header).toContain("compared by full handle (slot +");
    expect(header).toContain("never by slot alone");
  });

  test("fixture checksums match manifest (drift check)", () => {
    const manifest = readFileSync(
      new URL("./fixtures/fixtures.sha256", import.meta.url),
      "utf8"
    );
    const recorded = new Map(
      manifest
        .trim()
        .split("\n")
        .map((l) => {
          const [hash, path] = l.split(/\s+/);
          return [path.split("/").pop()!, hash];
        })
    );
    expect(recorded.size).toBe(fixtures.length);
    for (const f of fixtures) {
      const actual = createHash("sha256")
        .update(readFileSync(new URL(`./fixtures/${f}`, import.meta.url)))
        .digest("hex");
      expect(actual).toBe(recorded.get(f));
    }
  });

  test("stall fixture is actually an infinite loop", () => {
    const stall = readFileSync(new URL("./fixtures/stall.js", import.meta.url), "utf8");
    expect(stall).toContain("while (true)");
  });
});

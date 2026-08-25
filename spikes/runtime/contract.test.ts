import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const fixtures = ["hello.js", "callback.js", "stall.js"];

describe("runtime host adapter contract", () => {
  test("header declares ABI v1 with fail-closed statuses", () => {
    const header = readFileSync(new URL("./tenun_js_adapter.h", import.meta.url), "utf8");
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
      "tenun_js_last_result",
    ]) {
      expect(header).toContain(status);
    }
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

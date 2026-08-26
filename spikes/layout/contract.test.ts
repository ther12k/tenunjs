import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";

const header = readFileSync(new URL("./layout_adapter.h", import.meta.url), "utf8");

describe("layout adapter contract", () => {
  test("header declares ABI v1 with fail-closed statuses", () => {
    expect(header).toContain("#define TENUN_LAYOUT_ABI_VERSION 1u");
    expect(header).toContain('extern \"C\"');
    expect(header).toContain("_Static_assert");
    expect(header).toContain("tenun_layout_node_set_measure(");
    expect(header).toContain("void* userdata");
    expect(header).toContain("TENUN_LAYOUT_ERR_STYLE");
    expect(header).toContain("TENUN_LAYOUT_ERR_TREE");
    expect(header).toContain("TENUN_LAYOUT_ERR_HANDLE");
    expect(header).toContain("tenun_layout_measure_fn");
  });

  test("handle registry semantics are documented in the header", () => {
    expect(header).toContain("registry tokens");
    expect(header).toContain("Double destroy is a safe no-op");
    expect(header).toContain("TENUN_LAYOUT_ERR_HANDLE");
  });

  test("corpus cases are complete and exact-representable", () => {
    const dir = new URL("./corpus/", import.meta.url).pathname;
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
      const c = JSON.parse(readFileSync(dir + file, "utf8"));
      expect(c.case_id).toBeString();
      const boxes = [c.root.style.width, c.root.style.height, ...c.expected.flatMap((b: number[]) => Object.values(b))];
      for (const v of boxes) {
        expect(Number.isFinite(v)).toBe(true);
      }
      expect(c.expected).toHaveLength(c.root.children.length);
      for (const b of c.expected) expect(Object.keys(b).sort()).toEqual(["height", "width", "x", "y"]);
    }
    expect(readdirSync(dir).filter((f) => f.endsWith(".json")).length).toBeGreaterThanOrEqual(5);
  });

  test("corpus expectations are hand-checkable integers", () => {
    const c = JSON.parse(readFileSync(new URL("./corpus/004-center-both-axes.json", import.meta.url), "utf8"));
    expect(c.expected[0]).toEqual({ x: 120, y: 30, width: 60, height: 40 });
  });
});

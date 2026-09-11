import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * TN-020 acceptance: the AUTOMATIC TRANSFORM path, not direct jsx() calls.
 *
 * Real .tsx fixtures are compiled by actual tsc invocations with
 * `jsx: "react-jsx"` / `jsx: "react-jsxdev"` and `jsxImportSource:
 * "@tenunjs/jsx-runtime"` (see tests/tsx-fixtures/tsconfig.*.json), the
 * emitted JS is executed, and the resulting virtual nodes are asserted.
 * Red fixtures prove typed-invalid props fail compilation and a broken
 * runtime subpath fails resolution.
 */

const FIXTURES_DIR = join(import.meta.dir, "..", "tests", "tsx-fixtures");
const EMIT_ROOT = join(FIXTURES_DIR, ".out");
// outDir is tsconfig-relative; rootDir is the repo root, so emitted
// fixtures mirror the repository layout under .out/<variant>/packages/...
const EMIT = (variant: "production" | "development", name: string) =>
  join(
    EMIT_ROOT,
    variant,
    "packages",
    "jsx-runtime",
    "tests",
    "tsx-fixtures",
    variant,
    `${name}.js`
  );

interface TscResult {
  exit: number;
  output: string;
}

function runTsc(config: string): TscResult {
  const proc = Bun.spawnSync({
    cmd: ["bun", "x", "tsc", "-p", config],
    cwd: FIXTURES_DIR,
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    exit: proc.exitCode,
    output: `${proc.stdout.toString()}${proc.stderr.toString()}`,
  };
}

describe("TN-020 automatic JSX transform fixtures", () => {
  test("production config (react-jsx) compiles all valid fixtures", () => {
    const result = runTsc("tsconfig.production.json");
    if (result.exit !== 0) {
      throw new Error(`production fixture compile failed:\n${result.output}`);
    }
    expect(result.exit).toBe(0);
  });

  test("development config (react-jsxdev) compiles all valid fixtures", () => {
    const result = runTsc("tsconfig.development.json");
    if (result.exit !== 0) {
      throw new Error(`development fixture compile failed:\n${result.output}`);
    }
    expect(result.exit).toBe(0);
  });

  test("emitted imports resolve only through the TenunJS runtime subpath (boundary import)", () => {
    const productionFiles = [
      "simple-intrinsic",
      "nested-children",
      "fragment",
      "multiple-children",
      "keys",
      "function-component",
      "runtime-invalid-prop",
      "keyed-reorder",
      "identity-unkeyed",
      "nested-fragments",
      "children-matrix",
      "component-fragment",
      "determinism",
    ];
    for (const name of productionFiles) {
      const text = readFileSync(EMIT("production", name), "utf-8");
      expect(text).toContain('from "@tenunjs/jsx-runtime/jsx-runtime"');
      expect(text).not.toMatch(/react/i);
      expect(text).not.toContain("React");
    }
    const dev = readFileSync(EMIT("development", "dev-source"), "utf-8");
    expect(dev).toContain('from "@tenunjs/jsx-runtime/jsx-dev-runtime"');
    expect(dev).not.toMatch(/react/i);
  });

  test("production vs development factory selection: _jsx vs _jsxs vs _jsxDEV", () => {
    const simple = readFileSync(EMIT("production", "simple-intrinsic"), "utf-8");
    expect(simple).toContain("_jsx(");
    expect(simple).not.toContain("_jsxs(");

    const multiple = readFileSync(EMIT("production", "multiple-children"), "utf-8");
    expect(multiple).toContain("_jsxs(");

    const dev = readFileSync(EMIT("development", "dev-source"), "utf-8");
    expect(dev).toContain("_jsxDEV(");
  });

  test("simple intrinsic executes to the expected normalized virtual node", async () => {
    const mod = await import(EMIT("production", "simple-intrinsic"));
    const node = mod.node;
    expect(node.kind).toBe("text");
    expect(node.props).toEqual({ variant: "title" });
    expect(node.children).toEqual(["hello"]);
    expect(node.key).toBeNull();
    // Production transform: source metadata is absent by contract.
    expect(node.source).toBeUndefined();
  });

  test("nested children normalize stably", async () => {
    const mod = await import(EMIT("production", "nested-children"));
    const node = mod.node;
    expect(node.kind).toBe("column");
    expect(node.props).toEqual({ gap: "lg", align: "center" });
    expect(node.children.length).toBe(2);
    const [row, card] = node.children;
    expect(row.kind).toBe("row");
    expect(row.children.length).toBe(2);
    expect(row.children[0].kind).toBe("button");
    expect(row.children[0].props).toEqual({ variant: "secondary" });
    expect(row.children[1].props).toEqual({});
    expect(card.kind).toBe("card");
    expect(card.children[0].kind).toBe("text");
    expect(card.children[0].children).toEqual(["42"]);
  });

  test("Fragment stays virtual through the transform: no host kind, never Root", async () => {
    const mod = await import(EMIT("production", "fragment"));
    const node = mod.node;
    expect(node.kind).toBe("column");
    expect(node.children.length).toBe(1);
    const fragment = node.children[0];
    expect(fragment.kind).toBeTypeOf("symbol");
    expect(fragment.kind).not.toBe("root");
    expect(fragment.kind).not.toBe("column");
    expect(fragment.children.map((c: any) => c.kind)).toEqual(["text", "text"]);
    // Fragment props carry no leaked children after normalization.
    expect(Object.keys(fragment.props)).toEqual([]);
  });

  test("multiple static children take the jsxs path with array children", async () => {
    const mod = await import(EMIT("production", "multiple-children"));
    const node = mod.node;
    expect(node.kind).toBe("column");
    expect(node.children.length).toBe(2);
    expect(node.children[0].children).toEqual(["first"]);
  });

  test("key is separated from props via the runtime key argument", async () => {
    const mod = await import(EMIT("production", "keys"));
    const node = mod.keyed;
    expect(node.key).toBe("k-1");
    expect((node.props as Record<string, unknown>).key).toBeUndefined();
    expect(node.props).toEqual({ variant: "body" });
  });

  test("function components execute through the transform path", async () => {
    const mod = await import(EMIT("production", "function-component"));
    const node = mod.node;
    expect(typeof node.kind).toBe("function");
    expect(node.props).toEqual({ name: "Tenun" });
    const rendered = (node.kind as (props: unknown) => unknown)(node.props) as any;
    expect(rendered.kind).toBe("text");
    expect(rendered.children).toEqual(["Hello, ", "Tenun", "!"]);
  });

  test("development transform preserves file/line/column source metadata on the node", async () => {
    const mod = await import(EMIT("development", "dev-source"));
    const node = mod.node;
    expect(node.source).toBeDefined();
    expect(node.source!.fileName).toMatch(/dev-source\.tsx$/);
    expect(node.source!.lineNumber).toBeGreaterThanOrEqual(1);
    expect(node.source!.columnNumber).toBeGreaterThanOrEqual(1);
    // Source is not a prop: it must never leak into props.
    expect((node.props as Record<string, unknown>).source).toBeUndefined();
    expect(node.children).toEqual(["dev"]);
  });

  test("runtime-invalid prop compiles; the codec rejects at NODE CONSTRUCTION (the fixture's top-level JSX executes when its module is imported)", async () => {
    expect.assertions(2);
    try {
      // The rejection is construction-time, not import-side-effect: the
      // fixture's top-level JSX expression runs on module import, which
      // builds the node and invokes the codec. Importing the runtime
      // package itself is inert (proved in virtual-tree-contract.test.ts).
      await import(EMIT("production", "runtime-invalid-prop"));
      throw new Error("module should have been rejected by the prop codec");
    } catch (error) {
      expect((error as Error).message).toContain("TENUN_PROP_INVALID");
      expect((error as Error).message).toContain("button.onPress");
    }
  });

  test("red: typed-invalid prop FAILS compilation (type layer guarantee)", () => {
    const result = runTsc("tsconfig.red-typed-invalid-prop.json");
    expect(result.exit).not.toBe(0);
    expect(result.output).toContain("TS2322");
  });

  test("red: broken runtime subpath FAILS resolution (verification catches a severed transform import)", () => {
    const result = runTsc("tsconfig.red-broken-runtime-subpath.json");
    expect(result.exit).not.toBe(0);
    expect(result.output).toContain("jsx-runtime-missing");
  });
});

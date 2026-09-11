import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { HostWidgetKind } from "@tenunjs/protocol";
import { Fragment, JsxValidationError, jsx, validateProps } from "../src/index";
import type { WidgetNode } from "../src/index";

/**
 * TN-020 slice 2 — the normalized virtual-tree / reconciler-INPUT contract.
 *
 * One question: given valid TenunJS TSX, does the runtime produce a
 * deterministic, unambiguous virtual tree a future reconciler can safely
 * consume? Identity and normalization semantics only — NO diffing, no
 * mutation ops, no transactions (those belong to TN-052/TN-037 and later).
 *
 * Compiled fixtures live in tests/tsx-fixtures/production (built by
 * tsx-transform.test.ts and by the same tsc invocation here); runtime
 * contract edges that cannot be expressed in valid TSX are unit-tested
 * directly against the runtime entrypoints.
 */

const FIXTURES_DIR = join(import.meta.dir, "..", "tests", "tsx-fixtures");
const EMIT = (variant: "production" | "development", name: string) =>
  join(
    FIXTURES_DIR,
    ".out",
    variant,
    "packages",
    "jsx-runtime",
    "tests",
    "tsx-fixtures",
    variant,
    `${name}.js`
  );

async function loadFixture(name: string): Promise<Record<string, unknown>> {
  return import(EMIT("production", name)) as Promise<Record<string, unknown>>;
}

function walkFragmentKinds(node: WidgetNode, seen: unknown[] = []): unknown[] {
  if (node.kind === Fragment) {
    seen.push(node.kind);
    for (const child of node.children) {
      if (child !== null && typeof child === "object" && !Array.isArray(child)) {
        walkFragmentKinds(child as WidgetNode, seen);
      }
    }
  }
  return seen;
}

describe("TN-020 virtual-tree contract — node identity and keys", () => {
  test("keyed reorder retains identity information independent of position", async () => {
    const mod = (await loadFixture("keyed-reorder")) as {
      orderA: WidgetNode;
      orderB: WidgetNode;
    };

    // Author order is preserved in both trees.
    expect(mod.orderA.children.map((c) => (c as WidgetNode).key)).toEqual(["a", "b"]);
    expect(mod.orderB.children.map((c) => (c as WidgetNode).key)).toEqual(["b", "a"]);

    // The key="a" node is deep-equal across trees: its identity travels
    // with (key, kind, props), NOT with its slot. This is precisely the
    // information a future reconciler needs to tell "same nodes reordered"
    // from "two unrelated replacements" — without this contract defining
    // what mutations follow (TN-052 owns that).
    const aInA = mod.orderA.children[0] as WidgetNode;
    const aInB = mod.orderB.children[1] as WidgetNode;
    expect(aInA).toEqual(aInB);

    // Same signature multiset, different order: reorder is distinguishable.
    const signature = (n: WidgetNode) => `${String(n.kind)}|${n.key}|${JSON.stringify(n.props)}`;
    const sigA = mod.orderA.children.map((c) => signature(c as WidgetNode)).sort();
    const sigB = mod.orderB.children.map((c) => signature(c as WidgetNode)).sort();
    expect(sigA).toEqual(sigB);
    expect(mod.orderA.children).not.toEqual(mod.orderB.children);
  });

  test("unkeyed nodes carry null keys: identity is positional by necessity", async () => {
    const mod = (await loadFixture("identity-unkeyed")) as {
      orderA: WidgetNode;
      orderB: WidgetNode;
    };
    for (const tree of [mod.orderA, mod.orderB]) {
      expect(tree.children.every((c) => (c as WidgetNode).key === null)).toBe(true);
    }
    // The two nodes within a tree are deep-equal except for content —
    // nothing but slot order distinguishes them. Keyed vs unkeyed are
    // therefore explicitly different identity semantics.
    expect(mod.orderA.children.length).toBe(2);
  });

  test("key domain: strings and numbers, no coercion — 1 and \"1\" stay distinct", async () => {
    const mod = (await loadFixture("keyed-reorder")) as {
      numericKey: WidgetNode;
      stringKey: WidgetNode;
      zeroKey: WidgetNode;
    };
    expect(mod.numericKey.key).toBe(1);
    expect(typeof mod.numericKey.key).toBe("number");
    expect(mod.stringKey.key).toBe("1");
    expect(typeof mod.stringKey.key).toBe("string");
    // Deliberate divergence from React: no implicit stringification.
    expect(mod.numericKey.key).not.toBe(mod.stringKey.key);
    // Falsy-but-valid numeric key survives (0, not coerced away).
    expect(mod.zeroKey.key).toBe(0);
  });

  test("keys never leak into ordinary props — including on fragments (defect fixed)", () => {
    const frag = jsx(Fragment, { children: ["x"], key: "f1" });
    expect(frag.key).toBe("f1");
    expect((frag.props as Record<string, unknown>).key).toBeUndefined();

    const host = jsx(HostWidgetKind.TEXT, { variant: "body", key: "h1" }, "explicit");
    expect(host.key).toBe("explicit"); // explicit argument wins over props.key
    expect((host.props as Record<string, unknown>).key).toBeUndefined();
  });

  test("runtime red: invalid key types are rejected with a stable TenunJS error", () => {
    for (const bad of [true, false, {}, [], Symbol("k")]) {
      expect(() => jsx(HostWidgetKind.TEXT, {}, bad as never)).toThrow(JsxValidationError);
      expect(() => jsx(HostWidgetKind.TEXT, {}, bad as never)).toThrow(
        /TENUN_JSX_ERROR.*Invalid key/
      );
    }
  });

  test("red: a typed-invalid key FAILS compilation (type layer owns the same domain)", async () => {
    const proc = Bun.spawnSync({
      cmd: ["bun", "x", "tsc", "-p", "tsconfig.red-key-typed-invalid.json"],
      cwd: FIXTURES_DIR,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(proc.exitCode).not.toBe(0);
    expect(`${proc.stdout}${proc.stderr}`).toContain("TS2322");
  });
});

describe("TN-020 virtual-tree contract — component and fragment normalization", () => {
  test("component nodes use the same contract; executing one yields an ordinary subtree", async () => {
    const mod = (await loadFixture("component-fragment")) as { node: WidgetNode };

    // The component reference node itself is a contract node: kind holds
    // the function, props/children/key normalize identically.
    expect(typeof mod.node.kind).toBe("function");
    expect(mod.node.props).toEqual({ title: "Contract", depth: 8 });
    expect(mod.node.key).toBeNull();

    // Executing the component produces fragment + host nodes of the same
    // contract — no special reconciler path exists or is needed.
    const rendered = (mod.node.kind as (p: unknown) => WidgetNode | null)(mod.node.props)!;
    expect(rendered.kind).toBe(Fragment);
    const [title, column] = rendered.children as WidgetNode[];
    expect(title.kind).toBe("text");
    expect(title.props).toEqual({ variant: "title" });
    expect(column.kind).toBe("column");
    expect(column.props).toEqual({ gap: "md", padding: 8 });
  });

  test("components own their props contract: the host codec does NOT validate component props", () => {
    const MyWidget = (props: { variant: number }) =>
      jsx(HostWidgetKind.TEXT, { children: [String(props.variant)] });
    // {variant: 123} would be rejected on a host <text>; on a component it
    // passes construction untouched — the component owns validation.
    const node = jsx(MyWidget, { variant: 123 });
    expect(node.props).toEqual({ variant: 123 });
  });

  test("nested fragments stay virtual — never Root, never a host kind", async () => {
    const mod = (await loadFixture("nested-fragments")) as { node: WidgetNode };
    const fragmentKinds = walkFragmentKinds(mod.node);
    expect(fragmentKinds.length).toBe(2); // outer + inner
    expect(fragmentKinds.every((k) => k === Fragment)).toBe(true);
    expect(fragmentKinds).not.toContain(HostWidgetKind.ROOT);
    expect(fragmentKinds).not.toContain("root");
    // Host text children inside remain ordinary host nodes.
    const inner = mod.node.children[0] as WidgetNode;
    expect((inner.children[0] as WidgetNode).kind).toBe("text");
  });
});

describe("TN-020 virtual-tree contract — children normalization matrix", () => {
  test("every child form normalizes deterministically through real TSX", async () => {
    const mod = (await loadFixture("children-matrix")) as { node: WidgetNode };
    const kinds = mod.node.children.map((c) => typeof c);
    // "plain", 123, "a", "b", "c", <text conditional>, <Fragment>
    expect(mod.node.children.length).toBe(7);
    expect(kinds.filter((k) => k === "string").length).toBe(4); // plain, a, b, c
    expect(mod.node.children[1]).toBe(123); // numbers preserved
    // null, undefined, true, false, and false&&<text> all vanish
    expect(mod.node.children).not.toContain(null);
    expect(mod.node.children).not.toContain(true);
    expect(mod.node.children).not.toContain(false);
    const conditional = mod.node.children[5] as WidgetNode;
    expect(conditional.kind).toBe("text"); // true && <text> survives
    const frag = mod.node.children[6] as WidgetNode;
    expect(frag.kind).toBe(Fragment); // fragments preserved (not flattened away)
    expect((frag.children[0] as WidgetNode).children).toEqual(["in-frag"]);
  });
});

describe("TN-020 virtual-tree contract — validation timing and stability", () => {
  test("prop validation happens at node construction, never at package import", async () => {
    // Importing the runtime package is inert — no nodes are constructed,
    // nothing is validated on load (matters for bundling/hot reload).
    const proc = Bun.spawnSync({
      cmd: ["bun", "-e", "import('@tenunjs/jsx-runtime').then(m => console.log('inert', Object.keys(m).length))"],
      cwd: join(import.meta.dir, ".."),
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(proc.exitCode).toBe(0);
    expect(proc.stdout.toString()).toContain("inert");

    // The runtime validates only when a node is actually constructed.
    const runtime = await import("../src/index");
    expect(() => runtime.jsx(HostWidgetKind.BUTTON, {})).not.toThrow(); // schema allows empty button
    expect(() => runtime.jsx(HostWidgetKind.BUTTON, { onPress: "no" as never })).toThrow(
      /TENUN_PROP_INVALID/
    );
    expect(() => validateProps(HostWidgetKind.BUTTON, { onPress: "no" as never })).toThrow(
      /TENUN_PROP_INVALID/
    );
  });

  test("invalid structures fail with stable TenunJS errors, not platform exceptions", () => {
    const cases: Array<() => unknown> = [
      () => jsx("div" as never, {}), // unknown intrinsic
      () => jsx(42 as never, {}), // numeric kind (a plausible ABI-leak mistake)
      () => jsx(null as never, {}), // null kind
      () => jsx(Fragment, { children: [] }, {} as never), // invalid key on fragment
    ];
    for (const fn of cases) {
      let error: unknown;
      try {
        fn();
      } catch (e) {
        error = e;
      }
      expect(error).toBeInstanceOf(JsxValidationError);
      expect((error as Error).message).toMatch(/^(\[TENUN_JSX_ERROR\]|\[TENUN_PROP_INVALID\])/);
    }
  });

  test("determinism: identical TSX yields structurally equivalent frozen trees", async () => {
    const mod = (await loadFixture("determinism")) as { render: () => WidgetNode };
    const first = mod.render();
    const second = mod.render();
    expect(first).toEqual(second);
    // Normalized output is immutable — safe for a reconciler to retain.
    expect(Object.isFrozen(first.props)).toBe(true);
    expect(Object.isFrozen(first.children)).toBe(true);
    // Key metadata present and stable across renders.
    expect((first.children[0] as WidgetNode).key).toBe("t1");
    expect((second.children[0] as WidgetNode).key).toBe("t1");
  });

  test("source metadata stays diagnostic-only: same TSX, different lines, equal semantics", async () => {
    // Compiled dev fixture from slice 1 carries source; producing the same
    // node via the production path (no source) must be semantically equal
    // in every contract field except `source`.
    const dev = await import(EMIT("development", "dev-source"));
    const devNode = (dev as { node: WidgetNode }).node;
    const prodEquivalent = jsx(devNode.kind as never, { ...devNode.props, children: ["dev"] });
    expect(prodEquivalent.kind).toEqual(devNode.kind);
    expect(prodEquivalent.props).toEqual(devNode.props);
    expect(prodEquivalent.children).toEqual(devNode.children);
    expect(prodEquivalent.source).toBeUndefined();
    expect(devNode.source).toBeDefined();
  });
});

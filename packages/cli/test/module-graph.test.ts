import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../src/config";
import { ModuleGraphError, buildApplicationGraph } from "../src/module-graph";

/**
 * TN-022 acceptance: configuration -> REAL files -> graph/manifest.
 * Discovery never executes application code; canonical output is
 * identical across different checkout roots; every failure mode named in
 * the contract has a deterministic negative fixture.
 */

const REPO_ROOT = join(import.meta.dir, "..", "..", "..");

function makeProject(files: Record<string, string>, links?: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "tn022-"));
  for (const [rel, content] of Object.entries(files)) {
    const p = join(root, rel);
    mkdirSync(p.slice(0, p.lastIndexOf("/")), { recursive: true });
    writeFileSync(p, content);
  }
  for (const [linkPath, target] of Object.entries(links ?? {})) {
    const p = join(root, linkPath);
    mkdirSync(p.slice(0, p.lastIndexOf("/")), { recursive: true });
    symlinkSync(target, p, "dir");
  }
  return root;
}

function canonical(graph: unknown): string {
  return JSON.stringify(graph);
}

const GOOD_APP: Record<string, string> = {
  "src/main.tsx": `import { mount } from "./mount";
import type { AppConfig } from "./types";
export const cfg: AppConfig = { name: "app" };
mount(cfg);`,
  "src/mount.tsx": `import { label } from "./label";
export function mount(cfg: { name: string }): void {
  console.log(label + cfg.name);
}`,
  "src/label.ts": `export const label = "hello";`,
  "src/types.ts": `export interface AppConfig { name: string }`,
  "assets/logo.svg": `<svg xmlns="http://www.w3.org/2000/svg"/>`,
};

describe("TN-022 module graph and asset manifest", () => {
  test("happy path: runtime edges traverse, type-only edges stay type, implicit JSX edge present on .tsx only", () => {
    const root = makeProject(GOOD_APP, {
      "node_modules/@tenunjs/jsx-runtime": join(REPO_ROOT, "packages/jsx-runtime"),
    });
    const { config } = loadConfig({ projectName: "app", entry: "src/main.tsx" });
    const graph = buildApplicationGraph(config, root, { assets: ["assets/logo.svg"] });

    const ids = graph.modules.map((m) => m.id);
    expect(ids).toContain("src/main.tsx");
    expect(ids).toContain("src/mount.tsx");
    expect(ids).toContain("src/label.ts");
    expect(ids).toContain("src/types.ts");

    const main = graph.modules.find((m) => m.id === "src/main.tsx")!;
    // Runtime edge traverses to mount.tsx.
    expect(main.runtimeImports.some((i) => i.resolved === "src/mount.tsx")).toBe(true);
    // Type-only import retained as a TYPE edge — not a runtime dependency.
    const typeEdge = main.typeOnlyImports.find((i) => i.specifier === "./types");
    expect(typeEdge).toBeDefined();
    expect(typeEdge!.edgeKind).toBe("type-only");
    expect(main.runtimeImports.some((i) => i.specifier === "./types")).toBe(false);
    // Implicit automatic-JSX-transform edge: .tsx gains it even though
    // no source text contains it; resolved to the linked package.
    const implicit = main.runtimeImports.find(
      (i) => i.specifier === "@tenunjs/jsx-runtime/jsx-runtime"
    );
    expect(implicit).toBeDefined();
    expect(implicit!.implicit).toBe(true);
    expect(implicit!.resolved).toBe("node_modules/@tenunjs/jsx-runtime/src/jsx-runtime.ts");

    // Plain .ts module: no implicit JSX edge.
    const label = graph.modules.find((m) => m.id === "src/label.ts")!;
    expect(label.runtimeImports.some((i) => i.implicit)).toBe(false);

    // Package edges are leaves: the JSX runtime is an edge, not a module.
    expect(graph.modules.some((m) => m.id.includes("node_modules"))).toBe(false);

    // Asset manifest: logical path, bytes, content hash.
    expect(graph.assets).toEqual([
      {
        id: "assets/logo.svg",
        bytes: Buffer.byteLength(GOOD_APP["assets/logo.svg"]),
        sha256: new Bun.CryptoHasher("sha256")
          .update(GOOD_APP["assets/logo.svg"])
          .digest("hex"),
      },
    ]);

    expect(graph.complete).toBe(true);
    rmSync(root, { recursive: true, force: true });
  });

  test("discovery does not execute application modules", () => {
    const root = makeProject({
      "src/main.ts": `import "./side-effect";
export const ok = true;`,
      "src/side-effect.ts": `if (typeof globalThis.__tn022executed !== "undefined") throw new Error("re-executed");
globalThis.__tn022executed = true;
throw new Error("module was EXECUTED during discovery");`,
    });
    const { config } = loadConfig({ projectName: "app", entry: "src/main.ts" });
    const graph = buildApplicationGraph(config, root);
    expect(graph.complete).toBe(true);
    expect(graph.modules.length).toBe(2);
    // The throwing module was parsed, never run.
    rmSync(root, { recursive: true, force: true });
  });

  test("cycles terminate traversal and are recorded — not dropped, not fatal", () => {
    const root = makeProject({
      "src/main.ts": `import "./a";`,
      "src/a.ts": `import "./b";
export const a = 1;`,
      "src/b.ts": `import "./a";
export const b = 1;`,
    });
    const { config } = loadConfig({ projectName: "app", entry: "src/main.ts" });
    const graph = buildApplicationGraph(config, root);
    expect(graph.complete).toBe(true); // a cycle is a recorded condition, not invalidity
    expect(graph.cycles.length).toBe(1);
    expect([...graph.cycles[0]].sort()).toEqual(["src/a.ts", "src/b.ts"]);
    expect(graph.modules.map((m) => m.id).sort()).toEqual(["src/a.ts", "src/b.ts", "src/main.ts"]);
    rmSync(root, { recursive: true, force: true });
  });

  test("path escape is rejected with importer and specifier context", () => {
    const root = mkdtempSync(join(tmpdir(), "tn022-esc-"));
    const outside = join(root, "outside");
    mkdirSync(outside);
    writeFileSync(join(outside, "secret.ts"), "export const x = 1;");
    const proj = join(root, "project");
    mkdirSync(join(proj, "src"), { recursive: true });
    writeFileSync(join(proj, "src/main.ts"), `import "../../outside/secret";`);
    const { config } = loadConfig({ projectName: "app", entry: "src/main.ts" });
    try {
      expect(() => buildApplicationGraph(config, proj)).toThrow(ModuleGraphError);
      try {
        buildApplicationGraph(config, proj);
      } catch (error) {
        const err = error as ModuleGraphError;
        expect(err.message).toContain("escapes the project root");
        expect(err.importer).toBe("src/main.ts");
        expect(err.specifier).toBe("../../outside/secret");
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("symlink inside project pointing outside is rejected after realpath (declared symlink policy)", () => {
    const parent = mkdtempSync(join(tmpdir(), "tn022-sym-"));
    const outside = join(parent, "outside");
    mkdirSync(outside);
    writeFileSync(join(outside, "o.ts"), "export const x = 1;");
    const root = join(parent, "project");
    mkdirSync(join(root, "src"), { recursive: true });
    symlinkSync(join(outside, "o.ts"), join(root, "src", "link.ts"));
    writeFileSync(join(root, "src/main.ts"), `import "./link";`);
    const { config } = loadConfig({ projectName: "app", entry: "src/main.ts" });
    try {
      expect(() => buildApplicationGraph(config, root)).toThrow(/escapes the project root/);
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  });

  test("missing import target is rejected with full resolution context", () => {
    const root = makeProject({ "src/main.ts": `import "./nope";` });
    const { config } = loadConfig({ projectName: "app", entry: "src/main.ts" });
    try {
      buildApplicationGraph(config, root);
      throw new Error("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(ModuleGraphError);
      expect((error as ModuleGraphError).message).toContain('"./nope" from "src/main.ts"');
    }
    rmSync(root, { recursive: true, force: true });
  });

  test("computed dynamic import marks the graph incomplete — never silently complete", () => {
    const root = makeProject({
      "src/main.ts": `const name = "./" + "x";
async function go() { return import(name); }
export { go };`,
    });
    const { config } = loadConfig({ projectName: "app", entry: "src/main.ts" });
    const graph = buildApplicationGraph(config, root);
    expect(graph.complete).toBe(false);
    expect(
      graph.diagnostics.some((d) => d.code === "TJ_ERR_GRAPH_COMPUTED_DYNAMIC_IMPORT")
    ).toBe(true);
    rmSync(root, { recursive: true, force: true });
  });

  test("alias-style specifier is reported unresolved, never guessed (tsconfig-paths trap)", () => {
    const root = makeProject({
      "src/main.ts": `import { util } from "@app/util";`,
    });
    const { config } = loadConfig({ projectName: "app", entry: "src/main.ts" });
    const graph = buildApplicationGraph(config, root);
    expect(graph.complete).toBe(false);
    const diag = graph.diagnostics.find((d) => d.code === "TJ_ERR_GRAPH_UNRESOLVED_PACKAGE");
    expect(diag).toBeDefined();
    expect(diag!.message).toContain("@app/util");
    expect(diag!.message).toContain("aliases");
    rmSync(root, { recursive: true, force: true });
  });

  test("changing only an asset's bytes changes its content identity, not module identities", () => {
    const files = {
      ...GOOD_APP,
      "assets/logo.svg": `<svg version="1"/>`,
    };
    const rootA = makeProject(files);
    const rootB = makeProject({
      ...files,
      "assets/logo.svg": `<svg version="2"/>`,
    });
    const { config } = loadConfig({ projectName: "app", entry: "src/main.tsx" });
    const graphA = buildApplicationGraph(config, rootA, { assets: ["assets/logo.svg"] });
    const graphB = buildApplicationGraph(config, rootB, { assets: ["assets/logo.svg"] });

    expect(graphA.assets[0].sha256).not.toBe(graphB.assets[0].sha256);
    expect(graphA.modules).toEqual(graphB.modules);
    rmSync(rootA, { recursive: true, force: true });
    rmSync(rootB, { recursive: true, force: true });
  });

  test("canonical output is identical under two different checkout roots", () => {
    const rootA = makeProject(GOOD_APP, {
      "node_modules/@tenunjs/jsx-runtime": join(REPO_ROOT, "packages/jsx-runtime"),
    });
    const rootB = makeProject(GOOD_APP, {
      "node_modules/@tenunjs/jsx-runtime": join(REPO_ROOT, "packages/jsx-runtime"),
    });
    const { config } = loadConfig({ projectName: "app", entry: "src/main.tsx" });
    const a = buildApplicationGraph(config, rootA, { assets: ["assets/logo.svg"] });
    const b = buildApplicationGraph(config, rootB, { assets: ["assets/logo.svg"] });
    expect(canonical(a)).toBe(canonical(b));
    rmSync(rootA, { recursive: true, force: true });
    rmSync(rootB, { recursive: true, force: true });
  });

  test("directory passed as an asset is deterministically rejected (no permission-bit assumptions)", () => {
    const root = makeProject(GOOD_APP);
    mkdirSync(join(root, "assets/dir-asset"), { recursive: true });
    const { config } = loadConfig({ projectName: "app", entry: "src/main.tsx" });
    try {
      buildApplicationGraph(config, root, { assets: ["assets/dir-asset"] });
      throw new Error("should have thrown");
    } catch (error) {
      expect((error as ModuleGraphError).message).toContain("not a readable file");
    }
    rmSync(root, { recursive: true, force: true });
  });

  test("missing asset is rejected", () => {
    const root = makeProject(GOOD_APP);
    const { config } = loadConfig({ projectName: "app", entry: "src/main.tsx" });
    expect(() => buildApplicationGraph(config, root, { assets: ["assets/absent.png"] })).toThrow(
      /not a readable file/
    );
    rmSync(root, { recursive: true, force: true });
  });

  test("consumes the TN-021 config contract: entry and defaults come from the validated config", () => {
    const root = makeProject({
      "app/boot.ts": `export const boot = 1;`,
    });
    // Defaults flow through loadConfig; the builder uses config.entry as-is.
    const { config, diagnostics } = loadConfig({ projectName: "cfg-app", entry: "app/boot.ts" });
    expect(diagnostics.some((d) => d.path === "entry")).toBe(false); // explicitly provided
    const graph = buildApplicationGraph(config, root);
    expect(graph.entry).toBe("app/boot.ts");
    expect(graph.modules.map((m) => m.id)).toEqual(["app/boot.ts"]);
    rmSync(root, { recursive: true, force: true });
  });

  test("development JSX mode hands off to jsx-dev-runtime instead", () => {
    const root = makeProject({ "src/main.tsx": `export const x = 1;` });
    const { config } = loadConfig({ projectName: "app", entry: "src/main.tsx" });
    const graph = buildApplicationGraph(config, root, { jsxDevelopment: true });
    const implicit = graph.modules[0].runtimeImports.find((i) => i.implicit);
    expect(implicit!.specifier).toBe("@tenunjs/jsx-runtime/jsx-dev-runtime");
    rmSync(root, { recursive: true, force: true });
  });

  test("explicit runtime import suppresses the duplicate implicit edge", () => {
    const root = makeProject({
      "src/main.tsx": `import { jsx } from "@tenunjs/jsx-runtime/jsx-runtime";
export const x = 1;`,
      "node_modules/@tenunjs/jsx-runtime": join(REPO_ROOT, "packages/jsx-runtime"),
    });
    const { config } = loadConfig({ projectName: "app", entry: "src/main.tsx" });
    const graph = buildApplicationGraph(config, root);
    const edges = graph.modules[0].runtimeImports.filter((i) =>
      i.specifier.includes("jsx-runtime")
    );
    expect(edges.length).toBe(1);
    expect(Boolean(edges[0].implicit)).toBe(false);
    rmSync(root, { recursive: true, force: true });
  });
});

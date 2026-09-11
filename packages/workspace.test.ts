import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, normalize, relative } from "node:path";
import { createScanner, SyntaxKind } from "typescript/unstable/ast";

/**
 * Workspace dependency topology and package boundary enforcement (TN-019).
 *
 * Two enforcement layers:
 *  1. Manifest level: declared package.json dependencies honor the policy map.
 *  2. Source level: actual module specifiers in every package's .ts/.tsx
 *     files are extracted by PARSING (never regex):
 *       - Bun's transpiler scan for runtime import forms (static import,
 *         export-from, export *, dynamic import, require, import-equals,
 *         side-effect imports);
 *       - the TypeScript token scanner for type-only forms
 *         (`import type ...`, `export type ...`), which the transpiler
 *         erases but which still create compile-time dependency edges.
 *     Forbidden-import fixtures below prove the checker goes red.
 */

const PACKAGES_DIR = import.meta.dir;

const expectedPackages = [
  "protocol",
  "jsx-runtime",
  "core",
  "widgets",
  "navigation",
  "cli",
];

/** TenunJS package dependency policy: what each package may depend on. */
const allowedDependencies: Record<string, string[]> = {
  "@tenunjs/protocol": [],
  "@tenunjs/jsx-runtime": ["@tenunjs/protocol"],
  "@tenunjs/core": ["@tenunjs/protocol", "@tenunjs/jsx-runtime"],
  "@tenunjs/widgets": ["@tenunjs/protocol", "@tenunjs/jsx-runtime"],
  "@tenunjs/navigation": ["@tenunjs/protocol", "@tenunjs/jsx-runtime", "@tenunjs/core"],
  "@tenunjs/cli": ["@tenunjs/protocol"],
};

function readPackageManifest(pkg: string): { name: string; dependencies: string[] } {
  const pkgJson = JSON.parse(readFileSync(join(PACKAGES_DIR, pkg, "package.json"), "utf-8"));
  return {
    name: pkgJson.name,
    dependencies: Object.keys(pkgJson.dependencies || {}),
  };
}

// ---------------------------------------------------------------------------
// Source-level module-specifier extraction (parser-based, no regex)
// ---------------------------------------------------------------------------

const transpiler = new Bun.Transpiler({ loader: "tsx" });

// TS7 renamed EndOfFileToken -> EndOfFile; an undefined member here would
// make token comparisons silently never match (the infinite-walk class of
// bug), so fail loudly instead.
const SCANNER_KINDS = {
  import: SyntaxKind.ImportKeyword,
  export: SyntaxKind.ExportKeyword,
  type: SyntaxKind.TypeKeyword,
  stringLiteral: SyntaxKind.StringLiteral,
  semicolon: SyntaxKind.SemicolonToken,
  equals: SyntaxKind.EqualsToken,
  endOfFile: SyntaxKind.EndOfFile,
} as const;
for (const [name, value] of Object.entries(SCANNER_KINDS)) {
  if (typeof value !== "number") {
    throw new Error(`typescript/unstable/ast SyntaxKind.${name} is not numeric (got ${String(value)}); scanner pass is invalid`);
  }
}

/**
 * Type-only import/export module specifiers via the TypeScript token
 * scanner, in a single sequential pass. A specifier is captured only when a
 * StringLiteral appears inside a type-only clause BEFORE any `=` (type
 * alias) or `;` (clause end) — so `export type NodeId = number` is not
 * mistaken for an import. Note: string-literal export names inside
 * `export type { a as "x" } from "mod"` would capture the local name;
 * fail-closed noise is acceptable, no such code exists in this workspace.
 */
function typeOnlySpecifiers(sourceText: string): string[] {
  const scanner = createScanner(true, undefined, sourceText, 0, sourceText.length);
  const found: string[] = [];
  let inTypeClause = false;
  let prev: number = scanner.scan();
  while (prev !== SCANNER_KINDS.endOfFile) {
    const cur: number = scanner.scan();
    if (cur === SCANNER_KINDS.endOfFile) break;
    if ((prev === SCANNER_KINDS.import || prev === SCANNER_KINDS.export) && cur === SCANNER_KINDS.type) {
      inTypeClause = true;
    } else if (inTypeClause) {
      if (cur === SCANNER_KINDS.stringLiteral) {
        found.push(scanner.getTokenValue());
        inTypeClause = false;
      } else if (cur === SCANNER_KINDS.semicolon || cur === SCANNER_KINDS.equals) {
        inTypeClause = false;
      }
    }
    prev = cur;
  }
  return found;
}

function collectModuleSpecifiers(sourceText: string): string[] {
  const runtime = transpiler.scanImports(sourceText).map((entry) => entry.path);
  return [...new Set([...runtime, ...typeOnlySpecifiers(sourceText)])];
}

type ImportCheck = { ok: true } | { ok: false; reason: string };

/**
 * Checks one module specifier against the package's declared dependencies
 * and the workspace dependency policy.
 */
function checkSpecifier(opts: {
  specifier: string;
  fromFile: string;
  packageName: string;
  declaredDeps: readonly string[];
}): ImportCheck {
  const { specifier, fromFile, packageName, declaredDeps } = opts;

  if (specifier.startsWith("node:") || specifier.startsWith("bun:")) {
    return { ok: true };
  }

  if (specifier.startsWith("@tenunjs/")) {
    if (specifier === packageName) return { ok: true };
    if (!declaredDeps.includes(specifier)) {
      return {
        ok: false,
        reason: `"${specifier}" is imported but not declared in ${packageName}/package.json dependencies`,
      };
    }
    if (!(allowedDependencies[packageName] || []).includes(specifier)) {
      return {
        ok: false,
        reason: `"${specifier}" from ${packageName} violates the TenunJS package dependency policy`,
      };
    }
    return { ok: true };
  }

  if (specifier.startsWith("./") || specifier.startsWith("../")) {
    // fromFile is "<pkgDir>/<relative path>", so a legal in-package relative
    // import must still normalize to a path inside the package directory.
    const pkgDir = packageName.slice("@tenunjs/".length);
    const target = normalize(join(dirname(fromFile), specifier));
    if (!target.startsWith(pkgDir + "/") && target !== pkgDir) {
      return {
        ok: false,
        reason: `relative import "${specifier}" escapes package ${packageName}`,
      };
    }
    return { ok: true };
  }

  if (declaredDeps.includes(specifier)) return { ok: true };
  return {
    ok: false,
    reason: `external module "${specifier}" is not a declared dependency of ${packageName}`,
  };
}

function violationsForSource(
  packageName: string,
  declaredDeps: readonly string[],
  fromFile: string,
  sourceText: string
): string[] {
  const violations: string[] = [];
  for (const specifier of collectModuleSpecifiers(sourceText)) {
    const check = checkSpecifier({ specifier, fromFile, packageName, declaredDeps });
    if (!check.ok) {
      violations.push(`${packageName}:${fromFile}: ${check.reason}`);
    }
  }
  return violations;
}

function listSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listSourceFiles(path));
    } else if (entry.isFile() && (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx"))) {
      out.push(path);
    }
  }
  return out;
}

function realTreeViolations(): string[] {
  const violations: string[] = [];
  for (const pkg of expectedPackages) {
    const manifest = readPackageManifest(pkg);
    for (const area of ["src", "test"]) {
      const areaDir = join(PACKAGES_DIR, pkg, area);
      if (!existsSync(areaDir)) continue;
      for (const file of listSourceFiles(areaDir)) {
        const relFile = `${pkg}/${relative(PACKAGES_DIR, file)}`;
        violations.push(
          ...violationsForSource(
            manifest.name,
            manifest.dependencies,
            relFile,
            readFileSync(file, "utf-8")
          )
        );
      }
    }
  }
  return violations;
}

describe("workspace dependency topology and package boundaries (TN-019)", () => {
  test("all canonical packages exist with valid package.json manifests", () => {
    for (const pkg of expectedPackages) {
      const pkgJsonPath = join(PACKAGES_DIR, pkg, "package.json");
      expect(existsSync(pkgJsonPath)).toBe(true);

      const pkgJson = JSON.parse(readFileSync(pkgJsonPath, "utf-8"));
      expect(pkgJson.name).toBe(`@tenunjs/${pkg}`);
      expect(pkgJson.license).toBe("MIT");
      expect(pkgJson.version).toMatch(/^\d+\.\d+\.\d+/);
      expect(pkgJson.main).toBe("src/index.ts");
      expect(pkgJson.types).toBe("src/index.ts");
      expect(pkgJson.type).toBe("module");
    }
  });

  test("enforces strict architectural dependency boundaries (no upward or illegal links)", () => {
    for (const pkg of expectedPackages) {
      const pkgJson = JSON.parse(readFileSync(join(PACKAGES_DIR, pkg, "package.json"), "utf-8"));
      const pkgName = pkgJson.name;

      const declaredDeps = Object.keys(pkgJson.dependencies || {});
      const allowed = allowedDependencies[pkgName];
      expect(allowed).toBeDefined();

      for (const dep of declaredDeps) {
        expect(allowed).toContain(dep);
      }
    }
  });

  test("no package imports or depends on React (ADR-0003 enforcement)", () => {
    for (const pkg of expectedPackages) {
      const pkgJson = JSON.parse(readFileSync(join(PACKAGES_DIR, pkg, "package.json"), "utf-8"));
      const allDeps = {
        ...(pkgJson.dependencies || {}),
        ...(pkgJson.devDependencies || {}),
        ...(pkgJson.peerDependencies || {}),
      };
      expect(allDeps["react"]).toBeUndefined();
      expect(allDeps["react-dom"]).toBeUndefined();
      expect(allDeps["@types/react"]).toBeUndefined();
    }
  });

  test("dependency graph is strictly acyclic", () => {
    const adjList: Record<string, string[]> = {};
    for (const pkg of expectedPackages) {
      const pkgJson = JSON.parse(readFileSync(join(PACKAGES_DIR, pkg, "package.json"), "utf-8"));
      adjList[pkgJson.name] = Object.keys(pkgJson.dependencies || {});
    }

    const visited = new Set<string>();
    const recursionStack = new Set<string>();

    function hasCycle(node: string): boolean {
      visited.add(node);
      recursionStack.add(node);

      for (const neighbor of adjList[node] || []) {
        if (!visited.has(neighbor)) {
          if (hasCycle(neighbor)) return true;
        } else if (recursionStack.has(neighbor)) {
          return true;
        }
      }

      recursionStack.delete(node);
      return false;
    }

    for (const pkg of Object.keys(adjList)) {
      if (!visited.has(pkg)) {
        expect(hasCycle(pkg)).toBe(false);
      }
    }
  });

  test("source-level imports honor declared dependencies and the policy map (green over the real tree)", () => {
    expect(realTreeViolations()).toEqual([]);
  });

  test("boundary checker rejects forbidden imports (red fixtures, mutation evidence)", () => {
    // Real declared deps for fixtures that exercise the undeclared/external
    // branches; fabricated deps for the declared-but-policy-forbidden branch.
    const widgets = readPackageManifest("widgets");
    const jsxRuntime = readPackageManifest("jsx-runtime");

    // Undeclared internal package import (static import form).
    expect(
      violationsForSource(widgets.name, widgets.dependencies, "widgets/src/a.ts", 'import { defineScreen } from "@tenunjs/core";')
    ).toEqual([
      '@tenunjs/widgets:widgets/src/a.ts: "@tenunjs/core" is imported but not declared in @tenunjs/widgets/package.json dependencies',
    ]);

    // Declared in package.json but forbidden by the policy map.
    expect(
      checkSpecifier({
        specifier: "@tenunjs/navigation",
        fromFile: "cli/src/index.ts",
        packageName: "@tenunjs/cli",
        declaredDeps: ["@tenunjs/navigation"],
      })
    ).toEqual({
      ok: false,
      reason: '"@tenunjs/navigation" from @tenunjs/cli violates the TenunJS package dependency policy',
    });

    // Dynamic import of an undeclared internal package.
    expect(
      violationsForSource(jsxRuntime.name, jsxRuntime.dependencies, "jsx-runtime/src/dyn.ts", 'const m = await import("@tenunjs/widgets");')
    ).toHaveLength(1);

    // export ... from an undeclared internal package.
    expect(
      violationsForSource(widgets.name, widgets.dependencies, "widgets/src/reexport.ts", 'export * from "@tenunjs/navigation";')
    ).toHaveLength(1);

    // import type ... from an undeclared internal package (erased at runtime,
    // caught by the token-scanner pass).
    expect(
      violationsForSource(widgets.name, widgets.dependencies, "widgets/src/types.ts", 'import type { WidgetNode } from "@tenunjs/core";')
    ).toHaveLength(1);

    // CommonJS require of an undeclared internal package.
    expect(
      violationsForSource(widgets.name, widgets.dependencies, "widgets/src/cjs.ts", 'const c = require("@tenunjs/core");')
    ).toHaveLength(1);

    // Relative import escaping the package root (widgets/src/../../ leaves
    // the widgets package entirely).
    expect(
      violationsForSource(widgets.name, widgets.dependencies, "widgets/src/a.ts", 'import x from "../../protocol/src/index.ts";')
    ).toHaveLength(1);

    // In-package relative import stays legal (no violation).
    expect(
      violationsForSource(widgets.name, widgets.dependencies, "widgets/src/deep/a.ts", 'import x from "../button";')
    ).toHaveLength(0);

    // Undeclared external (npm) dependency.
    expect(
      violationsForSource(widgets.name, widgets.dependencies, "widgets/src/leftpad.ts", 'import leftPad from "left-pad";')
    ).toHaveLength(1);
  });
});

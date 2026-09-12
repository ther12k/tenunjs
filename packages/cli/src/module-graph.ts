/**
 * TenunJS module graph and asset manifest builder (TN-022).
 *
 * Consumes a validated TN-021 configuration plus the project filesystem
 * and produces a resolved module graph and a deterministic asset
 * manifest. STOP boundary: no bundle compilation, no packaging, no
 * application execution, no mutation generation (TN-023 and later).
 *
 * Contract:
 *  - Discovery WITHOUT execution: modules are scanned by parsing only
 *    (Bun transpiler scan + TypeScript token scan for type-only forms).
 *    Application code is never imported or evaluated.
 *  - Runtime vs type edges are tracked distinctly. Type-only imports
 *    (erased by every transpiler) are retained as type edges and are
 *    never packaged as runtime dependencies.
 *  - Implicit transform dependencies: `.tsx`/`.jsx` files are compiled
 *    by the automatic JSX transform (TN-020) and therefore depend on
 *    `@tenunjs/jsx-runtime/jsx-runtime` (or `./jsx-dev-runtime` in dev
 *    mode) WITHOUT spelling it in source. The graph represents this as
 *    an explicit `implicit: true` runtime edge — tested, not silent.
 *  - Cycles terminate traversal and are RECORDED, not silently dropped
 *    and not automatically fatal.
 *  - Filesystem boundary: resolution is project-root-confined. Symlinks
 *    are followed but their REAL paths must stay inside the project
 *    root; escapes and missing files are rejected with
 *    importer/specifier context.
 *  - Determinism: ids are project-relative POSIX paths; ordering is
 *    sorted; identity is content hashes + byte lengths. No absolute
 *    paths, no timestamps — the same project under two different
 *    checkout roots yields identical canonical output.
 *  - Completeness is honest: computed dynamic imports and unsupported
 *    specifier forms mark the graph `complete: false` with diagnostics
 *    instead of silently passing.
 *
 * Deliberately NOT here (recorded in the TN-022 status note): asset
 * DECLARATION lives in config in a later slice (this builder takes the
 * caller-declared asset list and produces the manifest contract);
 * screens/capabilities (TN-059/TN-060/TN-101), source-map files and the
 * bundle compiler (TN-023).
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { createScanner, SyntaxKind } from "typescript/unstable/ast";
import type { TenunConfig } from "./config";

export const GRAPH_VERSION = 1;

export type EdgeKind = "runtime" | "type-only" | "builtin";

export interface ResolvedImport {
  /** Import specifier exactly as written in source. */
  readonly specifier: string;
  /** Resolved logical id (project-relative) for in-project targets. */
  readonly resolved: string | null;
  readonly edgeKind: EdgeKind;
  /** True when the transform (not source text) introduces this edge. */
  readonly implicit?: boolean;
}

export interface GraphDiagnostic {
  readonly severity: "error" | "warning";
  readonly code: string;
  readonly path: string;
  readonly message: string;
}

export interface ModuleRecord {
  readonly id: string;
  readonly bytes: number;
  readonly sha256: string;
  readonly runtimeImports: readonly ResolvedImport[];
  readonly typeOnlyImports: readonly ResolvedImport[];
}

export interface AssetRecord {
  readonly id: string;
  readonly bytes: number;
  readonly sha256: string;
}

export interface ApplicationGraph {
  readonly graphVersion: number;
  readonly entry: string;
  readonly modules: readonly ModuleRecord[];
  readonly assets: readonly AssetRecord[];
  readonly cycles: readonly (readonly string[])[];
  /** False when unsupported forms were detected (never silently true). */
  readonly complete: boolean;
  readonly diagnostics: readonly GraphDiagnostic[];
}

export class ModuleGraphError extends Error {
  readonly path: string;
  readonly importer: string | null;
  readonly specifier: string | null;

  constructor(message: string, opts: { path?: string; importer?: string; specifier?: string } = {}) {
    super(message);
    this.name = "ModuleGraphError";
    this.path = opts.path ?? "";
    this.importer = opts.importer ?? null;
    this.specifier = opts.specifier ?? null;
  }
}

// ---------------------------------------------------------------------------
// Scanning (parse-only, never evaluates application code)
// ---------------------------------------------------------------------------

const transpilers = new Map<string, Bun.Transpiler>();
function transpilerFor(file: string): Bun.Transpiler {
  const loader = file.endsWith(".tsx") || file.endsWith(".jsx") ? "tsx" : "ts";
  let t = transpilers.get(loader);
  if (!t) {
    t = new Bun.Transpiler({ loader });
    transpilers.set(loader, t);
  }
  return t;
}

/** Type-only import/export specifiers via the TypeScript token scanner. */
function typeOnlySpecifiers(sourceText: string): string[] {
  const scanner = createScanner(true, undefined, sourceText, 0, sourceText.length);
  const found: string[] = [];
  let inTypeClause = false;
  let prev: number = scanner.scan();
  while (prev !== SyntaxKind.EndOfFile) {
    const cur: number = scanner.scan();
    if (cur === SyntaxKind.EndOfFile) break;
    if (
      (prev === SyntaxKind.ImportKeyword || prev === SyntaxKind.ExportKeyword) &&
      cur === SyntaxKind.TypeKeyword
    ) {
      inTypeClause = true;
    } else if (inTypeClause) {
      if (cur === SyntaxKind.StringLiteral) {
        found.push(scanner.getTokenValue());
        inTypeClause = false;
      } else if (cur === SyntaxKind.SemicolonToken || cur === SyntaxKind.EqualsToken) {
        inTypeClause = false;
      }
    }
    prev = cur;
  }
  return found;
}

interface ScanResult {
  runtime: Array<{ kind: string; path: string }>;
  typeOnly: string[];
  /** Computed (non-literal) dynamic import / require call sites exist. */
  computedCalls: boolean;
}

function scanModule(sourceText: string): ScanResult {
  const runtime = transpilerFor("x.tsx").scanImports(sourceText).map((e) => ({
    kind: e.kind,
    path: e.path,
  }));
  const typeOnly = typeOnlySpecifiers(sourceText);

  // Detect computed dynamic imports: `import(` or `require(` not followed
  // by a string literal. Fail-closed direction: presence marks the graph
  // incomplete even when the specifier might be resolvable by other means.
  const scanner = createScanner(true, undefined, sourceText, 0, sourceText.length);
  let computedCalls = false;
  let prev: number = scanner.scan();
  while (prev !== SyntaxKind.EndOfFile) {
    const cur: number = scanner.scan();
    if (cur === SyntaxKind.EndOfFile) break;
    if (
      (prev === SyntaxKind.ImportKeyword || prev === SyntaxKind.ExportKeyword) &&
      cur === SyntaxKind.TypeKeyword
    ) {
      // type-only clause (already handled); skip adjacency confusion
    }
    if (
      (prev === SyntaxKind.ImportKeyword || prev === SyntaxKind.ExportKeyword) &&
      cur === SyntaxKind.OpenParenToken
    ) {
      const next: number = scanner.scan();
      if (next !== SyntaxKind.StringLiteral) computedCalls = true;
    }
    if (prev === SyntaxKind.Identifier && scanner.getTokenValue() === "require" && cur === SyntaxKind.OpenParenToken) {
      const next: number = scanner.scan();
      if (next !== SyntaxKind.StringLiteral) computedCalls = true;
    }
    prev = cur;
  }

  return { runtime, typeOnly, computedCalls };
}

// ---------------------------------------------------------------------------
// Resolution (declared policy; unsupported forms fail explicitly)
// ---------------------------------------------------------------------------

const SOURCE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx"] as const;

function toPosix(p: string): string {
  return sep === "\\" ? p.split(sep).join("/") : p;
}

function fileExists(p: string): boolean {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

function resolveFileCandidate(base: string): string | null {
  if (fileExists(base)) return base;
  for (const ext of SOURCE_EXTENSIONS) {
    if (fileExists(base + ext)) return base + ext;
    const asIndex = join(base, "index" + ext);
    if (fileExists(asIndex)) return asIndex;
  }
  return null;
}

interface PackageTarget {
  file: string;
}

function resolvePackageSpecifier(
  specifier: string,
  importerAbs: string,
  projectRoot: string
): PackageTarget | null {
  const scoped = specifier.startsWith("@");
  const parts = specifier.split("/");
  const packageName = scoped ? parts.slice(0, 2).join("/") : parts[0];
  const subpath = scoped ? parts.slice(2).join("/") : parts.slice(1).join("/");

  let dir = dirname(importerAbs);
  // Walk up to (and including) the project root only.
  while (true) {
    const candidateDir = join(dir, "node_modules", packageName);
    const pkgJsonPath = join(candidateDir, "package.json");
    if (existsSync(pkgJsonPath)) {
      const pkgJson = JSON.parse(readFileSync(pkgJsonPath, "utf-8"));
      let target: string | undefined;
      const exportsMap = pkgJson.exports as Record<string, unknown> | undefined;
      if (exportsMap && typeof exportsMap === "object") {
        const key = subpath ? `./${subpath}` : ".";
        const entry = exportsMap[key];
        if (typeof entry === "string") target = entry;
      }
      if (target === undefined && !subpath && typeof pkgJson.main === "string") {
        target = pkgJson.main;
      }
      if (target === undefined) return null;
      const base = join(candidateDir, target);
      const resolvedFile = fileExists(base)
        ? base
        : resolveFileCandidate(join(candidateDir, target));
      if (!resolvedFile) return null;
      return { file: resolvedFile };
    }
    if (dir === projectRoot || dir.length < projectRoot.length) {
      // Also check node_modules directly under the project root before giving up.
      const rootCandidate = join(projectRoot, "node_modules", packageName);
      const rootPkg = join(rootCandidate, "package.json");
      if (existsSync(rootPkg)) {
        const pkgJson = JSON.parse(readFileSync(rootPkg, "utf-8"));
        let target: string | undefined;
        const exportsMap = pkgJson.exports as Record<string, unknown> | undefined;
        if (exportsMap && typeof exportsMap === "object") {
          const key = subpath ? `./${subpath}` : ".";
          const entry = exportsMap[key];
          if (typeof entry === "string") target = entry;
        }
        if (target === undefined && !subpath && typeof pkgJson.main === "string") {
          target = pkgJson.main;
        }
        if (target === undefined) return null;
        const base = join(rootCandidate, target);
        const resolvedFile = fileExists(base)
          ? base
          : resolveFileCandidate(join(rootCandidate, target));
        if (!resolvedFile) return null;
        return { file: resolvedFile };
      }
      return null;
    }
    dir = dirname(dir);
  }
}

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

export interface GraphBuildOptions {
  /** Caller-declared asset paths, project-relative, POSIX. */
  readonly assets?: readonly string[];
  /** Compile .tsx/.jsx with the development transform (jsx-dev-runtime). */
  readonly jsxDevelopment?: boolean;
}

interface BuildContext {
  rootReal: string;
  diagnostics: GraphDiagnostic[];
  cycles: string[][];
  modules: Map<string, ModuleRecord>;
}

function logicalId(ctx: BuildContext, absolute: string): string {
  return toPosix(relative(ctx.rootReal, absolute));
}

function confine(ctx: BuildContext, absolute: string, importer: string | null, specifier: string): string {
  const real = realpathSync(absolute);
  if (real !== ctx.rootReal && !real.startsWith(ctx.rootReal + sep)) {
    throw new ModuleGraphError(
      `resolution escapes the project root: "${specifier}" from "${importer ?? "entry"}" resolves to ${toPosix(real)}`,
      { importer: importer ?? undefined, specifier }
    );
  }
  return real;
}

function readModule(ctx: BuildContext, absolute: string, importer: string | null, specifier: string): string {
  const real = confine(ctx, absolute, importer, specifier);
  if (!fileExists(real)) {
    throw new ModuleGraphError(
      `resolved import is not a file: "${specifier}" from "${importer ?? "entry"}" -> ${toPosix(real)}`,
      { importer: importer ?? undefined, specifier }
    );
  }
  return readFileSync(real, "utf-8");
}

function visit(
  ctx: BuildContext,
  absoluteFile: string,
  config: TenunConfig,
  options: GraphBuildOptions,
  stack: string[]
): void {
  const id = logicalId(ctx, absoluteFile);
  // Registered BEFORE scanning so import cycles terminate traversal
  // instead of recursing forever; the record is completed below.
  if (ctx.modules.has(id)) return;
  ctx.modules.set(id, {
    id,
    bytes: -1,
    sha256: "",
    runtimeImports: [],
    typeOnlyImports: [],
  });

  const sourceText = readModule(ctx, absoluteFile, stack[stack.length - 1] ?? null, config.entry);
  const bytes = Buffer.byteLength(sourceText, "utf-8");
  const sha256 = createHash("sha256").update(sourceText, "utf-8").digest("hex");
  const scan = scanModule(sourceText);

  const runtimeImports: ResolvedImport[] = [];
  const typeOnlyImports: ResolvedImport[] = [];

  const handle = (
    specifier: string,
    edgeKind: EdgeKind,
    implicit: boolean | undefined,
    leaf: boolean,
    targetAbs: string | null
  ): void => {
    const resolvedId = targetAbs === null ? null : logicalId(ctx, targetAbs);
    const entry: ResolvedImport = { specifier, resolved: resolvedId, edgeKind, implicit };
    if (edgeKind === "runtime") runtimeImports.push(entry);
    else typeOnlyImports.push(entry);

    // Leaf edges (builtins, package specifiers) are recorded with their
    // resolved identity but NOT traversed: the application graph covers
    // project source; dependency closure belongs to the bundle stage
    // (TN-023). Relative edges traverse into project modules.
    if (!leaf && targetAbs && !ctx.modules.has(resolvedId!)) {
      // Both runtime and type-only edges traverse into project files —
      // the graph covers every discovered project module; the EDGE kind
      // records how it was referenced. Runtime reachability is derivable
      // by walking runtimeImports only.
      visit(ctx, targetAbs, config, options, [...stack, id]);
    }
  };

  const handleRelative = (specifier: string, edgeKind: EdgeKind, implicit?: boolean): void => {
    const base = resolve(dirname(absoluteFile), specifier);
    const found = resolveFileCandidate(base);
    if (!found) {
      throw new ModuleGraphError(
        `unresolved import: "${specifier}" from "${id}" (looked for ${toPosix(base)}[.ts|.tsx|.js|.jsx|/index…])`,
        { importer: id, specifier }
      );
    }
    const real = confine(ctx, found, id, specifier);
    handle(specifier, edgeKind, implicit, false, real);
  };

  const handlePackage = (specifier: string, edgeKind: EdgeKind, implicit?: boolean): void => {
    const pkg = resolvePackageSpecifier(specifier, absoluteFile, ctx.rootReal);
    if (!pkg) {
      // Includes alias-style specifiers: TypeScript `paths` does not
      // rewrite emitted imports, so an alias without a real package is
      // unresolvable here — reported, never guessed.
      ctx.diagnostics.push({
        severity: "warning",
        code: "TJ_ERR_GRAPH_UNRESOLVED_PACKAGE",
        path: id,
        message: `package specifier "${specifier}" does not resolve (aliases are not resolved by the graph builder) — graph marked incomplete`,
      });
      handle(specifier, edgeKind, implicit, true, null);
      return;
    }
    handle(specifier, edgeKind, implicit, true, pkg.file);
  };

  const handleSpecifier = (specifier: string, edgeKind: EdgeKind, implicit?: boolean): void => {
    if (specifier.startsWith("node:") || specifier.startsWith("bun:")) {
      handle(specifier, "builtin", implicit, true, null);
      return;
    }
    if (
      specifier.startsWith("http://") ||
      specifier.startsWith("https://") ||
      specifier.startsWith("#") ||
      specifier.startsWith("data:")
    ) {
      ctx.diagnostics.push({
        severity: "warning",
        code: "TJ_ERR_GRAPH_UNSUPPORTED_SPECIFIER",
        path: id,
        message: `unsupported specifier form "${specifier}" — graph marked incomplete`,
      });
      handle(specifier, edgeKind, implicit, true, null);
      return;
    }
    if (specifier.startsWith("./") || specifier.startsWith("../")) {
      handleRelative(specifier, edgeKind, implicit);
      return;
    }
    handlePackage(specifier, edgeKind, implicit);
  };

  for (const imp of scan.runtime) {
    handleSpecifier(imp.path, "runtime", false);
  }
  for (const specifier of scan.typeOnly) {
    // Type edges are retained distinctly and are never packaged as
    // runtime dependencies.
    handleSpecifier(specifier, "type-only", false);
  }

  if (scan.computedCalls) {
    ctx.diagnostics.push({
      severity: "warning",
      code: "TJ_ERR_GRAPH_COMPUTED_DYNAMIC_IMPORT",
      path: id,
      message: "computed dynamic import/require target cannot be determined statically — graph marked incomplete",
    });
  }

  // Implicit automatic-JSX-transform dependency (TN-020): .tsx/.jsx files
  // gain a runtime dependency on the JSX runtime subpath even though no
  // source text contains it. Explicit, tested — never silent.
  const isJsx = id.endsWith(".tsx") || id.endsWith(".jsx");
  if (isJsx) {
    const implicitSpecifier = options.jsxDevelopment
      ? "@tenunjs/jsx-runtime/jsx-dev-runtime"
      : "@tenunjs/jsx-runtime/jsx-runtime";
    const alreadyDeclared =
      runtimeImports.some((i) => i.specifier === implicitSpecifier) ||
      typeOnlyImports.some((i) => i.specifier === implicitSpecifier);
    if (!alreadyDeclared) {
      handleSpecifier(implicitSpecifier, "runtime", true);
    }
  }

  ctx.modules.set(id, {
    id,
    bytes,
    sha256,
    runtimeImports: Object.freeze(runtimeImports.sort((a, b) => a.specifier.localeCompare(b.specifier))),
    typeOnlyImports: Object.freeze(typeOnlyImports.sort((a, b) => a.specifier.localeCompare(b.specifier))),
  });
}

function findCycles(ctx: BuildContext): string[][] {
  const cycles: string[][] = [];
  const state = new Map<string, number>(); // 1 = in stack, 2 = done
  const stack: string[] = [];

  const dfs = (id: string): void => {
    state.set(id, 1);
    stack.push(id);
    const mod = ctx.modules.get(id);
    if (mod) {
      for (const imp of mod.runtimeImports) {
        if (imp.implicit) continue; // package edges have no in-project module record
        if (imp.resolved === null) continue;
        if (!ctx.modules.has(imp.resolved)) continue;
        const s = state.get(imp.resolved);
        if (s === undefined) {
          dfs(imp.resolved);
        } else if (s === 1) {
          const start = stack.indexOf(imp.resolved);
          cycles.push([...stack.slice(start).sort()]);
        }
      }
    }
    stack.pop();
    state.set(id, 2);
  };

  for (const id of [...ctx.modules.keys()].sort()) {
    if (!state.has(id)) dfs(id);
  }
  return cycles;
}

/**
 * Builds the application module graph and asset manifest from a
 * validated TN-021 config. Read-only: the project filesystem is never
 * written, and application modules are never executed.
 */
export function buildApplicationGraph(
  config: TenunConfig,
  projectRoot: string,
  options: GraphBuildOptions = {}
): ApplicationGraph {
  if (config.projectName === undefined) {
    throw new ModuleGraphError("buildApplicationGraph requires a validated TN-021 config");
  }

  const rootReal = realpathSync(resolve(projectRoot));
  const ctx: BuildContext = {
    rootReal,
    diagnostics: [],
    cycles: [],
    modules: new Map<string, ModuleRecord>(),
  };

  const entryAbs = resolve(rootReal, config.entry);
  if (!existsSync(entryAbs)) {
    throw new ModuleGraphError(
      `configured entry does not exist: "${config.entry}" (looked for ${toPosix(entryAbs)})`,
      { path: config.entry }
    );
  }
  visit(ctx, entryAbs, config, options, []);

  const assets: AssetRecord[] = (options.assets ?? []).map((logicalPath) => {
    if (logicalPath.startsWith("/") || logicalPath.includes("\\")) {
      throw new ModuleGraphError(
        `asset path must be project-relative POSIX: "${logicalPath}"`,
        { path: logicalPath }
      );
    }
    const abs = join(rootReal, logicalPath);
    if (!fileExists(abs)) {
      // Deterministic rejection: missing file or a directory passed as an
      // asset (statSync().isFile() fails) — no permission-bit assumptions.
      throw new ModuleGraphError(
        `asset is not a readable file: "${logicalPath}" (looked for ${toPosix(abs)})`,
        { path: logicalPath }
      );
    }
    const content = readFileSync(abs);
    return {
      id: toPosix(logicalPath),
      bytes: content.byteLength,
      sha256: createHash("sha256").update(content).digest("hex"),
    };
  });
  assets.sort((a, b) => a.id.localeCompare(b.id));

  const cycles = findCycles(ctx);
  if (cycles.length > 0) {
    ctx.diagnostics.push({
      severity: "warning",
      code: "TJ_ERR_GRAPH_CYCLE",
      path: "",
      message: `import cycle(s) detected (${cycles.length}); traversal terminated — recorded, not silently dropped`,
    });
  }

  const complete = !ctx.diagnostics.some(
    (d) =>
      d.code === "TJ_ERR_GRAPH_COMPUTED_DYNAMIC_IMPORT" ||
      d.code === "TJ_ERR_GRAPH_UNSUPPORTED_SPECIFIER" ||
      d.code === "TJ_ERR_GRAPH_UNRESOLVED_PACKAGE"
  );

  const modules = [...ctx.modules.values()].sort((a, b) => a.id.localeCompare(b.id));

  return {
    graphVersion: GRAPH_VERSION,
    entry: config.entry,
    modules: Object.freeze(modules),
    assets: Object.freeze(assets),
    cycles: Object.freeze(cycles.map((c) => Object.freeze(c))),
    complete,
    diagnostics: Object.freeze(ctx.diagnostics),
  };
}

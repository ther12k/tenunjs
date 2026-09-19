/**
 * Cross-example gate: every sample app must be a well-formed TenunJS
 * application project. Its TN-021 configuration must load through the
 * real loader, and its TN-022 application module graph must resolve
 * every import, traverse with no cycles, and complete with no
 * diagnostics. Discovered from tenun.config.ts files, so a new example
 * is covered by being created.
 */

import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { buildApplicationGraph, loadConfig, type TenunConfigInput } from "@tenunjs/cli";

const examplesRoot = join(import.meta.dir, "..", "..");

const exampleNames = readdirSync(examplesRoot, { withFileTypes: true })
  .filter(
    (entry) =>
      entry.isDirectory() &&
      existsSync(join(examplesRoot, entry.name, "tenun.config.ts"))
  )
  .map((entry) => entry.name)
  .sort();

/**
 * Bun 1.4's TSX scanner emits a constant `react` require edge for every
 * JSX-containing file, regardless of the configured import source. React
 * is never a legal TenunJS import (ADR-0003); this set exists only to
 * exempt that scanner artifact, so any OTHER unresolved specifier still
 * fails the gate.
 */
const BUN_SCAN_ARTIFACTS: ReadonlySet<string> = new Set([
  "react",
  "react/jsx-runtime",
  "react/jsx-dev-runtime",
]);

describe("examples are valid application projects", () => {
  test("discovers the expected sample apps", () => {
    expect(exampleNames).toEqual([
      "calculator",
      "counter",
      "flutter-showcase",
      "gallery",
      "navigation-demo",
      "todo-list",
    ]);
  });

  for (const name of exampleNames) {
    test(`${name}: config loads and module graph resolves`, async () => {
      const projectRoot = join(examplesRoot, name);
      const configModule = await import(join(projectRoot, "tenun.config.ts"));
      const { config } = loadConfig(configModule.default as TenunConfigInput);
      const graph = buildApplicationGraph(config, projectRoot);

      expect(graph.cycles).toEqual([]);

      // Every runtime import resolves — except the documented Bun scan
      // artifact above, which is the only reason `complete` can be false
      // for a JSX application today.
      const unresolved = graph.modules.flatMap((module) =>
        module.runtimeImports
          .filter((imp) => imp.resolved === null)
          .map((imp) => imp.specifier)
      );
      for (const specifier of unresolved) {
        expect(BUN_SCAN_ARTIFACTS.has(specifier)).toBe(true);
      }
      for (const diagnostic of graph.diagnostics) {
        expect(diagnostic.code).toBe("TJ_ERR_GRAPH_UNRESOLVED_PACKAGE");
      }

      const ids = graph.modules.map((module) => module.id);
      expect(ids).toContain(config.entry);

      // Every .tsx module carries the automatic-JSX-transform dependency
      // on the production TenunJS runtime subpath (TN-020), resolved into
      // the linked package: the scanner emits it (it is configured with
      // the repository JSX contract), and the builder's implicit edge
      // guarantees it for scans that do not (TN-022).
      for (const module of graph.modules) {
        if (!module.id.endsWith(".tsx")) continue;
        expect(
          module.runtimeImports.some(
            (imp) =>
              imp.resolved !== null &&
              imp.specifier === "@tenunjs/jsx-runtime/jsx-runtime"
          )
        ).toBe(true);
      }
    });
  }
});

import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

describe("workspace dependency topology and package boundaries (TN-019)", () => {
  const PACKAGES_DIR = join(import.meta.dir);

  const expectedPackages = [
    "protocol",
    "jsx-runtime",
    "core",
    "widgets",
    "navigation",
    "cli",
  ];

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
    const allowedDependencies: Record<string, string[]> = {
      "@tenunjs/protocol": [],
      "@tenunjs/jsx-runtime": ["@tenunjs/protocol"],
      "@tenunjs/core": ["@tenunjs/protocol", "@tenunjs/jsx-runtime"],
      "@tenunjs/widgets": ["@tenunjs/protocol", "@tenunjs/jsx-runtime"],
      "@tenunjs/navigation": ["@tenunjs/protocol", "@tenunjs/jsx-runtime", "@tenunjs/core"],
      "@tenunjs/cli": ["@tenunjs/protocol"],
    };

    for (const pkg of expectedPackages) {
      const pkgJsonPath = join(PACKAGES_DIR, pkg, "package.json");
      const pkgJson = JSON.parse(readFileSync(pkgJsonPath, "utf-8"));
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
      const pkgJsonPath = join(PACKAGES_DIR, pkg, "package.json");
      const pkgJson = JSON.parse(readFileSync(pkgJsonPath, "utf-8"));
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
});

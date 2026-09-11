import { describe, expect, test } from "bun:test";
import {
  CONFIG_VERSION,
  TenunConfigError,
  defineConfig,
  loadConfig,
} from "../src/config";

describe("@tenunjs/cli — project configuration (TN-021)", () => {
  test("exposes a config schema version", () => {
    expect(CONFIG_VERSION).toBe(1);
  });

  test("minimal config loads with explicit, reported defaults", () => {
    const { config, diagnostics } = loadConfig({ projectName: "my-app" });

    expect(config.projectName).toBe("my-app");
    expect(config.displayName).toBe("my-app");
    expect(config.platforms).toEqual(["ios", "android"]);
    expect(config.entry).toBe("src/main.tsx");
    expect(config.outDir).toBe("dist");
    expect(config.diagnostics).toBe(false);

    // Defaults are explicit and inspectable — never silently implicit.
    const defaulted = diagnostics.filter((d) => d.severity === "default").map((d) => d.path);
    expect(defaulted).toEqual([
      "displayName",
      "platforms",
      "entry",
      "outDir",
      "diagnostics",
    ]);
  });

  test("full config loads with zero default diagnostics", () => {
    const { config, diagnostics } = loadConfig({
      projectName: "orders-tool",
      displayName: "Orders Tool",
      platforms: ["android"],
      entry: "app/index.tsx",
      outDir: "build/out",
      diagnostics: true,
    });

    expect(config.displayName).toBe("Orders Tool");
    expect(config.platforms).toEqual(["android"]);
    expect(config.entry).toBe("app/index.tsx");
    expect(config.outDir).toBe("build/out");
    expect(config.diagnostics).toBe(true);
    expect(diagnostics.filter((d) => d.severity === "default")).toEqual([]);
  });

  test("loaded config is deeply frozen and deterministic", () => {
    const first = loadConfig({ projectName: "same" });
    const second = loadConfig({ projectName: "same" });
    expect(first).toEqual(second);
    expect(Object.isFrozen(first.config)).toBe(true);
    expect(Object.isFrozen(first.config.platforms)).toBe(true);
    expect(Object.isFrozen(first.diagnostics)).toBe(true);
  });

  test("fails closed on non-object input", () => {
    for (const bad of [null, 42, "config", [], true]) {
      try {
        loadConfig(bad);
        throw new Error(`should have thrown for ${JSON.stringify(bad)}`);
      } catch (error) {
        expect(error).toBeInstanceOf(TenunConfigError);
        expect((error as TenunConfigError).code).toBe("TJ_ERR_CONFIG_TYPE");
        expect((error as TenunConfigError).path).toBe("");
      }
    }
  });

  test("rejects unknown top-level keys (never partially honors untrusted config)", () => {
    try {
      loadConfig({ projectName: "x", platform: "ios" }); // typo'd key
      throw new Error("should have thrown");
    } catch (error) {
      const err = error as TenunConfigError;
      expect(err.code).toBe("TJ_ERR_CONFIG_UNKNOWN_KEY");
      expect(err.path).toBe("platform");
    }
  });

  test("projectName enforces the machine-safe pattern", () => {
    for (const bad of ["My App", "my_app", "-leading", "", "   "]) {
      try {
        loadConfig({ projectName: bad });
        throw new Error(`should have thrown for "${bad}"`);
      } catch (error) {
        const err = error as TenunConfigError;
        expect(err.path).toBe("projectName");
        expect(["TJ_ERR_CONFIG_VALUE", "TJ_ERR_CONFIG_MISSING"]).toContain(err.code);
      }
    }
    expect(() => loadConfig({ projectName: "a" })).not.toThrow();
    expect(() => loadConfig({ projectName: "app-2" })).not.toThrow();
  });

  test("missing required field has a stable missing-code", () => {
    try {
      loadConfig({});
      throw new Error("should have thrown");
    } catch (error) {
      const err = error as TenunConfigError;
      expect(err.code).toBe("TJ_ERR_CONFIG_MISSING");
      expect(err.path).toBe("projectName");
    }
  });

  test("platforms: rejects non-array, empty, duplicates, and unknown entries without coercion", () => {
    const bad: Array<[unknown, string]> = [
      ["ios", "platforms"], // string instead of array — no coercion
      [[], "platforms"],
      [["ios", "ios"], "platforms[1]"],
      [["ios", "web"], "platforms[1]"],
      [["ios", 1], "platforms[1]"],
    ];
    for (const [value, expectedPath] of bad) {
      try {
        loadConfig({ projectName: "x", platforms: value as never });
        throw new Error(`should have thrown for ${JSON.stringify(value)}`);
      } catch (error) {
        const err = error as TenunConfigError;
        expect(err.path).toBe(expectedPath);
      }
    }
  });

  test("paths must be project-relative and non-empty", () => {
    for (const field of ["entry", "outDir"] as const) {
      try {
        loadConfig({ projectName: "x", [field]: "/absolute/path" });
        throw new Error("should have thrown");
      } catch (error) {
        expect((error as TenunConfigError).path).toBe(field);
        expect((error as TenunConfigError).message).toContain("project-relative");
      }
      try {
        loadConfig({ projectName: "x", [field]: "   " });
        throw new Error("should have thrown");
      } catch (error) {
        expect((error as TenunConfigError).path).toBe(field);
      }
    }
  });

  test("diagnostics flag accepts only booleans", () => {
    try {
      loadConfig({ projectName: "x", diagnostics: "true" });
      throw new Error("should have thrown");
    } catch (error) {
      expect((error as TenunConfigError).path).toBe("diagnostics");
      expect((error as TenunConfigError).message).toContain("expected boolean, got string");
    }
  });

  test("defineConfig validates eagerly and freezes for trusted authoring", () => {
    const authored = defineConfig({ projectName: "authored", platforms: ["ios"] });
    expect(Object.isFrozen(authored)).toBe(true);
    expect(authored.platforms).toEqual(["ios"]);
    expect(() => defineConfig({ projectName: "Bad Name" })).toThrow(TenunConfigError);
  });
});

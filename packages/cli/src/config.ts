/**
 * TenunJS project configuration schema and loader (TN-021).
 *
 * Typed, fail-closed application project configuration with explicit
 * diagnostics and defaults (build-packaging stage 1: "Validate typed
 * project configuration").
 *
 * Guarantees:
 *  - NO coercion anywhere: a value is either exactly the declared type or
 *    the load fails with a structured, path-addressable error.
 *  - Unknown top-level keys are rejected (an untrusted config must never
 *    be partially honored).
 *  - Defaults are explicit and REPORTED: every applied default produces a
 *    diagnostic entry, so a config relying on defaults is inspectable, not
 *    silently implicit.
 *  - Loaded configs are deeply frozen and deterministic: the same input
 *    yields a structurally identical result every time.
 *
 * Placement note: this contract lives in `@tenunjs/cli` (developer
 * tooling home; TN-105/TN-106 consume it here). Downstream non-CLI
 * consumers (e.g. TN-022's module-graph builder) must declare their
 * dependency per the workspace policy — if that proves wrong, it is a
 * TN-022 boundary conflict to record then, not pre-solved now.
 */

export const CONFIG_VERSION = 1;

export type Platform = "ios" | "android";

export interface TenunConfigInput {
  /** Machine-safe project identifier: /^[a-z][a-z0-9-]*$/. Required. */
  readonly projectName: string;
  /** Human-facing name. Defaults to projectName. */
  readonly displayName?: string;
  /** Target platforms, order preserved. Defaults to ["ios", "android"]. */
  readonly platforms?: readonly Platform[];
  /** Application entry module, relative to the project root. */
  readonly entry?: string;
  /** Build output directory, relative to the project root. */
  readonly outDir?: string;
  /** Application-level diagnostics toggle (not the loader's diagnostics). */
  readonly diagnostics?: boolean;
}

export interface TenunConfig {
  readonly projectName: string;
  readonly displayName: string;
  readonly platforms: readonly Platform[];
  readonly entry: string;
  readonly outDir: string;
  readonly diagnostics: boolean;
}

export type TenunConfigErrorCode =
  | "TJ_ERR_CONFIG_TYPE"
  | "TJ_ERR_CONFIG_UNKNOWN_KEY"
  | "TJ_ERR_CONFIG_MISSING"
  | "TJ_ERR_CONFIG_VALUE";

export class TenunConfigError extends Error {
  /** Dotted field path ("projectName", "platforms[1]", "" for the root). */
  readonly path: string;
  readonly code: TenunConfigErrorCode;

  constructor(code: TenunConfigErrorCode, path: string, message: string) {
    super(`[${code}] ${path || "<root>"}: ${message}`);
    this.name = "TenunConfigError";
    this.code = code;
    this.path = path;
  }
}

export interface ConfigDiagnostic {
  /** "default" = an explicit default was applied; "warning" = non-fatal. */
  readonly severity: "default" | "warning";
  readonly path: string;
  readonly message: string;
}

export interface ConfigLoadResult {
  readonly config: TenunConfig;
  readonly diagnostics: readonly ConfigDiagnostic[];
}

const PROJECT_NAME_PATTERN = /^[a-z][a-z0-9-]*$/;
const KNOWN_KEYS: ReadonlySet<string> = new Set([
  "projectName",
  "displayName",
  "platforms",
  "entry",
  "outDir",
  "diagnostics",
]);
const KNOWN_PLATFORMS: ReadonlySet<string> = new Set(["ios", "android"]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(
  source: Record<string, unknown>,
  key: string,
  opts: { required: true; pattern?: RegExp }
): string;
function requireString(
  source: Record<string, unknown>,
  key: string,
  opts?: { required?: false; pattern?: RegExp }
): string | undefined;
function requireString(
  source: Record<string, unknown>,
  key: string,
  opts: { required?: boolean; pattern?: RegExp } = {}
): string | undefined {
  const raw = source[key];
  if (raw === undefined) {
    if (opts.required) {
      throw new TenunConfigError("TJ_ERR_CONFIG_MISSING", key, "required field is missing");
    }
    return undefined;
  }
  if (typeof raw !== "string") {
    throw new TenunConfigError("TJ_ERR_CONFIG_TYPE", key, `expected string, got ${typeof raw}`);
  }
  if (raw.trim().length === 0) {
    throw new TenunConfigError("TJ_ERR_CONFIG_VALUE", key, "must not be empty or whitespace");
  }
  if (raw.startsWith("/")) {
    throw new TenunConfigError(
      "TJ_ERR_CONFIG_VALUE",
      key,
      "must be a project-relative path (no leading '/')"
    );
  }
  if (opts.pattern && !opts.pattern.test(raw)) {
    throw new TenunConfigError(
      "TJ_ERR_CONFIG_VALUE",
      key,
      `must match ${opts.pattern.source}`
    );
  }
  return raw;
}

/**
 * Validates untrusted configuration input, applies documented defaults
 * (each reported as a diagnostic), and returns a frozen config.
 * Throws `TenunConfigError` on the first violation.
 */
export function loadConfig(source: unknown): ConfigLoadResult {
  if (!isPlainObject(source)) {
    throw new TenunConfigError(
      "TJ_ERR_CONFIG_TYPE",
      "",
      `expected a config object, got ${Array.isArray(source) ? "array" : typeof source}`
    );
  }

  const diagnostics: ConfigDiagnostic[] = [];
  const noteDefault = (path: string, message: string): void => {
    diagnostics.push({ severity: "default", path, message });
  };

  for (const key of Object.keys(source)) {
    if (!KNOWN_KEYS.has(key)) {
      throw new TenunConfigError(
        "TJ_ERR_CONFIG_UNKNOWN_KEY",
        key,
        `"${key}" is not a known config key`
      );
    }
  }

  const projectName = requireString(source, "projectName", {
    required: true,
    pattern: PROJECT_NAME_PATTERN,
  });

  let displayName = requireString(source, "displayName");
  if (displayName === undefined) {
    displayName = projectName;
    noteDefault("displayName", `applied default (projectName: "${projectName}")`);
  }

  let platforms: readonly Platform[] | undefined;
  const rawPlatforms = source.platforms;
  if (rawPlatforms === undefined) {
    platforms = Object.freeze(["ios", "android"] as const);
    noteDefault("platforms", 'applied default (["ios", "android"])');
  } else {
    if (!Array.isArray(rawPlatforms)) {
      throw new TenunConfigError(
        "TJ_ERR_CONFIG_TYPE",
        "platforms",
        `expected an array, got ${typeof rawPlatforms}`
      );
    }
    if (rawPlatforms.length === 0) {
      throw new TenunConfigError("TJ_ERR_CONFIG_VALUE", "platforms", "must not be empty");
    }
    const seen = new Set<string>();
    const validated: Platform[] = [];
    rawPlatforms.forEach((entry, index) => {
      if (typeof entry !== "string" || !KNOWN_PLATFORMS.has(entry)) {
        throw new TenunConfigError(
          "TJ_ERR_CONFIG_VALUE",
          `platforms[${index}]`,
          `expected "ios" or "android", got ${typeof entry === "string" ? `"${entry}"` : typeof entry}`
        );
      }
      if (seen.has(entry)) {
        throw new TenunConfigError(
          "TJ_ERR_CONFIG_VALUE",
          `platforms[${index}]`,
          `duplicate platform "${entry}"`
        );
      }
      seen.add(entry);
      validated.push(entry as Platform);
    });
    platforms = Object.freeze(validated);
  }

  let entry = requireString(source, "entry");
  if (entry === undefined) {
    entry = "src/main.tsx";
    noteDefault("entry", 'applied default ("src/main.tsx")');
  }

  let outDir = requireString(source, "outDir");
  if (outDir === undefined) {
    outDir = "dist";
    noteDefault("outDir", 'applied default ("dist")');
  }

  let appDiagnostics: boolean;
  if (source.diagnostics === undefined) {
    appDiagnostics = false;
    noteDefault("diagnostics", "applied default (false)");
  } else if (typeof source.diagnostics !== "boolean") {
    throw new TenunConfigError(
      "TJ_ERR_CONFIG_TYPE",
      "diagnostics",
      `expected boolean, got ${typeof source.diagnostics}`
    );
  } else {
    appDiagnostics = source.diagnostics;
  }

  return {
    config: Object.freeze({
      projectName,
      displayName,
      platforms,
      entry,
      outDir,
      diagnostics: appDiagnostics,
    }),
    diagnostics: Object.freeze(diagnostics),
  };
}

/**
 * Trusted authoring helper for TS config files: validates eagerly and
 * returns an immutable input. Same fail-closed rules as `loadConfig`.
 */
export function defineConfig(source: TenunConfigInput): TenunConfigInput {
  loadConfig(source); // validation only — defineConfig keeps the author's shape
  return Object.freeze({ ...source });
}

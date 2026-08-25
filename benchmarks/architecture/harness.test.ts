import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { assembleEvidence, collectHost, collectSource, step, writeEvidence } from "./harness";

describe("evidence harness", () => {
  test("collects host and source metadata", () => {
    const host = collectHost();
    expect(host.os).toBeString();
    expect(host.arch).toBeString();
    expect(host.mem_total_bytes).toBeNumber();

    const src = collectSource(new URL("../../", import.meta.url).pathname);
    expect(src.commit).not.toBe("");
    expect(typeof src.dirty).toBe("boolean");
  });

  test("records step timing and exit codes", () => {
    const okStep = step("true-probe", "true");
    expect(okStep.exit_code).toBe(0);
    expect(okStep.duration_ms).toBeGreaterThanOrEqual(0);

    const failStep = step("false-probe", "echo boom >&2; exit 3");
    expect(failStep.exit_code).toBe(3);
    expect(failStep.stderr_tail).toContain("boom");
  });

  test("writes reproducible evidence packet", async () => { // long timeout for CI cold caches
    const repoRoot = new URL("../../", import.meta.url).pathname;
    const evidence = await assembleEvidence("selftest", repoRoot, [step("probe", "true")], ["self-test"]);
    const file = await writeEvidence(evidence, "/tmp/tenunjs-evidence-test");
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    expect(parsed.schema_version).toBe(1);
    expect(parsed.label).toBe("selftest");
    expect(parsed.steps).toHaveLength(1);
    expect(parsed.timestamp_utc).toBeString();
  }, 30000);
});

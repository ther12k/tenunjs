import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type StepResult = {
  name: string;
  command: string;
  exit_code: number | null;
  duration_ms: number;
  stdout_tail: string;
  stderr_tail: string;
  timed_out: boolean;
};

export type Evidence = {
  schema_version: 1;
  label: string;
  timestamp_utc: string;
  source: { commit: string; dirty: boolean; changed_files: number };
  host: { os: string; arch: string; kernel: string; cpu_model: string; mem_total_bytes: number };
  tools: Record<string, string>;
  steps: StepResult[];
  reproducibility: { commands: string[] };
};

const TAIL = 4000;

function run(cmd: string, args: string[]) {
  const r = spawnSync(cmd, args, { encoding: "utf8", timeout: 120_000 });
  return { ok: r.status === 0, out: (r.stdout ?? "").trim(), err: (r.stderr ?? "").trim() };
}

export function collectHost(): Evidence["host"] {
  return {
    os: process.platform,
    arch: process.arch,
    kernel: run("uname", ["-sr"]).out || "unknown",
    cpu_model:
      run("sh", ["-c", "grep -m1 'model name' /proc/cpuinfo | cut -d: -f2 | xargs"]).out || "unknown",
    mem_total_bytes: Number(
      run("sh", ["-c", "awk '/MemTotal/ {print $2*1024}' /proc/meminfo"]).out || 0
    ),
  };
}

export function collectSource(repoRoot: string): Evidence["source"] {
  const commit = run("git", ["-C", repoRoot, "rev-parse", "HEAD"]);
  // evidence packets are outputs, not source: exclude this directory from
  // dirtiness so a packet can truthfully describe the tree that produced it
  const status = run("git", [
    "-C",
    repoRoot,
    "status",
    "--porcelain",
    "--",
    ".",
    ":(exclude)benchmarks/architecture/evidence",
  ]);
  return {
    commit: commit.ok ? commit.out : "no-git",
    dirty: !commit.ok || status.out.length > 0,
    changed_files: commit.ok ? status.out.split("\n").filter(Boolean).length : 0,
  };
}

export function collectTools(names: string[]): Record<string, string> {
  const tools: Record<string, string> = {};
  for (const t of names) {
    const v = run(t, ["--version"]);
    tools[t] = v.ok ? v.out.split("\n")[0] : "not-found";
  }
  return tools;
}

export function step(name: string, cmd: string): StepResult {
  const started = performance.now();
  const r = spawnSync("sh", ["-c", cmd], { encoding: "utf8", timeout: 600_000 });
  return {
    name,
    command: cmd,
    exit_code: r.status,
    duration_ms: Math.round(performance.now() - started),
    stdout_tail: (r.stdout ?? "").slice(-TAIL),
    stderr_tail: (r.stderr ?? "").slice(-TAIL),
    timed_out: r.error?.message?.includes("TIMEOUT") ?? false,
  };
}

export async function assembleEvidence(label: string, repoRoot: string, steps: StepResult[], commands: string[]): Promise<Evidence> {
  return {
    schema_version: 1,
    label,
    timestamp_utc: new Date().toISOString(),
    source: collectSource(repoRoot),
    host: collectHost(),
    tools: collectTools(["bun", "node", "cc", "clang++", "rustc"]),
    steps,
    reproducibility: { commands },
  };
}

export async function writeEvidence(evidence: Evidence, outDir: string): Promise<string> {
  mkdirSync(outDir, { recursive: true });
  const file = join(outDir, `${evidence.label}.evidence.json`);
  writeFileSync(file, JSON.stringify(evidence, null, 2));
  return file;
}

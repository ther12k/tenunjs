# Architecture spike benchmark and evidence harness

Closes the tooling half of TN-005: every M0 spike (TN-007, TN-008, TN-011, TN-012, TN-015, TN-016) records its evidence through this harness so candidates are compared on identical, reproducible packets.

## Usage

```sh
bun run benchmarks/architecture/run.ts --label <label> --step <name> "<command>" [--step <name> "<command>" ...]
```

Each `--step` runs through `sh -c`, capturing exit code, wall-clock duration, and stdout/stderr tails. The packet lands in `benchmarks/architecture/evidence/<label>/<label>.evidence.json`.

## Packet schema

| Field | Meaning |
| --- | --- |
| `schema_version` | 1 while this shape holds |
| `source.commit` / `dirty` / `changed_files` | exact source state under test; dirty trees are flagged and must be justified in the PR |
| `host` | OS, arch, kernel, CPU model, total memory |
| `tools` | probed versions of bun/node/cc/clang++/rustc (`not-found` recorded honestly) |
| `steps[]` | name, command, exit code, duration, output tails, timeout flag |
| `reproducibility.commands` | the exact commands a reviewer re-runs from clean checkout |

## Rules

- Device evidence for physical-device claims still requires the embedder-side recorder (added with TN-007/TN-008); this harness is the shared envelope they write into.
- A missing measurement is recorded as `not-found`/null — never omitted silently.
- Evidence JSON files are committed alongside the spike PR that produced them.

## Self-test

```sh
bun test benchmarks/architecture
```

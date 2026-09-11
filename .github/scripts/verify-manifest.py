#!/usr/bin/env python3
"""Content-manifest integrity gate (review follow-up to PR #170/#183).

08-validation/MANIFEST.md is an integrity control over the OKF design pack:
it must remain a bijective, correctly-hashed, ASCII-sorted index of every
governed Markdown resource. Drift previously went undetected (three stale
hashes and four missing entries accumulated while CI stayed green) because
no check consumed the manifest; this script makes the property enforced.

Scope (declared explicitly, not inferred):
  governed  = every *.md under the pack directories, plus the four root
              pack files, minus the declared exclusions below.
  excluded  = 08-validation/MANIFEST.md (the manifest cannot hash itself).

Checks (all fail closed):
  1. bijection: indexed set == governed set (no missing, no extra entries)
  2. no duplicate indexed paths
  3. every recorded SHA-256 matches the live file bytes
  4. every row is well formed: "| <path> | <64 lowercase hex> |"
  5. rows are strictly ASCII-sorted by path
  6. no excluded path is indexed

--selftest builds a synthetic tree in a temp directory, regenerates a known
good manifest with the same row format, then applies mutations (stale hash,
missing entry, extra entry, duplicate, bad format, unsorted) and fails if
any mutation goes undetected.
"""

import hashlib
import re
import shutil
import sys
import tempfile
from pathlib import Path

GOVERNED_DIRS = [
    "00-project", "01-requirements", "02-architecture", "03-decisions",
    "04-api", "05-delivery", "06-issues", "07-agent", "08-validation",
    "references",
]
ROOT_FILES = ["README.md", "index.md", "log.md", "CONTRIBUTING.md"]
EXCLUDED = {"08-validation/MANIFEST.md"}

MANIFEST = Path("08-validation/MANIFEST.md")
ROW_RE = re.compile(r"^\| (\S+) \| ([0-9a-f]{64}) \|$")


def fail(msg: str) -> None:
    print(f"MANIFEST VALIDATION FAIL: {msg}")
    sys.exit(1)


def governed_paths(root: Path) -> set:
    paths = set()
    for d in GOVERNED_DIRS:
        walk = root / d
        if not walk.is_dir():
            continue
        paths |= {str(p.relative_to(root)) for p in walk.rglob("*.md")}
    paths |= {f for f in ROOT_FILES if (root / f).exists()}
    return paths - EXCLUDED


def parse_rows(text: str):
    """Returns (rows, malformed) where rows is the ordered path->hash list."""
    rows = []
    malformed = []
    in_table = False
    for line in text.splitlines():
        if line.startswith("| Path | SHA-256 |"):
            in_table = True
            continue
        if not in_table:
            continue
        if line.startswith("| --- |"):
            continue
        if not line.startswith("|"):
            continue
        m = ROW_RE.match(line)
        if m:
            rows.append((m.group(1), m.group(2)))
        else:
            malformed.append(line)
    return rows, malformed


def check(root: Path) -> list:
    problems = []
    text = (root / MANIFEST).read_text()
    rows, malformed = parse_rows(text)
    problems += [f"malformed row: {line!r}" for line in malformed]

    indexed = {}
    for path, digest in rows:
        if path in indexed:
            problems.append(f"duplicate indexed path: {path}")
        indexed[path] = digest
        if path in EXCLUDED:
            problems.append(f"excluded path is indexed: {path}")
        live = root / path
        if not live.exists():
            problems.append(f"indexed path missing from tree: {path}")
        elif hashlib.sha256(live.read_bytes()).hexdigest() != digest:
            problems.append(f"stale hash: {path}")

    scope = governed_paths(root)
    missing = scope - set(indexed)
    extra = set(indexed) - scope
    problems += [f" governed file not indexed: {p}" for p in sorted(missing)]
    problems += [f"indexed file outside governed scope: {p}" for p in sorted(extra)]

    ordered = [p for p, _ in rows]
    problems += [
        f"rows not ASCII-sorted at: {ordered[i - 1]} > {ordered[i]}"
        for i in range(1, len(ordered))
        if ordered[i - 1] > ordered[i]
    ]
    return problems


# ---------------------------------------------------------------------------
# selftest: the checker must detect every mutation class it exists for
# ---------------------------------------------------------------------------

def build_tree(base: Path, files: dict) -> None:
    for rel, content in files.items():
        p = base / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(content)


def good_manifest(root: Path) -> str:
    rows = []
    for rel in sorted(governed_paths(root)):
        digest = hashlib.sha256((root / rel).read_bytes()).hexdigest()
        rows.append(f"| {rel} | {digest} |")
    return (
        "---\nokf_version: 0.2\ntitle: \"Content Manifest\"\n"
        "summary: test\ntype: manifest\nstatus: accepted\n---\n\n"
        "# Content manifest\n\n| Path | SHA-256 |\n| --- | --- |\n"
        + "\n".join(rows) + "\n"
    )


def selftest() -> None:
    base_files = {
        "00-project/a.md": "alpha\n",
        "00-project/b.md": "beta\n",
        "01-requirements/c.md": "gamma\n",
        "README.md": "root\n",
    }
    mutations = {
        "stale hash": lambda root, man: build_tree(root, {"00-project/a.md": "MUTATED\n"}),
        "missing entry": lambda root, man: man.write_text(
            good_manifest(root).replace("| 00-project/a.md |", "| 00-project/zz.md | 0 |  #", 1)
            .split("\n#")[0] + "\n".join(
                l for l in good_manifest(root).splitlines() if not l.startswith("| 00-project/a.md ")
            ) + "\n"
        ),
        "extra entry": lambda root, man: build_tree(root, {"99-extra/x.md": "x\n"})
        or man.write_text(
            good_manifest(root).rstrip("\n") + "\n| 99-extra/x.md | "
            + hashlib.sha256(b"x\n").hexdigest() + " |\n"
        ),
        "duplicate row": lambda root, man: man.write_text(
            good_manifest(root).rstrip("\n") + "\n"
            + [l for l in good_manifest(root).splitlines() if l.startswith("| 00-project/a.md ")][0]
            + "\n"
        ),
        "bad format": lambda root, man: man.write_text(
            good_manifest(root).replace("| 00-project/b.md |", "|00-project/b.md|", 1)
        ),
        "unsorted rows": lambda root, man: (build_tree(root, {"00-project/aa.md": "aa\n"}), man.write_text(
            "\n".join(
                sorted(
                    l for l in good_manifest(root).splitlines() if l.startswith("| ") and "Path" not in l and "---" not in l
                )
                + ["| 00-project/aa.md | " + hashlib.sha256(b"aa\n").hexdigest() + " |"]
            ) + "\n"
        )),
    }

    for name, mutate in mutations.items():
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            build_tree(root, base_files)
            man = root / MANIFEST
            man.parent.mkdir(parents=True, exist_ok=True)
            man.write_text(good_manifest(root))
            assert check(root) == [], f"selftest baseline must be clean before mutation {name}"
            mutate(root, man)
            problems = check(root)
            if not problems:
                fail(f"selftest: mutation '{name}' went UNDETECTED")
            print(f"selftest: mutation '{name}' detected ({len(problems)} problem(s))")

    print("MANIFEST CHECKER SELFTEST PASS")


def main() -> None:
    if "--selftest" in sys.argv:
        selftest()
        return
    problems = check(Path("."))
    if problems:
        for p in problems:
            print(f"MANIFEST PROBLEM: {p}")
        fail(f"{len(problems)} problem(s) in {MANIFEST}")
    print(f"MANIFEST VALIDATION PASS ({MANIFEST})")


if __name__ == "__main__":
    main()

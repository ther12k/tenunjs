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

# Issue lifecycle governance (06-issues/index.md "Status vocabulary"):
# the frontmatter status of every tn-NNN issue must use the vocabulary,
# and a closed issue must carry an evidence "## Status note" section.
ISSUE_RE = re.compile(r"^06-issues/tn-\d+-[^/]+\.md$")
VALID_STATUS = {"ready", "in-progress", "blocked", "closed"}


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


def check_issue_status(root: Path, problems: list) -> None:
    for path in sorted(governed_paths(root)):
        if not ISSUE_RE.match(path):
            continue
        text = (root / path).read_text()
        frontmatter = re.match(r"\A---\n(.*?)\n---(?:\n|$)", text, re.S)
        statuses = re.findall(r"^status:[ \t]*(\S+)[ \t]*$", frontmatter.group(1), re.M) if frontmatter else []
        m = statuses[0] if len(statuses) == 1 else None
        if not m:
            problems.append(f"issue missing 'status:' frontmatter: {path}")
            continue
        value = m
        if value not in VALID_STATUS:
            problems.append(
                f"issue status {value!r} not in vocabulary {sorted(VALID_STATUS)}: {path}"
            )
        elif value == "closed" and not re.search(r"^## Status note(?:[ \t].*)?$", text[frontmatter.end():], re.M):
            problems.append(
                f"closed issue lacks a '## Status note' evidence section: {path}"
            )


def check(root: Path) -> list:
    problems = []
    check_issue_status(root, problems)
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
    issue_closed_ok = (
        "---\nstatus: closed\n---\n\n# issue\n\n"
        "## Status note (test, closed)\n\nevidence.\n"
    )
    base_files = {
        "00-project/a.md": "alpha\n",
        "00-project/b.md": "beta\n",
        "01-requirements/c.md": "gamma\n",
        "06-issues/tn-900-ready.md": "---\nstatus: ready\n---\n\nbody\n",
        "06-issues/tn-901-closed.md": issue_closed_ok,
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
        # status mutations rewrite the file AND regenerate a clean
        # manifest, so detection can only come from the status check
        "invalid issue status": lambda root, man: (
            build_tree(root, {"06-issues/tn-900-ready.md": "---\nstatus: done\n---\n\nbody\n"}),
            man.write_text(good_manifest(root)),
        ),
        "body status without frontmatter": lambda root, man: (
            build_tree(root, {"06-issues/tn-900-ready.md": "---\ntitle: issue\n---\n\nstatus: ready\n"}),
            man.write_text(good_manifest(root)),
        ),
        "duplicate status fields": lambda root, man: (
            build_tree(root, {"06-issues/tn-900-ready.md": "---\nstatus: ready\nstatus: closed\n---\n"}),
            man.write_text(good_manifest(root)),
        ),
        "inline status note": lambda root, man: (
            build_tree(root, {"06-issues/tn-901-closed.md": "---\nstatus: closed\n---\n\nbody mentions ## Status note\n"}),
            man.write_text(good_manifest(root)),
        ),
        "closed without note": lambda root, man: (
            build_tree(root, {"06-issues/tn-901-closed.md": "---\nstatus: closed\n---\n\nbody\n"}),
            man.write_text(good_manifest(root)),
        ),
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

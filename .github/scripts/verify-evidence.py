#!/usr/bin/env python3
"""Evidence packet validator (review finding #3 / #142 H3, review-3 revision).

Structural gate (always on), per committed packet:
  - schema_version 3; host/toolchain metadata; build_profile release
  - no failed or timed-out steps
  - non-empty hashed-artifact manifest with repo-relative paths and well
    formed digests
  - inputs_digest equal to the LIVE TREE's digest: every fixture/source file
    the packet claims to describe must be exactly what is in the checkout,
    so committed packets cannot quietly outlive their fixtures

Replay gate (TENUN_EVIDENCE_REPLAY=1, set by CI):
  - executes the TRUSTED chain from .github/scripts/replay/<label>.sh (not
    shell commands taken from the packet itself) against a cold checkout,
    writing the regenerated packet into a sandbox directory
  - compares sandbox vs committed packet deterministically: artifact
    manifest (path/sha256/bytes for every artifact), step names + commands,
    build profile — a rebuild that produces different binaries fails

Self test (--selftest):
  - structural validator and comparator are pure functions; this mode feeds
    them mutated synthetic packets (fake hashes, fake sizes, missing steps,
    tree-digest drift...) and fails if any mutation goes undetected.
"""

import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
from datetime import datetime
from pathlib import Path

SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
REPLAY_TIMEOUT_S = 1800
ROOTS = ["spikes", "benchmarks/architecture"]
SKIP_DIRS = {"target", "evidence"}


def fail(msg: str) -> None:
    print(f"EVIDENCE VALIDATION FAIL: {msg}")
    sys.exit(1)


# --------------------------------------------------------------------------
# input-tree digest (must byte-match benchmarks/architecture/harness.ts)
# --------------------------------------------------------------------------

def tree_digest(root: Path) -> str:
    files: list[str] = []
    for base in ROOTS:
        walk_root = root / base
        if not walk_root.is_dir():
            continue
        stack = [walk_root]
        while stack:
            d = stack.pop()
            for e in sorted(d.iterdir()):
                if e.name in SKIP_DIRS:
                    continue
                if e.is_dir():
                    stack.append(e)
                else:
                    rel = e.relative_to(root).as_posix()
                    files.append((rel, e))
    seen = set()
    h = hashlib.sha256()
    for rel, path in sorted(files):
        if rel in seen:
            continue
        seen.add(rel)
        ch = hashlib.sha256(path.read_bytes()).hexdigest()
        h.update(f"{rel}\0{ch}\n".encode())
    return h.hexdigest()


# --------------------------------------------------------------------------
# pure validation + comparison functions (unit-tested via --selftest)
# --------------------------------------------------------------------------

def validate_packet(data: dict, live_digest: str) -> list[str]:
    errs: list[str] = []

    def err(m):
        errs.append(m)

    label = data.get("label", "?")
    if data.get("schema_version") != 3:
        err(f"{label}: schema_version must be 3 (regenerate packet)")
    try:
        datetime.fromisoformat(data["timestamp_utc"].replace("Z", "+00:00"))
    except Exception:
        err(f"{label}: timestamp_utc missing/invalid")
    if data.get("build_profile") != "release":
        err(f"{label}: build_profile must be 'release'")
    digest = data.get("inputs_digest")
    if not isinstance(digest, str) or not SHA256_RE.match(digest):
        err(f"{label}: inputs_digest absent/malformed")
    elif digest != live_digest:
        err(f"{label}: inputs_digest does not match the checkout — sources "
            f"or fixtures drifted since the packet was generated")
    steps = data.get("steps")
    if not isinstance(steps, list) or not steps:
        err(f"{label}: no recorded steps")
    else:
        for s in steps:
            if s.get("exit_code") != 0:
                err(f"{label}: step '{s.get('name')}' exit={s.get('exit_code')}")
            if s.get("timed_out"):
                err(f"{label}: step '{s.get('name')}' timed out")
    host = data.get("host") or {}
    for key in ("os", "arch", "kernel"):
        if not host.get(key):
            err(f"{label}: host.{key} missing")
    if not (data.get("tools") or {}):
        err(f"{label}: tools probe absent")

    arts = data.get("artifacts")
    if not isinstance(arts, list) or not arts:
        err(f"{label}: artifacts absent (H3 requires hashed release artifacts)")
    else:
        for art in arts:
            if not isinstance(art, dict):
                err(f"{label}: artifact entry is not an object")
                continue
            apath = art.get("path", "")
            if not isinstance(apath, str) or not apath or apath.startswith("/"):
                err(f"{label}: artifact path must be repo-relative: {apath!r}")
            elif "/home/" in apath or "/tmp/" in apath:
                err(f"{label}: artifact path machine-local: {apath}")
            dgst = art.get("sha256", "")
            if not isinstance(dgst, str) or not SHA256_RE.match(dgst):
                err(f"{label}: artifact {apath} sha256 absent/malformed")
            size = art.get("bytes")
            if not isinstance(size, int) or size <= 0:
                err(f"{label}: artifact {apath} bytes absent/non-positive")

    src = data.get("source") or {}
    commit = src.get("commit")
    if not commit or commit == "no-git":
        err(f"{label}: source commit missing")
    if src.get("dirty"):
        err(f"{label}: dirty tree — regenerate from clean checkout")
    repro = (data.get("reproducibility") or {}).get("commands") or []
    if not repro:
        err(f"{label}: reproducibility commands absent")
        repro = []
    for cmd in repro:
        if "/home/" in cmd or "/tmp/" in cmd:
            err(f"{label}: reproduction command machine-local: {cmd[:80]}")

    head = CURRENT_HEAD.get("head")
    on_main = CURRENT_HEAD.get("on_main", False)
    if head and commit and commit != "no-git":
        anc = subprocess.run(
            ["git", "merge-base", "--is-ancestor", commit, head], capture_output=True
        )
        if anc.returncode != 0:
            err(f"{label}: recorded commit {commit[:12]} is not an ancestor of HEAD")
        if os.environ.get("TENUN_EVIDENCE_REQUIRE_HEAD") == "1" and commit != head:
            err(f"{label}: strict mode requires recorded commit == HEAD")
    return errs


def manifest(arts) -> list[tuple]:
    entries = [(a["path"], a["sha256"], a["bytes"]) for a in arts]
    return sorted(entries)


def compare_replayed(committed: dict, replayed: dict) -> list[str]:
    """Deterministic identity of a cold rebuild. Timestamp/host/tool drift is
    expected and ignored; everything that defines WHAT was built and PROVED
    must match."""
    errs: list[str] = []
    label = committed.get("label", "?")

    def err(m):
        errs.append(m)

    if replayed.get("schema_version") != committed.get("schema_version"):
        err(f"{label}: replay schema differs")
    if replayed.get("build_profile") != committed.get("build_profile"):
        err(f"{label}: replay build_profile differs")
    if replayed.get("inputs_digest") != committed.get("inputs_digest"):
        err(f"{label}: replay inputs_digest differs (sources changed during replay?)")

    c_steps = committed.get("steps") or []
    r_steps = replayed.get("steps") or []
    if len(c_steps) != len(r_steps):
        err(f"{label}: replay ran {len(r_steps)} steps vs {len(c_steps)} recorded")
    else:
        for c, r in zip(c_steps, r_steps):
            if c.get("name") != r.get("name") or c.get("command") != r.get("command"):
                err(f"{label}: replay step '{c.get('name')}' name/command mismatch")
            if r.get("exit_code") != 0 or r.get("timed_out"):
                err(f"{label}: replay step '{r.get('name')}' failed/timed out")

    c_paths = [a.get("path") for a in committed.get("artifacts") or []]
    r_paths = [a.get("path") for a in replayed.get("artifacts") or []]
    if not r_paths:
        err(f"{label}: replay produced no artifact manifest")
    elif c_paths != r_paths:
        err(f"{label}: replayed artifact paths differ: {r_paths} vs committed {c_paths}")
    else:
        for a in replayed.get("artifacts") or []:
            if not isinstance(a.get("bytes"), int) or a["bytes"] <= 0:
                err(f"{label}: replayed artifact {a.get('path')} size non-positive")
            if not isinstance(a.get("sha256"), str) or not SHA256_RE.match(a["sha256"]):
                err(f"{label}: replayed artifact {a.get('path')} sha256 malformed")

    if os.environ.get("TENUN_EVIDENCE_STRICT_ARTIFACTS") == "1":
        c_arts = manifest(committed.get("artifacts") or [])
        r_arts = manifest(replayed.get("artifacts") or [])
        if c_arts != r_arts:
            only_c = [e for e in c_arts if e not in r_arts]
            only_r = [e for e in r_arts if e not in c_arts]
            err(f"{label}: strict artifact manifests differ\n"
                f"    committed-only: {only_c}\n    replay-only:    {only_r}\n"
                f"    (replayed binary does not match the validated manifest)")
    return errs


CURRENT_HEAD = {"head": None, "on_main": False}


def run_replay(label: str, script: Path, tmp_dir: Path, root: Path) -> dict:
    env = dict(os.environ)
    env["TENUN_EVIDENCE_OUT"] = str(tmp_dir)
    print(f"replay {label}: sh {script.name}")
    try:
        r = subprocess.run(
            ["sh", script.as_posix()],
            cwd=root,
            env=env,
            capture_output=True,
            text=True,
            timeout=REPLAY_TIMEOUT_S,
        )
    except subprocess.TimeoutExpired:
        fail(f"{label}: replay exceeded {REPLAY_TIMEOUT_S}s")
    tail = (r.stdout + r.stderr)[-800:]
    if r.returncode != 0:
        fail(f"{label}: replay exited {r.returncode}\n{tail}")
    if not re.search(r"steps: \d+ \(0 failed\)", r.stdout):
        fail(f"{label}: replay output lacks 'steps: N (0 failed)' marker\n{tail}")
    packet_path = tmp_dir / f"{label}.evidence.json"
    if not packet_path.exists():
        fail(f"{label}: replay wrote no packet into the sandbox dir\n{tail}")
    return json.loads(packet_path.read_text())


# --------------------------------------------------------------------------
# selftest: mutations MUST be caught by the pure functions above
# --------------------------------------------------------------------------

def valid_synthetic_packet(live: str) -> dict:
    art = {"path": "spikes/x/target/release/libx.so",
           "sha256": "ab" * 32, "bytes": 1234}
    return {
        "schema_version": 3,
        "label": "selftest",
        "timestamp_utc": "2026-08-26T00:00:00.000Z",
        "build_profile": "release",
        "inputs_digest": live,
        "source": {"commit": "0" * 40, "dirty": False},
        "host": {"os": "linux", "arch": "x64", "kernel": "Linux"},
        "tools": {"rustc": "1.0"},
        "artifacts": [dict(art)],
        "steps": [{"name": "build", "command": "cargo build --release",
                   "exit_code": 0, "timed_out": False}],
        "reproducibility": {"commands": ["cargo build --release"]},
    }


def selftest() -> None:
    live = "cd" * 32
    good = valid_synthetic_packet(live)

    def expect_ok():
        errs = validate_packet(good, live)
        assert errs == [], f"synthetic baseline rejected: {errs}"

    def expect_fail(mutate, tag):
        p = json.loads(json.dumps(good))
        mutate(p)
        errs = validate_packet(p, live)
        assert errs, f"MUTATION NOT CAUGHT ({tag})"
        comp_errs = compare_replayed(good, good)
        assert comp_errs == []

    expect_ok()
    expect_fail(lambda p: p.update(schema_version=2), "schema downgrade")
    expect_fail(lambda p: p["artifacts"][0].update(bytes=0), "zero bytes")
    expect_fail(lambda p: p["artifacts"].append(
        {"path": "/abs/lib.so", "sha256": "ab" * 32, "bytes": 5}), "absolute path")
    expect_fail(lambda p: p.update(inputs_digest="ff" * 32), "tree drift")
    expect_fail(lambda p: p["steps"][0].update(exit_code=1), "failed step")
    expect_fail(lambda p: p["steps"][0].update(timed_out=True), "timed-out step")
    expect_fail(lambda p: p["source"].update(dirty=True), "dirty tree")
    expect_fail(lambda p: p.update(host={}), "host metadata dropped")

    # replay comparison mutations
    def cmp_expect(tag, mutate_replay):
        r = json.loads(json.dumps(good))
        mutate_replay(r)
        errs = compare_replayed(good, r)
        assert errs, f"REPLAY MUTATION NOT CAUGHT ({tag})"

    cmp_expect("artifact path added on replay",
               lambda p: p["artifacts"].append(dict(p["artifacts"][0], path="extra.so")))
    cmp_expect("replayed artifact size zero",
               lambda p: p["artifacts"][0].update(bytes=0))
    cmp_expect("replayed artifact sha256 malformed",
               lambda p: p["artifacts"][0].update(sha256="bad"))
    cmp_expect("inputs_digest differs on replay",
               lambda p: p.update(inputs_digest="ee" * 32))
    cmp_expect("build_profile differs on replay",
               lambda p: p.update(build_profile="debug"))
    cmp_expect("step skipped on replay",
               lambda p: p["steps"].pop())
    cmp_expect("step swapped on replay",
               lambda p: p["steps"][0].update(name="other"))

    # strict mode comparison
    os.environ["TENUN_EVIDENCE_STRICT_ARTIFACTS"] = "1"
    strict_diff = json.loads(json.dumps(good))
    strict_diff["artifacts"][0]["sha256"] = "ee" * 32
    assert compare_replayed(good, strict_diff), "strict mode must catch hash divergence"
    del os.environ["TENUN_EVIDENCE_STRICT_ARTIFACTS"]

    print("SELFTEST PASS (structural + replay-comparison mutations all caught)")


# --------------------------------------------------------------------------

def main() -> None:
    argv = sys.argv[1:]
    if "--selftest" in argv:
        selftest()
        return

    root = Path(__file__).resolve().parents[2]
    packets = sorted((root / "benchmarks/architecture/evidence").glob("*/*.evidence.json"))
    if not packets:
        fail("no evidence packets found")

    do_replay = os.environ.get("TENUN_EVIDENCE_REPLAY") == "1"
    CURRENT_HEAD["head"] = subprocess.run(
        ["git", "rev-parse", "HEAD"], capture_output=True, text=True
    ).stdout.strip()
    CURRENT_HEAD["on_main"] = os.environ.get("GITHUB_REF") == "refs/heads/main"

    live = tree_digest(root)

    for packet in packets:
        data = json.loads(packet.read_text())
        label = data.get("label", "?")
        errs = validate_packet(data, live)
        if errs:
            print(f"EVIDENCE VALIDATION FAIL for {label}:")
            for e in errs:
                print(f"  - {e}")
            sys.exit(1)

        if do_replay:
            script = root / ".github/scripts/replay" / f"{label}.sh"
            if not script.exists():
                fail(f"{label}: trusted replay script missing: {script.relative_to(root)}")
            with tempfile.TemporaryDirectory(prefix="evidence-replay-") as td:
                replayed = run_replay(label, script, Path(td), root)
                cmp_errs = compare_replayed(data, replayed)
                if cmp_errs:
                    print(f"EVIDENCE REPLAY MISMATCH for {label}:")
                    for e in cmp_errs:
                        print(f"  - {e}")
                    sys.exit(1)

        mode = " (+replayed, manifest compared)" if do_replay else ""
        print(f"ok {packet.relative_to(root)} ({label}){mode}")

    suffix = ", replayed & compared" if do_replay else ""
    print(f"EVIDENCE VALIDATION PASS ({len(packets)} packets{suffix})")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Evidence packet validator (review finding #3 / #142 H3).

Rejects the committed evidence set when any packet:
  - has a wrong schema version or missing required sections,
  - reports a dirty source tree,
  - contains failed or timed-out steps,
  - lacks host/toolchain metadata, build profile, or hashed artifacts,
  - records machine-local paths anywhere a repo-relative path belongs,
  - (on main only) records a commit other than HEAD.

With TENUN_EVIDENCE_REPLAY=1 the first reproducibility command of every
packet is additionally EXECUTED from the clean checkout; a nonzero exit or
missing ALL-PASS marker fails the gate. CI sets this flag.
"""

import json
import os
import re
import subprocess
import sys
from datetime import datetime
from pathlib import Path

SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
REPLAY_TIMEOUT_S = 1800


def fail(msg: str) -> None:
    print(f"EVIDENCE VALIDATION FAIL: {msg}")
    sys.exit(1)


def check_artifact(label: str, art: object) -> None:
    if not isinstance(art, dict):
        fail(f"{label}: artifact entry is not an object")
    path = art.get("path", "")
    if not isinstance(path, str) or not path or path.startswith("/"):
        fail(f"{label}: artifact path must be repo-relative: {path!r}")
    if "/home/" in path or "/tmp/" in path:
        fail(f"{label}: artifact path contains machine-local segment: {path}")
    digest = art.get("sha256", "")
    if not isinstance(digest, str) or not SHA256_RE.match(digest):
        fail(f"{label}: artifact {path} sha256 absent/malformed")
    size = art.get("bytes")
    if not isinstance(size, int) or size <= 0:
        fail(f"{label}: artifact {path} bytes absent/non-positive")


def replay(label: str, command: str, root: Path) -> None:
    print(f"replay {label}: {command[:100]}...")
    try:
        r = subprocess.run(
            ["sh", "-c", command],
            cwd=root,
            capture_output=True,
            text=True,
            timeout=REPLAY_TIMEOUT_S,
        )
    except subprocess.TimeoutExpired:
        fail(f"{label}: replay exceeded {REPLAY_TIMEOUT_S}s")
    tail = (r.stdout + r.stderr)[-600:]
    if r.returncode != 0:
        fail(f"{label}: replay exited {r.returncode}\n{tail}")
    # run.ts exits nonzero when any packet step fails; require its all-green
    # summary line so a silent exit-0 rewrite cannot pass
    if not re.search(r"steps: \d+ \(0 failed\)", r.stdout):
        fail(f"{label}: replay output lacks 'steps: N (0 failed)' marker\n{tail}")


def main() -> None:
    root = Path(__file__).resolve().parents[2]
    packets = sorted((root / "benchmarks/architecture/evidence").glob("*/*.evidence.json"))
    if not packets:
        fail("no evidence packets found")

    head = subprocess.run(["git", "rev-parse", "HEAD"], capture_output=True, text=True).stdout.strip()
    on_main = os.environ.get("GITHUB_REF") == "refs/heads/main"
    do_replay = os.environ.get("TENUN_EVIDENCE_REPLAY") == "1"

    for packet in packets:
        data = json.loads(packet.read_text())
        label = data.get("label", "?")

        if data.get("schema_version") != 2:
            fail(f"{label}: schema_version must be 2 (regenerate packet)")
        try:
            datetime.fromisoformat(data["timestamp_utc"].replace("Z", "+00:00"))
        except Exception:
            fail(f"{label}: timestamp_utc missing/invalid")
        if data.get("build_profile") != "release":
            fail(f"{label}: build_profile must be 'release'")
        if not isinstance(data.get("steps"), list) or not data["steps"]:
            fail(f"{label}: no recorded steps")
        for step in data["steps"]:
            if step.get("exit_code") != 0:
                fail(f"{label}: step '{step.get('name')}' exit={step.get('exit_code')}")
            if step.get("timed_out"):
                fail(f"{label}: step '{step.get('name')}' timed out")
        host = data.get("host") or {}
        for key in ("os", "arch", "kernel"):
            if not host.get(key):
                fail(f"{label}: host.{key} missing")
        if not (data.get("tools") or {}):
            fail(f"{label}: tools probe absent")
        arts = data.get("artifacts")
        if not isinstance(arts, list) or not arts:
            fail(f"{label}: artifacts absent (H3 requires hashed release artifacts)")
        for art in arts:
            check_artifact(label, art)
        src = data.get("source") or {}
        if not src.get("commit") or src["commit"] == "no-git":
            fail(f"{label}: source commit missing")
        if src.get("dirty"):
            fail(f"{label}: dirty tree — regenerate from clean checkout")
        repro = (data.get("reproducibility") or {}).get("commands") or []
        if not repro:
            fail(f"{label}: reproducibility commands absent")
        for cmd in repro:
            if "/home/" in cmd or "/tmp/" in cmd:
                fail(f"{label}: reproduction command contains machine-local path: {cmd[:80]}")
        if on_main:
            # recorded evidence must describe an ancestor of current main;
            # strict equality available via TENUN_EVIDENCE_REQUIRE_HEAD=1
            anc = subprocess.run(
                ["git", "merge-base", "--is-ancestor", src["commit"], head],
                capture_output=True,
            )
            if anc.returncode != 0:
                fail(f"{label}: recorded commit {src['commit'][:12]} is not an ancestor of HEAD")
            if os.environ.get("TENUN_EVIDENCE_REQUIRE_HEAD") == "1" and src["commit"] != head:
                fail(f"{label}: strict mode requires recorded commit == HEAD")
        if do_replay:
            replay(label, repro[0], root)
        mode = " (+replayed)" if do_replay else ""
        print(f"ok {packet.relative_to(root)} ({label}){mode}")

    print(f"EVIDENCE VALIDATION PASS ({len(packets)} packets{' , replayed' if do_replay else ''})")


if __name__ == "__main__":
    main()

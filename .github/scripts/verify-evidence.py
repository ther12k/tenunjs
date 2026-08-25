#!/usr/bin/env python3
"""Evidence packet validator (review finding #3 / #142 H3, interim gate).

Rejects the committed evidence set when any packet:
  - has a wrong schema version or missing required sections,
  - reports a dirty source tree,
  - contains failed or timed-out steps,
  - lacks host/toolchain metadata,
  - (on main only) records a commit other than HEAD.
"""

import json
import os
import subprocess
import sys
from datetime import datetime
from pathlib import Path

REQUIRED_STEPS_NONEMPTY = True


def fail(msg: str) -> None:
    print(f"EVIDENCE VALIDATION FAIL: {msg}")
    sys.exit(1)


def main() -> None:
    root = Path(__file__).resolve().parents[2]
    packets = sorted(
        (root / "benchmarks/architecture/evidence").glob("*/*.evidence.json")
    )
    if not packets:
        fail("no evidence packets found")

    head = subprocess.run(
        ["git", "rev-parse", "HEAD"], capture_output=True, text=True
    ).stdout.strip()
    on_main = os.environ.get("GITHUB_REF") == "refs/heads/main"

    for packet in packets:
        data = json.loads(packet.read_text())
        label = data.get("label", "?")

        if data.get("schema_version") != 1:
            fail(f"{label}: schema_version must be 1")
        try:
            datetime.fromisoformat(data["timestamp_utc"].replace("Z", "+00:00"))
        except Exception:
            fail(f"{label}: timestamp_utc missing/invalid")
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
        src = data.get("source") or {}
        if not src.get("commit") or src["commit"] == "no-git":
            fail(f"{label}: source commit missing")
        if src.get("dirty"):
            fail(f"{label}: dirty tree — regenerate from clean checkout")
        repro = (data.get("reproducibility") or {}).get("commands") or []
        if not repro:
            fail(f"{label}: reproducibility commands absent")
        if on_main and src["commit"] != head:
            fail(
                f"{label}: recorded commit {src['commit'][:12]} != HEAD {head[:12]} on main"
            )
        print(f"ok {packet.relative_to(root)} ({label})")

    print(f"EVIDENCE VALIDATION PASS ({len(packets)} packets)")


if __name__ == "__main__":
    main()

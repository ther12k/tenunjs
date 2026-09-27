#!/usr/bin/env bash
# External-consumer rehearsal (see 04-api/external-consumer-guide.md).
#
# Rehearses the documented developer workflow from a clean checkout:
# pack the five runtime packages into private tarballs, scaffold the
# committed fixture (consumers/tasks-app) into a fresh temporary
# directory, install from the tarballs only, type-check both automatic
# JSX transforms, build both transforms, assert both JSX runtime
# subpaths expose real functions, and assert the fixture never imports
# repository-relative paths (the independence boundary).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
FIXTURE="$REPO_ROOT/consumers/tasks-app"
WORK="$(mktemp -d /tmp/tenun-consumer-rehearsal.XXXXXX)"
trap 'rm -rf "$WORK"' EXIT

echo "== consumer rehearsal: packing packages =="
mkdir -p "$WORK/app/vendor"
for p in protocol jsx-runtime core widgets navigation; do
  (cd "$REPO_ROOT/packages/$p" && bun pm pack >/dev/null)
done
mv "$REPO_ROOT"/packages/*/tenunjs-*.tgz "$WORK/app/vendor/"

echo "== consumer rehearsal: scaffolding fixture =="
mkdir -p "$WORK/app"
cp -r "$FIXTURE/src" "$FIXTURE/scripts" "$FIXTURE/tsconfig.json" \
      "$FIXTURE/tsconfig.dev.json" "$FIXTURE/package.json" "$WORK/app/"

echo "== consumer rehearsal: independence guard =="
# No import may reach into the monorepo by relative path, and no
# dependency may bypass the vendored tarballs.
if grep -REn "from ['\"]\.\./" "$WORK/app/src" "$WORK/app/scripts" >/dev/null; then
  echo "CONSUMER-REHEARSAL-FAILURE: fixture imports a repository-relative path"
  grep -REn "from ['\"]\.\./" "$WORK/app/src" "$WORK/app/scripts" || true
  exit 1
fi
if grep -v "file:vendor/" "$WORK/app/package.json" | grep -E '"@tenunjs/' >/dev/null; then
  echo "CONSUMER-REHEARSAL-FAILURE: non-vendored @tenunjs dependency spec present"
  exit 1
fi

echo "== consumer rehearsal: install from tarballs =="
cd "$WORK/app"
bun install
# Positive lockfile evidence: every @tenunjs package must resolve to a
# vendored tarball (bun.lock records file: paths for tarball installs;
# it carries no registry URLs at all, so absence-of-URL greps prove
# nothing).
for pkg in core jsx-runtime navigation protocol widgets; do
  if ! grep -q "\"@tenunjs/$pkg\": \"file:vendor/tenunjs-$pkg-[0-9.]*\.tgz\"" bun.lock; then
    echo "CONSUMER-REHEARSAL-FAILURE: @tenunjs/$pkg is not resolved from a vendored tarball in bun.lock"
    exit 1
  fi
done

echo "== consumer rehearsal: typecheck (react-jsx + react-jsxdev) =="
bun run typecheck

echo "== consumer rehearsal: builds =="
bun run build:app
bun run build:app:dev
if grep -q "jsxDEV(" .out/prod/main.js; then
  echo "CONSUMER-REHEARSAL-FAILURE: production build references jsxDEV"
  exit 1
fi
if ! grep -q "jsxDEV(" .out/dev/main.js; then
  echo "CONSUMER-REHEARSAL-FAILURE: development build never references jsxDEV"
  exit 1
fi

echo "== consumer rehearsal: JSX runtime subpath check =="
bun run check:runtimes

echo "== consumer rehearsal: scene production through the public lowering (TN-133) =="
# The external fixture must produce a host-consumable scene using only
# the public @tenunjs/widgets API — no examples/ imports (independence
# guard above already enforces that for this script's imports too).
SCENE_OUT="$(bun run scripts/produce-scene.ts)"
echo "$SCENE_OUT" | grep -q "CONSUMER-SCENE-OK" || {
  echo "CONSUMER-REHEARSAL-FAILURE: scene production failed"; echo "$SCENE_OUT"; exit 1; }
SCENE_SHA="$(echo "$SCENE_OUT" | grep -o 'scene-sha256=[0-9a-f]*' | cut -d= -f2)"
EXPECTED_SHA="$(cat scripts/expected-scene.sha256)"
if [ "$SCENE_SHA" != "$EXPECTED_SHA" ]; then
  echo "CONSUMER-REHEARSAL-FAILURE: scene digest mismatch (got $SCENE_SHA, expected $EXPECTED_SHA)"
  exit 1
fi
echo "consumer scene digest matches the committed fixture: $SCENE_SHA"

echo "== consumer rehearsal: host-contract execution (TN-133 browser leg) =="
# The fixture's host bundle must boot and run through the PUBLIC
# commit/dispatch protocol only — the same contract the Android bridge
# and the generic browser host consume.
bun run build:host
HOST_OUT="$(bun run check:host)" || {
  echo "CONSUMER-REHEARSAL-FAILURE: headless host-contract check failed"; echo "$HOST_OUT"; exit 1; }
echo "$HOST_OUT" | grep -q "HOST-CONTRACT-OK" || {
  echo "CONSUMER-REHEARSAL-FAILURE: host-contract check did not pass"; echo "$HOST_OUT"; exit 1; }

echo "== consumer rehearsal: application-only change through the contract =="
# TN-133 acceptance shape: change a label AND an action's behavior in
# APPLICATION code only (framework untouched), rebuild, and observe both
# changes through the contract.
python3 - <<'PATCH'
from pathlib import Path
screen = Path("src/screens/tasks.screen.tsx")
source = screen.read_text()

label_old = "Clear completed"
label_new = "Clear done"
assert source.count(label_old) == 1, "label occurrence changed"
source = source.replace(label_old, label_new)

behavior_old = """    toggleAll({ state }: ScreenActionContext<TasksState>) {
      const anyOpen = state.items.some((item) => !item.done);
      for (const item of state.items) item.done = anyOpen;
    },"""
behavior_new = """    toggleAll({ state }: ScreenActionContext<TasksState>) {
      for (const item of state.items) item.done = !item.done;
    },"""
assert source.count(behavior_old) == 1, "toggleAll body changed"
source = source.replace(behavior_old, behavior_new)

screen.write_text(source)
print("application-only patch applied (label + toggleAll invert)")
PATCH
bun run build:host
MOD_OUT="$(bun run check:host -- --modified)" || {
  echo "CONSUMER-REHEARSAL-FAILURE: modified-variant host-contract check failed"; echo "$MOD_OUT"; exit 1; }
echo "$MOD_OUT" | grep -q "HOST-CONTRACT-OK (application-only variant)" || {
  echo "CONSUMER-REHEARSAL-FAILURE: modified variant did not pass"; echo "$MOD_OUT"; exit 1; }

echo "CONSUMER REHEARSAL PASS (install, author, both JSX transforms, runtime subpaths, host-contract execution, application-only change, independence guard)"

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
if grep -q "registry.npmjs.org/@tenunjs" bun.lock; then
  echo "CONSUMER-REHEARSAL-FAILURE: @tenunjs resolved from a registry"
  exit 1
fi

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

echo "CONSUMER REHEARSAL PASS (install, author, both JSX transforms, runtime subpaths, independence guard)"

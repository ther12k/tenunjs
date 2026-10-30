---
okf_version: 0.2
title: "TN-178: Development hot reload must be debug-build-only and absent from release packages"
summary: "The dev_server.txt hot-reload marker was generated into main assets and honored at runtime regardless of build type: packaging a release with a leftover marker enabled unsigned network-sourced JavaScript evaluation with live host capabilities — the signed OTA envelope's gates never applied to this path."
type: issue
status: closed
issue_id: "TN-178"
milestone: "M4"
priority: "P1"
depends_on: []
---

# TN-178 — Development hot reload must be debug-build-only and absent from release packages

## Purpose

The 2026-10-30 production-readiness review (round 2) flagged the
development reload path as a conditional release-security defect:

- `build.mjs` wrote `dev_server.txt` into `src/main/assets/` — packaged
  by EVERY variant, release included.
- `MainActivity.readDevServerAsset()` honored it with no build-type
  guard: a release APK with a leftover marker polls the endpoint,
  downloads changed JavaScript, and boots it with live host capabilities
  — with NONE of the OTA channel's signature/compatibility gates. An
  HTTPS endpoint makes the condition independent of cleartext policy.
- No release artifact had ever been built: the first `assembleRelease`
  attempt also exposed a latent blocker (vendored quickjs
  `-Wunused-but-set-variable` under `-O2` — debug's `-O0` never trips
  it), so release packaging was not merely unhardened, it did not
  compile.

Local residue demonstrated the accident concretely: a stale
`src/main/assets/dev_server.txt` from the 2026-10-28 WiFi dev loop
(git-ignored, untracked) shipped into the first successful release APK.

## Required outcome

1. The marker is generated into `src/debug/assets/` — release never
   packages it; build.mjs also removes stale copies from BOTH locations.
2. Runtime defense in depth: `readDevServerAsset()` returns null in
   non-debuggable builds (`ApplicationInfo.FLAG_DEBUGGABLE`), so even a
   manually re-added marker cannot activate reload in release.
3. Release packaging builds: CMake carries the same vendored-quickjs
   warning suppressions the host build has; `assembleRelease` compiles
   both ABIs.
4. Packaging proof: with the marker deliberately present in debug
   assets, the release APK contains ZERO dev_server entries and the
   debug APK contains exactly one.

## Verification

- Local `assembleRelease` + `assembleDebug` + `assembleDebugAndroidTest`
  all BUILD SUCCESSFUL; unzip inspection: release 0 entries, debug 1
  entry.
- `run_device_acceptance.sh`'s existing acceptance-APK absence grep
  still guards its own build.
- Full run_android_test.sh, 8-gate CI.

## Out of scope

- Release signing/distribution configuration (TN-128's store candidates
  own that).
- The OTA channel's own signed-envelope machinery (unchanged).
## Status note (2026-10-30, closed)

Implemented and published in one session. Fixed in PR #261: the
dev_server.txt marker is generated into src/debug/assets (release never
packages it; build.mjs purges stale copies in both locations), and
MainActivity.readDevServerAsset() honors it only in debuggable builds
(ApplicationInfo.FLAG_DEBUGGABLE) — a release package can no longer
activate unsigned network hot reload even if a marker is manually
re-added. The first-ever assembleRelease also exposed a latent -O2
warning blocker in vendored quickjs; CMake now carries the host build's
suppressions. Packaging proof (marker deliberately seeded in debug
assets): assembleRelease/assembleDebug/assembleDebugAndroidTest all
BUILD SUCCESSFUL; release APK contains 0 dev_server entries, debug APK
exactly 1. A stale local main-assets marker from the 2026-10-28 WiFi
loop was found shipping into the first release APK and removed
(git-ignored residue, never committed).

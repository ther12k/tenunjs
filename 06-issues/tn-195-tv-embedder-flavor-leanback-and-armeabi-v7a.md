---
okf_version: 0.2
title: "TN-195: TV embedder flavor — leanback packaging and armeabi-v7a"
summary: "Add a `tv` product flavor to the Android embedder: applicationId id.my.tenun.tvplayer, label NusaTV (working name "Tenun TV"), armeabi-v7a added to abiFilters (target TV hardware), and a flavor manifest overlay with LEANBACK_LAUNCHER, leanback uses-feature, and a banner drawable. The touch flavor stays untouched."
type: issue
status: in-progress
issue_id: "TN-195"
milestone: "M5"
priority: "P1"
depends_on: []
---

# TN-195 — TV embedder flavor

## Purpose

The embedder ships one touch-only sample configuration
(`app/build.gradle.kts:35-37`): `abiFilters = [arm64-v8a, x86_64]`, no
leanback entry point, so nothing it builds can install as a TV app on
the 2019 Amlogic Mi TV (`armeabi-v7a`, Android 9) that anchors this
initiative's device gate.

## Required outcome

1. `productFlavors { tv { ... } }` in the embedder's
   `app/build.gradle.kts`: `applicationId id.my.tenun.tvplayer`,
   label "NusaTV", `abiFilters += "armeabi-v7a"` (QuickJS/CMake
   build needs no change); the default touch flavor is bit-identical
   in behavior to today's build.
2. Flavor manifest overlay (`src/tv/AndroidManifest.xml`): a
   `LEANBACK_LAUNCHER` category on the launch activity,
   `uses-feature android.software.leanback`, `uses-feature
   android.hardware.touchscreen` not-required, and a TV banner
   drawable (x1dp `banner`, 320×180).
3. The tv flavor's bundled asset is the TV player bundle produced by
   TN-196's build pipeline.
4. Gate: `./gradlew :app:assembleTvDebug` builds; the APK installs on
   the Mi TV and appears in the Android TV launcher with its banner.

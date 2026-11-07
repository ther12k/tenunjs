---
okf_version: 0.2
title: "TN-193: Media host service — Media3 playback, TextureView overlay compositing, and fetchText"
summary: "Deliver the media capability of ADR-0028: a `media` NativeService wrapping Media3 ExoPlayer+HLS (prepare/play/pause/stop/setRect/status), a TextureView video surface layered over TenunSurfaceView in a FrameLayout and positioned in design units, MEDIA_STATE event push, and a bounded fetchText so bundles can load playlists before the net capability lands."
type: issue
status: ready
issue_id: "TN-193"
milestone: "M5"
priority: "P0"
depends_on: []
---

# TN-193 — Media host service and overlay compositing

## Purpose

The display-list contract has no video op (`DisplayListScene.kt:124-183`)
and bundles have no HTTP (`README.md:258-260`), so no TenunJS app can
play a stream or even fetch a playlist. The host-service seam
(`HostServiceRegistry.kt:8-30`, `MainActivity.kt:287-319`) is the
proven extension point — `PolytronBleService.kt:738-752` shows the
native→JS event push pattern to follow.

## Required outcome

1. `MediaService.kt` under the Android embedder implements
   `NativeService` as `"media"`: `prepare`, `play`, `pause`, `stop`,
   `setRect`, `status` over Media3 ExoPlayer with the HLS module;
   `fetchText` via `HttpURLConnection` (GET only, 10 s timeout, 2 MB
   cap, text responses only).
2. `MEDIA_STATE` events (`idle|buffering|ready|playing|paused|ended|error`)
   dispatched to the runtime through the established event seam.
3. Compositing: the activity content view becomes
   `FrameLayout { TenunSurfaceView, TextureView }` — the video view is
   `GONE` until the first frame, positioned by `setRect` in design
   units, and never occludes scene UI outside its rect (ADR-0017-lite;
   full platform-view contract stays with TN-094).
4. Registered in `MainActivity.ensureHostServices()` alongside the
   existing services; no display-list protocol change.
5. Gate: `bun run verify:ts` and the Android host test green; on-device
   HLS playback evidence (a public test stream) on the Mi TV per
   ADR-0019 — emulator runs are not substitutes.

---
okf_version: 0.2
title: "ADR-0028: Media and TV capabilities — host-service playback, overlay compositing, generic key dispatch, and a TV embedder flavor"
summary: "TenunJS cannot host a live-TV player today: no video op in the display list, no HTTP from bundles, no D-pad path to the runtime, and a touch-only embedder. This decision adds media as a host service (Media3 + TextureView overlay in an ADR-0017-lite composition), a generic KEY action from the Android host, and a `tv` product flavor with leanback packaging and armeabi-v7a — enough to ship a real TV player app without changing the display-list contract or shipping the full platform-views model."
type: decision
status: accepted
---

# ADR-0028: Media and TV capabilities

## Context

A first real TV application (the "Tenun TV" player, TN-196) exposes four
framework gaps, each verified against the tree before this decision:

1. **No video.** The display-list contract has no image or video op —
   `DisplayListScene.kt:124-183` rasterizes text, shapes, and scroll
   regions only.
2. **No HTTP from JS.** QuickJS bundles have no `fetch`; the net
   capability (TN-188, `review/companion-connectivity`) is specced but
   not landed, so a bundle cannot even load a playlist.
3. **No D-pad input.** Android key events only feed the IME path;
   otherwise they are logged (`TenunSurfaceView.kt:591-599`), never
   dispatched to the runtime as actions.
4. **No TV packaging.** The Android embedder ships a touch-only sample
   manifest with no `LEANBACK_LAUNCHER`, and
   `abiFilters = [arm64-v8a, x86_64]` (`app/build.gradle.kts:35-37`)
   while the target device (a 2019 Amlogic Mi TV) is `armeabi-v7a`.

The proven extension seam is the host-service registry:
`tenun_host_call(service, method, payloadJson)` →
`NativeService`/`HostServiceRegistry` (`HostServiceRegistry.kt:8-30`,
registered in `MainActivity.kt:287-319`), with native→JS event push
demonstrated by `PolytronBleService.kt:738-752`.

## Decision

Four sub-decisions, each the smallest step that ships the app:

1. **Media is a host service, not a display-list op (TN-193).** A
   `media` `NativeService` wraps Media3 ExoPlayer (with the HLS module)
   behind the existing host-call seam: `prepare`, `play`, `pause`,
   `stop`, `setRect`, `status`, plus `fetchText` — a deliberately
   minimal `HttpURLConnection` reader (10 s timeout, 2 MB cap) so the
   app can load playlists without landing all of TN-188. State changes
   are pushed as `MEDIA_STATE` events following the BLE service's
   `dispatchAction` pattern. The public TS contract lives in
   `04-api/media.md`.
2. **Video composites as a TextureView overlay — ADR-0017-lite
   (TN-193).** The Android content view becomes a `FrameLayout` holding
   `TenunSurfaceView` and a `TextureView` (hidden until prepared,
   positioned by `setRect`). The Tenun scene draws its UI around the
   video region; the display-list wire contract is unchanged in v1.
   This borrows ADR-0017's intent (platform surfaces as an explicit
   escape hatch) without its full lifecycle/z-order/input contract,
   which stays deferred with TN-094.
3. **Generic KEY action dispatch, app-level focus for v1 (TN-194).**
   When the IME does not consume a key, `TenunSurfaceView` dispatches
   a `KEY` action `{keyCode, phase}` into the runtime and redraws; BACK
   handling in `MainActivity.kt:118-146` is untouched. A framework
   focus model is explicitly future work — the example app implements
   its own list/grid focus helper over `KEY` actions.
4. **A `tv` product flavor (TN-195).** `applicationId id.my.tenun.tvplayer`,
   label "Tenun TV", `abiFilters += armeabi-v7a` (no QuickJS/CMake
   change needed), and a flavor manifest overlay adding
   `LEANBACK_LAUNCHER`, `uses-feature android.software.leanback`, and a
   banner drawable. The touch flavor is untouched.

**Content boundary (standing).** The example app is a generic
m3u/m3u8 playlist player with a starter list of official free
Indonesian streams plus a public test stream. No third-party panel
integration or reverse-engineering, no bundled unofficial endpoints.
Where a user points the player is their choice, as with any media
player.

## Consequences

- A TV player app becomes buildable in-repo on one branch, and the
  capabilities it needs (media surface, key dispatch, TV packaging)
  permanently upgrade the framework for every future app.
- Video is outside the display list in v1: no scene-graph ordering,
  clipping, or transitions over video. Bundles draw UI around the
  `setRect` region. This is a documented ceiling, not a hidden one.
- `fetchText` is a stopgap; the full net capability (TN-188) supersedes
  it and lands separately on its own review.
- Device evidence follows ADR-0019: bring-up on the physical armeabi-v7a
  TV (install → play → navigate → screencap) is the acceptance gate for
  TN-193–TN-195; emulator runs are not substitutes.
- Out of scope for v1: framework-wide focus, iOS (ADR-0019 schedule),
  DRM streams, EPG, and any BitTV-panel integration.

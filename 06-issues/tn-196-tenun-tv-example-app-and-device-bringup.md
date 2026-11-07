---
okf_version: 0.2
title: "TN-196: Tenun TV — example live-TV player app and device bring-up"
summary: "Build examples/tvplayer on the TN-193..195 capabilities: a pure-TS M3U parser, player screen with D-pad channel sidebar (app-level focus over KEY actions), settings screen with playlist-URL entry over the existing IME widgets, official-free-streams starter playlist, IIFE bundle pipeline for the tv flavor, and Mi TV device acceptance. Generic player only — no third-party panel integration (ADR-0028 content boundary)."
type: issue
status: in-progress
issue_id: "TN-196"
milestone: "M7"
priority: "P0"
depends_on:
  - "TN-193"
  - "TN-194"
  - "TN-195"
---

# TN-196 — Tenun TV example app and device bring-up

## Purpose

A real TV application exercises everything ADR-0028 added and proves
the framework can host a live-TV player: video surface, D-pad
navigation, TV packaging, playlist loading — end to end on physical
hardware.

## Required outcome

1. `examples/tvplayer/` following the `examples/polytron` structure:
   `host-entry.ts` guarded `tenun_host_call("media", …)` glue (pattern
   of `embedders/android/tools/gallery-bundle/polytron-entry.ts:45-131`).
2. Pure-TS M3U/M3U8 parser (`#EXTINF`, `tvg-*` attributes, group
   grouping) with unit tests — no host dependency.
3. Player screen (video rect + channel sidebar: up/down = channel,
   OK = toggle sidebar, right = settings) and Settings screen
   (playlist URL through the existing `TextField`/IME path), using
   existing widgets only; app-level focus helper over `KEY` actions —
   deliberately in-app, not framework (ADR-0028).
4. Starter playlist asset: official free streams only (e.g. TVRI's
   public HLS — verified reachable at build time) plus a public test
   stream (mux) for development. **Content boundary:** generic player,
   no bundled unofficial endpoints, no panel integration or
   reverse-engineering.
5. Bundle pipeline (bun IIFE, modeled on
   `build-polytron-apk-asset.mjs`) emitting the tv-flavor asset, plus
   a browser-preview media stub (fail-closed `unsupported`) so gallery
   preview/headless boots still work.
6. Device acceptance on the Mi TV (192.168.1.9): install the tv
   flavor, play the test stream and an official stream, navigate by
   injected keyevents, enter a playlist URL via IME, and capture
   screencap evidence; the app appears in the launcher grid.
7. Findings fed back into TN-193..195 status notes; `bun run
   verify:ts` and the manifest gate green.

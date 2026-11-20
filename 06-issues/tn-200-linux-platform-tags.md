---
okf_version: 0.2
title: "TN-200: Linux platform tags — CapabilityPlatform and platform metadata"
summary: "The platform vocabulary is android|ios|web everywhere (CapabilityPlatform, PlatformKind overrides); a Linux desktop pilot needs the tag so capability metadata can declare availability and so linux-only capabilities fail visibly on other platforms instead of silently matching nothing."
type: issue
status: ready
issue_id: "TN-200"
priority: "P0"
depends_on: []
adr: "ADR-0028"
---

# TN-200 — Linux platform tags

## Purpose

ADR-0028 opens a Linux desktop pilot, but the platform vocabulary has
no linux value: `CapabilityPlatform = "android" | "ios" | "web"`
(packages/platform/src/capability.ts:87) and `PlatformKind` overrides
carry the same three. Without the tag, the MPRIS capability (TN-201)
cannot declare its availability, and a linux-only capability would
silently match nothing on other platforms instead of failing visibly.

## Required outcome

1. `CapabilityPlatform` gains `"linux"`; capability metadata
   (`platforms` availability lists, static permission metadata) uses
   it — no capability changes behavior on android/ios/web.
2. `PlatformKind` scope overrides gain `"linux"` where the vocabulary
   is user-facing (theme-scope platform override, textScale/platform
   plumbing) — Android/iOS hosts never resolve to linux and are
   unchanged.
3. Linux-only capabilities (TN-201's MPRIS) fail visibly — a result
   type or static availability metadata — on android/ios/web hosts,
   never a silent no-op that looks like success.
4. The preview host and browser twin are unaffected (they already
   render any scene; the tag is metadata, not a renderer branch).

## Non-goals

- Any macos/windows values (still frozen until M7 + a further ADR).
- Desktop capability implementations (TN-201's scope).
- Renderer branching on platform — painters stay platform-agnostic.

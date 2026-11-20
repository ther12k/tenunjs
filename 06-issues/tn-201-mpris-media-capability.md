---
okf_version: 0.2
title: "TN-201: MPRIS/DBus media capability — desktop media control and metadata"
summary: "The lekuvo notch is driven by the desktop's media player over MPRIS/DBus (metadata, playback state, position). One capability through the ADR-0027 recipe verbatim — result types, tri-state link, idempotent unsubscribe, static permission metadata, contract v1, preview-host shim and fail-closed stubs — with host-push events delivering metadata and position; the reference implementation (zbus) lives in the lekuvo repo at crates/lekuvo-media."
type: issue
status: ready
issue_id: "TN-201"
priority: "P1"
depends_on:
  - "TN-200"
adr: "ADR-0028"
---

# TN-201 — MPRIS/DBus media capability

## Purpose

The lekuvo notch renders live player state: track title/artist/album,
album art (a file path rewritten per track — the TN-046 image
invalidation verb rides this capability's host-push machinery), EQ
level, position clock. The desktop already speaks MPRIS2 over DBus;
the reference zbus implementation lives in the lekuvo repo
(`crates/lekuvo-media`, not in this repository). This is the first
desktop capability — it must follow the exact quality bar of the
companion track (ADR-0027: net/keys/discovery) so capability seams stay
interchangeable across hosts.

## Required outcome

1. `packages/platform/src/mpris.ts` (name within the capability
   family convention) through the documented `host.ts` recipe:
   contract version 1, result types (never thrown errors for expected
   failures), a tri-state link (`offline | searching | linked`),
   idempotent unsubscribe on every listener, idempotent close.
2. Host-push events: metadata changed (title, artist, album, art file
   path), playback status, position (1 Hz is enough — timers already
   exist), seeked. Push shape matches the net/discovery push contract.
3. Static permission metadata declared for the seam; Linux-only
   availability — other platforms get a fail-visible result (never a
   silent success), per TN-200.
4. Preview-host shim: a scripted fake player driving the same events
   (the gallery app demonstrates the notch against it); fail-closed
   stubs on hosts without the capability.
5. Contract v1 documented in `04-api` with the same shape as the
   companion capabilities.

## Non-goals

- Controlling the player (play/pause/seek from the notch UI) — the
  notch is a display; control commands are a follow-up if lekuvo wants
  them.
- Album art decoding (TN-046's decode/cache owns that — this
  capability only carries the path).
- DBus services other than MPRIS2 (no org.freedesktop.* general
  surface).
- The Rust zbus implementation itself — it stays in the lekuvo repo;
  this capability's host seam is defined by its contract, not its
  library.

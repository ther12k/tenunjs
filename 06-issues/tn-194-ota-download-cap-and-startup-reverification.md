---
okf_version: 0.2
title: "TN-194: OTA download size cap during streaming + startup re-verification of the stored bundle"
summary: "Two OTA hardening gaps: the size limit was applied only AFTER the whole response body was read into memory (the signed bundleSize capped a comparison, not the transfer), and the stored confirmed bundle booted on download-time proof alone — its cached metadata was not re-verified against the pinned key, the running host, or the stored bytes at startup. The bundle download now enforces a hard byte cap DURING the copy (manifest gets its own cap), and the signed manifest envelope is cached in meta.json so bootEngine re-proves signature → compatibility → size/digest before a stored bundle boots."
type: issue
status: ready
issue_id: "TN-194"
priority: "P0"
depends_on:
  - "TN-135"
  - "TN-138"
---

# TN-194 — OTA download size cap during streaming + startup re-verification

Source-review findings on the OTA channel (not device reproductions): the
download and the boot path each trusted a check that ran at the wrong
time.

## Purpose

Two concrete gaps in `OtaManager` / `UpdateStore` / `MainActivity`:

1. **The size limit capped a comparison, not the transfer.**
   `httpGetBytes` read the whole response body into memory with
   `copyTo`; `MAX_BUNDLE_BYTES` bounded only the manifest-DECLARED
   `bundleSize` at parse time, and `bytes.size == bundleSize` was
   compared after the full read. A hostile or broken server could
   declare one size and stream gigabytes — memory ballooned before any
   check ran. The manifest fetch had the same unbounded shape.

2. **Download-time proof did not carry to boot time.** `meta.json`
   stored only `{state, stateSchema}`; the signed envelope was
   discarded after download, and `bootEngine()` booted
   `activeBundleBytes()` on faith — the only startup check was whether
   QuickJS threw. A cache whose bytes drifted on disk booted (if it
   still parsed); a bundle verified by an older APK booted unexamined
   by a newer APK whose `HOST_API_VERSION` had moved past the bundle's
   signed `hostApiMax`; a tampered `meta.json` was invisible.

## Required outcome

1. The bundle download enforces the signed `bundleSize` as a hard cap
   DURING the read: an honest oversized `Content-Length` fails up
   front; a body that outgrows the cap mid-transfer aborts the copy
   (`ResponseTooLargeException`) — never a full-buffer-then-compare.
   A transport-level refusal is NOT a bundle defect: no stage, no
   trial, no quarantine, so a corrected server can serve the same
   sequence later.
2. The manifest fetch is capped by a protocol constant
   (`MAX_MANIFEST_BYTES`), same during-read enforcement.
3. `UpdateStore` caches the signed manifest envelope in `meta.json`
   (`envelope` field) through staged → trial → confirmed, and exposes
   it for the active bundle (`activeEnvelope()`). Legacy metas without
   the field read as null — the store treats them as ordinary state.
4. `UpdateProtocol.storedBundleUsable(envelope, key, host, bytes)`
   re-proves a stored bundle: signature over exact payload bytes →
   parse → app/channel/host-API compatibility → size/SHA-256 of the
   stored bytes themselves. Null on any defect.
5. `bootEngine()` boots a stored bundle only when it re-verifies.
   Verification that RAN and failed (tampered meta, drifted bytes,
   host API moved on) quarantines the sequence like a failed trial
   (TN-138 floor semantics preserved). Verification that CANNOT run
   (no channel asset, legacy cache without an envelope) destroys
   nothing — the store keeps the bundle, but packaged boots this
   launch.

## Verification

- JVM (`UpdateProtocolTest`): `storedBundleUsable` accepts a valid
  cache and refuses tampered payload, wrong key, newer host, drifted
  bytes (both directions), and garbage — never throws.
- JVM (`UpdateStoreTest`): envelope persists through the lifecycle;
  stage-without-envelope reads null.
- Device (`OtaEngineJourneyTest`): the confirmed v2's cached envelope
  re-verifies at the gate and refuses drifted bytes; a chunked v5
  whose body outgrows the signed size is cut off mid-stream with no
  stage/trial/quarantine; an oversized manifest is refused before
  parse.

## Status note (2026-11-13, implemented on `fix/ota-download-cache`)

Both gaps fixed in one pass; the remaining OTA rollout work (activation
policy, snapshot-schema migration, UI-level journey test, staged
rollout + monitoring + key rotation) stays open as separate tracks.

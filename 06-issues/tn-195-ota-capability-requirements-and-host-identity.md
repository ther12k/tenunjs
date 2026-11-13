---
okf_version: 0.2
title: "TN-195: OTA capability requirements + versioned host identity"
summary: "HOST_API_VERSION was a bare constant 1 compared only at update-check time, and the host had no per-capability identity: the registry mapped plain names to services with no versions, the publisher guessed hostApiMin=hostApiMax manually, and a bundle needing a capability an APK lacks was only discovered by failing at runtime. NativeService now declares a contractVersion, HostServiceRegistry exposes capabilitySnapshot(), signed ReleaseMetadata carries requiredCapabilities (capability → minimum contract version) gated at update-check AND startup re-verification, and HOST_API_VERSION moves to 2 (the first capability-aware host) with an enforced discipline: requirement-bearing releases must pin hostApiMin ≥ 2."
type: issue
status: ready
issue_id: "TN-195"
priority: "P0"
depends_on:
  - "TN-154"
  - "TN-194"
---

# TN-195 — OTA capability requirements + versioned host identity

The second P0 from the 2026-11-13 OTA review: "identitas kompatibilitas
native yang lebih kuat".

## Purpose

The only compatibility identity was `HOST_API_VERSION = 1`, a coarse
constant with no bump discipline, and no per-capability identity at all:

- `HostServiceRegistry` mapped bare names (`ble`, `system`, `keys`,
  `net`, `discovery`) to services — no contract versions, nothing for a
  release to declare requirements against.
- The publisher pinned `hostApiMin = hostApiMax = --host-api` (default
  1) by hand — a guess with no knowledge of the host's actual surface.
- A bundle that uses, say, `discovery` on an APK built before discovery
  existed sailed through every gate (same appId, same channel,
  hostApi 1 ∈ [1,1]) and failed only at runtime.

## Required outcome

1. Per-capability identity: every `NativeService` declares its wire
   `contractVersion`; the registry's `capabilitySnapshot()` is the
   host's capability inventory.
2. Signed requirements: `ReleaseMetadata.requiredCapabilities`
   (capability name → minimum contract version), gated inside
   `isCompatible` — a host that does not provide a required capability
   at ≥ the declared version refuses the release BEFORE download, at
   update-check time AND at startup re-verification (TN-194's
   `storedBundleUsable`). Absent field = no requirements: legacy
   manifests stay installable.
3. Old-APK protection: hosts at hostApi 1 predate the field and ignore
   it, so a requirement-bearing release with `hostApiMin < 2` is
   malformed — rejected at parse time, and the publisher refuses to
   sign one. `REQUIREMENTS_MIN_HOST_API = 2`; `HOST_API_VERSION` moves
   to 2 (capability-aware host). Consequence of the existing min=max
   pinning: releases published for host-api 1 no longer apply to the
   new APK — re-publish with `--host-api 2` (publisher default).
4. Publisher: `--requires-capability name:version` (repeatable); the
   default host-api tracks the current host (2).
5. Versioning discipline documented at the protocol: HOST_API_VERSION
   is the coarse gate (bump when gate semantics or the native surface
   change); per-capability contract versions are the fine gate
   (additive-compatible service changes keep the version; breaking
   changes bump it and the release declares the new minimum).

## Verification

- JVM (`HostServiceRegistryTest`): snapshot tracks registration,
  versions, and unregistration.
- JVM (`UpdateProtocolTest`): requirements parse; malformed values and
  sub-2 hostApi pins fail closed; the gate refuses missing
  capabilities, too-old contracts, and empty inventories; newer host
  contracts satisfy older requirements.
- Device (`OtaEngineJourneyTest`): v2 requires `system:1` and applies
  end-to-end (requirement-bearing releases are installable when met);
  v6 (`hologram:1`) and v7 (`net:2`) are refused at the gate — no
  staging, no quarantine — and v2 keeps running.
- Publisher smoke: refuses requirements with `--host-api 1`; emits
  signed `requiredCapabilities` with the default host-api 2.

## Status note (2026-11-13, implemented on `feat/tn-195-capability-requirements`)

The review's stronger option — a build-time-generated runtime identity
(fingerprint baked via buildConfigField) — stays open; the snapshot +
signed-requirements mechanism delivers the review's actual requirement
(old APK rejects new-capability bundles before running) without new
build plumbing.

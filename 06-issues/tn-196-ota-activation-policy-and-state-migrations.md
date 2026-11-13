---
okf_version: 0.2
title: "TN-196: OTA activation policy + signed state migrations"
summary: "Every verified release applied immediately, and state carried across a swap only on equal schema numbers — no way to defer activation to a safe moment, and no way for an app to change its data shape without silently dropping user state. Release metadata gains a signed activation policy (immediate | next-launch | idle) and stateMigrationsFrom (old state schemas the release's restore handler can migrate); hosts at HOST_API 3 honor both. idle releases activate when no text-input session is live or on an explicit system.activateUpdate request; next-launch releases activate at boot, re-verified, trial-disciplined. Equal schema numbers no longer prove field compatibility — an explicit signed migration declaration does."
type: issue
status: ready
issue_id: "TN-196"
priority: "P0"
depends_on:
  - "TN-150"
  - "TN-163"
  - "TN-194"
---

# TN-196 — OTA activation policy + signed state migrations

The third P0 from the 2026-11-13 OTA review: "Kebijakan aktivasi dan
migrasi state".

## Purpose

Two gaps in how a verified release reached the running app:

1. **Activation was unconditional.** The moment a download verified, the
   host swapped engines — mid-form, mid-companion-session, whenever the
   check happened to land. The review asked for a choice: activate on
   the next launch, when no form or critical interaction is active, or
   immediately when the app explicitly asks. None existed.

2. **The schema-equality carry gate proved less than it claimed.**
   `shouldRestore(old, new)` restored state only when both sides
   declared the same positive state schema — but equal numbers prove
   nothing about app FIELD compatibility: an app can change its data
   shape while keeping the framework's schema constant, and user state
   silently restarts clean (or worse, a restore handler receives a shape
   it no longer understands). Schema migrations were called out as "an
   explicit designed mechanism, never an accident of OtaManager" —
   but no mechanism existed.

## Required outcome

1. Signed activation policy in release metadata:
   - `immediate` (default; absent field = current behavior — legacy
     manifests unchanged);
   - `next-launch`: staged but never applied live; the host activates it
     at the next cold boot — re-verified through the TN-194 startup gate,
     promoted to TRIAL before booting (process death before confirm
     quarantines, TN-138 discipline);
   - `idle`: staged; activates when no text-input session is live (the
     resume cadence) or when the app explicitly calls
     `system.activateUpdate` (force past the idle gate).
2. Deferred releases do not re-download on every check; a stale staged
   candidate that fails re-verification is DISCARDED (not quarantined —
   a stale stage is not a defect) and re-downloads fresh.
3. `stateMigrationsFrom` (signed list of old state schemas): restores
   across a schema change when the new release declares it can migrate
   the old shape; the migration itself is app-authored inside the new
   bundle's restore handler, and TN-163's unacknowledged-restore refusal
   still gates the swap. Equal-schema carry is unchanged.
4. Host-API discipline, enforced at parse time and in the publisher:
   deferred activation or migrations need `hostApiMin >= 3`
   (`ACTIVATION_MIN_HOST_API`) — older hosts would ignore the fields and
   apply immediately / restart clean. `HOST_API_VERSION` moves to 3.
5. Publisher: `--activation immediate|next-launch|idle` and repeatable
   `--migrates-state-from N`; both refused below host-api 3.

## Verification

- JVM (`UpdateProtocolTest`): `testActivationPolicyParse` (defaults,
  explicit values, malformed values, host-api discipline);
  `testStateCarryGate` extended with migration acceptance/refusal.
- JVM (`UpdateStoreTest`): `testPendingStagedDetection` — staged with
  envelope is the candidate; confirmed/newer-only/legacy-no-envelope/
  quarantined/older-than-accepted are not.
- Device (`OtaEngineJourneyTest`): v8 (next-launch) stages without
  applying and activates through the re-verify → trial → boot path at
  engine level; v9 (idle) defers while the idle gate is closed and
  applies on explicit force; v10 (stateSchema 2, migrates 1) applies
  immediately with the migration declaration riding to the apply
  callback.
- Publisher smoke: unknown activation refused; migrations below host-api
  3 refused; legacy shape emits neither field.

## Status note (2026-11-13, implemented on `feat/tn-196-activation-policy`)

Remaining OTA work per the review: the UI-Activity journey test (form +
scroll + live TCP/TLS + update + background/close — P1), then staged
rollout, failure monitoring, signing-key rotation, asset management.

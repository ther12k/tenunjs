---
okf_version: 0.2
title: "VOTOL consumer feedback record (2026-10-02)"
summary: "Framework-level feedback from the first external-consumer build (PR #215, examples/votol): what the service-seam architecture already got right, and the five gaps — in the order they hurt — that pushed the real phone build off the framework onto native Kotlin. Recommendations for roadmap sequencing only; no decisions are claimed here."
type: report
status: accepted
---

# VOTOL consumer feedback record (2026-10-02)

## Scope and method

The VOTOL companion app started life inside this repository
(`examples/votol`, PR #215) and ran well in the browser host
(`bun examples/votol/dev.ts` — same-origin proxy to the esp-votol
dashboard backend). The moment it had to reach a real phone, the shipped
artifact was a native Kotlin app instead of a TenunJS bundle. That gap is
the subject of this record. Evidence is the example's own source
(`examples/votol/src/runtime.ts`, `src/snapshot.ts`, `dev.ts`), the
Android verification path, and the build history of the phone app. This
record captures recommendations for roadmap sequencing; per the planning
discipline, none of it is a decision until an owning issue takes it.

## What the framework already got right (keep these)

- **The service-seam factoring is correct.** Screens never touch
  networking; `VotolRuntime` exposes seams (`navigate`, `command`,
  `keyless`, `pod`) and each host implements them. All five screens
  stayed headless-testable, and the pod screen's BLE logic lived entirely
  in the browser host. This should stop being an example convention and
  become the documented framework pattern.
- **Fail-soft data normalization matches embedded reality.**
  `src/snapshot.ts` surfaces honest "unknown" states for a down backend
  instead of crashing. Companion apps live in a world of absent hardware;
  the framework should teach this posture explicitly.
- **Evidence discipline made the boundary trustworthy.** The README's
  blunt "cannot build and ship a real application today", TN-132's exact
  boundary, fail-closed CI, and APK digest verification meant the limit
  was known up front instead of discovered by debugging.

## The gaps, in the order they hurt

### 1 — The dev-loop/host gap is the whole product, and it is measured in the wrong place

The app ran beautifully in the browser host, but the Android gate
(`verify:android`) proves the embedder with a hand-authored scene
(`embedders/android/app/src/main/assets/tenun_app.js`) — not
representative of how anyone writes apps. Suggested milestone exit: a
TSX-compiled example bundle runs in the Android QuickJS host, even with
ugly widgets, before the widget layer is polished. (The browser-shell
half of this is blocked on the TN-042 ownership mismatch recorded in the
2026-09-28 Android host review.)

### 2 — Native capabilities are scheduled too late for real apps, and the contracts can't be retrofitted

The phone app needed on day one: a BLE GATT client
(scan-with-UUID-filter → connect → discover → write + notify + CCC
descriptor), camera barcode scan, key-value storage, clipboard. An app
can ship with ugly widgets; it cannot ship without BLE. The suggestion
is not "implement M5 early" — it is to **freeze the capability-seam
contracts early** (a minimal platform module: `ble` / `storage` /
`camera`), because seams written against a stable contract survive while
apps written against half-built internals get rewritten. Permissions
(Android S+ `BLUETOOTH_SCAN`/`BLUETOOTH_CONNECT`, legacy location,
camera) and their degradation states belong in the same contract — app
authors will get this wrong every time if it is left to them.

### 3 — The interaction model is action-driven, but companion apps are push-driven

"Native event → action → transaction → commit" fits taps. This app is
dominated by traffic the user didn't cause: BLE status notifications
arriving while idle, background reconnection, fob near/away flips, a
LINKED/SEARCHING/OFFLINE link state machine. Today that lives in the
`actionSeams` capture-after-mount dance plus the `podSync()` replay in
`examples/votol/src/runtime.ts` — bookkeeping the framework should own.
Make the host→runtime push channel a first-class citizen (with
coalescing/backpressure) delivered through a screen service context,
rather than something each app improvises.

### 4 — Theme must be a framework primitive, decided before widgets freeze

Light/dark at runtime with a persisted choice touched every color. The
native Android build got it free via resource aliases; the web replica
hand-plumbed ~40 CSS variables. If scenes bake colors at commit time,
fine — but define semantic color slots / token indirection now, or every
app (and any future OS dark-mode-follows) hand-plumbs it later.

### 5 — Smaller practical items

- A bundling story for fonts plus a default type ramp (this app fell
  back to system fonts; variable TTFs are unreliable before Android
  API 33).
- **Host-parity assertions** in the test stack: a check that each host
  actually implements every seam an app uses, so an embedder cannot
  silently claim an app it cannot run. This failure mode is precisely
  why two apps exist.
- The KVM requirement already has a documented host-only tier — keep
  that.

## Disposition

No fix is claimed by this record. The one-sentence summary offered to
the roadmap: the roadmap orders work by engine-difficulty (widgets M4,
capabilities M5, DX M6), but app survival orders it contracts-first —
freeze the seams, the push channel, and the theme tokens early even if
implementations come late, and TenunJS would have kept this app instead
of losing it to Kotlin at the first real phone. Items needing an owning
issue: gaps 1–4 as roadmap re-sequencing input to the TN-131/132/133
planning track, gap 5's host-parity assertion as a candidate test-stack
gate.

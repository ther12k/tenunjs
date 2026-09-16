# Provenance — gallery-prototype-tapfix

Artifact: **tenunjs-gallery-fixed.apk** (release `gallery-prototype-tapfix`)
Recorded: 2026-09-16

## Classification

**Repackaged prototype / JS-overlay build.** Not a clean end-to-end build
of `main`. The native/Kotlin payload comes from a locally staged APK; only
`assets/gallery_app.js` was replaced with the current tap-fix bundle, then
the APK was zipaligned and re-signed.

## Full values

| Field | Value |
| --- | --- |
| Release | `gallery-prototype-tapfix` |
| Artifact | `tenunjs-gallery-fixed.apk` |
| Artifact type | repackaged prototype / JS-overlay build |
| APK SHA-256 | `fa8e334b19668a2371cbfb117dede9ae56161a8179ca1575f661baeaf83c3f78` |
| Signing certificate SHA-256 | `9d3842ebf73ac1149824efa8bc351d5759eb01babf47c5dab9cb96eacc3607cb` |
| Signature schemes | APK Signature Scheme v2 + v3 (apksigner-verified; v1 absent) |
| Package id | `id.my.tenun.embedder` |
| versionCode | `1` |
| versionName | `0.1.0-alpha` |
| Native/Kotlin origin | staged `tenunjs-gallery-prototype-debug.apk`, SHA-256 `98139dbadd7147567013804dc9aaad7a1e883dfd470b236f4747bf166995890e`, built locally via `run_android_test.sh` from the working tree that became PR #195 (pre-merge; **not** a CI-verified `main` build) |
| Gallery JS origin | bundle SHA-256 `8e9d6ab24c7a96294e4fa38276ca3885fba3f8848185721bb94d07436ae2e3bb`, built by `tools/gallery-bundle/rebuild.ts` from `main` @ `7824b50` (tap fix, PR #195) |
| Legacy notes app | `assets/tenun_app.js` unmodified from the staged APK |

The signing key is a freshly generated debug key (the machine holding the
original keystore was reset mid-session). Installing over a previous build
requires uninstalling first — expected when the signature identity changes.

## What this artifact can and cannot prove

**Can prove:** the corrected gallery JavaScript (tap fix) works with the
existing staged Android prototype host on a physical phone — navigation,
actions, and the generic host→JS event contract.

**Cannot claim (even after a perfect run):**

- reproducible build from current `main`
- native/Kotlin code corresponds exactly to `7824b50` (it corresponds to
  the PR #195 working tree, built locally, pre-merge)
- production signing/update behavior
- current-main physical-device acceptance
- incident #191 resolved

## Focused phone test for this artifact

Fresh install → launch, then per module: home tiles navigate; Banking
transfer/pay; Smart Home toggles/scenes; Fitness log/complete; Store cart
mutation; Settings switches; Music transport + seek; Chat quick-reply/send;
Recipes favorite/servings; Crypto timeframe/refresh. Then background →
foreground, close → reopen, and repeated navigation/taps.

Watch `adb logcat -s TenunEngine` for
`TENUN_ENGINE_INIT_FAILED stage=... attempt=...` and any JS dispatch
errors.

Because the original defect was a literal `tap` vs `TAP` string mismatch,
exercise several unrelated modules (e.g. Banking + Settings + Music +
Chat): one working screen could be luck; four unrelated ones responding is
strong evidence the generic event contract is fixed.

**#191 stays a separate verdict:** `init failure observed: YES / NO`.
A clean run is useful evidence but does not close the incident.

## Publishing the provenance to the release

When a shell is available:

```bash
gh release edit gallery-prototype-tapfix --notes-file <this file>
```

## Next infrastructure step (after the phone test)

Have CI publish the debug APK directly from a verified `main` revision
with source SHA, APK SHA-256, certificate fingerprint, and CI run ID — so
device evidence ties exactly to source instead of to a repackaged overlay.

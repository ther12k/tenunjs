# Workout pilot — Phase 0 baseline and capability matrix

Established 2026-11-05 against TenunJS `1427f41` (clean tree, `main`), in the
worktree of branch `feat/workout-pilot-gate-a`. This is the Phase 0 record the
UI/UX improvement plan requires before Milestone A implementation: repository
revision, toolchain, baseline results, capability matrix, and the
dependency-backed mapping for every change this pilot makes.

## Toolchain and baseline results

| Item | Value |
| --- | --- |
| Revision | `1427f4124063f46491bdd696caa626c5ee83dcdc` |
| Bun | `1.4.0` (repo `packageManager`; installed locally, not on PATH by default) |
| TypeScript | `7.0.2` (workspace devDependency) |
| `bun run typecheck` | PASS — all five tsconfigs (root, examples, votol, polytron, gallery-bundle) |
| `bun test` | **659 pass / 0 fail** across 58 files, 3730 assertions |
| `verify:manifest` / `verify:evidence` | untouched; no governed design-pack files modified |
| Android build | `embedders/android` Gradle project; JVM unit tests via `./gradlew test`, device stages via `run_android_test.sh` / `run_device_acceptance.sh` (requires KVM/emulator or physical device — not available in this environment; recorded as a limitation below) |

Known pre-existing failures: none (baseline is fully green).

## Physical device target (declared)

The plan requires one supported physical Android target. This environment has no
attached device or emulator, so the declared target is recorded as policy and
the device evidence rows below stay explicitly **pending**:

- Device class: Pixel-4a-class or newer (repo supported-baseline matrix)
- Record on first acceptance run: density, font scale, OS version, refresh rate, keyboard

Emulator (`run_device_acceptance.sh`) results, when produced, are diagnostic;
physical-device TalkBack/IME journeys are the acceptance gate and remain open.

## Capability matrix

Legend: **implemented** (contract + host + tests), **prototype** (works, bounded
contract, known gaps), **missing**, **blocked** (naming the blocker).

| Capability | State | Evidence / notes |
| --- | --- | --- |
| Display-list scene parse/paint (rect, outline, gradient, circle, ring, line, text) | implemented | `packages/widgets/src/display-list.ts`; `DisplayListScene.kt` / `TenunSurfaceView.kt`; fail-closed `SceneContractException` |
| Layout (bounded TS layout, TN-157) | implemented | `layoutScreen` lowering; viewport negotiation TN-158 |
| Theme tokens, palettes, runtime switching (TN-170/173/174) | implemented | `theme-slots.ts`; `bakeThemeScene` |
| Environment dispatch: locale/font-scale/platform (TN-187) | implemented | `ApplicationRuntime.setEnvironment`; host `maybeDeliverEnvironment` |
| Viewport negotiation (TN-158) | implemented | `VIEWPORT` verb, logical px |
| Controlled single-line text input (TN-160) | implemented | revisioned sessions, composition, stale guards; `keyboardType` locked to `"text"`, `returnAction` locked to `"done"` |
| Numeric keyboard intent | **added** (slice A) | plan A2; extends TN-160's contract: `number`/`decimal` intents, fail-closed draft gate, host inputType mapping |
| Focus transfer (Next/Done) | **added, bounded** (slice C) | `inputAction: "next"` submits and advances to the next editable field in layout order; host maps it to `IME_ACTION_NEXT`. Full TN-081 focus tree/restoration stays open |
| Keyboard insets | **added, floor** (slice C) | host `WindowInsets` ime listener (API 30+) dispatches `INSET` (VIEWPORT negotiation precedent); the render reserves logical px from the viewport height. Auto-reveal scrolling of a field under the keyboard remains a TN-081 follow-up |
| Independent scroll regions (TN-161) | implemented (drag only) | offsets host-owned, content-space taps, region-id keyed; **no fling physics, no virtualization** (TN-083/084/085 remain open) |
| Route transitions (TN-169) | implemented (slide/fade, host-evaluated, ≤10s cap) | `scene.transition` burst semantics; not a general animation system |
| General animation surface (TN-086/087) | **missing** → pilot adds only the smallest countdown slice (plan A3: deadline + injected clock + host-painted ring re-commit) | no per-frame JS contract claimed |
| Semantics wire v1 (TN-179) | implemented | roles button/text/header/textfield/container/generic/group/alert; actions press/long-press/focus; live regions rate-limited |
| Android accessibility bridge (TN-180/186) | implemented (prototype contract) | `SceneAccessibility.kt`; `ACTION_SET_TEXT` supported; physical TalkBack journeys pending |
| Overlays (dialog/sheet/snackbar, TN-088) | **missing** at framework layer | example-side `ModalBottomSheet`/`AlertDialog` in ui-kit only; Milestone B scope |
| Images (TN-045/046) | **missing** (Icon is text-glyph based) | Milestone B scope |
| Gestures beyond tap/long-press + swipe actions | **missing** (gesture arena TN-082 open) | Milestone B scope |
| Lazy lists (TN-085) | **missing** | Milestone B scope; the 6,554-record picker fixture is specified now but not claimed |
| Vector paths / custom drawing | **partial**: `CanvasBox` (example) + fixed op set only | Milestone C scope |
| Multiline text wrap / ellipsis / line height | **missing** (one baseline line per text op; `clip` only; `align` only `"center"` on host) | plan A1; slice D adds measurement/wrap fixtures + minimal lowering changes |
| Navigation lifecycle/back (TN-063/065) | **added, bounded**: Back routes through one owner — `goBack()` pops a bounded origin stack, handoff `BACK` verb answers `{handled}`, host `onBackPressed` applies the platform default when not handled (plan B2 slice). Route restoration policies stay with TN-063/066 | Milestone B scope (rest) |

## Dependency-backed mapping (every pilot change → owner)

The plan's rule: extend delivered contracts; never fabricate a blocked API; no
new TN numbers invented here — bounded follow-ups are named, tracker allocation
happens through the repository's normal governance.

| Pilot change | Extends / depends on | Bounded follow-up named |
| --- | --- | --- |
| `keyboardType: "number"\|"decimal"` on TextField descriptor + host input type | TN-160 delivered contract (same editor, same revision protocol) | numeric/decimal editing acceptance issue (plan §9 tracking gap) |
| Numeric content gate (fail-closed charset on number/decimal fields) | TN-160 stale-guard machinery; rejected edits are simply not adopted | same as above |
| `returnAction: "next"` + runtime focus transfer | TN-160 session focus; NOT the full TN-081 native focus tree | TN-081 stays open unchanged |
| Host IME-inset dispatch → runtime viewport adjustment | TN-158 viewport negotiation pattern | TN-081 insets contract stays open |
| Workout example `RestTimer`: deadline + injected monotonic clock, timer re-commits | host `system.scheduleTimer` (`TIMER` dispatch, existing) | TN-086/087 animation graph stays open |
| Reduced-motion + announcement policy | TN-187 environment (`platform`); semantics `liveRegion` (TN-179) exists | TN-092 reduced-motion policy stays open |
| Workout-pilot example app (fixtures, journeys) | TN-155 framework-feel pattern (factory + host entry + parity script) | acceptance-example tracking issue (plan §9 tracking gap) |
| Text measurement/wrap fixtures (slice D) | TN-157 bounded layout; host text op | TN-075 shaping service stays open |

Everything else in the plan (Milestone B/C capabilities) maps to already-open
issues (TN-063/065/082–088/045/046) and is **not started** by this branch.

## Hosts and gates this pilot touches

- `packages/widgets` TS contract + runtime (bun tests, `tsc` strict)
- `embedders/android` Kotlin host descriptor parse + `EditorInfo` mapping
  (JVM unit tests; device tests extended where the harness permits)
- `examples/workout-pilot` journey tests (bun, fixture-driven) following the
  framework-feel precedent (`createXRuntime(viewport)` factory + journey tests)

## Milestone A implementation record (updated 2026-11-05)

All five first-batch items are implemented on `feat/workout-pilot-gate-a`
(4 commits, each a bounded slice; `bun run verify:ts` green at every step):

| Plan item | Slice | Delivered |
| --- | --- | --- |
| 1. Baseline + acceptance-fixture spec | docs | this document + `fixture-journeys.md` (frozen ids) |
| 2. Renderer-consistent text measurement fixtures | slice D | `layoutTextLines` single source, CJK/URL hard-break, `maxLines`/`ellipsis`, 9 fixtures, reflow journey assertions |
| 3. Numeric keyboard intent + decimal-editing tests | slice A | `number`/`decimal` intents, fail-closed draft gate, host `inputTypeFor`, JVM + bun tests |
| 4. Focus/inset coordination + Focus-workout journey | slices B/C | Focus journey + `inputAction: "next"` transfer + `INSET` reveal floor |
| 5. Essential motion/countdown slice (Gate A) | slice B | deadline + injected-clock countdown, ~1 Hz tick chain, host-painted ring, single completion announcement |

Suite: **720 pass / 0 fail** (61 over baseline 659), `tsc` strict clean across
all five tsconfigs.

### Review remediations (addressing findings across framework, host, and example)

- **Android compilation & IME lifecycle:** Fixed compile failure in `DisplayListInputConnection`
  where `returnAction` was read from an undefined variable; `TextInputSession.adopt` now restarts
  IME input when `keyboardType` or `returnAction` intent changes; resolved contradictory JVM assertion
  in `TextInputSessionTest` for `"next"`. Corrected `OnBackInvokedDispatcher.PRIORITY_DEFAULT` in `MainActivity.kt`.
  Preserved local IME edits during uncommitted batch editing and unedited scene re-renders (geometry/inset updates).
- **Keyboard insets & fixed anchors:** Normalized unit comparisons for `INSET` delivery; only mark
  unsupported if initial negotiation fails (do not permanently disable on transient errors); adjusted
  native fixed-anchor painting in settled frames and transition frames (`drawSceneLayer`) as well as
  hit-testing to take `reservedBottomInset` into account so bottom chrome does not sit behind the soft keyboard.
  `INSET` dispatch in `installHostHandoff` commits when an invalidation subscription is absent and forwards
  the parsed payload in the non-negotiating fallback.
- **Android Back (API 33+):** Registered `OnBackInvokedCallback` on `MainActivity` using official
  `OnBackInvokedDispatcher.PRIORITY_DEFAULT` for modern predictive-back routing alongside `onBackPressed()`.
  Fallback on unhandled Back delegates to `moveTaskToBack(true)` for the root launcher task, matching platform default,
  with explicit `Unit` callback return typing.
- **Navigation & focus guards:** `goBack()` now triggers route-activation channel replay (TN-142
  conformance); `TEXT_SUBMIT` next-focus transfer is restricted to the originating route to prevent
  accidental cross-screen focus jumping; `installHostHandoff` commits handled Back events even without
  an explicit invalidation subscription; text input error recovery republishes authority and restores wrapper
  tap runs on `INVALID_TEXT_CONTENT`; custom INSET fallback handlers commit the resized frame when unmonitored by invalidation listeners.
- **Text wrap & metrics:** Hard-break logic respects grapheme clusters (diacritics, ZWJ sequences,
  flags with Regional Indicator pair parity); ellipsis calculations reserve space within max width by
  popping whole clusters (avoiding malformed UTF-16 surrogates) and safely suppressing when budget is smaller
  than marker width; placement layout text line wrapping respects available constraint width rather than tight allocation width;
  prop codecs/layout tolerate `null` values; JSX intrinsic typing updated for `<text>`;
  metric tolerance tests reflect honest formula assertions.
- **Workout journey state & countdown:** Preserved user-entered weights/reps in completed set records
  and view; guarded completion button taps with a set-completion cooldown against rapid duplicate replays;
  guarded view rendering against older snapshots without `results`; captured instant deadline remainder
  on pause; tied timer lifecycle to runtime generation to prevent orphaned callbacks; used monotonic clock
  (`performance.now()`) by default and bound native wake-up scheduling to prevent wake-up accumulation across non-timer dispatches;
  rebased countdown deadline and cooldown across fresh engine instantiation on `TENUN_RESTORE`.

### Slice E — production boot path (bun tier)

- `src/host-entry.ts` installs the QuickJS `setTimeout` shim (polytron-entry
  precedent) so the countdown's tick chain survives bundling; the dispatch
  entry drains due timers on every host re-entry and passes `TIMER` through.
- `scripts/build-host.ts` builds and boot-verifies the IIFE bundle in a bare
  (QuickJS-like) context.
- `test/host-boot.test.ts` drives the production contract three ways: module
  boot + frozen identifiers; bun-global timer path (~1s tick repaints the
  ring); and the **QuickJS shim path** — the built bundle in a no-timer-globals
  VM requests `system.scheduleTimer` through the fake host bridge, and the
  TIMER re-entry drains the tick and visibly advances the countdown.
- Still device-gated: real QuickJS engine, JNI transport, paint, IME.

### Evidence boundaries (unchanged rules, explicit)

- Physical-device rows remain **pending**: this environment has no Android
  SDK/emulator, so Kotlin changes are review-verified with JVM-test additions
  committed (`TextInputSessionTest`); Gradle/device gates must run where an
  SDK exists. Emulator evidence would still be diagnostic, not acceptance.
- Gate A at bun level = journey usable through the public runtime composition
  (taps, TEXT_EDIT, TEXT_SUBMIT, pushTo ticks, theme/scale/inset re-renders).
  TalkBack, live-IME, and reduced-motion-policy acceptance remain open per the
  plan and TN-091/092.

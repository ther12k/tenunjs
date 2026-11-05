# Workout pilot (openGym-shaped acceptance example)

Fixture-driven acceptance journeys that prove **Android UI pilot readiness**
for TenunJS — the framework layer of the UI/UX improvement plan. This is not
an openGym fork: no backend, no persistence, no application-specific host code.
Everything here is ordinary TSX over public `@tenunjs/*` APIs.

## Journeys and status

| Journey | Gate | Status |
| --- | --- | --- |
| 1. Focus workout — edit weight/reps, complete a set, rest countdown with pause/resume/skip | Gate A (Milestone A) | **implemented here** |
| 2. Workout + exercise picker (search, sheet, swipe/undo) | Gate B (Milestone B) | identifiers frozen in `docs/fixture-journeys.md`; awaits overlays (TN-088), lazy lists (TN-085), swipe (TN-082) |
| 3. Progress (chart, heatmap, muscle map) | Gate C (Milestone C) | identifiers frozen; awaits vector paths (TN-045) |

## Layout

```text
docs/phase0-baseline.md     baseline record + capability matrix + issue mapping
docs/fixture-journeys.md    frozen journeys, component states, action/semantics ids
src/fixtures/workout.ts     deterministic fixture model, lenient decimal parsing, id builders
src/screens/focus.screen.tsx  Journey 1 screen (controller + view)
src/runtime.ts              createWorkoutRuntime(viewport, { now?, schedule? }) — injected
                            monotonic clock and foreground scheduler
src/theme.ts                TN-170 light/dark palette pair
src/host-entry.ts           QuickJS bundle entry (installHostHandoff)
test/runtime.test.ts        journey tests through the full runtime (taps, TEXT_EDIT, ticks)
test/focus-screen.test.ts   named-action tests + fixture model unit coverage
```

## Rest countdown design (plan A3)

- Remaining time is always `deadline − now()` with the **clock injected** by the
  runtime factory — a late callback cannot accumulate drift.
- Ticks chain at ~1 Hz through `ApplicationRuntime.pushTo("focus", "restTick", now)`;
  each tick re-renders and the **host paints the ring op** — no per-frame JS work.
- TalkBack: the countdown value is *not* a live region; completion is announced
  once via a role-`alert` semantics node whose label changes (host rate-limits
  live-region announcements).

## Run

```sh
bun test examples/workout-pilot/   # journey + named-action tests
```

## Recorded limitations

- Physical-device acceptance (live soft keyboard, TalkBack journeys, insets on a
  real IME) is **pending** — this environment has no Android SDK/emulator; see
  `docs/phase0-baseline.md`. Emulator results would be diagnostic only.
- The number/decimal *keyboard* shown on Android follows `inputTypeFor()`;
  content gating is enforced framework-side (`numericDraftError`), and
  committed-value validation (ranges, separator) is application-owned here
  (`parseDecimalDraft`).
- Navigation/Back, overlays, images, lazy lists, and gesture/swipe are
  Milestone B capabilities — see the plan; do not read their absence here as
  framework completion signals.

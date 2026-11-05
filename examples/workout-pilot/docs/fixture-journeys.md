# Workout pilot — fixture journeys, states, and identifiers

Phase 0 deliverable: these journeys, component states, and identifiers are
frozen **before** implementation. Tests and screens reference them; changing an
identifier here is a contract change, not a refactor.

## Scope of this document

Milestone A delivers Journey 1 (Focus workout) and closes Gate A. Journeys 2–3
are specified now (stable identifiers) and implemented in Milestones B/C.

## Fixture data (in-memory, deterministic)

- `EXERCISES`: 6,554 generated records (plan B1 volume) — `{ id, name, muscle, equipment, thumb? }`;
  generated from a seeded table so the count and ordering are stable. Milestone A
  consumes only a small `FOCUS_EXERCISES` subset.
- `WORKOUT`: one session — `{ id, title, entries }`, each entry
  `{ id, exerciseId, sets: [{ id, weight, reps, done }] , restSeconds }`.
- Injected clock: `RestTimer` derives remaining time from a deadline and an
  injected monotonic `now()`; no wall-clock reads inside the journey logic.

## Journey 1 — Focus workout (Gate A)

Entry: `createWorkoutRuntime(viewport, options?)` with fixture `WORKOUT`.

Steps and required behavior:

1. Screen shows the entry: exercise name, set rows with weight/reps fields, a
   "Complete set" action, and (after completion) a rest countdown.
2. Tap a weight field → session opens (numeric intent); type `62.5` → the
   field echoes `62.5`; intermediate states `""`, `62`, `62.` are preserved
   while editing; committed values parse leniently (`.` and `,` both accepted
   as decimal separator; the committed number is `62.5`).
3. IME Next (slice C) or tap moves focus weight → reps; Done submits; no
   obscured-field states at 1× and 2× text scale (inset reveal, slice C).
4. "Complete set" marks the set done, advances to the next set, and starts the
   rest countdown (`ring` progress op painted by the host from committed
   progress values — no per-frame JS).
5. Countdown controls: pause/resume and skip. A late timer callback does not
   accumulate drift: remaining time is always `deadline − now()`.
6. TalkBack: the countdown does not announce every second; completion of the
   rest period announces once via a `liveRegion` semantics node.

### Stable action identifiers (tap payload ids)

| Action id | Meaning |
| --- | --- |
| `workout.set.<entryId>.<setId>.field.weight` | weight field (TextField id) |
| `workout.set.<entryId>.<setId>.field.reps` | reps field (TextField id) |
| `workout.set.<entryId>.<setId>.complete` | complete-set button |
| `workout.set.<entryId>.<setId>.step.weight.up` / `.down` | stepper buttons |
| `workout.set.<entryId>.<setId>.step.reps.up` / `.down` | stepper buttons |
| `rest.pause` / `rest.resume` / `rest.skip` | countdown controls |

### Stable semantics identifiers

| Semantics id | Role | Notes |
| --- | --- | --- |
| `workout.title` | header | screen title |
| `workout.entry.<entryId>.exercise` | text | exercise name |
| `workout.set.<entryId>.<setId>.status` | text | `liveRegion` on rest completion announcement |
| `rest.ring` | text | countdown value, **not** a live region (no per-second announcements) |

## Journey 2 — workout and exercise picker (Gate B, Milestone B)

- `workout.exercise.add` opens the picker sheet; `picker.search.field` filters;
  `picker.item.<exerciseId>` selects; back/undo behavior per plan Gate B.
- Requires: overlays (TN-088), lazy list (TN-085), swipe actions (TN-082).
- **Not started on this branch**; identifiers frozen for later tests.

## Journey 3 — progress (Gate C, Milestone C)

- `progress.chart`, `progress.heatmap.<week>.<day>`, `progress.muscle.<group>`.
- Requires vector paths/interaction (Milestone C). **Not started** on this branch.

## Component states (fixture matrix)

Every Journey-1 component must render, and its journey test must cover, these
states: default, focused, editing-intermediate (`""`, `12`, `12.`), committed,
error (non-numeric committed value → field error style, value not adopted),
disabled (done set), long label (≥40-char exercise name reflow), empty set list,
and large text (textScale 2). Themes: light and dark (TN-170 runtime switch).

---
okf_version: 0.2
title: "ADR-0028: Desktop pilot carve-out — lekuvo under a firewall"
summary: "ADR-0021 froze desktop until the M7 beta mobile gate. TN-198 now supplies the frame-time evidence that clause's revisit trigger anticipated: a notch-scale 760x560 scene CPU-rasterizes end-to-end at p95 1.54 ms — 10.9x inside a 60 Hz budget. This ADR amends the freeze for exactly one named pilot (lekuvo, a host-owned media/notch overlay), four issues wide, inside a firewall that never touches mobile embedders or the beta gate. Everything else desktop stays frozen."
type: decision
status: accepted
supersedes: "ADR-0021 (platform-order clause 2 and the ship-desktop non-goal, for the named pilot only)"
---

# ADR-0028: Desktop pilot carve-out — lekuvo under a firewall

## Context

ADR-0021 froze the v0.x charter: "macOS, Windows, Linux only after the
beta mobile gate" (platform order clause 2) and "ship desktop or web
targets before the beta mobile gate" as a hard non-goal, with issues
proposing desktop closed by rule. Its enforcement clause allows lifting
a boundary only through a superseding ADR that names the violated
invariant, affected issue IDs, migration cost, and rollback plan — and
its revisit trigger allows exactly that when evidence exists.

The evidence now exists. TN-198 (PR #288) measured the first frame
times in the repo: the notch-scale scene of a concrete desktop
candidate — **lekuvo**, a media player presenting as a fixed 760x560
transparent overlay (album art, vinyl, EQ pulse, pill morph, MPRIS
metadata) — CPU-rasterizes end-to-end through `engine/render/skia-host`
at p50 1.2–1.6 ms / p95 ~1.5 ms on a laptop i5, 10.9x inside a 60 Hz
budget. A same-machine Flutter comparator (software raster p50
0.43–0.59 ms, GPU 0.30 ms) confirms the order of magnitude; engine
versions verified near-identical (Skia m134 vs m137/138), so the gap
is pipeline, not engine. The ablation record prices the levers
(surface churn 0.17 ms; arc cost a parity-guarded known-cost). No
desktop evidence existed before this; the question "is CPU raster
sufficient for a fixed-size notch surface without a GPU backend" is
answered for this hardware class, with the target-hardware re-run
built in as the kill check.

lekuvo fits the existing architecture without reshape: the host owns
the window (no framework windowing), the surface is fixed-size (no
resize plumbing), the palette is solid colors (no gradient work), text
is single-line labels (TN-075 stays day-one-optional), and the
zbus/MPRIS reference implementation exists in the lekuvo repo
(`crates/lekuvo-media`) — the capability itself is the ADR-0027 recipe
applied to DBus.

## Decision

ADR-0021's platform-order clause 2 and the ship-desktop hard non-goal
are amended **for exactly one named pilot**: lekuvo, on Linux, rendered
through the framework-owned skia-host painter (ADR-0026 stage 2). The
pilot is four issues wide and nothing more:

1. **TN-199 — Scene transparency.** `DisplayListScene` gains an
   optional transparent-scene contract (premultiplied RGBA host
   output), following the documented unknown-field precedent
   (`semantics?`, `scene.transition`): hosts that predate the field
   ignore it; no existing host changes behavior. Contract v1 field,
   versioned per the wire rules.
2. **TN-200 — Linux platform tags.** `CapabilityPlatform` and
   `PlatformKind` gain `"linux"`; capability metadata (permissions,
   availability) carries the tag. Mobile capabilities are untouched.
3. **TN-201 — MPRIS/DBus media capability.** The ADR-0027 recipe
   verbatim: result types, idempotent unsubscribe, static permission
   metadata, contract v1, preview-host shim and fail-closed stubs;
   host-push events deliver metadata (track change) and position. The
   host-driven image-invalidation verb (TN-046 spec delta) rides the
   same host-push machinery.
4. **Linux embedder (TN-202).** Assembly, not research: the JS engine
   spike path that passed (rquickjs, all-PASS) or the portable half of
   the C bridge, skia-host's existing RGBA output presented through
   SHM, input via the gallery-preview `host.ts` contract
   (~295 lines, the embedder template). Lives in `embedders/linux`.

Sequencing: TN-199 → TN-200 → TN-201 → TN-202 (embedder last, when it
is pure assembly). The pilot runs **parallel** to the mobile roadmap
with a firewall, not behind the M7 gate.

### Firewall (what the pilot may not do)

- No other desktop application, platform, or distribution target:
  macOS/Windows remain frozen until the M7 gate + a further ADR.
- No windowing, no desktop shell integration, no packaging/installers:
  lekuvo-host owns its window and lifecycle by design.
- No GPU path day one: ADR-0026's stage-3 evidence gates decide GPU,
  unchanged (the TNP plan's evidence-gated Skia GPU clause is the
  revisit instrument).
- No mobile regression: mobile embedders, the TN-130 beta gate, and
  its checklist are untouched; mobile work always takes precedence
  over pilot work. Painter changes inside the pilot still pass TN-184
  pixel parity (the arc-fast-path probe is the worked example of this
  discipline).
- No desktop-flavored issue survives this ADR's scope: anything beyond
  TN-199..TN-202 closes by rule, as before.

### Kill criteria (falsification)

The pilot halts — contract fields revert, `embedders/linux` is deleted,
pilot issues close out-of-scope — when any of:

1. **Frame budget:** the TN-198 bench re-run on the machine that will
   run lekuvo-host misses a 60 Hz budget with <5x margin at p99
   (the one-command replay makes this cheap; the committed packet's
   co-load annotation documents why quiet-machine readings are the
   decision inputs).
2. **Embedder parity:** the JS-engine path cannot drive the
   `host.ts` contract at gallery-preview parity (scene commits,
   taps, lifecycle) in the spike harness.
3. **Contract instability:** the transparency contract change
   destabilizes any mobile host (unknown-field parsing, output
   format).

## Superseded invariants (per ADR-0021's enforcement format)

- **Violated invariant:** ADR-0021 platform order clause 2 ("macOS,
  Windows, Linux only after the beta mobile gate") and the hard
  non-goal "ship desktop or web targets before the beta mobile gate" —
  amended only for the named lekuvo Linux pilot; every other clause
  and non-goal stands untouched.
- **Affected issue IDs:** TN-198 (evidence, shipped), TN-199, TN-200,
  TN-201, TN-202.
- **Migration cost:** none to mobile — the transparency field follows
  the unknown-field precedent (older hosts ignore it), the linux tag
  adds a platform value mobile never matches, and the embedder is
  additive. The only shared-surface change is skia-host's output
  contract gaining a premultiplied-transparency mode that opaque
  scenes do not request.
- **Rollback plan:** the kill criteria above; rollback is deletion
  plus reverting one optional contract field that nothing mobile
  reads. The evidence packet and comparator record stay for the next
  desktop proposal.

## Consequences

- Milestone gate checklists keep their charter question, with pilot
  PRs (TN-199..TN-202) cited as ADR-0028-scoped, not charter
  violations.
- Documentation must not imply general desktop support: the pilot is
  an application embedder for one named consumer, not a platform
  release.
- The M7 gate itself is unchanged; lekuvo shipping does not open the
  desktop gate — only a further ADR can.
- Painter/engine work the pilot needs (transparency output, MPRIS
  events) is specified to be contract-generic, so mobile hosts inherit
  it only when they choose to.

## Verification

- Every pilot PR cites this ADR and its issue ID; the firewall's
  "nothing beyond TN-199..TN-202" is enforced by review, like the
  charter rules it amends.
- The kill-criteria bench re-run is one command
  (`benchmarks/raster/README.md`); its packet joins the evidence
  chain with the same replay discipline.
- TN-184 parity harness covers any painter change; the arc probe
  (2026-11-15) is the precedent for rejecting non-pixel-identical
  shortcuts.

## Revisit trigger

When lekuvo ships publicly or is killed. A second desktop consumer,
another OS, or GPU-backed desktop raster each require their own
superseding ADR with fresh evidence.

---
okf_version: 0.2
title: "ADR-0021: TenunJS v0.x product charter freeze"
summary: "Freeze the charter, target workload, and non-goals so HTML/web rendering, React compatibility, and premature desktop scope cannot enter v0.x."
type: decision
status: accepted
issue_id: "TN-002"
---

# ADR-0021: TenunJS v0.x product charter freeze

## Context

`00-project/product-definition.md`, `non-goals.md`, and `principles.md` describe the intended product, but they are descriptive documents. TN-002 requires a single accepted, enforceable decision so that dependent issues (TN-003 onward) inherit one frozen boundary. Without it, scope disputes resurface at every milestone gate.

## Decision

The TenunJS v0.x charter is frozen as follows.

### Product

TenunJS is a mobile-native UI framework with four layers:

1. A TypeScript + TSX application API (custom JSX runtime, no React dependency).
2. A controller/action and incremental reconciliation runtime.
3. A native UI engine owning layout, rendering, input, semantics, scrolling, animation, and resources.
4. Thin iOS and Android embedders for platform lifecycle and services.

### Target user

A TypeScript developer building application-oriented mobile interfaces who wants Flutter-like widget composition without Dart, without React, and without a browser engine.

### Target workloads (v0.x)

Business applications and internal tools; school and operational applications; forms and approval workflows; search, filtering, and lists; dashboards and data visualization; settings and account flows; moderately animated consumer applications.

Anything outside these workloads is out of scope until M7 closes, even if technically achievable.

### Platform order

1. iOS and Android first.
2. macOS, Windows, Linux only after the beta mobile gate.
3. Web only as a separate renderer/host investigation that never constrains the mobile core.

### Hard non-goals (fail-closed boundaries)

v0.x must not:

- Reimplement React hooks or claim React package compatibility.
- Treat TSX as HTML syntax or render application UI through a WebView.
- Ship desktop or web targets before the beta mobile gate.
- Draw editable text without native IME contract participation.
- Fake accessibility with screenshots or undocumented overlays.
- Use a chatty JSON bridge for per-property updates.
- Expose raw Skia objects through ordinary widget APIs.
- Require Rust, C++, or any native language in application projects.
- Merge network, database, and rendering logic into single untestable screen functions.
- Make platforms artificially identical where conventions materially differ.

## Enforcement

- Any PR whose diff implements or enables a hard non-goal fails review regardless of other merit.
- Lifting any boundary requires a superseding ADR naming the violated invariant, affected issue IDs, migration cost, and rollback plan; it cannot ride on an unrelated patch (roadmap scope discipline).
- Each milestone gate checklist includes one question: "did anything in this milestone cross a charter boundary?" A yes blocks the gate.
- `falsification-criteria.md` remains the kill-switch layer above this charter: if evidence shows the frozen charter cannot succeed, the project narrows or stops rather than quietly broadening scope.

## Rationale

A frozen charter converts product taste into checkable review criteria. The chosen workloads share one profile — structured UI, lists, forms, moderate animation — which is exactly what the M0–M4 vertical slices optimize. Excluding games, browsers, and web parity protects the atomic-mutation/native-engine architecture from bridge-shaped compromises.

## Consequences

- Issues proposing web/desktop/React features before M7 close as out-of-scope by rule, not debate.
- Documentation and examples must not imply compatibility beyond the charter.
- The workload list bounds benchmark scenario selection for TN-005 and all physical-device evidence.

## Verification

Charter compliance is reviewed at every milestone gate using the enforcement rules above. The first concrete consumers are TN-005 (benchmark scenarios must come from target workloads) and TN-006 (spike contract must exclude non-charter surface).

## Revisit trigger

After M7: pilot evidence, platform policy changes, or a credible request for a new platform may reopen specific clauses through a superseding ADR. Individual clauses may also be revisited earlier if falsification evidence demands narrowing.

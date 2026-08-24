---
okf_version: 0.2
title: "M3: TSX reconciliation, controllers, actions, and navigation"
summary: "Deliver the complete application programming model without React."
type: index
status: accepted
---

# M3 — TSX reconciliation, controllers, actions, and navigation

Deliver the complete application programming model without React.

| Issue | Priority | Dependencies | Required outcome |
| --- | --- | --- | --- |
| [TN-051](tn-051-implement-function-widget-execution-and-child-normalization.md) | P0 | TN-020, TN-034, TN-050 | Pure TSX function widgets compose host nodes with deterministic child semantics. |
| [TN-052](tn-052-implement-keyed-reconciliation-identity-rules.md) | P0 | TN-036, TN-051 | Create/update/move/remove traces preserve identity and diagnose invalid keys. |
| [TN-053](tn-053-implement-property-diffing-and-event-handle-registration.md) | P0 | TN-034, TN-036, TN-052 | Only changed typed props are emitted and native stores runtime-owned action handles. |
| [TN-054](tn-054-implement-root-scheduling-and-bounded-reconciliation.md) | P0 | TN-052, TN-053 | Affected roots reconcile once per committed state turn with starvation diagnostics. |
| [TN-055](tn-055-implement-controller-definition-and-typed-state-initialization.md) | P0 | TN-019, TN-054 | Controllers own typed state, generation, dependencies, and deterministic initialization. |
| [TN-056](tn-056-implement-typed-action-definition-and-dispatch.md) | P0 | TN-053, TN-055 | Events dispatch statically registered typed actions with validated payloads. |
| [TN-057](tn-057-implement-atomic-controller-state-transactions.md) | P0 | TN-054, TN-055, TN-056 | Synchronous mutations publish one coherent render and rollback on thrown action errors. |
| [TN-058](tn-058-implement-cancellable-async-effects-and-concurrency-policies.md) | P0 | TN-056, TN-057 | Latest/drop/queue/parallel policies are bounded and stale completions cannot mutate disposed state. |
| [TN-059](tn-059-implement-one-file-screen-tsx-normalization.md) | P0 | TN-022, TN-055, TN-056 | Single-file screens compile into the canonical manifest without a special runtime. |
| [TN-060](tn-060-implement-split-controller-view-screen-normalization.md) | P0 | TN-022, TN-055, TN-059 | Feature-local split sources compile into the identical manifest contract. |
| [TN-061](tn-061-implement-controller-and-widget-error-boundaries.md) | P1 | TN-030, TN-054, TN-058 | Recoverable view/action failures render declared fallbacks and cancel owned effects. |
| [TN-062](tn-062-specify-typed-route-and-navigation-state-model.md) | P0 | TN-002, TN-055 | Route schemas, stack entries, modal entries, and restoration metadata are versioned. |
| [TN-063](tn-063-implement-stack-navigation-and-screen-lifecycle.md) | P0 | TN-058, TN-060, TN-062 | Push, replace, pop, modal, load, pause, resume, and dispose behavior is deterministic. |
| [TN-064](tn-064-implement-deep-link-parsing-and-invalid-route-policy.md) | P1 | TN-062, TN-063 | Untrusted links validate through typed route schemas and produce declared fallbacks. |
| [TN-065](tn-065-implement-android-back-and-ios-interactive-navigation-hooks.md) | P1 | TN-063 | Platform back/gesture intent coordinates with typed navigation without double commits. |
| [TN-066](tn-066-implement-versioned-navigation-and-controller-state-restoration.md) | P1 | TN-055, TN-062, TN-063 | Restorable state survives process recreation with schema/version mismatch handling. |
| [TN-067](tn-067-close-controller-action-navigation-gate.md) | P0 | TN-051, TN-052, TN-057, TN-058, TN-059, TN-060, TN-061, TN-063, TN-064, TN-065, TN-066 | One- and split-file apps complete typed interactive navigation journeys on both platforms. |

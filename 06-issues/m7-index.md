---
okf_version: 0.2
title: "M7: Pilot, stabilization, and beta"
summary: "Validate the framework in a real application and freeze a credible beta surface."
type: index
status: accepted
---

# M7 — Pilot, stabilization, and beta

Validate the framework in a real application and freeze a credible beta surface.

| Issue | Priority | Dependencies | Required outcome |
| --- | --- | --- | --- |
| [TN-119](tn-119-build-full-reference-business-application.md) | P0 | TN-118 | A non-trivial forms/lists/search/navigation/offline-error application exercises the public API. |
| [TN-120](tn-120-select-and-instrument-a-real-pilot-application.md) | P0 | TN-118 | Pilot scope, baseline metrics, risk owners, rollback, and privacy rules are recorded. |
| [TN-121](tn-121-migrate-pilot-vertical-slices-and-record-framework-gaps.md) | P0 | TN-119, TN-120 | Representative production journeys run on both platforms with issue-backed gaps. |
| [TN-122](tn-122-review-and-simplify-public-api-from-pilot-evidence.md) | P0 | TN-121 | Remove accidental complexity and record every beta-breaking API decision. |
| [TN-123](tn-123-freeze-package-boundaries-versioning-and-compatibility-policy.md) | P0 | TN-122 | Beta packages have explicit support windows, protocol compatibility, and deprecation rules. |
| [TN-124](tn-124-publish-application-tutorial-and-architecture-guide.md) | P1 | TN-119, TN-122, TN-123 | A new TypeScript developer can build, test, debug, and package a complete application. |
| [TN-125](tn-125-publish-widget-native-module-and-platform-view-author-guides.md) | P1 | TN-098, TN-094, TN-122, TN-123 | Extension authors have supported contracts, templates, tests, and compatibility rules. |
| [TN-126](tn-126-complete-independent-accessibility-review-and-remediation.md) | P0 | TN-121, TN-124, TN-125 | External review findings for core journeys are fixed or explicitly gate beta. |
| [TN-127](tn-127-close-performance-and-memory-acceptance-budgets.md) | P0 | TN-121, TN-115, TN-116, TN-122 | Pilot and reference workloads meet declared physical-device budgets without hidden exclusions. |
| [TN-128](tn-128-produce-store-installable-ios-and-android-release-candidates.md) | P0 | TN-102, TN-103, TN-114, TN-123, TN-127 | Signed release candidates install, launch, upgrade, and report symbols correctly. |
| [TN-129](tn-129-run-beta-stabilization-compatibility-upgrade-and-rollback-campaign.md) | P0 | TN-123, TN-126, TN-127, TN-128 | No unresolved release-blocking crash, data, accessibility, protocol, or upgrade defect remains. |
| [TN-130](tn-130-close-beta-gate-and-publish-evidence-index.md) | P0 | TN-124, TN-125, TN-126, TN-127, TN-128, TN-129 | Beta release and complete traceable evidence packet are approved. |

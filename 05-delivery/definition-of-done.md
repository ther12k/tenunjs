---
okf_version: 0.2
title: "Definition of Done"
summary: "Closure standard applied to every implementation issue."
type: plan
status: accepted
---

# Definition of done

An issue closes only when all applicable conditions are met:

- Declared dependencies are closed or explicitly waived by an ADR.
- The scoped implementation exists and no placeholder path is presented as production behavior.
- Public and internal contracts are typed and documented.
- Positive, negative, boundary, lifecycle, and disposal tests pass.
- Platform claims have physical-device evidence where required.
- Generated files are reproducible and checked for drift.
- Diagnostics identify the owning layer and actionable failure.
- Security and accessibility implications are addressed, not deferred silently.
- Benchmarks include environment and methodology when performance is claimed.
- Evidence is stored in the PR/release packet and linked from the issue.
- Out-of-scope work remains out of the patch.
- Reviewer can reproduce the result from a clean checkout.

---
okf_version: 0.2
title: "Independent Review Prompt"
summary: "Reusable prompt for reviewing an issue implementation against its contract."
type: prompt
status: accepted
---

# Independent review prompt

Review the implementation for `<ISSUE_ID>` against its issue Markdown and accepted dependencies.

Do not review only the diff’s apparent intent. Verify:

1. The required outcome is genuinely implemented.
2. The patch does not depend on behavior assigned to unresolved issues.
3. Trust boundaries reject malformed and incompatible input before mutation/execution.
4. Ownership, generations, cancellation, lifecycle, and disposal are correct.
5. Tests cover negative paths and would fail against the previous behavior.
6. Platform claims use physical-device evidence where required.
7. Public APIs do not leak native implementation choices.
8. Generated files and manifests match their canonical sources.
9. Diagnostics identify the correct layer.
10. The evidence packet is reproducible from a clean checkout.

Return findings by severity, with file/line references, reproduction, violated contract, and minimal remediation. Do not approve based solely on passing broad tests.

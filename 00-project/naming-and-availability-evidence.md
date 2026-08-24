---
okf_version: 0.2
title: "Naming and Availability Evidence"
summary: "Fail-closed availability evidence and canonical naming decisions for TenunJS (TN-001)."
type: evidence
status: accepted
issue_id: "TN-001"
---

# Naming and availability evidence

Closes TN-001. Recorded on 2026-08-24 by running each command locally; raw results are quoted verbatim. A check passes only with recorded output proving the name is unclaimed or owned by this project. Anything else is recorded as inconclusive and must be resolved before dependent packages publish.

## Canonical naming

| Identity | Value | Status |
| --- | --- | --- |
| Product name | `TenunJS` | Accepted (ADR-0001) |
| GitHub repository | `ther12k/tenunjs` | Owned by this project, public |
| npm scope | `@tenunjs` | Registry names unclaimed; scope claim pending (follow-up below) |
| Core framework package | `@tenunjs/core` | Unclaimed in npm registry |
| Project scaffolder | `create-tenun` | Unclaimed in npm registry |
| CLI binary | `tenun` | Assigned here; first published in M6 (TN-105) |

Rules:

- All published packages live under the `@tenunjs` scope except the scaffolder, which follows the `create-*` convention.
- The standalone product boundary of ADR-0001 holds: no Bundar-scoped or Bun-coupled package names.
- Renames after M0 require a superseding ADR that names every published artifact affected.

## Availability evidence

Environment: Linux, node v24.11.0 / npm 11.6.1, `gh` authenticated as `ther12k`.

### GitHub repository

```
$ gh repo view ther12k/tenunjs --json name,owner,isPrivate
{"name":"tenunjs","owner":{"login":"ther12k"},"isPrivate":false}
$ gh search repos tenunjs --limit 5
ther12k/tenunjs
```

PASS — repository exists, is public, owned by this project, and no other GitHub repository uses the name.

### npm registry package names

```
$ curl -s -o /dev/null -w "%{http_code}" https://registry.npmjs.org/tenunjs
404
$ curl -s -o /dev/null -w "%{http_code}" https://registry.npmjs.org/create-tenun
404
$ curl -s -o /dev/null -w "%{http_code}" https://registry.npmjs.org/@tenunjs%2Fcore
404
```

PASS — HTTP 404 from the registry proves no package is published under these names.

### npm scope claim

```
$ curl -s -o /dev/null -w "%{http_code}" https://www.npmjs.com/org/tenunjs
403
```

INCONCLUSIVE — the npm website returns 403 to scripted requests (bot protection), so this proves nothing either way. Scope ownership can only be established by acting on the npm account. Publishing under `@tenunjs/*` does not require pre-claiming an org scope (a scoped name becomes owned on first publish), but the scaffolder and docs should reserve it early.

Follow-up (blocking only first publish, not M0 exit): create the npm organization or publish `@tenunjs/core` first, then append the confirmation to this file.

## Fail-closed policy

If any future availability check fails (name claimed, scope squatted), the default is stop-and-rename through a superseding ADR — never publish under a contested name and never silently fall back to a different name without recording it here.

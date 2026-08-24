---
okf_version: 0.2
title: "Security Requirements"
summary: "Trust-boundary and fail-closed requirements."
type: requirement
status: accepted
---

# Security requirements

- Verify bundle and bytecode manifests before application execution.
- Validate every mutation transaction, node reference, opcode, payload length, and protocol version.
- Never let application code pass arbitrary native pointers or class names.
- Native module access shall be capability-scoped and manifest-declared.
- Permission APIs shall preserve platform user intent and never imply permission from a stale cache.
- Deep links and external intents shall be parsed as untrusted input.
- Development-only inspectors and reload endpoints shall be unavailable in release builds.
- Text and image decoders shall be isolated behind resource limits and fuzzed parsers where applicable.
- Platform-view messages shall use generated typed contracts rather than arbitrary evaluation.
- Crash reports shall scrub configured secrets and sensitive user fields.

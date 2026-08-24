---
okf_version: 0.2
title: "Non-functional Requirements"
summary: "Quality constraints for performance, reliability, portability, and maintainability."
type: requirement
status: accepted
---

# Non-functional requirements

- NFR-001: Architecture boundaries shall be versioned and independently testable.
- NFR-002: Malformed mutation buffers, module manifests, and bytecode shall fail closed.
- NFR-003: The core engine shall have no application-specific dependencies.
- NFR-004: Ordinary application code shall not require unsafe native code.
- NFR-005: Build outputs shall be reproducible enough to compare artifacts and diagnose regressions.
- NFR-006: Native crashes shall retain symbolized stacks and framework/application attribution.
- NFR-007: Input, focus, and accessibility behavior shall be deterministic under replayable event traces.
- NFR-008: A renderer mock shall permit engine testing without a GPU.
- NFR-009: The selected native language/toolchain shall support maintainable iOS and Android CI.
- NFR-010: Public APIs shall not expose the selected layout or JavaScript runtime implementation.
- NFR-011: Performance claims shall specify device, OS, build mode, workload, and sample method.
- NFR-012: The framework shall document known divergence from native platform conventions.

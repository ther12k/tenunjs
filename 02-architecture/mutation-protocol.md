---
okf_version: 0.2
title: "Mutation Protocol"
summary: "Versioned atomic ABI between JavaScript reconciliation and the native engine."
type: architecture
status: accepted
---

# Mutation protocol

## Goals

- Low overhead without exposing native pointers
- Atomic application
- Deterministic recording and replay
- Strict validation
- Runtime and engine independence
- Forward-compatible version negotiation

## Conceptual operations

```text
BEGIN_TRANSACTION(version, sequence, root)
CREATE_NODE(id, kind)
SET_PROPS(id, prop_block)
SET_TEXT(id, text_ref)
INSERT_CHILD(parent, child, index)
MOVE_CHILD(parent, child, index)
REMOVE_CHILD(parent, child)
DESTROY_NODE(id)
COMMIT_TRANSACTION(checksum)
```

The actual wire format uses bounded typed buffers and string/resource tables. It is not JSON.

## Validation

Before applying any operation, native verifies:

- Header, protocol version, sizes, checksums, and table bounds
- Unique creates and valid node generations
- Parent/child ownership and cycle absence
- Widget-kind and property schema compatibility
- String, resource, and action-handle validity
- Legal ordering and destruction semantics
- Configured per-transaction resource limits

A transaction either applies completely or produces a structured protocol error. Release builds may terminate the offending application runtime after repeated corruption.

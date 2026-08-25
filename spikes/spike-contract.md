---
okf_version: 0.2
title: "Spike Contract: Minimal Native Engine and Embedder Vertical Slice"
summary: "The exact vertical-slice contract every engine-language candidate implements identically (TN-006)."
type: contract
status: accepted
issue_id: "TN-006"
---

# Spike contract — minimal native engine and embedder vertical slice

This contract is the single source of truth for TN-007 (C++20) and TN-008 (Rust). Both candidates implement it exactly; any deviation is a disqualifying-contract breach, not a preference.

## The slice

One screen, driven end-to-end:

1. Embedder creates a GPU surface and starts the engine.
2. Engine loads a fixed fixture bundle through the runtime host adapter stub.
3. Bundle declares one scene: root container → text label ("0") → button ("increment").
4. Engine lays out via the layout adapter stub and renders one frame through Skia.
5. A touch on the button produces an event into the JS fixture, which returns one transaction changing the label to "1".
6. The engine validates and applies that transaction atomically and renders the second frame.

No scrolling, no animation, no images, no text input. Anything beyond this slice belongs to later issues.

## Frozen C ABI

Both candidates export the same C ABI (the only FFI boundary both languages emit trivially):

```c
#define TENUN_SPIKE_ABI_VERSION 1

typedef enum {
  TENUN_OK = 0,
  TENUN_ERR_SURFACE = 1,
  TENUN_ERR_BUNDLE = 2,
  TENUN_ERR_TRANSACTION = 3,
  TENUN_ERR_RESOURCE = 4,
} tenun_status;

tenun_status tenun_spike_version(uint32_t* out_version);
tenun_status tenun_spike_start(tenun_surface_handle surface, const uint8_t* bundle, size_t bundle_len);
tenun_status tenun_spike_render_frame(void);
tenun_status tenun_spike_handle_touch(float x, float y, int32_t phase);
tenun_status tenun_spike_shutdown(void);
```

Rules:

- `tenun_spike_start` fails closed: wrong ABI version, checksum mismatch, or malformed bundle returns the specific error before any frame renders.
- Transactions arriving from JS are validated against the spike's expected schema; invalid bytes return `TENUN_ERR_TRANSACTION` and leave the scene untouched.
- `surface` is an opaque embedder-provided handle; the engine never names UIKit or Android classes.
- No candidate may add extra exported functions beyond logging hooks defined here; diagnostics go through stderr with a `tenun-spike:` prefix.

## Fixture bundle

- One committed file per candidate run, byte-identical across candidates, SHA-256 recorded in each evidence packet.
- Contents: minimal JS registering the two nodes and a handler returning the label-update transaction. It exercises host-call in and transaction out; nothing else.
- The toolchain that compiles real TSX does not exist at M0; hand-authoring the fixture is expected and honest, recorded as such in evidence.

## Identical measured workloads

All measurements flow through the TN-005 harness (`benchmarks/architecture/`), on the physical-device floor from `01-requirements/supported-baseline-matrix.md`, plus the same CI build host:

| # | Workload | Metric |
| --- | --- | --- |
| W1 | Clean build of engine lib + embedders | wall-clock seconds |
| W2 | Incremental rebuild after one-line change | wall-clock seconds |
| W3 | Binary size | stripped and unstripped, per platform |
| W4 | Cold start → first rendered frame | ms, p50/p95 over 30 runs |
| W5 | Touch → frame showing updated label | ms, p50/p95 over 100 events |
| W6 | Idle memory after 60s | RSS KB |
| W7 | Crash diagnosability | forced crash produces symbolized stack via platform tooling |
| W8 | Debugger attach | breakpoint hit and variable inspection succeeds |

## Evidence requirements

- One harness packet per candidate per platform, committed in the candidate PR.
- Device metadata (model, OS version, build mode) present for every device number; missing numbers recorded as absent, never interpolated.
- Symbolization commands for W7 are part of the reproducibility log.

## Disqualification vs preference

Disqualifying (contract breaches, fail-closed): skipping validation, divergent fixtures, extra exports, simulator-only numbers for W4–W6, unreproducible packets.

Preferences (weighted later by TN-009 scorecard): build ergonomics, error-message quality, code size shape, contributor familiarity.

## Rollback / revisit trigger

If both candidates disqualify, M0 blocks and the contract itself is reviewed before any candidate is relaxed. Relaxing this contract for one candidate requires a superseding ADR naming the breached invariant.

---
okf_version: 0.2
title: "Performance Requirements"
summary: "Initial measurable performance budgets and benchmark rules."
type: requirement
status: accepted
---

# Performance requirements

These are provisional targets to validate, not marketing claims.

## Target budgets

- Cold start: first meaningful screen should be competitive with the selected baseline application on matched devices.
- Frame pacing: ordinary scrolling and engine-side animations should sustain the display refresh target with bounded missed frames.
- JS stall isolation: an active native scroll/animation should remain visually responsive during a controlled 200 ms JavaScript stall.
- Mutation commits: the engine must reject or atomically apply a transaction; no partial frame state.
- List memory: a 10,000-item logical list must retain only a bounded visible/recycle window.
- Idle memory: repeated screen mount/unmount cycles must converge rather than grow without bound.

## Benchmark discipline

Every result records:

- Device model and thermal state
- OS and graphics API
- Release/debug build mode
- Runtime, layout, and engine backend versions
- Dataset and exact interaction trace
- Median, tail, and worst observed samples
- Comparison against a declared baseline

Benchmarks run on physical devices. Simulator results are diagnostic only.

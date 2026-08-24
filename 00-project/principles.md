---
okf_version: 0.2
title: "Engineering Principles"
summary: "Principles used to resolve design trade-offs."
type: concept
status: accepted
---

# Engineering principles

1. **TypeScript is the product surface; native languages are implementation details.**
2. **Measure integration cost, not only microbenchmark speed.** Build time, debugging, crash diagnosis, mobile tooling, and contributor ramp-up count.
3. **Skia renders; it does not define the whole widget contract.**
4. **Platform-native text input and accessibility are foundational, not polish.**
5. **Events produce typed actions and bounded state transitions.** Avoid hidden global mutation.
6. **Atomic native commits.** The engine never observes a half-applied JS reconciliation transaction.
7. **Scrolling and animation must not depend on JavaScript for every frame.**
8. **One obvious path first, escape hatches second.**
9. **Feature-local source organization.** Related view, controller, schema, and tests stay together.
10. **Fail closed at unstable boundaries.** Protocol versions, native modules, manifests, and bytecode must be verified.
11. **Evidence closes work.** A task is not complete without tests and inspectable artifacts.
12. **No performance folklore.** Benchmark representative screens on physical devices.

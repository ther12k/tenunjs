# Native integration risk probe

Linked follow-up: TN-131. Original TN-006 remains unchanged and excludes text input.

## Command

```sh
benchmarks/architecture/run-native-probe.sh /tmp/tenun-native-probe
```

The command compiles and runs identical probe scenarios through C11, C++17, and Rust candidates with `-Wall -Wextra -Werror` (Rust `-D warnings`).

## Scenarios

- Composition: marked text update, commit, stale-generation rejection.
- Focus/disposal: focus transfer, disposed-target rejection, stale-generation rejection.
- Accessibility: editable and actionable nodes, missing-node activation rejection.
- JavaScript stall: native-owned ticks continue, queue stays at or below eight entries, queued work drains after release. The 500 ms value is the contract stimulus, not a performance threshold.

## Result

| Candidate | Headless result | iOS | Android |
| --- | --- | --- | --- |
| C11 fixture | PASS | NOT EXERCISED | NOT EXERCISED |
| C++20 fixture | PASS | NOT EXERCISED | NOT EXERCISED |
| Rust fixture | PASS | NOT EXERCISED | NOT EXERCISED |

Headless passes establish shared state-machine and fail-closed behavior only. They do not establish native IME, VoiceOver, TalkBack, or physical-device responsiveness. Those remain follow-up work under TN-077, TN-078, TN-090, TN-091, TN-112, and TN-115.

## Provenance

Fixture: `spikes/native-integration-probe.fixture.json`.
Shared model: `spikes/native-integration-probe.h`.
Candidate runners: `spikes/native-integration-probe.c`, `spikes/native-integration-probe.cc`, `spikes/native-integration-probe.rs`.

Engine decision remains open under ADR-0005. Results feed TN-009; they do not select C++ or Rust.

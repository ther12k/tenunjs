# Native integration risk probe

Linked follow-up: TN-131. Original TN-006 remains unchanged and excludes text input.

## Command

```sh
benchmarks/architecture/run-native-probe.sh /tmp/tenun-native-probe
```

The command compiles and runs the same scenario contract through three candidate fixtures with `-Wall -Wextra -Werror` (Rust `-D warnings`). The C11 fixture is a reference/compatibility control; C++20 and Rust are the ADR-0005 candidate configurations. The state-transition assertions are duplicated per runner, not shared implementation code. The JSON fixture is shared input; each runner independently applies the transitions and rejection rules.

## Scenarios

- Composition: marked text update, commit, stale-generation rejection.
- Focus/disposal: focus transfer, disposed-target rejection, stale-generation rejection.
- Accessibility: editable and actionable nodes, valid button activation reaches the actionable node, missing-node activation rejection. This is model-level activation, not screen-reader interoperability.
- Modeled JavaScript-stall semantics: the runner marks JavaScript unavailable, advances a native-owned tick counter, bounds queued work, and drains it after release. This does not execute a blocked JavaScript runtime or establish scheduler/thread independence. The 500 ms value is the contract stimulus, not a performance threshold.

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

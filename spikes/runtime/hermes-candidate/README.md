# Hermes candidate — slice 1 (TN-012 / ADR-0007 option C)

Implements the shared TenunJS runtime host adapter C ABI
(`../tenun_js_adapter.h`) against the **in-process Hermes runtime**.
Pinned engine: tag `v0.13.0`, commit `4b3bf912cc0f705b51b71ce1a5b8bd79b93a451b`
(that tag's CMake still declares project version 0.12.0 and its bytecode
header defines HBC 96 — a property of the tagged source; the commit pin
is authoritative and is NOT patched).

## Effective build configuration (recorded per review 2026-09-22)

- Configure: `-DCMAKE_BUILD_TYPE=Release -DHERMES_ENABLE_INTL=OFF -DHERMES_BUILD_TOOLS=ON`, Ninja, GCC 13 host.
- `HERMES_ENABLE_INTL=OFF` disables the JavaScript **Intl feature**. It does **not** remove native ICU dependencies: the built artifacts link the system `libicuuc.so.74` / `libicudata.so.74` (`libi18n` only for the tool binary). "Intl feature off" != "ICU-free"; comparative rows carry this label.
- Two recorded one-line source patches are applied by `acquire_hermes.sh` (GCC 13 requires `<string>`/`<memory>`/`<utility>` includes the CDP sources assume transitively).
- The candidate links the shared `API/hermes/libhermes.so` + `jsi/libjsi.so` produced by the `libhermes` target — real in-process embedding, no interpreter subprocess.

## Slice 1 — implemented vs honest gaps

Implemented and passing (`abi_smoke`, 15/15): fail-closed config
validation; handle registry (slot+generation, never reissued; stale
handles fail closed with the empty-diagnostic rule; double-destroy
no-op); TJRB bundle validation (magic/version/length/sha256); source
evaluation through `jsi::evaluateJavaScript`; completion mapping
(null/bool/f64/string/ArrayBuffer-bytes; objects/BigInt/other kinds
rejected `VALUE_BOUNDS` per contract, never coerced); owner-thread
affinity; last_error clear-on-success; cross-VM isolation.

**Honest gaps — fail visibly with `TJERR:UNSUPPORTED` (never silent
no-ops):** host callback registration (`tenun_js_register_host_fn`),
microtask pump + unhandled-rejection tracking (`tenun_js_pump`), the
interrupt protocol (`request_interrupt`/`clear_interrupt`), BigInt
completion bridging (returns VALUE_BOUNDS with an explicit diagnostic),
per-scope payload budgets, mid-evaluation destroy/self-destroy paths.
The error line/column fields are not yet extracted from Hermes
diagnostics (recorded as 0). These follow the QuickJS candidate's
17-review hardening sequence in later slices; no expectation was
weakened for this candidate.

## Build & run

```sh
./acquire_hermes.sh          # clone+build pinned Hermes into .hermes/ (recorded config)
cmake -B build -DHERMES_BUILD_DIR=.hermes/hermes-build && make -C build abi_smoke -j
LD_LIBRARY_PATH=.hermes/hermes-build/API/hermes:.hermes/hermes-build/jsi ./build/abi_smoke
```

Selection-neutral per ADR-0022: this slice selects nothing and satisfies
no TN-013 acceptance criterion; physical-device rows stay blocked.

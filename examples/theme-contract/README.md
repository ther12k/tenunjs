# Semantic theme contract reference

This executable TN-143 reference proves the **slot → palette → baked scene**
boundary and a persisted light/dark choice. It is not a deployable TenunJS
application and deliberately has no `tenun.config.ts`.

The example retains one semantic scene with background, card, text, button,
outline, and an `app.brand` extension slot. Literal colors occur only in two
complete palettes. Changing mode re-bakes the same semantic source; it never
edits screen definitions or tries to recover a slot from an old pixel color.

This does **not** implement TN-068's inherited widget context or wire dynamic
themes into `ApplicationRuntime`, `ThemeProvider`, or the Android renderer.
The output is the existing concrete-color display-list v1 shape; semantic
scenes stay framework-side. Native storage and device persistence are not
claimed by this reference.

## Verify the contract

From the repository root, with the pinned Bun toolchain and dependencies:

```sh
bun test examples/theme-contract
```

The suite checks scene colors, geometry/text/tap preservation, restoration
in a new instance, failed storage reads/writes, malformed preferences,
concurrent-switch refusal, and retained source references.

## Demonstrate persistence across processes

The optional `demo.ts` supplies a local file host for the existing
`StorageCapability` get/set seam. Its Node/Bun imports are isolated from the
host-independent `src/main.ts` implementation. Use a writable path whose
parent directory already exists:

```sh
bun examples/theme-contract/demo.ts /tmp/tenun-theme-choice.txt light
bun examples/theme-contract/demo.ts /tmp/tenun-theme-choice.txt dark
bun examples/theme-contract/demo.ts /tmp/tenun-theme-choice.txt
```

The last command loads `dark` from the previous process. The background,
card, label, and button colors change together; operation and tap counts
stay constant. The file host replaces its preference file by a same-directory
temporary-file rename. It is a demonstration host, not an Android storage
implementation or a concurrent multi-process database.

## Preference policy

`ThemeContractExample.open(storage)` completes storage initialization before
the first render. An absent value selects light mode without inventing a
persisted choice. Any other stored value must be exactly `light` or `dark`;
malformed values and structured read failures reject initialization and are
not overwritten.

`setMode(mode)` validates and bakes a complete candidate scene, then awaits
the host's storage result. Only a successful write publishes the new mode.
A failed write keeps the previous scene and reports the host failure. A
second switch while the first is pending rejects with `SWITCH_BUSY`; callers
may retry after the pending operation settles. Unexpected host promise
rejections remain visible and also release that guard.

Persistence belongs to this example-owned policy, through
`Pick<StorageCapability, "get" | "set">` from `@tenunjs/platform`. The core
semantic-color contract does not depend on storage, browser globals, or a
platform runtime. OS-following mode and inherited theme scopes remain future
integration work.

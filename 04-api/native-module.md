---
okf_version: 0.2
title: "Native Module API"
summary: "Typed capability declaration and use from TypeScript."
type: reference
status: accepted
---

# Native module

```ts
export const ClipboardModule = defineNativeModule({
  name: 'clipboard',
  version: 1,
  methods: {
    readText: method({ output: t.nullable(t.string) }),
    writeText: method({ input: t.object({ value: t.string }), output: t.void }),
  },
});
```

```ts
const text = await native.clipboard.readText();
await native.clipboard.writeText({ value: 'Copied from TenunJS' });
```

Generated Swift and Kotlin implementations preserve method names, types, cancellation, error codes, thread affinity, and version checks. Missing or incompatible capabilities fail during application startup unless explicitly declared optional.

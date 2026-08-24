---
okf_version: 0.2
title: "JSX Runtime and Reconciliation"
summary: "How TSX becomes stable native mutations without React."
type: architecture
status: accepted
---

# JSX runtime and reconciliation

TypeScript compiles TSX to the TenunJS `jsx`, `jsxs`, and `Fragment` runtime. Host widgets are interned numeric kinds; function widgets execute in JavaScript and return widget descriptions.

## Widget node

```ts
interface WidgetNode {
  kind: HostWidgetKind | FunctionWidget;
  key: Key | null;
  props: Readonly<Record<string, unknown>>;
  children: readonly WidgetChild[];
  source?: SourceLocation;
}
```

## Reconciliation rules

- Identity uses parent slot, host kind, and explicit key.
- Keys are mandatory for reorderable collections.
- An unkeyed type change replaces the node.
- Event functions become runtime-owned numeric action handles; native never retains arbitrary JS pointers.
- Prop codecs are generated and reject unsupported values before transaction emission.
- Reconciliation produces deterministic ordered operations.
- The native engine validates the entire buffer before mutation.
- Failed validation leaves the previous tree intact.

## Initial strategy

The first implementation uses a JS-side keyed reconciler and typed-array mutation encoder because it is easier to iterate with the TSX API. Static subtree compilation and native-assisted diffing are deferred until profiling demonstrates value.

## Required diagnostics

Development mode identifies duplicate keys, unstable keys, oversized props, excessive subtree replacement, actions registered during render, and mutations after controller disposal.

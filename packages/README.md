# TenunJS TypeScript Package Workspace

This workspace hosts the TypeScript/TSX public application layer and core framework packages for TenunJS (ADR-0002, ADR-0003, TN-019).

## Package topology

```text
@tenunjs/protocol
  ├── @tenunjs/jsx-runtime
  │     ├── @tenunjs/core
  │     │     └── @tenunjs/navigation
  │     └── @tenunjs/widgets
  └── @tenunjs/cli
```

All packages are strictly acyclic and compile under TypeScript `strict: true` with zero escapes to untyped pointers or React dependencies (ADR-0003).

## Packages

| Package | Purpose | Dependencies |
|---|---|---|
| `@tenunjs/protocol` | Mutation opcode names, host widget kinds, and structured error codes (ADR-0012). Symbolic values only — the numeric ABI binding is owned by TN-034/TN-035. | None |
| `@tenunjs/jsx-runtime` | Framework-owned custom `jsx`, `jsxs`, and `Fragment` runtime without React (ADR-0003, TN-020) | `@tenunjs/protocol` |
| `@tenunjs/core` | Controller and typed action state model, screen definition, and application lifecycle (ADR-0009, TN-055–TN-057) | `@tenunjs/protocol`, `@tenunjs/jsx-runtime` |
| `@tenunjs/widgets` | Core layout and UI widgets (`Column`, `Row`, `Text`, `Button`, `Card`, `Scaffold`, `AppBar`) | `@tenunjs/protocol`, `@tenunjs/jsx-runtime` |
| `@tenunjs/navigation` | Typed route definitions, route builders, and `NavigationHost` (ADR-0010, TN-062, TN-063) | `@tenunjs/protocol`, `@tenunjs/jsx-runtime`, `@tenunjs/core` |
| `@tenunjs/cli` | Unified developer command-line interface | `@tenunjs/protocol` |

## Verification

Canonical TypeScript verification:
```sh
bun run verify:ts
```

Runs `tsc --noEmit -p tsconfig.json` (strict typechecking across all packages) followed by `bun test` (including workspace boundary and topology assertions in `packages/workspace.test.ts`).

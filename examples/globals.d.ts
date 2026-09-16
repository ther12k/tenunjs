/**
 * Intended TenunJS authoring globals (04-api/application-entry.md).
 *
 * The embedder injects `__DEV__` at runtime. Example entry modules are
 * scanned but never executed by the current tooling, so the TSX samples
 * only need the type-level declaration.
 */
declare const __DEV__: boolean;

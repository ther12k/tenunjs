---
okf_version: 0.2
title: "ADR-0024: Semantic color slots before the widget freeze"
summary: "Retain semantic color references through scene construction and resolve a complete palette at commit time; pull the TN-143 decision ahead of TN-068 implementation."
type: decision
status: accepted
---

# ADR-0024: Semantic color slots before the widget freeze

## Context

[TN-143](../06-issues/tn-143-decide-semantic-theme-token-slots-before-widgets-freeze.md)
pulls the theme-token decision forward so each screen does not have to
implement light/dark switching. The current prototype accepts color strings
in widget props and bakes them into display-list v1. A baked string alone
does not retain which role supplied it: two slots can have the same light
value and different dark values.

[TN-068](../06-issues/tn-068-implement-theme-tokens-and-inherited-widget-context.md)
still owns the complete inherited theme/context implementation. This ADR
freezes its color input contract and provides an executable root-scope
reference without presenting the prototype as that finished implementation.

## Decision

### 1. One bounded vocabulary, with an application namespace

`@tenunjs/widgets` exports `SEMANTIC_COLOR_SLOTS` and `SemanticColorSlot`.
The initial vocabulary contains these 24 slots:

| Slots | Meaning |
| --- | --- |
| `background`, `onBackground` | App canvas and its foreground content. |
| `surface`, `onSurface`, `onSurfaceVariant` | Base surfaces, normal content, and secondary content. |
| `surfaceContainer`, `surfaceContainerHigh` | Two increasing levels of contained surface emphasis. |
| `primary`, `onPrimary` | Primary action/emphasis fill and its foreground. |
| `primaryContainer`, `onPrimaryContainer` | Less prominent primary container and its foreground. |
| `secondaryContainer`, `onSecondaryContainer` | Secondary container and its foreground. |
| `outline`, `outlineVariant` | Normal and lower-emphasis boundaries. |
| `error`, `onError` | Error or destructive status fill and its foreground. |
| `success`, `onSuccess` | Success status fill and its foreground. |
| `warning`, `onWarning` | Warning status fill and its foreground. |
| `inverseSurface`, `onInverseSurface` | Inverse surface and its foreground. |
| `onPrimaryFixed` | Foreground for an app-defined primary fill that stays fixed across modes. The palette author must pair it with that fill explicitly. |

This reuses the prototype's existing role names, adding explicit canvas
roles and status foregrounds. It does not promise Material component or
palette-generation compatibility. Naming a foreground role does not prove
its contrast; palette authors remain responsible for readable pairs and
must not communicate status through color alone.

An application may add `app.<identifier>` slots, where the identifier
matches `[A-Za-z][A-Za-z0-9_]*`. For example, `app.chartRevenue` can give
custom drawing a stable meaning without inventing a framework role.
Built-in names are reserved. New required built-in slots or changed
meanings require an explicit contract revision and migration; they must
not silently invalidate existing palettes.

The strict contract has no aliases. When migrating legacy theme keys,
translate `accent` to `primary`, `danger` to `error`, `text` to `onSurface`,
`textDim` to `onSurfaceVariant`, `surfaceRaised` to `surfaceContainer`, and
`ok` to `success`. This is migration guidance, not runtime fallback logic.

### 2. References belong to widgets and semantic scenes; literals belong to palettes

`ColorRef` is the immutable data shape `{ readonly slot: ColorSlot }`.
`colorSlot("onSurface")` validates a canonical name and creates a frozen
reference. New widget property schemas and semantic drawing APIs use
`ColorRef` for theme-sensitive color fields, including custom drawing.
Literal colors are supplied only in palettes. A branded or intentionally
fixed color uses an application slot with the same value in both palettes.

`ThemePalette` is a complete mapping for every built-in slot, with optional
application slots. Every referenced application slot must also exist.
`defineColorPalette()` validates, copies, and freezes a palette. It accepts
`#RRGGBB` or `#AARRGGBB` values, using the existing Android scene encoding;
the eight-digit form is alpha-first, not CSS alpha-last. Preview adapters
must convert that form before claiming alpha-color conformance. The
reference example uses opaque six-digit colors and makes no alpha-rendering
claim across hosts.

No missing color falls back to white, black, a similarly named slot, or a
previous theme. There are no alias chains or expression evaluation in the
palette. Arbitrary image pixels and media content are outside this color
token contract.

### 3. Resolve once per commit and retain the semantic source

The authoritative framework scene retains slot references. Its reference
representation is `SemanticDisplayListScene`, tagged
`tenun: "semantic-display-list", version: 1`. Every `color` field is a
reference, as are scene `background`, gradient `colorTo`, and ring `track`.

`bakeThemeScene(source, palette)` resolves one validated palette snapshot
into a fresh concrete `DisplayListScene`. Its output uses the existing
`tenun: "display-list", version: 1` wire shape. Neither the semantic source
nor a previously baked scene is mutated. Geometry, content, and tap
identities are preserved. The semantic marker is framework-only and must
never be sent to an existing host.

A palette change invalidates the color resolution for the next commit.
The framework re-bakes from retained references, or re-runs the same widget
definition to produce those references. It must never infer slot identity
by reverse-mapping literal colors from the previous frame. A color-only
switch does not change layout or input ownership.

Baking either returns a complete scene or throws. The caller publishes the
scene only after success and keeps its previous committed scene after a
failure. The reference implementation validates the theme boundary and
scene discriminants; the existing host remains responsible for its full
geometry and wire validation. A successful bake is not a substitute for
that validation.

### 4. Root and inherited scopes have defined ownership

The reference implementation resolves one complete root palette. The
TN-068 implementation will inherit this palette through widget context.
A child scope may override named values for its descendants only; its
effective palette must still satisfy the same complete-slot contract.
Parent changes propagate through unoverridden slots. Siblings and parents
must not observe child overrides.

Retained semantic operations in an inherited implementation must retain
their scope identity as well as their slot, or be regenerated from the
same scoped widget tree on the next commit. Flattening every reference
against the root palette would violate the contract. The root reference
scene does not claim to implement those scopes.

Immutable palettes and references own no native resources and need no
disposal. The widget/context owner, not individual screens, will own theme
subscriptions and their teardown under TN-068. This decision introduces no
global mutable theme singleton.

### 5. Persist a preference through the existing storage seam

An app persists a preference such as `light` or `dark` through
`StorageCapability`, not a baked scene or a serialized copy of its palette.
One app-level coordinator selects a complete palette, so switching does
not require editing each screen. OS preference following can supply a
palette through the same boundary later; this PR does not add an OS event
source or claim that behavior exists.

The reference example initializes storage before exposing its first scene.
Absent stored data chooses its documented default. Invalid stored data and
storage failures are surfaced explicitly. A requested switch is baked
before persistence; only a successful write publishes the new preference
and scene. A failed write keeps the previous state and is never reported
as persisted. Concurrent switches have an explicit policy in the example.
These rules prevent a late startup read from overwriting a user choice.

### 6. Errors are attributable and fail visibly

`ThemeContractError` exposes stable codes: `INVALID_SLOT`, `INVALID_COLOR`,
`MISSING_SLOT`, `INVALID_COLOR_REF`, `INVALID_PALETTE`, and `INVALID_SCENE`.
Unknown names, malformed values, incomplete palettes, literal strings in
semantic color fields, and unsupported scene markers/versions/op kinds
fail before a new scene is published. Messages identify the offending slot
or field. Storage errors retain the existing capability failure boundary;
they are not converted into palette defaults.

## Implementation and migration boundary

This decision ships an opt-in TypeScript reference contract in
`packages/widgets/src/theme-slots.ts` and a runnable contract example in
`examples/theme-contract/`. It does not change display-list v1, the native
ABI, current prototype widget signatures, or existing scene goldens.
Current `defineTheme`, `ThemeProvider`, `ThemeScopeBox`, and `layoutScreen`
still have their documented prototype limitations. In particular,
`ApplicationRuntime` does not gain a live `setTheme()` API from this work.

TN-068 owns migration of ordinary TSX widget props, inherited contexts,
palette invalidation, and widget-to-semantic-scene lowering. TN-034's future
property schemas and TN-042's semantic display-list work must consume the
accepted reference shape instead of freezing literal-color inputs. Their
eventual wire/schema changes require their own versioned compatibility
decision; this reference module does not smuggle fields into existing v1
host messages. Spacing, radius, typography, locale, scale, and platform
values remain in TN-068's scope.

The reference adapter classifies every existing display-op field and
handles every op variant explicitly. Adding a field or variant must update
that classification, the resolver where applicable, and its conformance
tests. A new color-bearing field must not inherit a literal-string input
silently through a shared TypeScript type.

## Explicit sequencing exception

TN-143 declares TN-068 as a dependency while explicitly requesting its
decision before the widget freeze. This ADR waives **completion of TN-068
as a prerequisite for TN-143's vocabulary, indirection decision, and
root-scope reference proof only**. TN-068 remains open and keeps all
implementation responsibilities listed above. This exception does not
waive TN-068's own dependencies, close an M-gate, select an engine/backend,
or certify the framework-feel app. TN-155 can consume the decision while
recording the runtime/widget work still needed for its end-to-end proof.

## Verification

- `packages/widgets/test/theme-slots.test.ts` covers every color-bearing
  field, repeated baking, preservation of semantic references, and invalid
  palette/reference/scene inputs.
- `examples/theme-contract/` demonstrates light/dark switching over one
  unchanged semantic screen and restoration through the existing storage
  seam, including explicit failure behavior. Its tests are reference
  evidence, not an Android/iOS persistence or rendered-widget claim.
- Existing widget goldens, the TypeScript suite, and the external-consumer
  rehearsal protect the prototype's compatibility boundary.

TN-068 must add ordinary TSX widget, inherited-scope, and runtime lifecycle
evidence when it integrates this contract. Host alpha conversion and actual
device persistence require corresponding adapter/device evidence before
they are claimed.

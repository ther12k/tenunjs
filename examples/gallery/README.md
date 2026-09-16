# Tenun Gallery (gallery)

The all-in-one UI/UX showcase: **five Flutter-inspired reference modules in
one app**, written the TenunJS way — typed screens, controller-owned state,
typed actions, and pure views.

| Module | Flutter study it references | What it shows |
| --- | --- | --- |
| Banking | Rally (M3 design language) | Glanceable balance card, account list, bills with pay actions, transfer with balance clamping |
| Smart home | Home-automation dashboards | Room grouping, live device tiles, one-tap scenes (Morning / Movie / Away) |
| Fitness | Health/activity trackers | Gamified rings (steps/move/stand), weekly step bars, workout completion with derived energy |
| Store | Shrine (M2 design language) | Category chips, product list, live cart with totals and checkout |
| Settings | Grouped settings studies | Account header, described preference toggles, reset-to-defaults, about section |

> **Status: API preview, not a runnable product.** Like every sample here,
> the gallery compiles against today's `@tenunjs/*` packages, its screens
> are exercised by tests through the shared harness, and it is a valid
> TN-021 project with a complete TN-022 module graph — but nothing here
> installs or runs on a device yet.

## Run the checks

```sh
bun test examples/gallery
```

The tests mount every screen through `@tenunjs-examples/test-support` and
drive the interactive flows: transfers (including clamping and
conservation), scene application, ring/kcal math, cart totals and
checkout, and preference toggles + reset.

## Design notes

- The dark Rally-style theme lives in `src/theme.ts` and is applied once
  in `src/app.tsx` via `ThemeProvider`.
- All module state is screen-local; every mutation is a named typed
  action (`transfer`, `toggle`, `applyScene`, `logWalk`, `addToCart`,
  `togglePreference`, …) — no ad-hoc event handlers.
- Derived values (totals, ring percentages, best-week scaling) are
  computed in `view()` from committed state, never stored.
- Derived rendering keeps determinism: identical state always renders an
  identical widget tree.

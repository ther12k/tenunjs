# Tenun Gallery (gallery)

The all-in-one UI/UX showcase: **fourteen Flutter-inspired reference
modules in one app**, written the TenunJS way — typed screens,
controller-owned state, typed actions, and pure views that render through
the shared display-list engine (the same scene JSON the browser preview
and the Android embedder consume).

## Modules and the Flutter UIs they reference

| Module | Flutter study it references | What it shows |
| --- | --- | --- |
| Widget showcase | Material 3 component catalog (flutter/gallery) | The whole M3 kit live: buttons, chips, sliders, tabs, nav bar, fields, snack bars |
| Onboarding walkthrough | Walkthrough/onboarding screens in [mitesh77/Best-Flutter-UI-Templates](https://github.com/mitesh77/Best-Flutter-UI-Templates) and the community plant-app onboardings ([realflutternuggets/flutter-ui-plant-app](https://github.com/realflutternuggets/flutter-ui-plant-app)) | Three-page intro with dot indicator, Skip/Next, and the canonical sign-up form reveal |
| Plant shop | The "Plant App" dribbble family, one of the most recreated Flutter UIs on GitHub ([ViktorKirjanov/flutter-ui-plant-shop](https://github.com/ViktorKirjanov/flutter-ui-plant-shop), plant-shop challenges) | Greeting header, search, category icon row, two-column product grid with favorites and a live cart, bottom navigation |
| Profile & account | Profile/account pages of the e-commerce template family ([abuanwar072/E-commerce-Complete-Flutter-UI](https://github.com/abuanwar072/E-commerce-Complete-Flutter-UI)) | Gradient hero with avatar, three-up stats row, tabs, grouped settings with logout |
| Banking | Rally (M3 design language) | Glanceable balance card, account list, bills with pay actions, transfer with balance clamping |
| Smart home | Home-automation dashboards | Room grouping, live device tiles, one-tap scenes (Morning / Movie / Away) |
| Fitness | Health/activity trackers | Gamified rings (steps/move/stand), weekly step bars, workout completion with derived energy |
| Store | Shrine (M2 design language) | Category chips, product list, live cart with totals and checkout |
| Settings | Grouped settings studies | Account header, described preference toggles, reset-to-defaults, about section |
| Weather | Weather forecast apps | Sky hero, hourly strip, 7-day ranges, condition rings |
| Music | Music players | Now playing, seek bar, transport controls, and a queue |
| Chat | Messaging apps | Bubbles, presence header, quick replies, and a composer |
| Recipes | Recipe & cooking apps | Category chips, featured dish hero, servings, favorites |
| Crypto | Portfolio trackers | Value hero, timeframes, sparklines, and a market list |

The three newest modules (onboarding, plant shop, profile) are deliberate
recreations of the most-copied Flutter UI families from those GitHub
collections — same layout skeletons, navigation patterns, and component
choices, expressed as pure display-list ops with no raster assets.

> **Status: runs in the preview and the Android prototype.** The gallery
> is exercised end-to-end by tests through the shared harness, renders in
> the browser preview (`bun run gallery:preview`), and its bundle powers
> the Android embedder prototype. It is still an example, not a product.

## Run the checks

```sh
bun test examples/gallery
```

The tests mount every screen through `@tenunjs-examples/test-support` and
drive the interactive flows: transfers (including clamping and
conservation), scene application, ring/kcal math, cart totals and
checkout, preference toggles + reset, onboarding paging and sign-up,
plant favorites/cart/checkout, and profile tab/settings/logout flows.

## Design notes

- The dark Rally-style theme lives in `src/theme.ts` and is applied once
  in `src/app.tsx` via `ThemeProvider`.
- All module state is screen-local; every mutation is a named typed
  action (`transfer`, `toggle`, `applyScene`, `logWalk`, `addToCart`,
  `togglePreference`, `next`, `toggleFavorite`, `logOut`, …) — no ad-hoc
  event handlers.
- Derived values (totals, ring percentages, best-week scaling, cart
  sums) are computed in `view()` from committed state, never stored.
- Derived rendering keeps determinism: identical state always renders an
  identical widget tree.

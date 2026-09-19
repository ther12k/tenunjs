# Flutter Showcase by TenunJS

A focused, multi-category UI study inspired by [Best-Flutter-UI-Templates](https://github.com/mitesh77/Best-Flutter-UI-Templates) by mitesh77. The reference repository is MIT licensed; this package is an independent TenunJS-native recreation using typed state, pure TSX views, and the shared display-list contract.

The package is a **launcher plus five independent app studies**: the launcher screen catalogs the studies (`SHOWCASE_APPS` in `src/data.ts`, typed by `ShowcaseAppId`), and each study owns its own controller state, so hotel filters, course progress, and onboarding position never leak into one another. The browser preview mounts one session per study and preserves it across app switches — see `flutter-showcase-preview/README.md`.

## Categories

| Category | What it demonstrates |
| --- | --- |
| Introduction animation | A deterministic three-step onboarding flow, page indicator, sign-up reveal, and restart path. |
| Hotel booking | Search, destination/category filters, featured stays, room details, guest/night controls, and booking confirmation. |
| Fitness dashboard | Activity rings, weekly progress, workout selection, derived calories, and completion feedback. |
| Design course | Learning catalog, category filters, course detail, tabs, enrollment, lesson progress, and completion. |
| Custom drawer | Fixed modal drawer, destination selection, bottom navigation, and state-preserving navigation study. |

## Run and verify

This is an example package in the TenunJS workspace. Its controller/action behavior is covered by deterministic tests:

```bash
bun test examples/flutter-showcase
```

The desktop browser preview is served separately by the repository gallery preview tooling. It uses the same screens and display-list operations as the Android prototype; it is a UI iteration surface, not proof that the future native widget host is complete.

## Design boundary

The reference informs layout rhythm, navigation patterns, and visual hierarchy. No Flutter source code or remote image assets are bundled here. Visuals use deterministic vector/display-list operations so browser and Android hosts render the same scene data.

The hotel screen's `HotelCard` and the course screen's `CourseCard` double as the Flutter-migration demos: both are composed from the structural widget tier (`Stack`, `Positioned`, `Container`, `Center`, `Icon`, `GestureDetector`, `SizedBox`) the way their Flutter originals would be, keeping only the translucent circle decorations in a `CanvasBox` paint layer and passing palette role names through the color props. See `04-api/flutter-migration.md` for the full widget mapping.

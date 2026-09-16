# Weavers Guild (navigation-demo)

The app-skeleton sample: **typed routes**, `NavigationHost`, and the
**split controller/view** pattern for a larger screen. Follows the shape
of [`04-api/split-controller-view.md`](../../04-api/split-controller-view.md)
and [`04-api/navigation.md`](../../04-api/navigation.md).

## What it demonstrates

- A typed route table with a parameterized path — `/profile/:memberId` —
  and frozen route instances from typed builders (`src/routes.ts`)
- Feature-local split screen: controller, view, types, and service each
  in their own file (`src/screens/profile/`)
- Async work in the controller: `load()` lifecycle hook plus a
  `defineAction` that talks to an injected `ProfileService`, with a
  declared `idle/loading/ready/error` status state and abort-signal
  awareness
- A pure presentational home screen (`src/screens/home.screen.tsx`)

## Layout

```text
src/
├── main.tsx                       entry: runApp({ root: <App /> })
├── app.tsx                        ThemeProvider + NavigationHost
├── theme.ts                       defineTheme tokens
├── routes.ts                      typed route table
├── data/directory.ts              static member data
└── screens/
    ├── home.screen.tsx            single-file directory screen
    └── profile/
        ├── profile.types.ts       TeamMember, ProfileState, ProfileService
        ├── profile.service.ts     in-memory service (capability seam)
        ├── profile.controller.ts  async controller + actions
        └── profile.view.tsx        view + ProfileScreen assembly
```

## Honest boundary

Routes are declared and type-checked, and `NavigationHost` mounts the
initial route — but **navigation execution** (`navigation.push` from an
action) lands with the executable application model in M3. The profile
screen is reached today by driving `ProfileController` in tests via the
injected in-memory service.

## Verify

```sh
bun test examples/navigation-demo
```

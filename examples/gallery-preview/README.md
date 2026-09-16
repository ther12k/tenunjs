# TenunJS Gallery Preview

Desktop/browser UI lab for the TenunJS gallery. It runs the same gallery
screen definitions, state, typed actions, JSX normalization, and display-list
layout used by the Android prototype, but makes UI iteration possible without
building or installing an APK.

## Run it

From the repository root:

```bash
bun run gallery:preview
```

Open [http://127.0.0.1:8898/](http://127.0.0.1:8898/) in a desktop browser.
The server also binds on the LAN interface, so another machine can use the
laptop's local IP.

## Interactions

- Use the route rail to open Home, Banking, Smart home, Fitness, Store, or Settings.
- Click the visible canvas buttons to dispatch real screen actions.
- Drag vertically to scroll long screens.
- Press `H` to return to Home.
- Edit a gallery screen or TenunJS runtime source; the browser polls the
  preview hash and applies a new bundle while preserving route and screen state.

## Rendering boundary

The preview uses the shared display-list operations (`rect`, `outline`, and
`text`) at a 720-unit design width. Its current backend is the browser's
hardware-accelerated Canvas 2D API, which is backed by the browser's graphics
stack. The renderer is isolated behind `PreviewRenderer` so a CanvasKit/Skia
WASM backend can replace it without changing the gallery runtime or widget
model. This keeps the local loop working offline and avoids making a CDN/WASM
fetch a prerequisite for UI iteration.

This is a development preview, not proof that the future M4 native widget host
is complete. It deliberately uses approximate text metrics and the prototype
display-list layout; Android TN-132 acceptance remains a separate gate.

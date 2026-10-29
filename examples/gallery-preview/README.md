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

## Generic host and controlled text input

`host.html?bundle=...` is the generic bundle-consuming shell used by
[Day Plan](../framework-feel/README.md), separate from the gallery-specific
`index.html` route rail above. It negotiates logical viewport delivery and
supports TN-160's `text-input` descriptors. A transparent native input
provides browser keyboard, selection, clipboard, and composition events;
the canvas paints the ordinary field and its editing state.

The host reconciles editors after dispatch returns. An acknowledged edit
or geometry-only update keeps the active editor; changed controller state
or a retired session replaces it and removes old listeners. A failed edit
restores the accepted scene's value. Field text honors `TextOp.clip`, while
general scroll-container clipping remains separate work.

The ui-kit's gallery `TextField` remains a visual focus-ring component.
Editable screens use the controlled `TextField` from `@tenunjs/widgets`
with `ApplicationRuntime`. This prototype does not provide pointer caret
placement, native selection handles, or a virtual accessibility tree.

## Automation hooks

The shell exposes three `window` hooks so tests and agents can drive the
canvas without synthesizing pointer events:

- `__previewScroll(y)` — set the canvas scroll offset (design units).
- `__previewTaps()` — current tap regions as `[{ y, h, id }]`; `id` is the
  payload id hosts echo back (not the region index: on non-home routes the
  shell prepends a back-to-home region).
- `__previewTap(id)` / `__previewState()` — dispatch a tap by id and read
  the exported screen state.

---
okf_version: 0.2
title: "Canvas Escape Hatch API"
summary: "Controlled custom drawing without making raw Skia the normal widget contract."
type: reference
status: accepted
---

# Canvas escape hatch

```tsx
<Canvas
  semantics={{ role: 'image', label: 'Monthly sales chart' }}
  draw={(canvas, size) => {
    canvas.roundRect({ x: 0, y: 0, width: size.width, height: size.height }, {
      radius: 12,
      fill: theme.colors.surfaceRaised,
    });
    drawBars(canvas, size, values);
  }}
/>
```

The draw API is framework-owned and versioned. It may map efficiently to Skia but does not expose native pointers. A canvas must provide explicit semantics for meaningful content and cannot host editable text or ordinary interactive controls in core.

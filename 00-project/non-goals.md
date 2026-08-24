---
okf_version: 0.2
title: "Non-goals"
summary: "Guardrails that prevent TenunJS from becoming several frameworks at once."
type: concept
status: accepted
---

# Non-goals

TenunJS v0.x will not:

- Reimplement React hooks or claim React package compatibility.
- Treat TSX as HTML syntax.
- Use a WebView to render the main application UI.
- Make every platform feature identical when platform conventions differ materially.
- Draw editable text controls without participating in native IME contracts.
- Fake accessibility using screenshots or undocumented overlays.
- Send JSON commands across a chatty bridge for every property update.
- Require Rust, C++, or any native language in application projects.
- Select an engine language because it is fashionable rather than because the matched spike wins.
- Promise desktop or web before mobile beta is credible.
- Expose raw Skia objects through ordinary widget APIs.
- Place network calls, database rules, and rendering logic in one untestable screen function.

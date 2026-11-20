---
okf_version: 0.2
title: "TN-202: Linux embedder — lekuvo-host vertical slice"
summary: "Assembly, not research: a Linux desktop embedder in embedders/linux that runs the JS engine, drives skia-host's RGBA output into a SHM surface the host window composites, and wires input through the gallery-preview host.ts contract — the last pilot step, after the transparency contract (TN-199), platform tags (TN-200), and the MPRIS capability (TN-201) exist."
type: issue
status: ready
issue_id: "TN-202"
priority: "P1"
depends_on:
  - "TN-199"
  - "TN-200"
  - "TN-201"
adr: "ADR-0028"
---

# TN-202 — Linux embedder: lekuvo-host vertical slice

## Purpose

ADR-0028's last pilot step. Everything it needs exists or is
pilot-scoped: skia-host paints the scene contract to premultiplied
RGBA8 (TN-198 baseline; transparent scenes arrive with TN-199), the
JS engine spike path passed (rquickjs, all-PASS), the host contract has
a ~295-line working template (examples/gallery-preview/host.ts), and
the embedders own their windows by design — the framework ships no
windowing. What remains is assembly under the ADR-0028 firewall.

## Required outcome

1. `embedders/linux/` — a Rust host (lekuvo-host shape) that:
   - embeds the JS engine (the spike-selected path) and drives the
     scene-commit contract;
   - presents skia-host output through SHM zero-copy or at worst one
     copy per frame into a transparent, host-owned fixed-size window
     (760x560, the notch surface);
   - wires input (taps) through the gallery-preview `host.ts`
     contract, extended only where the pilot's needs force it;
   - consumes the MPRIS capability's host-push events (TN-201).
2. The notch scene runs end-to-end: JS app (lekuvo's TSX) -> scene
   commits -> skia-host raster (transparent) -> composited overlay at
   60 Hz, measured with the TN-198 bench method on the target machine
   (the ADR-0028 kill criterion's evidence step — the packet joins the
   evidence chain with the post-merge-commit rule).
3. The embedder keeps the host.ts contract as the JS boundary — no
   new bridge vocabulary beyond what the pilot provably needs; anything
   extra closes by rule (ADR-0028 firewall).
4. CI-green: the embedder builds headless (Xvfb) and passes its own
   scene-commit smoke test; no mobile embedder file changes.

## Non-goals

- GPU rendering (CPU raster is the measured, approved baseline).
- Windowing APIs in the framework (the host owns its window; GTK/
  layer-shell details live in embedders/linux).
- Packaging, installers, desktop-file integration (post-pilot).
- macOS/Windows (frozen until M7 + a further ADR).

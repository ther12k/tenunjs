import type { DisplayListScene, DisplayOp, FixedPosition, SerializedTap } from "../ui-kit/src/display-list";
import {
  sceneTransitionWireError, textInputContractError, transitionEasing,
  validateTextClip, type SceneTransition,
} from "@tenunjs/widgets";

/**
 * Normalizes the display-list color convention for CSS: scenes use
 * Android-style "#AARRGGBB" for translucent colors (the Android host parses
 * it natively); CSS wants alpha last, so rewrite those to rgba().
 * TN-173: an op color arriving as a slot REF is a contract violation —
 * runtimes bake refs at the commit boundary; a host never paints one.
 */
function toCss(color: string | { slot: string }): string {
  if (typeof color !== "string") {
    throw new Error(`[TENUN_SCENE_ERROR] unbaked color ref "${color.slot}" reached the host; the bundle must bake scenes before commit`);
  }
  if (color.startsWith("#") && color.length === 9) {
    const a = parseInt(color.slice(1, 3), 16) / 255;
    const r = parseInt(color.slice(3, 5), 16);
    const g = parseInt(color.slice(5, 7), 16);
    const b = parseInt(color.slice(7, 9), 16);
    return `rgba(${r},${g},${b},${a.toFixed(3)})`;
  }
  return color;
}

export interface PreviewRenderer {
  render(scene: DisplayListScene, scrollY: number): void;
  resize(): void;
  /** [action] filters the hit to one gesture's regions (TN-152): a
   *  short click must resolve "tap" regions and a hold "long-press"
   *  regions — never whichever same-frame region registered last. */
  hitTest(scene: DisplayListScene, clientX: number, clientY: number, scrollY: number, action?: "tap" | "long-press"): number | null;
  maxScroll(scene: DisplayListScene): number;
}

export function anchorOffsetForTest(position: FixedPosition, visibleHeight: number): number {
  if (!position.fixed || position.anchorSize === undefined) return 0;
  if (position.anchor === "bottom") return visibleHeight - position.anchorSize;
  if (position.anchor === "center") return (visibleHeight - position.anchorSize) / 2;
  return 0;
}

/** Scene op kinds this renderer can paint — the browser twin of the Android parser's switch. */
const KNOWN_OP_KINDS: ReadonlySet<string> = new Set([
  "rect",
  "outline",
  "text",
  "circle",
  "ring",
  "line",
  "gradient",
  "text-input",
  "scroll-region",
]);

/**
 * Fail-closed scene validation, symmetric with the Android host's
 * SceneContractException: a scene version above SUPPORTED_SCENE_VERSION or
 * any unknown op kind (at ANY position — validation completes before a
 * candidate is accepted) rejects the whole scene. Returns the violation
 * message, or null when the scene is acceptable. Structurally malformed
 * input (JSON that parsed but is not a scene — ops/taps not arrays, null
 * scene) is a CONTRACT VIOLATION, not a crash: the message stays in the
 * host's diagnostic channel instead of a TypeError from the caller.
 */
export function sceneContractError(scene: DisplayListScene): string | null {
  if (!scene || typeof scene !== "object") {
    return "scene is not an object";
  }
  if (typeof scene.version !== "number") {
    return "scene.version is missing or not a number";
  }
  if (!Array.isArray(scene.ops)) {
    return "scene.ops is missing or not an array";
  }
  if (!Array.isArray(scene.taps)) {
    return "scene.taps is missing or not an array";
  }
  if (scene.version > CanvasPreviewRenderer.SUPPORTED_SCENE_VERSION) {
    return `scene version ${scene.version} exceeds renderer support (${CanvasPreviewRenderer.SUPPORTED_SCENE_VERSION})`;
  }
  // TN-169: the transition block is optional, but a present malformed one
  // is a contract violation — an animator that half-reads it would freeze
  // or misplace whole routes.
  const transitionViolation = sceneTransitionWireError((scene as { transition?: unknown }).transition);
  if (transitionViolation) {
    return `invalid transition: ${transitionViolation}`;
  }
  const inputIds = new Set<string>();
  let hasFocusedInput = false;
  // TN-166: the per-op contract checks (op kind, text clip, text-input
  // descriptor, duplicate ids, single focus) apply to ROOT ops and to
  // scroll-region content ops alike — the pre-TN-166 nested loop checked
  // only kinds, so a nested invalid text-input descriptor or clip passed
  // browser validation that the Android parser rejects. Id/focus tracking
  // is shared across both levels, so a root field and a nested field
  // cannot collide or both claim focus.
  const opViolation = (op: { op?: string } | null, label: string): string | null => {
    if (!op || typeof op !== "object") {
      return `${label} is not an object`;
    }
    const kind: string = op.op as string;
    if (!KNOWN_OP_KINDS.has(kind)) {
      return `unknown op kind "${kind}" at ${label}`;
    }
    if (kind === "text" && "clip" in op && op.clip !== undefined) {
      try { validateTextClip(op.clip); }
      catch (error) { return `invalid text clip at ${label}: ${(error as Error).message}`; }
    }
    if (kind === "text-input") {
      const violation = textInputContractError(op);
      if (violation) return `invalid text input at ${label}: ${violation}`;
      const field = op as unknown as Extract<DisplayOp, { op: "text-input" }>;
      if (inputIds.has(field.id)) return `duplicate text input id "${field.id}"`;
      inputIds.add(field.id);
      if (field.focused && hasFocusedInput) return "more than one focused text input";
      if (field.focused) hasFocusedInput = true;
    }
    return null;
  };
  for (let index = 0; index < scene.ops.length; index++) {
    const op = scene.ops[index] as { op?: string } | null;
    const violation = opViolation(op, `ops[${index}]`);
    if (violation) return violation;
    if (op && (op as { op?: string }).op === "scroll-region") {
      const region = op as { id?: unknown; x?: unknown; y?: unknown; w?: unknown; h?: unknown; contentHeight?: unknown; ops?: unknown };
      if (typeof region.id !== "string" || region.id.length === 0) {
        return `scroll region at ops[${index}] has no id`;
      }
      for (const key of ["x", "y", "w", "h", "contentHeight"] as const) {
        if (typeof region[key] !== "number" || !Number.isFinite(region[key] as number)) {
          return `scroll region "${region.id}" has invalid ${key}`;
        }
      }
      if (!Array.isArray(region.ops)) {
        return `scroll region "${region.id}" ops is not an array`;
      }
      for (let child = 0; child < region.ops.length; child++) {
        const nested = region.ops[child] as { op?: string } | null;
        if (nested && typeof nested === "object" && (nested as { op?: string }).op === "scroll-region") {
          return `nested scroll regions are not supported ("${region.id}")`;
        }
        const nestedViolation = opViolation(nested, `scroll region "${region.id}" ops[${child}]`);
        if (nestedViolation) return nestedViolation;
      }
    }
  }
  return null;
}

/**
 * TN-161 unified tap resolution across scene and scroll-region coordinates.
 * Taps tagged with a region id (tap.scroll) resolve in that region's CONTENT
 * space: their viewport position is the region's viewport box (which itself
 * scrolls with the scene) plus the region's own paint offset. Untagged taps
 * keep the scene rule (y - scrollY, fixed anchors honored). One reverse scan
 * keeps topmost-wins across BOTH kinds — an overlay painted after a region
 * still wins. Returns the tap's index in scene.taps, or null.
 */
export function hitTestTapsWithRegions(
  taps: ReadonlyArray<SerializedTap>,
  regions: ReadonlyArray<Extract<DisplayOp, { op: "scroll-region" }>>,
  regionOffsets: ReadonlyMap<string, number>,
  designX: number,
  viewportY: number,
  visibleHeight: number,
  scrollY: number,
  action?: SerializedTap["action"]
): number | null {
  const regionById = new Map(regions.map((region) => [region.id, region]));
  for (let index = taps.length - 1; index >= 0; index--) {
    const tap = taps[index]!;
    if (action !== undefined && tap.action !== action) continue;
    if (tap.scroll === undefined) {
      const y = tap.fixed ? tap.y + anchorOffsetForTest(tap, visibleHeight) : tap.y - scrollY;
      if (tap.x <= designX && designX <= tap.x + tap.w && y <= viewportY && viewportY <= y + tap.h) {
        return index;
      }
      continue;
    }
    const region = regionById.get(tap.scroll);
    if (!region) continue; // stale tag: scene changed; not hittable
    const regionViewportTop = region.y - scrollY;
    if (designX < region.x || designX > region.x + region.w) continue;
    if (viewportY < regionViewportTop || viewportY > regionViewportTop + region.h) continue;
    // TN-166: clamp against THIS region's bounds — a stored offset left
    // over from a taller previous scene must not desync hit-testing from
    // painting (render() normalizes the stored value; this keeps the
    // exported resolver correct for any caller-supplied map).
    const maxOffset = Math.max(0, region.contentHeight - region.h);
    const offset = Math.min(Math.max(regionOffsets.get(region.id) ?? 0, 0), maxOffset);
    const contentY = viewportY - regionViewportTop + offset;
    if (tap.x <= designX - region.x && designX - region.x <= tap.x + tap.w &&
        tap.y <= contentY && contentY <= tap.y + tap.h) {
      return index;
    }
  }
  return null;
}

/**
 * The tap-resolution rule shared by every host surface: regions are tested
 * in REVERSE registration order, so the topmost painted region wins (paint
 * order is z-order). Fixed regions resolve in viewport coordinates with
 * their anchor offset; scrollable regions translate by the current scroll
 * the same way painting does — scene y MINUS scrollY is the viewport
 * position (render() draws scrollable ops after translate(0, -scrollY),
 * and the Android host's Tap.contains uses y - scrollY; this rule
 * previously tested y + scrollY, which diverged from the painted
 * position by 2×scrollY).
 * This is the browser twin of the Android host's Tap.contains + lastOrNull
 * dispatch — one rule, two adapters.
 */
export function hitTestTaps(
  taps: ReadonlyArray<SerializedTap>,
  designX: number,
  viewportY: number,
  visibleHeight: number,
  scrollY: number,
  action?: SerializedTap["action"]
): number | null {
  for (let index = taps.length - 1; index >= 0; index--) {
    const tap = taps[index]!;
    // TN-152 gesture filter: a GestureDetector with both handlers emits
    // two regions with the SAME frame (tap first, long-press second), so
    // an unfiltered reverse scan always picks the long-press region and
    // a short click would run the hold handler. Hosts pass the gesture
    // they are dispatching; omitted keeps the legacy unfiltered scan.
    if (action !== undefined && tap.action !== action) continue;
    const y = tap.fixed ? tap.y + anchorOffsetForTest(tap, visibleHeight) : tap.y - scrollY;
    if (tap.x <= designX && designX <= tap.x + tap.w && y <= viewportY && viewportY <= y + tap.h) {
      return index;
    }
  }
  return null;
}

function translateFixedOp(op: DisplayOp, visibleHeight: number): DisplayOp {
  const dy = anchorOffsetForTest(op, visibleHeight);
  if (dy === 0) return op;
  switch (op.op) {
    case "circle":
    case "ring":
      return { ...op, cy: op.cy + dy };
    case "line":
      return { ...op, y1: op.y1 + dy, y2: op.y2 + dy };
    case "text":
      return { ...op, y: op.y + dy, ...(op.clip ? { clip: { ...op.clip, y: op.clip.y + dy } } : {}) };
    default:
      return { ...op, y: op.y + dy };
  }
}

/**
 * CanvasKit-compatible drawing surface. CanvasKit is intentionally loaded by
 * the HTML shell so the bundle remains ordinary browser JavaScript. When
 * CanvasKit/WASM is unavailable, this deterministic Canvas 2D implementation
 * keeps the preview usable.
 */
export interface CanvasRendererOptions {
  /** Injectable frame clock for the adapter's transition tests. */
  raf?: (callback: (timeMs: number) => void) => number;
  cancelRaf?: (handle: number) => void;
  now?: () => number;
}

/** Scene identity without the transition stamp — burst continuation check. */
function stripTransition(scene: DisplayListScene): string {
  const { transition: _omit, ...rest } = scene;
  return JSON.stringify(rest);
}

export class CanvasPreviewRenderer implements PreviewRenderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D;
  private scale = 1;
  private designWidth = 720;
  /** TN-161 per-region paint offsets (host-owned scroll state, keyed by region id). */
  private readonly regionOffsets = new Map<string, number>();
  /** TN-169: the last scene painted as settled (transition source). */
  private settledScene: DisplayListScene | null = null;
  private activeTransition: {
    from: DisplayListScene;
    to: DisplayListScene;
    spec: SceneTransition;
    scrollY: number;
    startMs: number;
    handle: number;
  } | null = null;
  private readonly raf: (callback: (timeMs: number) => void) => number;
  private readonly cancelRaf: (handle: number) => void;
  private readonly now: () => number;
  /** Scene contract version this renderer understands (mirrors the Android host). */
  static readonly SUPPORTED_SCENE_VERSION = 1;

  constructor(canvas: HTMLCanvasElement, options?: CanvasRendererOptions) {
    this.canvas = canvas;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas 2D context unavailable");
    this.context = context;
    const scope = globalThis as { requestAnimationFrame?: typeof requestAnimationFrame; cancelAnimationFrame?: typeof cancelAnimationFrame };
    this.raf = options?.raf ?? ((callback) => scope.requestAnimationFrame!.call(globalThis, callback));
    this.cancelRaf = options?.cancelRaf ?? ((handle) => scope.cancelAnimationFrame!.call(globalThis, handle));
    this.now = options?.now ?? (() => performance.now());
    this.resize();
  }

  resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.max(1, Math.round(rect.width * dpr));
    this.canvas.height = Math.max(1, Math.round(rect.height * dpr));
    this.scale = rect.width > 0 ? rect.width / this.designWidth : 1;
  }

  render(scene: DisplayListScene, scrollY: number): void {
    // Fail-loud compatibility policy (same contract as the Android host):
    // an unacceptable scene is rejected whole with a console error and the
    // last painted canvas stays, instead of a partial render.
    const error = sceneContractError(scene);
    if (error !== null) {
      console.error(`[TENUN_SCENE_ERROR] ${error}; keeping the last painted scene`);
      return;
    }
    // TN-169: a scene carrying a transition animates FROM the previously
    // settled scene on this renderer's own frame clock — JavaScript only
    // configured the request; the host evaluates every frame. A commit
    // without a transition cuts any in-flight animation to the new scene.
    // A commit WITH a transition whose content equals the in-flight
    // destination is a continuation of the same navigation burst (the
    // dispatch-return commit after the invalidation commit): the clock
    // keeps running; only the destination scene object is refreshed.
    const active = this.activeTransition;
    if (scene.transition && active && stripTransition(active.to) === stripTransition(scene)) {
      active.to = scene;
      return;
    }
    this.cancelTransition();
    const from = this.settledScene;
    if (scene.transition && from && from !== scene) {
      this.designWidth = scene.designWidth;
      this.settledScene = scene;
      this.activeTransition = {
        from, to: scene, spec: scene.transition, scrollY,
        startMs: this.now(), handle: 0,
      };
      // Paint frame zero synchronously so the first committed frame never
      // flashes the settled previous scene, then continue on the frame clock.
      this.paintTransitionFrame(from, scene, scene.transition, scrollY, 0);
      this.activeTransition.handle = this.raf(() => this.stepTransition());
      return;
    }
    this.settledScene = scene;
    this.designWidth = scene.designWidth;
    this.paintPlain(scene, scrollY);
  }

  private cancelTransition(): void {
    const active = this.activeTransition;
    if (active) {
      this.cancelRaf(active.handle);
      this.activeTransition = null;
    }
  }

  private stepTransition(): void {
    const active = this.activeTransition;
    if (!active) return;
    const progress = (this.now() - active.startMs) / active.spec.durationMs;
    if (progress >= 1) {
      this.activeTransition = null;
      this.paintPlain(active.to, active.scrollY);
      return;
    }
    this.paintTransitionFrame(active.from, active.to, active.spec, active.scrollY, progress);
    active.handle = this.raf(() => this.stepTransition());
  }

  /** One host-evaluated transition frame. `progress` is raw 0..1; the
   *  easing curve and offsets are shared with the Android host. */
  paintTransitionFrame(
    from: DisplayListScene, to: DisplayListScene, spec: SceneTransition, scrollY: number, progress: number
  ): void {
    const eased = transitionEasing(progress);
    const rect = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const scale = rect.width / to.designWidth;
    const visibleHeight = rect.height / scale;
    const ctx = this.context;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, rect.width, rect.height);
    ctx.fillStyle = toCss(to.background);
    ctx.fillRect(0, 0, rect.width, rect.height);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, to.designWidth, visibleHeight);
    ctx.clip();
    if (spec.kind === "slide") {
      const direction = spec.direction === "forward" ? 1 : -1;
      this.paintScene(from, scrollY, -direction * eased * to.designWidth, 1, scale, visibleHeight);
      this.paintScene(to, scrollY, direction * (1 - eased) * to.designWidth, 1, scale, visibleHeight);
    } else {
      this.paintScene(from, scrollY, 0, 1 - eased, scale, visibleHeight);
      this.paintScene(to, scrollY, 0, eased, scale, visibleHeight);
    }
    ctx.restore();
  }

  private paintPlain(scene: DisplayListScene, scrollY: number): void {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const ctx = this.context;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, rect.width, rect.height);
    ctx.fillStyle = toCss(scene.background);
    ctx.fillRect(0, 0, rect.width, rect.height);
    this.paintScene(scene, scrollY, 0, 1, rect.width / scene.designWidth, rect.height * scene.designWidth / rect.width);
  }

  /** The scene body (scrollable layer + fixed overlays) under an
   *  x-translate and alpha — the shared path for plain and transition
   *  frames. */
  private paintScene(
    scene: DisplayListScene, scrollY: number, dx: number, alpha: number, scale: number, visibleHeight: number
  ): void {
    const ctx = this.context;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.scale(scale, scale);
    ctx.translate(dx, -scrollY);
    ctx.beginPath();
    ctx.rect(-dx, scrollY, scene.designWidth, visibleHeight);
    ctx.clip();
    for (const op of scene.ops) {
      if (op.fixed) continue;
      if (op.op === "scroll-region") {
        // TN-161: the region's viewport box (already in scene coordinates,
        // so it scrolls with the scene) clips its content; the region's own
        // paint offset translates it. Scrolling changes paint only.
        const offset = Math.min(Math.max(this.regionOffsets.get(op.id) ?? 0, 0),
          Math.max(0, op.contentHeight - op.h));
        // TN-166: normalize the stored offset to THIS scene's bounds so
        // every reader — hit-testing, the text-input adapter, the next
        // drag — agrees with what painting shows, even after content
        // shrinks below a previously scrolled position.
        this.regionOffsets.set(op.id, offset);
        ctx.save();
        ctx.beginPath();
        ctx.rect(op.x, op.y, op.w, op.h);
        ctx.clip();
        // TN-166: children are in content space RELATIVE TO THE REGION —
        // painting adds the region origin (hit-testing already subtracts
        // it), or a region at (20,44) clips its first rows away while
        // their taps still hit: invisible content with working hits.
        ctx.translate(op.x, op.y - offset);
        for (const nested of op.ops) this.paint(ctx, nested);
        ctx.restore();
        continue;
      }
      this.paint(ctx, op);
    }
    ctx.restore();

    // Fixed overlays form a viewport layer above all scrollable content.
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.scale(scale, scale);
    ctx.translate(dx, 0);
    ctx.beginPath();
    ctx.rect(-dx, 0, scene.designWidth, visibleHeight);
    ctx.clip();
    for (const op of scene.ops) {
      if (op.fixed) this.paint(ctx, translateFixedOp(op, visibleHeight));
    }
    ctx.restore();
  }

  hitTest(scene: DisplayListScene, clientX: number, clientY: number, scrollY: number, action?: "tap" | "long-press"): number | null {
    // A scene this renderer rejected is not painted AND not hittable: its
    // hit regions must never dispatch (no new action targets go live).
    if (sceneContractError(scene) !== null) return null;
    const rect = this.canvas.getBoundingClientRect();
    const scale = rect.width / scene.designWidth;
    return hitTestTapsWithRegions(
      scene.taps,
      this.scrollRegions(scene),
      this.regionOffsets,
      (clientX - rect.left) / scale,
      (clientY - rect.top) / scale,
      rect.height / scale,
      scrollY,
      action
    );
  }

  /** TN-161 validated scroll regions of a scene, in paint order. */
  scrollRegions(scene: DisplayListScene): Extract<DisplayOp, { op: "scroll-region" }>[] {
    if (sceneContractError(scene) !== null) return [];
    return scene.ops.filter((op): op is Extract<DisplayOp, { op: "scroll-region" }> => op.op === "scroll-region");
  }

  /** Topmost scroll region whose viewport box contains the client point. */
  regionAt(scene: DisplayListScene, clientX: number, clientY: number, scrollY: number):
      Extract<DisplayOp, { op: "scroll-region" }> | null {
    const rect = this.canvas.getBoundingClientRect();
    const scale = rect.width / scene.designWidth;
    const designX = (clientX - rect.left) / scale;
    const viewportY = (clientY - rect.top) / scale;
    let hit: Extract<DisplayOp, { op: "scroll-region" }> | null = null;
    for (const region of this.scrollRegions(scene)) {
      const top = region.y - scrollY;
      if (designX >= region.x && designX <= region.x + region.w &&
          viewportY >= top && viewportY <= top + region.h) {
        hit = region; // later regions paint above earlier ones
      }
    }
    return hit;
  }

  regionOffset(id: string): number {
    return this.regionOffsets.get(id) ?? 0;
  }

  /** Clamps into [0, contentHeight - viewport], stores, returns the clamped value. */
  setRegionOffset(scene: DisplayListScene, id: string, value: number): number {
    const region = this.scrollRegions(scene).find((candidate) => candidate.id === id);
    if (!region) return 0;
    const clamped = Math.min(Math.max(value, 0), Math.max(0, region.contentHeight - region.h));
    this.regionOffsets.set(id, clamped);
    return clamped;
  }

  maxScroll(scene: DisplayListScene): number {
    const rect = this.canvas.getBoundingClientRect();
    const scale = rect.width / scene.designWidth;
    return Math.max(0, scene.contentHeight - rect.height / scale);
  }

  private paint(ctx: CanvasRenderingContext2D, op: DisplayOp): void {
    switch (op.op) {
      case "text-input":
        // Required editing metadata. Ordinary operations paint the field;
        // BrowserTextInput owns its platform input connection.
        return;
      case "text": {
        if (op.clip) {
          ctx.save();
          ctx.beginPath();
          ctx.rect(op.clip.x, op.clip.y, op.clip.w, op.clip.h);
          ctx.clip();
        }
        ctx.fillStyle = toCss(op.color);
        ctx.font = `${op.weight >= 600 ? "700" : "400"} ${op.size}px sans-serif`;
        // Honor the scene's own alignment contract: align/width describe
        // a centering box, so the drawn x is the box's centered start —
        // drawing at op.x left-aligned every centered label (STOP, card
        // labels, pill text).
        let x = op.x;
        if (op.width !== undefined && op.align === "center") {
          const measured = ctx.measureText(op.text).width;
          x = op.x + Math.max(0, (op.width - measured) / 2);
        }
        ctx.fillText(op.text, x, op.y);
        if (op.clip) ctx.restore();
        return;
      }
      case "circle": {
        ctx.beginPath();
        ctx.arc(op.cx, op.cy, op.r, 0, Math.PI * 2);
        ctx.fillStyle = toCss(op.color);
        ctx.fill();
        return;
      }
      case "ring": {
        if (op.track) {
          ctx.beginPath();
          ctx.arc(op.cx, op.cy, op.r, 0, Math.PI * 2);
          ctx.strokeStyle = toCss(op.track);
          ctx.lineWidth = op.width;
          ctx.lineCap = "round";
          ctx.stroke();
        }
        if (op.progress > 0) {
          const start = -Math.PI / 2;
          const end = start + Math.PI * 2 * Math.min(op.progress, 1);
          ctx.beginPath();
          ctx.arc(op.cx, op.cy, op.r, start, end);
          ctx.strokeStyle = toCss(op.color);
          ctx.lineWidth = op.width;
          ctx.lineCap = "round";
          ctx.stroke();
        }
        return;
      }
      case "line": {
        ctx.beginPath();
        ctx.moveTo(op.x1, op.y1);
        ctx.lineTo(op.x2, op.y2);
        ctx.strokeStyle = toCss(op.color);
        ctx.lineWidth = op.width;
        ctx.stroke();
        return;
      }
      case "gradient": {
        ctx.save();
        if (op.shadow) this.applyShadow(ctx, op.shadow);
        const gradient = ctx.createLinearGradient(op.x, op.y, op.x, op.y + op.h);
        gradient.addColorStop(0, op.color);
        gradient.addColorStop(1, op.colorTo);
        ctx.beginPath();
        ctx.roundRect(op.x, op.y, op.w, op.h, op.r);
        ctx.fillStyle = gradient;
        ctx.fill();
        ctx.restore();
        return;
      }
      case "outline": {
        ctx.beginPath();
        ctx.roundRect(op.x, op.y, op.w, op.h, op.r);
        ctx.strokeStyle = toCss(op.color);
        ctx.lineWidth = op.width;
        ctx.stroke();
        return;
      }
      default: {
        ctx.save();
        if (op.shadow) this.applyShadow(ctx, op.shadow);
        ctx.beginPath();
        ctx.roundRect(op.x, op.y, op.w, op.h, op.r);
        ctx.fillStyle = toCss(op.color);
        ctx.fill();
        ctx.restore();
      }
    }
  }

  private applyShadow(ctx: CanvasRenderingContext2D, elevation: number): void {
    ctx.shadowColor = "rgba(0, 0, 0, 0.45)";
    ctx.shadowBlur = elevation;
    ctx.shadowOffsetY = elevation / 2;
  }
}

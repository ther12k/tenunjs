import type { DisplayListScene, DisplayOp } from "../ui-kit/src/display-list";

/**
 * Normalizes the display-list color convention for CSS: scenes use
 * Android-style "#AARRGGBB" for translucent colors (the Android host parses
 * it natively); CSS wants alpha last, so rewrite those to rgba().
 */
function toCss(color: string): string {
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
  hitTest(scene: DisplayListScene, clientX: number, clientY: number, scrollY: number): number | null;
  maxScroll(scene: DisplayListScene): number;
}

/**
 * CanvasKit-compatible drawing surface. CanvasKit is intentionally loaded by
 * the HTML shell so the bundle remains ordinary browser JavaScript. When
 * CanvasKit/WASM is unavailable (offline or blocked CDN), this deterministic
 * Canvas 2D implementation keeps the preview usable and reports the
 * fallback through the UI.
 */
export class CanvasPreviewRenderer implements PreviewRenderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D;
  private scale = 1;
  private designWidth = 720;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas 2D context unavailable");
    this.context = context;
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
    this.designWidth = scene.designWidth;
    this.resize();
    const rect = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const width = rect.width;
    const height = rect.height;
    const scale = width / scene.designWidth;
    const visibleHeight = height / scale;
    const ctx = this.context;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = toCss(scene.background);
    ctx.fillRect(0, 0, width, height);
    ctx.save();
    ctx.scale(scale, scale);
    ctx.translate(0, -scrollY);
    ctx.beginPath();
    ctx.rect(0, scrollY, scene.designWidth, visibleHeight);
    ctx.clip();
    for (const op of scene.ops) this.paint(ctx, op);
    ctx.restore();
  }

  hitTest(scene: DisplayListScene, clientX: number, clientY: number, scrollY: number): number | null {
    const rect = this.canvas.getBoundingClientRect();
    const scale = rect.width / scene.designWidth;
    const x = (clientX - rect.left) / scale;
    const y = (clientY - rect.top) / scale + scrollY;
    for (let index = scene.taps.length - 1; index >= 0; index--) {
      if (scene.taps[index]!.x <= x && x <= scene.taps[index]!.x + scene.taps[index]!.w &&
          scene.taps[index]!.y <= y && y <= scene.taps[index]!.y + scene.taps[index]!.h) {
        return index;
      }
    }
    return null;
  }

  maxScroll(scene: DisplayListScene): number {
    const rect = this.canvas.getBoundingClientRect();
    const scale = rect.width / scene.designWidth;
    return Math.max(0, scene.contentHeight - rect.height / scale);
  }

  private paint(ctx: CanvasRenderingContext2D, op: DisplayOp): void {
    switch (op.op) {
      case "text": {
        ctx.fillStyle = toCss(op.color);
        ctx.font = `${op.weight >= 600 ? "700" : "400"} ${op.size}px sans-serif`;
        ctx.fillText(op.text, op.x, op.y);
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
        // Track first, then the progress arc swept from 12 o'clock.
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

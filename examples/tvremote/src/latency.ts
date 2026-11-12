/**
 * Companion latency harness (TN-192) — measurement, not a threshold.
 *
 * Times ONE key press end to end at four points:
 *
 *   t0  widget press dispatched   (the screen action handler entry)
 *   t1  capability call entered   (net.write about to cross the seam)
 *   t2  write() resolved          (bytes handed to the transport)
 *   t3  acknowledgement observed  (the TV/fake-TV frame echoed back)
 *
 * producing a per-segment breakdown
 *
 *   uiDispatch = t1 - t0   (runtime action → capability entry)
 *   seam       = t2 - t1   (the capability write itself)
 *   transport  = t3 - t2   (wire round trip to the device echo)
 *   endToEnd   = t3 - t0
 *
 * and a digest with p50/p95/p99 over N events. Pure TypeScript,
 * QuickJS-safe (Date.now only; injectable clock for tests). This module
 * NEVER declares a budget passed or failed — it produces the evidence a
 * later decision consumes (the issue's explicit scope boundary).
 */

/** One completed key-event measurement (all four timestamps, client clock ms). */
export interface KeyEventSample {
  readonly keyCode: number;
  readonly direction: number;
  readonly t0Dispatch: number;
  readonly t1Capability: number;
  readonly t2WriteResolved: number;
  readonly t3AckObserved: number;
}

export interface SegmentBreakdown {
  readonly uiDispatchMs: number;
  readonly seamMs: number;
  readonly transportMs: number;
  readonly endToEndMs: number;
}

export function segmentsFor(sample: KeyEventSample): SegmentBreakdown {
  return {
    uiDispatchMs: sample.t1Capability - sample.t0Dispatch,
    seamMs: sample.t2WriteResolved - sample.t1Capability,
    transportMs: sample.t3AckObserved - sample.t2WriteResolved,
    endToEndMs: sample.t3AckObserved - sample.t0Dispatch,
  };
}

/** Nearest-rank percentile over an unsorted copy; p in (0, 100]. */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) throw new Error("percentile of empty set");
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[Math.min(sorted.length - 1, rank - 1)]!;
}

export interface LatencyDigest {
  readonly eventCount: number;
  readonly endToEnd: { readonly p50: number; readonly p95: number; readonly p99: number };
  readonly uiDispatch: { readonly p50: number; readonly p95: number; readonly p99: number };
  readonly seam: { readonly p50: number; readonly p95: number; readonly p99: number };
  readonly transport: { readonly p50: number; readonly p95: number; readonly p99: number };
  readonly minEndToEndMs: number;
  readonly maxEndToEndMs: number;
}

export function summarizeLatencies(samples: readonly KeyEventSample[]): LatencyDigest {
  if (samples.length === 0) throw new Error("digest of empty sample set");
  const e2e = samples.map((s) => segmentsFor(s).endToEndMs);
  const ui = samples.map((s) => segmentsFor(s).uiDispatchMs);
  const seam = samples.map((s) => segmentsFor(s).seamMs);
  const transport = samples.map((s) => segmentsFor(s).transportMs);
  const triple = (values: readonly number[]) => ({
    p50: percentile(values, 50),
    p95: percentile(values, 95),
    p99: percentile(values, 99),
  });
  return {
    eventCount: samples.length,
    endToEnd: triple(e2e),
    uiDispatch: triple(ui),
    seam: triple(seam),
    transport: triple(transport),
    minEndToEndMs: Math.min(...e2e),
    maxEndToEndMs: Math.max(...e2e),
  };
}

export interface LatencyRecorderOptions {
  /** Injectable clock (tests); default Date.now. Millisecond resolution. */
  now?: () => number;
  /** Keep at most this many completed samples (default unlimited). */
  maxSamples?: number;
}

/**
 * FIFO probe pipeline: over a serial transport, echoes return in write
 * order, so each completed `begin()` pairs with the next observed frame.
 * A probe that never sees its ack (link lost) stays pending and is
 * reported through `pendingCount()` — never silently dropped.
 */
export class LatencyRecorder {
  private readonly now: () => number;
  private readonly maxSamples: number;
  private readonly completed: KeyEventSample[] = [];
  private pending: {
    keyCode: number;
    direction: number;
    t0: number;
    t1: number;
    t2: number;
  }[] = [];

  constructor(options: LatencyRecorderOptions = {}) {
    this.now = options.now ?? (() => Date.now());
    this.maxSamples = options.maxSamples ?? Number.MAX_SAFE_INTEGER;
  }

  /** t0 — the widget press dispatched (screen action handler entry). */
  begin(keyCode: number, direction: number): void {
    this.pending.push({ keyCode, direction, t0: this.now(), t1: NaN, t2: NaN });
  }

  /** t1 — the capability call is entered (net.write about to run). */
  markCapabilityEntered(): void {
    const head = this.pending.find((p) => Number.isNaN(p.t1));
    if (head === undefined) return;
    head.t1 = this.now();
  }

  /** t2 — write() resolved (bytes handed to the transport). */
  markWriteResolved(): void {
    const head = this.pending.find((p) => !Number.isNaN(p.t1) && Number.isNaN(p.t2));
    if (head === undefined) return;
    head.t2 = this.now();
  }

  /** t3 — one device frame observed; completes the OLDEST pending probe. */
  markAckObserved(): void {
    const head = this.pending.shift();
    if (head === undefined || Number.isNaN(head.t2)) return;
    const sample: KeyEventSample = {
      keyCode: head.keyCode,
      direction: head.direction,
      t0Dispatch: head.t0,
      t1Capability: head.t1,
      t2WriteResolved: head.t2,
      t3AckObserved: this.now(),
    };
    if (this.completed.length < this.maxSamples) this.completed.push(sample);
  }

  /** Samples finished end to end, in completion order. */
  samples(): readonly KeyEventSample[] {
    return this.completed;
  }

  /** Probes still awaiting their device echo. */
  pendingCount(): number {
    return this.pending.length;
  }

  /** Digest over everything completed; empty runs have no digest. */
  digest(): LatencyDigest | null {
    return this.completed.length === 0 ? null : summarizeLatencies(this.completed);
  }
}

/** The JSON wire shape the device gate prints and the digest doc cites. */
export function digestToJson(digest: LatencyDigest): string {
  return JSON.stringify(digest);
}

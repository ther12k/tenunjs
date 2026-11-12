import { describe, expect, test } from "bun:test";
import {
  LatencyRecorder,
  percentile,
  segmentsFor,
  summarizeLatencies,
  digestToJson,
  type KeyEventSample,
} from "../src/latency";
import { TvRemoteRuntime } from "../src/runtime";
import type { CapabilityResult, NetCapability, NetSession, NetLinkState } from "@tenunjs/platform";
import {
  RemoteDirection,
  RemoteKeyCode,
  decodeFrames,
  frameMessage,
  parseRemoteMessage,
} from "../src/protocol";

/**
 * TN-192 harness tests: the MEASUREMENT itself, verified with a
 * deterministic clock — synthetic delays must produce exactly the
 * expected percentiles and segment breakdowns. No latency threshold is
 * asserted anywhere (the issue's explicit scope boundary); only the
 * harness's arithmetic is pinned.
 */

/** A clock the test advances by hand (ms). */
function manualClock(startAt: number = 1_000) {
  let now = startAt;
  return {
    now: () => now,
    advance(ms: number) {
      now += ms;
    },
  };
}

describe("TN-192 percentiles and segments (deterministic clock)", () => {
  test("percentile uses nearest-rank over the sorted copy", () => {
    expect(percentile([30, 10, 40, 20], 50)).toBe(20); // sorted [10,20,30,40], rank ceil(.5*4)=2
    expect(percentile([30, 10, 40, 20, 50], 50)).toBe(30); // rank ceil(.5*5)=3
    expect(percentile([30, 10, 40, 20, 50], 100)).toBe(50);
    expect(percentile([7], 95)).toBe(7);
    expect(() => percentile([], 50)).toThrow("empty set");
  });

  test("segmentsFor derives the four intervals from the timestamps", () => {
    const sample: KeyEventSample = {
      keyCode: 19,
      direction: 3,
      t0Dispatch: 100,
      t1Capability: 104,
      t2WriteResolved: 109,
      t3AckObserved: 139,
    };
    expect(segmentsFor(sample)).toEqual({
      uiDispatchMs: 4,
      seamMs: 5,
      transportMs: 30,
      endToEndMs: 39,
    });
  });

  test("synthetic delays produce exactly the expected percentiles", () => {
    const clock = manualClock();
    const recorder = new LatencyRecorder({ now: clock.now });

    // 20 events: transport delay of event i is (i + 1) ms → 1..20.
    for (let i = 0; i < 20; i += 1) {
      const delay = i + 1;
      recorder.begin(19, RemoteDirection.SHORT);
      clock.advance(2); // uiDispatch
      recorder.markCapabilityEntered();
      clock.advance(1); // seam
      recorder.markWriteResolved();
      clock.advance(delay); // transport
      recorder.markAckObserved();
    }

    const digest = recorder.digest()!;
    expect(digest.eventCount).toBe(20);
    // transport p50 = rank ceil(.5*20)=10 → 10; p95 = rank 19 → 19; p99 = rank 20 → 20.
    expect(digest.transport.p50).toBe(10);
    expect(digest.transport.p95).toBe(19);
    expect(digest.transport.p99).toBe(20);
    // Every event: uiDispatch=2, seam=1 → those percentiles are constant.
    expect(digest.uiDispatch).toEqual({ p50: 2, p95: 2, p99: 2 });
    expect(digest.seam).toEqual({ p50: 1, p95: 1, p99: 1 });
    // endToEnd = 3 + delay → p50 = 13, p95 = 22, p99 = 23.
    expect(digest.endToEnd.p50).toBe(13);
    expect(digest.endToEnd.p95).toBe(22);
    expect(digest.endToEnd.p99).toBe(23);
    expect(digest.minEndToEndMs).toBe(4);
    expect(digest.maxEndToEndMs).toBe(23);
  });

  test("digestToJson is stable, parseable JSON carrying the digest fields", () => {
    const clock = manualClock();
    const recorder = new LatencyRecorder({ now: clock.now });
    recorder.begin(4, RemoteDirection.SHORT);
    clock.advance(3);
    recorder.markCapabilityEntered();
    clock.advance(2);
    recorder.markWriteResolved();
    clock.advance(11);
    recorder.markAckObserved();
    const parsed = JSON.parse(digestToJson(recorder.digest()!)) as {
      eventCount: number;
      endToEnd: { p50: number };
    };
    expect(parsed.eventCount).toBe(1);
    expect(parsed.endToEnd.p50).toBe(16);
  });

  test("probes complete FIFO and unmatched probes stay visible as pending", () => {
    const clock = manualClock();
    const recorder = new LatencyRecorder({ now: clock.now });

    recorder.begin(19, RemoteDirection.SHORT);
    recorder.begin(20, RemoteDirection.SHORT);
    expect(recorder.pendingCount()).toBe(2);
    recorder.markCapabilityEntered();
    recorder.markCapabilityEntered();
    recorder.markWriteResolved();
    recorder.markWriteResolved();

    // Only ONE frame arrives → oldest probe completes, newest stays pending.
    clock.advance(5);
    recorder.markAckObserved();
    expect(recorder.pendingCount()).toBe(1);
    expect(recorder.samples().length).toBe(1);
    const [first] = recorder.samples();
    expect(first!.keyCode).toBe(19); // FIFO: the OLDEST press is paired with the echo
    expect(segmentsFor(first!).endToEndMs).toBe(5);

    // The next frame completes the remaining probe (frames pair FIFO with
    // writes — the harness cannot and must not second-guess the wire).
    clock.advance(2);
    recorder.markAckObserved();
    expect(recorder.pendingCount()).toBe(0);
    expect(recorder.samples().length).toBe(2);

    // A frame with NOTHING pending is a no-op, not a crash or a phantom sample.
    recorder.markAckObserved();
    recorder.markAckObserved();
    expect(recorder.samples().length).toBe(2);
  });

  test("digest of an empty recorder is null, never a fabricated zero digest", () => {
    const recorder = new LatencyRecorder({ now: manualClock().now });
    expect(recorder.digest()).toBeNull();
    expect(recorder.pendingCount()).toBe(0);
    expect(recorder.droppedCount()).toBe(0);
  });

  test("a rejected write retires its probe to dropped — never a fabricated sample or a stolen t2", () => {
    const clock = manualClock();
    const recorder = new LatencyRecorder({ now: clock.now });

    // Press A's write REJECTS (dying link): t1 set, t2 never lands.
    recorder.begin(19, RemoteDirection.SHORT);
    clock.advance(2);
    recorder.markCapabilityEntered();
    recorder.abandonOldestUnwritten(); // the runtime's catch-path retirement
    expect(recorder.pendingCount()).toBe(0);
    expect(recorder.droppedCount()).toBe(1);
    expect(recorder.samples().length).toBe(0);

    // Press B then measures CLEANLY — A's absence cannot steal B's t2 or
    // contaminate B's segments.
    recorder.begin(20, RemoteDirection.SHORT);
    clock.advance(3);
    recorder.markCapabilityEntered();
    clock.advance(1);
    recorder.markWriteResolved();
    clock.advance(9);
    recorder.markAckObserved();
    expect(recorder.samples().length).toBe(1);
    const [b] = recorder.samples();
    expect(b!.keyCode).toBe(20);
    expect(segmentsFor(b!).uiDispatchMs).toBe(3);
    expect(segmentsFor(b!).seamMs).toBe(1);
    expect(segmentsFor(b!).transportMs).toBe(9);
    expect(recorder.droppedCount()).toBe(1); // A is still countable
  });

  test("a frame pairing with an unwritten probe is refused, not fabricated", () => {
    const clock = manualClock();
    const recorder = new LatencyRecorder({ now: clock.now });
    recorder.begin(19, RemoteDirection.SHORT);
    recorder.markCapabilityEntered(); // t1 only — write still in flight
    recorder.markAckObserved(); // stray/impossible frame
    expect(recorder.pendingCount()).toBe(1); // probe NOT consumed
    expect(recorder.samples().length).toBe(0);
  });

  test("t0 override: dispatchedAt captures the true screen-action entry", () => {
    const clock = manualClock(1_000);
    const recorder = new LatencyRecorder({ now: clock.now });
    const dispatchedAt = 1_000 - 4; // the action started 4ms before sendKey
    recorder.begin(19, RemoteDirection.SHORT, dispatchedAt);
    clock.advance(1); // sendKey entry → t1 at 1001
    recorder.markCapabilityEntered();
    clock.advance(1); // write resolves → t2 at 1002
    recorder.markWriteResolved();
    clock.advance(1); // echo → t3 at 1003
    recorder.markAckObserved();
    const [s] = recorder.samples();
    expect(segmentsFor(s!).uiDispatchMs).toBe(5); // 996 → 1001
    expect(segmentsFor(s!).seamMs).toBe(1);
    expect(segmentsFor(s!).transportMs).toBe(1);
    expect(segmentsFor(s!).endToEndMs).toBe(7); // 996 → 1003
  });
});

describe("TN-192 runtime integration (fake-TV echo completes probes)", () => {
  class EchoSession implements NetSession {
    written: Uint8Array[] = [];
    private listeners: ((c: Uint8Array) => void)[] = [];

    async write(data: Uint8Array): Promise<CapabilityResult<void>> {
      this.written.push(data);
      return { ok: true, value: undefined };
    }
    onData(listener: (chunk: Uint8Array) => void) {
      this.listeners.push(listener);
      return () => {};
    }
    onLinkStateChange(listener: (state: NetLinkState) => void) {
      listener("linked");
      return () => {};
    }
    onServerCertificate() {
      return () => {};
    }
    async close(): Promise<CapabilityResult<void>> {
      return { ok: true, value: undefined };
    }
    /** The fake TV echoes a written frame back verbatim. */
    echoLast(): void {
      const last = this.written[this.written.length - 1]!;
      this.fire(last);
    }
    /** Deliver a raw chunk to the runtime (coalesced bursts included). */
    fire(chunk: Uint8Array): void {
      for (const l of [...this.listeners]) l(chunk);
    }
  }

  function runtimeWithEcho(): {
    runtime: TvRemoteRuntime;
    holder: { session: EchoSession | null };
  } {
    const holder: { session: EchoSession | null } = { session: null };
    const net: NetCapability = {
      contractVersion: 1,
      availability: () => ({ status: "supported" }),
      permissionPrerequisites: () => [],
      async connect() {
        holder.session = new EchoSession();
        return { ok: true, value: holder.session };
      },
    };
    const runtime = new TvRemoteRuntime(
      { net, latency: new LatencyRecorder() },
      { initialRoute: "remote" }
    );
    (runtime as unknown as { activeTv: unknown }).activeTv = {
      name: "Test TV",
      host: "127.0.0.1",
      port: 6466,
    };
    return { runtime, holder };
  }

  test("a press through the runtime completes when the fake TV echoes", async () => {
    const { runtime, holder } = runtimeWithEcho();
    await (runtime as unknown as { connectRemoteSession(): Promise<void> }).connectRemoteSession();
    const session = holder.session!;
    expect(session).not.toBeNull();

    await runtime.sendKey(RemoteKeyCode.KEYCODE_DPAD_UP, RemoteDirection.SHORT);
    const probe = (runtime as unknown as { host: { latency: LatencyRecorder } }).host.latency;
    expect(probe.pendingCount()).toBe(1); // awaiting the echo
    expect(probe.samples().length).toBe(0);

    session.echoLast(); // the fake TV answers
    expect(probe.pendingCount()).toBe(0);
    const samples = probe.samples();
    expect(samples.length).toBe(1);
    const sample = samples[0]!;
    expect(sample.keyCode).toBe(RemoteKeyCode.KEYCODE_DPAD_UP);
    expect(segmentsFor(sample).endToEndMs).toBeGreaterThanOrEqual(0);
    // The echoed frame must parse as the key inject we sent.
    const { frames } = decodeFrames(session.written[session.written.length - 1]!);
    expect(frames.length).toBe(1);
    const parsed = parseRemoteMessage(frames[0]!);
    expect(parsed.hasKeyInject).toBe(true);

    const digest = probe.digest();
    expect(digest).not.toBeNull();
    expect(digest!.eventCount).toBe(1);
  });

  test("N presses + N echoes produce an N-sample digest in write order", async () => {
    const { runtime, holder } = runtimeWithEcho();
    await (runtime as unknown as { connectRemoteSession(): Promise<void> }).connectRemoteSession();
    const session = holder.session!;
    const probe = (runtime as unknown as { host: { latency: LatencyRecorder } }).host.latency;

    const N = 25;
    for (let i = 0; i < N; i += 1) {
      await runtime.sendKey(RemoteKeyCode.KEYCODE_DPAD_DOWN, RemoteDirection.SHORT);
    }
    expect(probe.pendingCount()).toBe(N);

    // All N echoes arrive in one burst (a realistic socket coalesce).
    const lastN = session.written.slice(-N);
    const burst = new Uint8Array(lastN.reduce((total, f) => total + f.length, 0));
    let offset = 0;
    for (const frame of lastN) {
      burst.set(frame, offset);
      offset += frame.length;
    }
    session.fire(burst);

    expect(probe.pendingCount()).toBe(0);
    const digest = probe.digest()!;
    expect(digest.eventCount).toBe(N);
    // Burst delivery: all transports collapse to ~0; endToEnd stays finite.
    expect(digest.endToEnd.p50).toBeGreaterThanOrEqual(0);
    expect(digest.maxEndToEndMs).toBeLessThan(1_000);
  });
});

---
okf_version: 0.2
title: "TV Remote latency baseline (TN-192) — first recorded digest"
summary: "The first measured end-to-end key-event latency digest for the tvremote vertical slice through the embedded runtime: 100 key events through the compiled public TvRemoteRuntime + net adapter, QuickJS → JNI → NetService → plain TCP → the CI runner's byte-echo server. Measurement only — no threshold is declared passed or failed; a budget decision cites this data."
type: report
status: accepted
---

# TV Remote latency baseline (TN-192)

## Method

`TvRemoteLatencyTest` drives 100 key events (D-pad cycle, `SHORT`
direction) through the full seam and records four timestamps per event
(client clock, `Date.now`, millisecond resolution):

- **t0** — widget press dispatched (screen action handler entry, passed
  as `dispatchedAt` into `sendKey`)
- **t1** — capability call entered (`net.write` about to run)
- **t2** — `write()` resolved (bytes handed to the transport)
- **t3** — device acknowledgement observed (echo frame received)

Segments: **uiDispatch** = t1−t0 (the real action→capability distance),
**seam** = t2−t1, **transport** = t3−t2, **endToEnd** = t3−t0.
Percentiles are nearest-rank over all 100 events. Harness arithmetic is
separately proven with a deterministic clock
(`examples/tvremote/test/latency.test.ts`: synthetic delays produce
exactly the expected p50/p95/p99; a rejected write retires its probe to
a countable `dropped` instead of contaminating later probes).

## Environment (first digest, CI run 43279450848, head a2d2f1b)

- **Device**: GitHub-hosted KVM emulator (API 30 x86_64 guest), not a
  physical set.
- **Path**: compiled public `TvRemoteRuntime` + public net adapter →
  QuickJS → JNI → NetService → **plain TCP** → the runner-hosted
  byte-echo server (`tn192_echo_server.mjs`), reached at the guest's
  `10.0.2.2` host alias. Plain TCP by design: the transport segment
  measures the socket round trip, NOT a TLS record layer or a real
  radio path.
- **Clock**: `Date.now`, 1 ms granularity — sub-millisecond segments
  report as 0 and are expected to.
- **Wi-Fi conditions**: not applicable (emulated Ethernet path).

## Recorded digest

```
TN192_LATENCY digest={"eventCount":100,"endToEnd":{"p50":1,"p95":2,"p99":3},"uiDispatch":{"p50":0,"p95":0,"p99":0},"seam":{"p50":0,"p95":1,"p99":1},"transport":{"p50":1,"p95":2,"p99":3},"minEndToEndMs":0,"maxEndToEndMs":4}
```

| Segment | p50 (ms) | p95 (ms) | p99 (ms) |
| --- | ---: | ---: | ---: |
| uiDispatch | 0 | 0 | 0 |
| seam | 0 | 1 | 1 |
| transport | 1 | 2 | 3 |
| end to end | 1 | 2 | 3 |

min end-to-end 0 ms, max 4 ms, 100/100 events completed.

Reading note on `uiDispatch`: in THIS run the fixture drives
`runtime.sendKey` directly (no screen action in the loop), so t0 and t1
land in the same synchronous call and the segment reports 0 by
construction of the gate, not of the harness — the recorder accepts the
screen's `dispatchedAt` (proven by the deterministic-clock test) and a
UI-driven journey would measure the real action→capability distance
there. The recorded 0 is the gate's floor, honestly labeled.

## Reading, and what this is NOT

- This is a **regression ceiling and harness validation**, not a claim
  about real devices: the emulator loopback path with a host echo
  server is the fastest possible transport. Physical-set numbers (the
  MiTV-AXSO0 journey over Wi-Fi with TLS) are expected to be strictly
  larger and remain the human hardware gate per ADR-0019.
- **No latency budget is declared passed or failed** — that is a
  decision issue that cites this data (the TN-192 scope boundary).
- The four-segment breakdown lets a later decision attribute cost:
  today the runtime+seam contributes ≤ 1 ms at p95 on this path; the
  transport dominates.
- Hosted evidence: CI run
  [43279450848](https://github.com/ther12k/tenunjs/actions/runs/43279450848)
  (verify-android-device, 58/58 tests), PR #282 head `a2d2f1b`.

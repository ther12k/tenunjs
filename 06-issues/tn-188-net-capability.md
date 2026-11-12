---
okf_version: 0.2
title: "TN-188: Net capability — TCP and TLS sessions with client-certificate pairing"
summary: "Add the net host capability per ADR-0027 and 04-api/net.md: connect() to host:port, optional TLS using a keys identity as client certificate, pinned or first-use-accepted server identity, Uint8Array writes, pushed data and tri-state link events, idempotent close. Android implementation behind the existing JNI host-service bridge; a loopback WebSocket proxy shim for the browser preview; fail-closed stub wired through defineHostCapabilities."
type: issue
status: closed
issue_id: "TN-188"
priority: "P1"
depends_on:
  - "TN-141"
  - "TN-189"
---

# TN-188 — Net capability

## Purpose

Companion-device apps converse with one nearby device over a persistent
connection. The Android TV Remote v2 driver needs a TLS session the
phone authenticates with a generated client certificate; today the
platform has no socket seam at all (review 2026-11-07, gap G1).

## Required outcome

1. `packages/platform/src/net.ts` implementing the contract in
   `04-api/net.md` exactly (result types, `contractVersion: 1`,
   tri-state link, idempotent close/unsubscribe, `onServerCertificate`
   in first-use mode).
2. Android host service on the existing bridge: `Socket`/`SSLSocket`
   transport, client key used in place via the TN-189 Keystore side,
   link-state and data events marshalled to the runtime.
3. Browser preview shim (WebSocket↔TCP loopback proxy) plus an
   in-memory fake endpoint for headless tests.
4. `unsupportedNet` stub and `defineHostCapabilities` wiring; TN-145
   parity surface updated.

## Verification

- Headless contract tests against a local echo/fixture server: connect,
  write/receive round-trip, first-use fingerprint delivered, pin
   enforcement on a second connect, link-lost on remote close, double
  close is a no-op, cancelled signal aborts connect.
- Android device gate: the same suite over the real bridge.

## Out of scope

- UDP, sockets beyond a single session per call, SOCKS proxies.
- Background survival (ADR-0027 v1: foreground-scoped).

## Status note (2026-11-08, closed)

Implemented in PR #278's successor branch (see the PR record for the merged head). All four required outcomes landed against the frozen contract (`packages/platform/src/net.ts`, contractVersion 1, exactly the `04-api/net.md` shapes: `NET_PERMISSIONS` with the android `INTERNET` tier and empty ios/web tiers, tri-state `NetLinkState`, result-shaped everything, idempotent close, `onServerCertificate` in first-use mode only):

1. **Contract + shared bounds** — `net.ts` plus `net-validation.ts`: host/port/timeout/tls argument validation shared byte-for-byte across all three tiers (`netConnectArgumentError`), write bound 1 MiB, timeout bound 120 s; `HostCapabilities` gained its SIXTH member (`net`) with `unsupportedNet` fail-closed wiring and TN-145 parity assertions in `platform.test.ts`.
2. **Native adapter** — `net-native.ts` `createHostNetBridge(hostCall)`: the asynchronous seam over the synchronous bridge, split exactly like production BLE (requests via `tenun_host_call("net", …)`, events pushed as `NET_EVENT` dispatch actions routed into `bridge.handleHostEvent`). Cancellation settles JS-side from the caller's `CapabilityCancelSignal` (already-aborted signals settle before the transport; the host session is closed best-effort behind the settle). Session listeners replay the current link state and, in first-use mode, the already-delivered fingerprint; data listeners never replay history. Fail-closed: null replies → `unsupported`, throwing bridge → `platform-error`, unknown failure kinds → `platform-error`, malformed events → visible `false` from `handleHostEvent`.
3. **Android host** — `NetService.kt` behind the bridge: plain `Socket` and `SSLSocket` transports; TLS on whenever a `tls` object is present (even empty). Trust is pin-or-first-use, NOT WebPKI (self-signed companion certificates): a `PinTrustManager` verifies only the caller's SHA-256 pin — a mismatch is a loud `link-lost` connect failure; first-use records the real leaf-certificate hash and delivers it before connect-ok. Client certificates resolve through `KeysService.identityEntry` — the `tenun.keys.v1.` namespace ONLY, private key used in place via an `X509ExtendedKeyManager` exposing exactly that entry (TN-189 ownership boundary holds across capabilities). The contract's bounded receive side is enforced: 1 MiB buffered ahead of the runtime; a runtime that stops draining overflows to a `link-lost` offline event — never truncation, never unbounded growth. Writes are bounded too (2 MiB backlog → `busy`); `close` is idempotent including unknown ids; closing a PENDING connect abandons it with no events for a session JS never saw. `MainActivity` registers `"net"` with NET_EVENT pushes re-entering the current engine (the BLE_LINK channel discipline).
4. **Preview + fakes** — `net-preview.ts`: `previewNetCapability` speaks the WebSocket↔TCP loopback-proxy wire (endpoint hello carries the fingerprint; TLS terminates at the proxy by spec — the pin journey is real, the fingerprint is proxy-synthesized and labelled as such); `createFakeNetEndpoint` is a fully in-memory endpoint for deterministic headless tests. Both bind the REAL contract.

Evidence: `bun run typecheck` clean; `bun test` 806 pass — `net.test.ts` (fake endpoint contract suite incl. first-use/pin, link loss, double close, cancellation, argument bounds), `net-native.test.ts` (the exact wire against a scripted bridge: payload shapes, replay semantics, malformed-event visibility, fail-closed matrix), `net-preview.test.ts` (a real Bun WebSocket↔TCP proxy plus node:net echo servers: round-trip, first-use fingerprint, pin enforcement, remote close, timeout, cancel); the JVM tier runs the SAME semantics against real loopback TCP — `NetServiceFormatTest` **OK (9 tests)** including the overflow-to-link-lost bound and refusal/timeout taxonomies; the isolated K2JVMCompiler rehearsal compiles the full Kotlin set including the androidTest tier (`NetBridgeTest.kt`) clean. On device, `NetBridgeTest` drives the compiled public adapter through a real `TenunEngine` (QuickJS → JNI → NetService → real sockets): metadata/QuickJS-globals, plain-TCP round-trip with idempotent close, remote close → offline, cancelled black-holed connect, and the TLS pairing journey — a Keystore client identity authenticating to a deterministic single-alias TLS server that independently verifies the presented client certificate IS the identity's certificate, first-use fingerprint = the real sha256 of the server certificate (JCA-computed, not production code), correct-pin reconnect silent, wrong pin a loud `link-lost` mismatch. Hosted results for the pushed head are on the PR checks.

**Device-gate evidence trail (2026-11-08/09), and what it caught.** The hosted device runs failed four times; each failure was reproduced locally on the API-30 emulator with adb/logcat and fixed on the branch, in order: `InputStream.readAllBytes()` is API 33+ and absent from the API-30 guest's ART (NoSuchMethodError, all five net tests); an uncaught exception in any test-spawned thread kills the whole instrumentation process (the one-shot accept thread died at teardown — desktop JUnit tolerates this, the JVM rehearsal did not see it); and the local reproduction exposed two production defects the earlier hosted noise had hidden. First, `NetBridgeFixture` pushed NET_EVENT into QuickJS straight from NetService io threads — QuickJS pins its stack-overflow guard to the engine-creating thread, so every push died with "Maximum call stack size exceeded" and no event ever reached JS (production already avoids this by dispatching on the thread that created the engine; the fixture now mirrors that discipline on a dedicated HandlerThread). Second, test servers bound `InetAddress.getLoopbackAddress()`, which is `::1` on this ART — an IPv6-only listener — while NetService dialed the literal `127.0.0.1` (ECONNREFUSED; `ss -tln`-proven; the desktop JVM returns IPv4 loopback and masked the mismatch); binds now name 127.0.0.1 explicitly.

**TLS pairing evidence — topology and a real Keystore defect.** With plain-TCP net tests green on device, the TLS journey still failed locally. Isolation (raw-byte probe: the ClientHello provably reaches the peer; outward guest TLS to a real CA endpoint succeeds; every in-guest SERVER-mode handshake dies with mutual read-EOF) established that the API-30 emulator guest's server-mode Conscrypt is unusable, so the device gate's TLS server runs on the HOST (`tools/tn188_tls_server.mjs`, started by the acceptance runner, reachable through the emulator's 10.0.2.2 alias) — the guest exercises only its proven client mode. That exposed the substantive defect: **TLS client authentication with a Keystore identity requires `DIGEST_NONE` in the KeyGenParameterSpec** — Conscrypt signs the TLS CertificateVerify with the pre-hashed `NONEwithECDSA` transform (`CryptoUpcalls.ecSignDigestWithPrivateKey`), and a keys identity generated with only `DIGEST_SHA256` fails every handshake with "Keystore operation failed" (`InvalidKeyException`, CryptoUpcalls stack in logcat). `KeysService` now generates identities permitting both digests; ordinary in-place `SHA256withECDSA` signing is unaffected (the keys suites are unchanged and green). The device gate then passed end to end locally: first-use connect with the client identity, the delivered fingerprint asserted equal to the server's own certificate hash, the presented client certificate asserted equal to the Keystore identity's certificate (both hashes echoed by the host server from the live TLS session, verified with independent JCA/node:crypto code), silent reconnect with the seen pin, and a wrong pin aborting loudly with a mismatch. The TLS trust semantics also corrected: `checkClientTrusted` no longer throws (JSSE validates the client's own identity there during TLS 1.3 client auth — our keys identity needs no third-party validation), and both key managers select certificates by both TLS 1.2 ("EC") and TLS 1.3 ("ecdsa_secp256r1_sha256") key-type spellings.

Residuals, open and not silently dropped: TLS end to end is exercised against the runner-hosted server (self-signed, deterministic), not a physical Android TV (`TN-191` owns the literal device journey against `com.google.android.tv.remote.service`); the browser preview proxy itself (dev-server wiring) is authorable now and lands with TN-191's preview work; no application bundle binds `net` yet (TN-191 will).

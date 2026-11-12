# @tenunjs-examples/tvremote

Companion app vertical slice: an Android TV Remote controller written entirely in TypeScript/TSX on top of TenunJS platform capabilities (**discovery**, **keys**, and **net**), implementing [ADR-0027](../../03-decisions/adr-0027-companion-connectivity-capabilities.md) and closing [TN-191](../../06-issues/tn-191-tvremote-example.md).

## What this demonstrates

1. **Discovery (`_androidtvremote2._tcp`)**:
   - mDNS discovery on local LAN via `discovery.browse({ serviceType: "_androidtvremote2._tcp" })`.
   - Resolution to IP, port (pairing port 6467 / remote port 6466), and TXT records.
   - Manual host:port entry fallback for restricted or preview networks.

2. **Keys & TLS Client-Certificate Pairing (`keys` + `net`)**:
   - Generates a persistent key pair and self-signed certificate via `keys.generateIdentity()`.
   - Connects to the TV's pairing service on port 6467 over TLS with client certificate authentication.
   - Exchanges Polo protobuf messages: `PairingRequest` -> `Options` -> `Configuration` -> `Secret`.
   - Computes the SHA-256 pairing secret hash from public key bytes and the 6-hex-digit PIN displayed on the TV.
   - Saves the TV's certificate fingerprint in storage for silent subsequent connections.

3. **Remote Control Protocol (`net`)**:
   - Connects to port 6466 over TLS with certificate pinning (`expectedServerCertSha256`).
   - Exchanges configuration (`RemoteConfigure` and `RemoteSetActive`).
   - Handles keepalive pings (`RemotePingRequest` / `RemotePingResponse`).
   - D-Pad navigation with **separate press and release events** (`START_LONG` and `END_LONG`) for continuous holding repeat on the TV.
   - Text input via `RemoteImeBatchEdit`.
   - Quick app launch via `RemoteAppLinkLaunchRequest`.

4. **Browser Preview Host (`dev.ts`, `preview.ts`)**:
   - In-browser simulated Android TV running the pairing handshake and remote control loop.
   - Live visual monitor showing TV screen, active app, volume, PIN banner, and wire traffic log.

## Running the preview

```bash
bun examples/tvremote/dev.ts
# Open http://localhost:8175 in your browser
```

## Running tests

```bash
bun test examples/tvremote/test/
```

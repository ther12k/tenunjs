---
okf_version: 0.2
title: "Media Capability API"
summary: "Host-service media playback for TV-style apps: prepare/play/pause/stop, a positioned video surface, fetchText for playlists, and MEDIA_STATE events — fail-closed when the host provides no media service."
type: reference
status: accepted
---

# Media capability

Design target for the `media` host service (ADR-0028, delivered by
TN-193). Bundles reach it through the existing host-call seam; the
TypeScript contract below is the public shape, modeled on the BLE
capability and the net capability draft.

## Contract (v1)

```ts
export interface MediaCapability {
  contractVersion: 1;

  /** Load a media URL (HLS m3u8 supported) without starting playback. */
  prepare(url: string): Promise<CapabilityResult<MediaStatus>>;

  play(): Promise<CapabilityResult<MediaStatus>>;
  pause(): Promise<CapabilityResult<MediaStatus>>;
  stop(): Promise<CapabilityResult<MediaStatus>>;

  /** Position the video surface, in design units, over the scene. */
  setRect(x: number, y: number, w: number, h: number):
    Promise<CapabilityResult<null>>;

  /** Current status snapshot. */
  status(): Promise<CapabilityResult<MediaStatus>>;

  /** Minimal HTTP GET → text (10 s timeout, 2 MB cap). Stopgap until
      the net capability (TN-188) lands; playlists are its only user. */
  fetchText(url: string): Promise<CapabilityResult<string>>;
}

export interface MediaStatus {
  state: "idle" | "buffering" | "ready" | "playing" | "paused"
       | "ended" | "error";
  url?: string;
  message?: string;   // error detail when state === "error"
}
```

## Events

The host pushes state transitions as a `MEDIA_STATE` action (the BLE
service's native→JS event pattern):

```ts
{ type: "MEDIA_STATE", state: MediaStatus["state"],
  url?: string, message?: string }
```

## Semantics

- **Fail-closed.** Hosts without a media service report
  `unsupportedMedia`/`unsupported` for every op; the platform stub in
  `packages/platform/src/media.ts` returns exactly that, so a bundle can
  probe support the same way it probes BLE.
- **One player per host.** `prepare` releases any previous item.
  Ops on an unprepared player fail closed with a message, never throw
  past the seam.
- **The video rect is opaque.** The Tenun scene composes around it; v1
  has no scene-graph ordering or clipping across video (ADR-0028).
- **`setRect` uses design units** and takes effect on the next frame.
- **`fetchText` is not a general fetch**: GET, text responses, bounded
  size, no headers/auth/streams. The net capability supersedes it.

## Android delivery (TN-193)

Registered as the `"media"` host service wrapping Media3 ExoPlayer +
HLS; the surface is a `TextureView` overlaying `TenunSurfaceView` in
the activity's `FrameLayout`, hidden until the first frame is ready.
`fetchText` is an async ticket on this host — the invoke replies
`{ok:true, value:{ticket}}` and completion arrives as a `MEDIA_TEXT`
event (`{ticket, ok, text|message}`), because a blocking GET on the
engine's dispatch thread would exceed the JS entry time budget; the
TS glue resolves the promise from the event.

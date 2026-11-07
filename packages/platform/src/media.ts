/**
 * Media capability contract (ADR-0028, delivered by TN-193).
 *
 * Host-service media playback for TV-style applications: one player per
 * host (prepare/play/pause/stop), an opaque video surface positioned
 * over the scene in design units (setRect), a bounded fetchText for
 * playlists, and MEDIA_STATE push events — the native→JS event pattern
 * the BLE service established.
 *
 * Unlike ble/storage/camera/launcher this contract declares no
 * availability()/permissionPrerequisites(): playback needs no runtime
 * permission grant and has no degradation ladder — a host either
 * provides the service or the fail-closed stub below answers
 * `unsupported` for every op, so a bundle can probe support the same
 * way it probes BLE (04-api/media.md).
 *
 * Host mappings:
 *  - Android: the "media" NativeService wraps Media3 ExoPlayer + HLS;
 *    the video surface is a TextureView layered over TenunSurfaceView
 *    in the activity's FrameLayout, hidden until the first frame
 *    (TN-193). fetchText is an async ticket over the host-call seam —
 *    the invoke reply carries {ticket} and completion arrives as a
 *    MEDIA_TEXT event; the TS glue resolves the fetchText promise from
 *    it (a blocking GET on the engine thread would blow the JS entry
 *    time budget).
 *  - Web/iOS: the unsupported stub.
 *
 * The net capability (TN-188) supersedes fetchText when it lands.
 */
import type { CapabilityResult, CapabilityFailure } from "./capability";
import { unsupportedFailure } from "./capability";

export type MediaState =
  | "idle"
  | "buffering"
  | "ready"
  | "playing"
  | "paused"
  | "ended"
  | "error";

export interface MediaStatus {
  readonly state: MediaState;
  readonly url?: string;
  /** Error detail when state === "error". */
  readonly message?: string;
}

/** Host-pushed state transition, delivered as the MEDIA_STATE action. */
export interface MediaStateEvent {
  readonly type: "MEDIA_STATE";
  readonly state: MediaState;
  readonly url?: string;
  readonly message?: string;
}

export interface MediaCapability {
  readonly contractVersion: 1;

  /** Load a media URL (HLS m3u8 supported) without starting playback. */
  prepare(url: string): Promise<CapabilityResult<MediaStatus>>;
  play(): Promise<CapabilityResult<MediaStatus>>;
  pause(): Promise<CapabilityResult<MediaStatus>>;
  stop(): Promise<CapabilityResult<MediaStatus>>;

  /** Position the video surface, in design units, over the scene. The
   *  rect is opaque: v1 has no scene-graph ordering or clipping across
   *  video (ADR-0028); the Tenun scene composes around it. */
  setRect(x: number, y: number, w: number, h: number): Promise<CapabilityResult<null>>;

  /** Current status snapshot. */
  status(): Promise<CapabilityResult<MediaStatus>>;

  /** Minimal HTTP GET → text (10 s timeout, 2 MB cap). Not a general
   *  fetch: text responses only, no headers/auth/streams. Stopgap
   *  until the net capability (TN-188) lands; playlists are its only
   *  user. */
  fetchText(url: string): Promise<CapabilityResult<string>>;
}

const fail = (failure: CapabilityFailure) => Promise.resolve({ ok: false as const, failure });

/**
 * The fail-closed stub an unprovided media host answers every op with:
 * a structured `unsupported` failure, never a throw, never a fabricated
 * success (04-api/media.md "Fail-closed"). The contract has no
 * availability() to surface the reason, so it rides failure.message —
 * the same place BLE's stub puts it.
 */
export function unsupportedMedia(reason?: string): MediaCapability {
  return {
    contractVersion: 1,
    prepare: () => fail(unsupportedFailure("media", reason)),
    play: () => fail(unsupportedFailure("media", reason)),
    pause: () => fail(unsupportedFailure("media", reason)),
    stop: () => fail(unsupportedFailure("media", reason)),
    setRect: () => fail(unsupportedFailure("media", reason)),
    status: () => fail(unsupportedFailure("media", reason)),
    fetchText: () => fail(unsupportedFailure("media", reason)),
  };
}

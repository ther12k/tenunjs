import { defineAction, defineScreen } from "@tenunjs/core";
import { Column, Container, Expanded, Row, Scaffold, ScrollView, SizedBox, Text } from "@tenunjs/widgets";
import { GAP_SM, SIDEBAR_W, VIDEO_RECT, type FocusState, type NowPlaying } from "../layout";
import type { MediaStatus } from "@tenunjs/platform";
import type { PlaylistEntry } from "../playlist";

/**
 * TN-196 player screen: channel sidebar + video slot + status bar.
 *
 * Geometry is DERIVED (layout.ts): the sidebar column is ALWAYS laid
 * out (an empty box while hidden), so the video slot never moves and
 * VIDEO_RECT — what the runtime asserts via media.setRect and the
 * native TextureView occupies — is exactly the slot the scene draws
 * around. ADR-0028 ceiling: one static rect.
 *
 * The slot carries an idle/error PLACEHOLDER the scene paints; on
 * device the video overlay covers it whenever frames render, so it
 * doubles as the no-signal/error surface.
 *
 * All state arrives via push channels (the runtime owns reality):
 *   "channels" — the playlist + current index
 *   "channel"  — now playing (moves the index on a zap)
 *   "focus"    — sidebar visibility + focused index (TN-194 KEY actions)
 *   "media"    — MEDIA_STATE snapshot
 */
export interface PlayerState {
  channels: readonly PlaylistEntry[];
  index: number;
  now: NowPlaying | null;
  focus: FocusState;
  media: MediaStatus | null;
}

/** Media states in which the current channel is genuinely on air. */
function onAir(media: MediaStatus | null): boolean {
  return media !== null && (media.state === "playing" || media.state === "buffering" || media.state === "paused");
}

function stateLabel(media: MediaStatus | null): { text: string; color: string } {
  switch (media?.state) {
    case "playing":
      return { text: "● LIVE", color: "success" };
    case "buffering":
      return { text: "BUFFERING", color: "warning" };
    case "paused":
      return { text: "PAUSED", color: "textDim" };
    case "error":
      return { text: "ERROR", color: "danger" };
    default:
      return { text: "IDLE", color: "textDim" };
  }
}

/** TV-style two-digit channel number: 1 → "01". */
function channelNo(index: number): string {
  return String(index + 1).padStart(2, "0");
}

/**
 * How many channel rows fit the sidebar column without host scrolling:
 * D-pad focus cannot scroll a host-owned scroll region (no
 * ensure-visible API in v1), so long lists render as a WINDOWED
 * CAROUSEL — the classic TV pattern. The window slides with focus and
 * keeps each row's TRUE channel number.
 */
const CHANNEL_WINDOW = 6;

/** One channel row: number + title, focus/live states styled apart. */
function ChannelRow(props: {
  channel: PlaylistEntry;
  index: number;
  focused: boolean;
  live: boolean;
}) {
  const { channel, index, focused, live } = props;
  return (
    <Container
      color={focused ? "accent" : "surface"}
      radius={12}
      padding="sm"
      borderColor={live && !focused ? "accent" : undefined}
      borderWidth={live && !focused ? 2 : 0}
    >
      <Row gap="md" align="center">
        <Text variant="label" color={focused ? "onPrimaryContainer" : "accent"}>
          {channelNo(index)}
        </Text>
        <Text
          variant={focused ? "label" : "body"}
          color={focused ? "onPrimaryContainer" : live ? "accent" : "text"}
          maxLines={1}
          ellipsis
        >
          {channel.title}
        </Text>
      </Row>
    </Container>
  );
}

/** The idle/error placeholder painted inside the video slot. */
function VideoPlaceholder({ media, now }: { media: MediaStatus | null; now: NowPlaying | null }) {
  if (media?.state === "playing" || media?.state === "paused") {
    // On device the overlay covers the slot with real frames; nothing
    // to draw. (The preview cannot reach these states — its media seam
    // is the fail-closed stub.)
    return <SizedBox height={VIDEO_RECT.h} />;
  }
  const isErr = media?.state === "error";
  const glyph = isErr ? "✕" : media?.state === "buffering" ? "…" : "▶";
  const title = isErr ? "No signal" : now ? `${channelNo(now.index)} · ${now.title}` : "No channel";
  const caption = isErr
    ? (media.message ?? "playback failed")
    : media?.state === "buffering"
      ? now?.title ?? ""
      : "OK opens the channel list";
  return (
    <Container color="surfaceRaised" radius={16} height={VIDEO_RECT.h}>
      <Column align="center" justify="center" gap="md">
        <Text variant="display" color={isErr ? "danger" : "outline"}>
          {glyph}
        </Text>
        <Text variant="title" color={isErr ? "danger" : "text"}>
          {title}
        </Text>
        <Text variant="caption" color="textDim">
          {caption}
        </Text>
      </Column>
    </Container>
  );
}

export const PlayerScreen = defineScreen({
  name: "Player",
  initialState: (): PlayerState => ({
    channels: [],
    index: 0,
    now: null,
    focus: { sidebar: true, index: 0 },
    media: null,
  }),
  actions: {
    channels: defineAction<PlayerState, { channels: readonly PlaylistEntry[]; index: number }>({
      run({ input, state }) {
        state.channels = input.channels;
        state.index = input.index;
      },
    }),
    channel: defineAction<PlayerState, NowPlaying>({
      run({ input, state }) {
        state.now = input;
        // The now-playing line and the live-row highlight read
        // state.index; the "channel" push is what moves it on a zap
        // (the "channels" push only flows on boot / playlist load).
        state.index = input.index;
      },
    }),
    focus: defineAction<PlayerState, FocusState>({
      run({ input, state }) {
        state.focus = input;
      },
    }),
    media: defineAction<PlayerState, MediaStatus>({
      run({ input, state }) {
        state.media = input;
      },
    }),
  },
  view({ state }) {
    const live = state.media !== null && onAir(state.media) ? state.channels[state.index] : null;
    const pill = stateLabel(state.media);
    const count = state.channels.length;
    // The carousel window: slide with focus, clamp at the list's ends,
    // keep true channel numbers.
    const winStart = Math.max(0, Math.min(state.focus.index - 2, count - CHANNEL_WINDOW));
    const window_ = state.channels.slice(winStart, winStart + CHANNEL_WINDOW);
    return (
      <Scaffold>
        <Column padding="lg" gap="md">
          {/* Top bar — brand + accent underline left, state + now
              playing right. */}
          <Row gap="lg" align="center" justify="between">
            <Column gap="sm">
              <Text variant="title" color="text">
                TENUN TV
              </Text>
              <Container color="accent" radius={2} width={128} height={4} />
            </Column>
            <Column align="end" gap="sm">
              <Text variant="label" color={pill.color}>
                {pill.text}
              </Text>
              {state.now && (
                <Text variant="caption" color="textDim" maxLines={1} ellipsis>
                  {`${channelNo(state.now.index)} · ${state.now.title}`}
                </Text>
              )}
            </Column>
          </Row>
          <Row gap={GAP_SM}>
            {/* The sidebar column is ALWAYS reserved so the video slot
                never moves (layout.ts derives VIDEO_RECT from it). */}
            <SizedBox width={SIDEBAR_W} height={VIDEO_RECT.h}>
              {state.focus.sidebar && (
                <Column gap="sm">
                  <Text variant="caption" color="textDim">
                    CHANNELS
                  </Text>
                  {count === 0 && (
                        <Text variant="body" color="textDim">
                          Playlist empty — press → for Settings
                        </Text>
                  )}
                  {count > 0 && (
                    <Column gap="sm">
                      {window_.map((channel, k) => (
                        <ChannelRow
                          channel={channel}
                          index={winStart + k}
                          focused={winStart + k === state.focus.index}
                          live={live !== null && live !== undefined && winStart + k === state.index}
                        />
                      ))}
                    </Column>
                  )}
                </Column>
              )}
            </SizedBox>
            {/* The video slot — exactly VIDEO_RECT. On device the native
                TextureView composites here; the placeholder shows
                through whenever no frames render. */}
            <SizedBox width={VIDEO_RECT.w}>
              <VideoPlaceholder media={state.media} now={state.now} />
            </SizedBox>
          </Row>
          {/* Status line — below the video slot. */}
          <Text variant="caption" color="textDim">
            {state.focus.sidebar
              ? "↑↓ browse · OK watch · ← close · → settings"
              : "↑↓ channels · → settings"}
          </Text>
        </Column>
      </Scaffold>
    );
  },
});

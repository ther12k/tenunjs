import { defineAction, defineScreen } from "@tenunjs/core";
import { Column, Container, Row, Scaffold, ScrollView, SizedBox, Text, Expanded } from "@tenunjs/widgets";
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

/** The idle/error placeholder painted inside the video slot. */
function VideoPlaceholder({ media, now }: { media: MediaStatus | null; now: NowPlaying | null }) {
  if (media?.state === "playing" || media?.state === "paused") {
    // On device the overlay covers the slot with real frames; nothing
    // to draw. (The preview cannot reach these states — its media seam
    // is the fail-closed stub.)
    return <SizedBox height={VIDEO_RECT.h} />;
  }
  const title =
    media?.state === "error"
      ? "No signal"
      : media?.state === "buffering"
        ? "Buffering…"
        : now
          ? now.title
          : "No channel";
  const caption =
    media?.state === "error"
      ? (media.message ?? "playback failed")
      : media?.state === "buffering"
        ? now?.title ?? ""
        : "OK opens the channel list";
  return (
    <Container color="surfaceRaised" radius={12} height={VIDEO_RECT.h}>
      <Column align="center" justify="center" gap="sm">
        <Text variant="headline" color={media?.state === "error" ? "danger" : "textDim"}>
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
    return (
      <Scaffold>
        <Column padding="lg" gap="md">
          {/* Top bar — above VIDEO_RECT.y. */}
          <Row gap="lg" align="center" justify="between">
            <Text variant="title" color="accent">
              Tenun TV
            </Text>
            <Text variant="label" color={pill.color}>
              {pill.text}
            </Text>
          </Row>
          <Row gap={GAP_SM}>
            {/* The sidebar column is ALWAYS reserved so the video slot
                never moves (layout.ts derives VIDEO_RECT from it). */}
            <SizedBox width={SIDEBAR_W} height={VIDEO_RECT.h}>
              {state.focus.sidebar && (
                <ScrollView id="channel-list" gap="sm">
                  {state.channels.length === 0 && (
                    <Text variant="body" color="textDim">
                      Playlist empty — press → for Settings
                    </Text>
                  )}
                  {state.channels.map((channel, i) => {
                    const focused = i === state.focus.index;
                    const isLive = live !== undefined && live !== null && i === state.index;
                    const prefix = focused ? "› " : isLive ? "• " : "";
                    return (
                      <Container
                        color={focused ? "accent" : "surface"}
                        radius={8}
                        padding="sm"
                        borderColor={isLive && !focused ? "accent" : undefined}
                        borderWidth={isLive && !focused ? 2 : 0}
                      >
                        <Text
                          variant={focused ? "label" : "body"}
                          color={focused ? "onPrimaryContainer" : isLive ? "accent" : "textDim"}
                          maxLines={1}
                          ellipsis
                        >
                          {`${prefix}${channel.title}`}
                        </Text>
                      </Container>
                    );
                  })}
                </ScrollView>
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
              ? "↑↓ move · OK play · → settings"
              : "↑↓ zap · OK channels · → settings"}
          </Text>
        </Column>
      </Scaffold>
    );
  },
});

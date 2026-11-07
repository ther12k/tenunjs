import { defineAction, defineScreen } from "@tenunjs/core";
import { Column, Container, Row, Scaffold, ScrollView, SizedBox, Text, Expanded } from "@tenunjs/widgets";
import type { FocusState, NowPlaying } from "../layout";
import { VIDEO_RECT } from "../layout";
import type { MediaStatus } from "@tenunjs/platform";
import type { PlaylistEntry } from "../playlist";

/**
 * TN-196 player screen: channel sidebar + now-playing bar, drawn
 * AROUND the static video rect (ADR-0028 ceiling — the video surface
 * is OUTSIDE the display list, composited over the scene's surface;
 * the region below is deliberately unpainted scene space, because
 * anything the scene draws there would sit hidden behind the video).
 *
 * All state arrives via push channels (the runtime owns reality):
 *   "channels" — the playlist + current index
 *   "channel"  — now playing
 *   "focus"    — sidebar visibility + focused index (the app-level
 *                focus helper's mirror; TN-194 KEY actions decide it)
 *   "media"    — MEDIA_STATE snapshot (buffering/playing/error…)
 */
export interface PlayerState {
  channels: readonly PlaylistEntry[];
  index: number;
  now: NowPlaying | null;
  focus: FocusState;
  media: MediaStatus | null;
}

function statusLine(state: PlayerState): string {
  if (state.media?.state === "error") {
    return `media error: ${state.media.message ?? "unknown"}`;
  }
  const media = state.media ? state.media.state : "idle";
  if (state.focus.sidebar) {
    return `media: ${media}  |  UP/DOWN: move  OK: play  RIGHT: settings`;
  }
  return `media: ${media}  |  UP/DOWN: zap  OK: channels  RIGHT: settings`;
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
    const playing = state.channels[state.index];
    return (
      <Scaffold>
        <Column padding="lg" gap="md">
          {/* Top bar — stays above VIDEO_RECT.y (24 padding + 38 title + 16 gap + margin). */}
          <Row gap="lg" align="center">
            <Text variant="title" color="accent">
              Tenun TV
            </Text>
            <Text variant="label" color="textDim">
              {playing ? `Now playing: ${playing.title}` : "No channel loaded"}
            </Text>
          </Row>
          <Row gap="sm">
            {state.focus.sidebar && (
              <SizedBox width={240} height={VIDEO_RECT.h}>
                <ScrollView id="channel-list" gap="sm">
                  {state.channels.length === 0 && (
                    <Text variant="body" color="textDim">
                      Playlist empty — RIGHT opens Settings
                    </Text>
                  )}
                  {state.channels.map((channel, i) => {
                    const focused = i === state.focus.index;
                    const live = i === state.index;
                    return (
                      <Container
                        color={focused ? "accent" : "surface"}
                        radius={8}
                        padding="sm"
                        borderColor={live ? "outline" : undefined}
                        borderWidth={live ? 2 : 0}
                      >
                        <Text
                          variant={focused ? "label" : "body"}
                          color={focused ? "onPrimaryContainer" : live ? "accent" : "textDim"}
                        >
                          {`${live ? "• " : ""}${channel.title}`}
                        </Text>
                      </Container>
                    );
                  })}
                </ScrollView>
              </SizedBox>
            )}
            {/* The video region — the native TextureView composites
                exactly here (VIDEO_RECT, runtime.ts). The Expanded
                SizedBox reserves the space; the scene paints nothing
                inside it (ADR-0028 documented ceiling). */}
            <Expanded flex={1}>
              <SizedBox height={VIDEO_RECT.h} />
            </Expanded>
          </Row>
          {/* Status line — below the video rect. */}
          <Text variant="caption" color={state.media?.state === "error" ? "danger" : "textDim"}>
            {statusLine(state)}
          </Text>
        </Column>
      </Scaffold>
    );
  },
});

import { defineAction, defineScreen } from "@tenunjs/core";
import {
  AppBar,
  Card,
  Column,
  Row,
  Scaffold,
  Text,
} from "@tenunjs/widgets";
import { CanvasBox, IconButton, ListTile, TrackBar } from "@tenunjs-examples/ui-kit";

/**
 * Music player module — the classic "now playing" pattern: gradient album
 * tile, seek bar with time labels, a transport control row (shuffle,
 * prev, big play/pause, next, repeat), and an up-next queue. Every control
 * is a real action: play/pause, track skipping, seek-by-tap, and queue
 * selection.
 */
export interface Track {
  readonly title: string;
  readonly artist: string;
  readonly durationSec: number;
  readonly glyph: string;
}

export interface MusicState {
  readonly playing: boolean;
  readonly trackIndex: number;
  readonly positionSec: number;
  readonly shuffle: boolean;
  readonly repeat: boolean;
  readonly queue: readonly Track[];
}

function fmt(totalSec: number): string {
  const m = Math.floor(totalSec / 60);
  const s = Math.floor(totalSec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export const MusicScreen = defineScreen({
  name: "Music",

  initialState: (): MusicState => ({
    playing: false,
    trackIndex: 0,
    positionSec: 72,
    shuffle: false,
    repeat: false,
    queue: [
      { title: "Tenun Threads", artist: "The Weavers", durationSec: 214, glyph: "🧵" },
      { title: "Ikat Nights", artist: "Desert Loom", durationSec: 187, glyph: "🌙" },
      { title: "Songket Silver", artist: "Coastal Warp", durationSec: 243, glyph: "✨" },
      { title: "Batik Bloom", artist: "Wax & Dye", durationSec: 198, glyph: "🌺" },
    ],
  }),

  actions: {
    playPause: defineAction<MusicState, void>({
      run({ state }) {
        (state as unknown as { playing: boolean }).playing = !state.playing;
      },
    }),

    next: defineAction<MusicState, void>({
      run({ state }) {
        (state as unknown as { trackIndex: number }).trackIndex =
          (state.trackIndex + 1) % state.queue.length;
        (state as unknown as { positionSec: number }).positionSec = 0;
      },
    }),

    prev: defineAction<MusicState, void>({
      run({ state }) {
        (state as unknown as { trackIndex: number }).trackIndex =
          (state.trackIndex - 1 + state.queue.length) % state.queue.length;
        (state as unknown as { positionSec: number }).positionSec = 0;
      },
    }),

    /** Seeks to a 0..1 fraction of the current track (TrackBar buckets). */
    seek: defineAction<MusicState, number>({
      run({ input, state }) {
        const ratio = Math.max(0, Math.min(1, input));
        const track = state.queue[state.trackIndex]!;
        (state as unknown as { positionSec: number }).positionSec =
          Math.round(ratio * track.durationSec);
      },
    }),

    toggleShuffle: defineAction<MusicState, void>({
      run({ state }) {
        (state as unknown as { shuffle: boolean }).shuffle = !state.shuffle;
      },
    }),

    toggleRepeat: defineAction<MusicState, void>({
      run({ state }) {
        (state as unknown as { repeat: boolean }).repeat = !state.repeat;
      },
    }),

    selectTrack: defineAction<MusicState, number>({
      run({ input, state }) {
        if (input < 0 || input >= state.queue.length) return;
        (state as unknown as { trackIndex: number }).trackIndex = input;
        (state as unknown as { positionSec: number }).positionSec = 0;
      },
    }),
  },

  view({ state, actions }) {
    const track = state.queue[state.trackIndex]!;
    const ratio = track.durationSec > 0 ? state.positionSec / track.durationSec : 0;

    return (
      <Scaffold appBar={<AppBar title="Music" />}>
        <Column padding="lg" gap="lg">
          <Card padding="lg" radius="lg" background="surfaceRaised">
            <Column gap="md">
              <Row gap="sm" justify="center">
                <AlbumTile glyph={track.glyph} playing={state.playing} />
              </Row>
              <Column gap="xs">
                <Text variant="title">{track.title}</Text>
                <Text variant="body" color="#9AA3B2">{track.artist}</Text>
              </Column>
              <TrackBar ratio={ratio} onSeek={(next) => actions.seek(next)} />
              <Row gap="sm" justify="between">
                <Text variant="body" color="#9AA3B2">{fmt(state.positionSec)}</Text>
                <Text variant="body" color="#9AA3B2">-{fmt(Math.max(track.durationSec - state.positionSec, 0))}</Text>
              </Row>
              <Row gap="md" justify="center">
                <IconButton
                  glyph="🔀"
                  size={48}
                  color={state.shuffle ? "#3DD68C" : "#9AA3B2"}
                  onPress={() => actions.toggleShuffle()}
                />
                <IconButton glyph="⏮" size={56} onPress={() => actions.prev()} />
                <IconButton
                  glyph={state.playing ? "⏸" : "▶"}
                  size={76}
                  glyphSize={30}
                  variant="filled"
                  onPress={() => actions.playPause()}
                />
                <IconButton glyph="⏭" size={56} onPress={() => actions.next()} />
                <IconButton
                  glyph="🔁"
                  size={48}
                  color={state.repeat ? "#3DD68C" : "#9AA3B2"}
                  onPress={() => actions.toggleRepeat()}
                />
              </Row>
            </Column>
          </Card>

          <Column gap="sm">
            <Text variant="title">Up next</Text>
            {state.queue.map((item, index) => (
              <ListTile
                key={item.title}
                leading={<IconButton glyph={item.glyph} size={44} glyphSize={20} variant={index === state.trackIndex ? "filled" : "tonal"} />}
                title={item.title}
                subtitle={`${item.artist} · ${fmt(item.durationSec)}`}
                trailing={
                  index === state.trackIndex ? (
                    <Text variant="body" color="#3DD68C">Playing</Text>
                  ) : (
                    <Text variant="body" color="#9AA3B2">Play</Text>
                  )
                }
              />
            ))}
          </Column>
        </Column>
      </Scaffold>
    );
  },
});

/** Square gradient "album art" tile with a playing badge. */
function AlbumTile(props: { glyph: string; playing: boolean }) {
  const size = 260;
  return (
    <CanvasBox
      height={size}
      width={size}
      paint={(origin, put) => {
        put({ op: "gradient", x: 0, y: 0, w: size, h: size, r: 24, color: "#3A2E5C", colorTo: "#14182B", shadow: 16 });
        put({ op: "text", x: size / 2 - 30, y: size / 2 + 34, text: props.glyph, size: 60, weight: 400, color: "#F2F2F7" });
        if (props.playing) {
          put({ op: "circle", cx: size - 36, cy: 36, r: 12, color: "#3DD68C" });
        }
      }}
    />
  );
}

import { defineAction, defineScreen } from "@tenunjs/core";
import { Column, Container, GestureDetector, Row, Scaffold, SizedBox, Text } from "@tenunjs/widgets";
import {
  GAP_SM,
  SIDEBAR_W,
  VIDEO_RECT,
  VIDEO_RECT_PHONE,
  type FocusState,
  type FormFactor,
  type NowPlaying,
} from "../layout";
import { groupColor } from "../theme";
import type { MediaStatus } from "@tenunjs/platform";
import type { PlaylistEntry } from "../playlist";

/**
 * TN-196 player screen: group chips + channel carousel + video slot.
 *
 * Geometry is DERIVED (layout.ts): the sidebar column is ALWAYS laid
 * out (an empty box while hidden), so the video slot never moves and
 * VIDEO_RECT — what the runtime asserts via media.setRect and the
 * native TextureView occupies — is exactly the slot the scene draws
 * around. ADR-0028 ceiling: one static rect.
 *
 * Grouping (the reference UI's shape): chips [All + groups] filter the
 * list; switching groups NEVER interrupts playback (the runtime tracks
 * the playing channel by url, not by filtered index). The scene has no
 * image op in v1, so channel logos become GROUP-COLORED number tiles.
 *
 * All state arrives via push channels (the runtime owns reality):
 *   "form"/"channels" (visible list + groups + active)/"channel"/"focus"/"media"
 */
export interface PlayerState {
  form: FormFactor;
  channels: readonly PlaylistEntry[];
  groups: readonly string[];
  activeGroup: string | null;
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
const CHANNEL_WINDOW = 5;

/** The group chips: [All, …groups]; focus/active styling per chip. */
function GroupChips(props: {
  groups: readonly string[];
  activeGroup: string | null;
  focusedChip: number | null;
  compact?: boolean;
  onPick?: (group: string | null) => void;
}) {
  const { groups, activeGroup, focusedChip, compact, onPick } = props;
  const chips: Array<string | null> = [null, ...groups]; // null = All
  return (
    <Row gap="sm">
      {chips.map((group, i) => {
        const active = (group ?? null) === activeGroup;
        const focused = focusedChip === i;
        const chip = (
          <Container
            color={focused ? "accent" : active ? "secondaryContainer" : "surface"}
            radius={14}
            padding={compact ? "sm" : "sm"}
            borderColor={active && !focused ? "accent" : undefined}
            borderWidth={active && !focused ? 2 : 0}
          >
            <Text
              variant="caption"
              color={focused ? "onPrimaryContainer" : active ? "onSecondaryContainer" : "textDim"}
            >
              {group ?? "Semua"}
            </Text>
          </Container>
        );
        return onPick ? (
          <GestureDetector key={group ?? "__all__"} onTap={() => onPick(group ?? null)}>
            {chip}
          </GestureDetector>
        ) : (
          chip
        );
      })}
    </Row>
  );
}

/** One channel row: group-colored number tile + title. */
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
        <Container color={groupColor(channel.group)} radius={8} width={40} height={40}>
          <Column align="center" justify="center">
            <Text variant="label" color="#101014">
              {channelNo(index)}
            </Text>
          </Column>
        </Container>
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
    return <SizedBox height={media.state === "playing" ? VIDEO_RECT.h : VIDEO_RECT.h} />;
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
    form: "tv",
    channels: [],
    groups: [],
    activeGroup: null,
    index: 0,
    now: null,
    focus: { index: 0, zone: "rows" },
    media: null,
  }),
  actions: {
    form: defineAction<PlayerState, FormFactor>({
      run({ input, state }) {
        state.form = input;
      },
    }),
    channels: defineAction<
      PlayerState,
      { channels: readonly PlaylistEntry[]; groups: readonly string[]; activeGroup: string | null }
    >({
      run({ input, state }) {
        state.channels = input.channels;
        state.groups = input.groups;
        state.activeGroup = input.activeGroup;
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
    /** Phone list tap: select + play this channel. */
    select: defineAction<PlayerState, number>({
      run({ input, services }) {
        (services as { select?: (index: number) => void }).select?.(input);
      },
    }),
    /** Phone chip tap: switch the group filter (playback untouched). */
    setGroup: defineAction<PlayerState, string | null>({
      run({ input, services }) {
        (services as { setGroup?: (group: string | null) => void }).setGroup?.(input);
      },
    }),
  },
  view({ state, actions }) {
    const liveVisible =
      state.media !== null && onAir(state.media)
        ? state.channels.find((c) => c.url === state.now?.url) // visible only
        : null;
    const pill = stateLabel(state.media);
    const count = state.channels.length;
    // The carousel window: slide with focus, clamp at the list's ends,
    // keep true channel numbers.
    const winStart = Math.max(0, Math.min(state.focus.index - 2, count - CHANNEL_WINDOW));
    const window_ = state.channels.slice(winStart, winStart + CHANNEL_WINDOW);
    const onChips = state.focus.zone === "chips";
    const focusedChip = onChips ? state.focus.index : null;

    if (state.form === "phone") {
      // Phone: video hero on top (full-bleed 16:9), chrome and the
      // tappable channel list below. The remote is optional — rows and
      // chips are tapped directly; ↑/↓/OK still work with a keyboard.
      return (
        <Scaffold>
          <Column gap="md">
            {/* The video slot — exactly VIDEO_RECT_PHONE. On device the
                native TextureView composites here; the placeholder
                shows through whenever no frames render. */}
            <SizedBox width={VIDEO_RECT_PHONE.w} height={VIDEO_RECT_PHONE.h}>
              <VideoPlaceholder media={state.media} now={state.now} />
            </SizedBox>
            <Column padding="md" gap="md">
              <Row gap="md" align="center" justify="between">
                <Column gap="sm">
                  <Text variant="label" color="text">
                    TENUN TV
                  </Text>
                  <Container color="accent" radius={2} width={72} height={3} />
                </Column>
                <Column align="end" gap="sm">
                  <Text variant="caption" color={pill.color}>
                    {pill.text}
                  </Text>
                  {state.now && (
                    <Text variant="caption" color="textDim" maxLines={1} ellipsis>
                      {`${channelNo(state.now.index)} · ${state.now.title}`}
                    </Text>
                  )}
                </Column>
              </Row>
              <GroupChips
                groups={state.groups}
                activeGroup={state.activeGroup}
                focusedChip={focusedChip}
                compact
                onPick={(g) => actions.setGroup(g)}
              />
              <Text variant="caption" color="textDim">
                {`${count} CHANNEL${count === 1 ? "" : "S"} · ${state.activeGroup ?? "Semua"}`}
              </Text>
              {count === 0 && (
                <Text variant="body" color="textDim">
                  Playlist empty — open Settings to load one
                </Text>
              )}
              <Column gap="sm">
                {window_.map((channel, k) => {
                  const i = winStart + k;
                  return (
                    <GestureDetector key={channel.url} onTap={() => actions.select(i)}>
                      <ChannelRow
                        channel={channel}
                        index={i}
                        focused={i === state.focus.index}
                        live={liveVisible !== null && liveVisible !== undefined && channel.url === liveVisible.url}
                      />
                    </GestureDetector>
                  );
                })}
              </Column>
            </Column>
          </Column>
        </Scaffold>
      );
    }

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
            {/* The channel list column — ALWAYS visible beside the
                video (the reference shape); VIDEO_RECT derives from it
                so the slot never moves. */}
            <SizedBox width={SIDEBAR_W} height={VIDEO_RECT.h}>
              <Column gap="sm">
                <GroupChips
                  groups={state.groups}
                  activeGroup={state.activeGroup}
                  focusedChip={focusedChip}
                />
                {count === 0 && (
                  <Text variant="body" color="textDim">
                    Playlist empty — press → for Settings
                  </Text>
                )}
                {count > 0 && (
                  <Column gap="sm">
                    {window_.map((channel, k) => (
                      <ChannelRow
                        key={channel.url}
                        channel={channel}
                        index={winStart + k}
                        focused={winStart + k === state.focus.index}
                        live={
                          liveVisible !== null &&
                          liveVisible !== undefined &&
                          channel.url === liveVisible.url
                        }
                      />
                    ))}
                  </Column>
                )}
              </Column>
            </SizedBox>
            {/* The video slot — exactly VIDEO_RECT. On device the native
                TextureView composites here; the placeholder shows
                through whenever no frames render. */}
            <SizedBox width={VIDEO_RECT.w}>
              <VideoPlaceholder media={state.media} now={state.now} />
            </SizedBox>
          </Row>
          {/* Status line — count + group left, key hints right. */}
          <Row justify="between">
            <Text variant="caption" color="textDim">
              {`${count} CHANNEL${count === 1 ? "" : "S"} · ${state.activeGroup ?? "Semua"}`}
            </Text>
            <Text variant="caption" color="textDim">
              {onChips ? "←→ group · ↓ channels" : "↑↓ browse · OK watch · ↑ chips · → settings"}
            </Text>
          </Row>
        </Column>
      </Scaffold>
    );
  },
});

import { defineAction, defineScreen } from "@tenunjs/core";
import { Column, Container, GestureDetector, Row, Scaffold, SizedBox, Text } from "@tenunjs/widgets";
import {
  CARD_H,
  CARD_W,
  CARDS_VISIBLE,
  DESIGN_HEIGHT,
  FULLSCREEN_RECT,
  RAIL_W,
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
 * TN-196 player screen — the IPTV reference shape: a narrow icon RAIL
 * on the left, the VIDEO as a huge hero right of it, the group TABS
 * and a horizontal row of channel CARDS below (the list stays visible;
 * only its arrangement changed from the BitTV-style sidebar).
 *
 * Geometry is DERIVED (layout.ts): VIDEO_RECT — what the runtime
 * asserts via media.setRect and the native TextureView occupies — is
 * exactly the hero slot the scene draws around. ADR-0028 ceiling: one
 * static rect (browse hero ↔ fullscreen pair on navigation).
 *
 * Grouping: tabs [All + groups] filter the cards; switching groups
 * NEVER interrupts playback (the runtime tracks the playing channel by
 * url, not by filtered index). The scene has no image op in v1, so
 * channel logos become GROUP-COLORED number tiles.
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
  /** Local wall clock "HH.MM" (the reference's top-right time; pushed
   *  by the runtime's minute-aligned tick). */
  clock: string;
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
 * D-pad focus cannot scroll a host-owned scroll region (no
 * ensure-visible API in v1), so long lists render as WINDOWED CAROUSELS
 * — the classic TV pattern; the window slides with the cursor and keeps
 * TRUE channel numbers. The TV cards run horizontally (6 visible), the
 * phone list keeps its vertical 5-row window.
 */
const PHONE_ROWS = 5;

/** The left icon rail: brand tile + nav items (the reference's left
 *  edge). Items are [Live, Settings]; focus comes from the runtime's
 *  rail zone (focus.index 0/1). Glyphs are text — the scene has no
 *  image op in v1. */
function Rail(props: { focusedItem: number | null }) {
  const items: Array<{ glyph: string; label: string }> = [
    { glyph: "▶", label: "Live" },
    { glyph: "≡", label: "Set" },
  ];
  return (
    <Container width={RAIL_W} height={DESIGN_HEIGHT} color="surface">
      <Column align="center" padding="sm" gap="md">
        {/* Brand tile */}
        <Container color="accent" radius={10} width={44} height={44}>
          <Column align="center" justify="center">
            <Text variant="label" color="onPrimaryContainer">
              NT
            </Text>
          </Column>
        </Container>
        <Text variant="caption" color="textDim">
          NUSA TV
        </Text>
        {items.map((item, i) => {
          const focused = props.focusedItem === i;
          return (
            <Column key={item.label} align="center" gap="sm">
              <Container
                color={focused ? "accent" : "surfaceRaised"}
                radius={10}
                width={44}
                height={44}
              >
                <Column align="center" justify="center">
                  <Text variant="label" color={focused ? "onPrimaryContainer" : "textDim"}>
                    {item.glyph}
                  </Text>
                </Column>
              </Container>
              <Text variant="caption" color={focused ? "text" : "textDim"}>
                {item.label}
              </Text>
            </Column>
          );
        })}
      </Column>
    </Container>
  );
}

/**
 * The group tabs: [All, …groups]; focus/active styling per chip.
 * `perRow` wraps long chip sets (the scene has no flex-wrap in v1, so
 * the chunks are explicit) — the TV form spans one full-width row under
 * the hero; the phone form wraps at two per row.
 */
function GroupChips(props: {
  groups: readonly string[];
  activeGroup: string | null;
  focusedChip: number | null;
  perRow?: number;
  onPick?: (group: string | null) => void;
}) {
  const { groups, activeGroup, focusedChip, perRow, onPick } = props;
  const chips: Array<string | null> = [null, ...groups]; // null = All
  const rows: Array<Array<string | null>> = [];
  if (perRow === undefined) {
    rows.push(chips);
  } else {
    for (let i = 0; i < chips.length; i += perRow) rows.push(chips.slice(i, i + perRow));
  }
  let i = 0; // chip index across the wrapped rows
  return (
    <Column gap="sm">
      {rows.map((row, r) => (
        <Row key={r} gap="sm">
          {row.map((group) => {
            const chipIndex = i++;
            const active = (group ?? null) === activeGroup;
            const focused = focusedChip === chipIndex;
            const chip = (
              <Container
                color={focused ? "accent" : active ? "secondaryContainer" : "surface"}
                radius={14}
                padding="sm"
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
      ))}
    </Column>
  );
}

/** One phone-list row: group-colored number tile + title. */
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
            <Text variant="label" color="#FFFFFF">
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

/** One TV card (the reference's poster-card shape): a group-colored
 *  number tile on top, the title below — CARD_W×CARD_H. */
function ChannelCard(props: {
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
      width={CARD_W}
      height={CARD_H}
      borderColor={live && !focused ? "accent" : undefined}
      borderWidth={live && !focused ? 2 : 0}
    >
      <Column>
        <Container color={groupColor(channel.group)} radius={12} width={CARD_W} height={64}>
          <Column align="center" justify="center">
            <Text variant="title" color="#FFFFFF">
              {channelNo(index)}
            </Text>
          </Column>
        </Container>
        <Column padding="sm">
          <Text
            variant="caption"
            color={focused ? "onPrimaryContainer" : live ? "accent" : "text"}
            maxLines={1}
            ellipsis
          >
            {channel.title}
          </Text>
        </Column>
      </Column>
    </Container>
  );
}

/**
 * The idle/error placeholder painted inside the video slot — the
 * reference's "now watching" block: the channel's GROUP-COLORED number
 * tile (the card tile, enlarged) beside its title and state caption.
 * Idle, it previews the CARD cursor so the slot reads as the
 * about-to-play channel, not a dead box. Height is a prop — the same
 * placeholder paints the hero, the phone slot, and the fullscreen rect.
 */
function VideoPlaceholder(props: {
  media: MediaStatus | null;
  now: NowPlaying | null;
  h: number;
  channel?: PlaylistEntry | null;
  no?: string | null;
}) {
  const { media, now, h, channel, no } = props;
  if (media?.state === "playing" || media?.state === "paused") {
    // On device the overlay covers the slot with real frames; nothing
    // to draw. (The preview cannot reach these states — its media seam
    // is the fail-closed stub.)
    return <SizedBox height={h} />;
  }
  const isErr = media?.state === "error";
  const buffering = media?.state === "buffering";
  const tileColor = isErr ? "danger" : channel ? groupColor(channel.group) : "outline";
  const tileText = isErr ? "✕" : buffering ? "…" : (no ?? "–");
  const title = isErr ? "No signal" : channel ? channel.title : (now?.title ?? "No channel");
  const caption = isErr
    ? (media.message ?? "playback failed")
    : buffering
      ? "Buffering…"
      : channel
        ? "OK to watch"
        : "OK opens the channel list";
  return (
    <Container color="surfaceRaised" radius={16} height={h}>
      <Column align="center" justify="center" gap="md">
        <Row gap="md" align="center">
          <Container color={tileColor} radius={16} width={72} height={72}>
            <Column align="center" justify="center">
              <Text variant="title" color="#FFFFFF">
                {tileText}
              </Text>
            </Column>
          </Container>
          <Column gap="sm" align="start">
            <Text variant={isErr ? "title" : "headline"} color={isErr ? "danger" : "text"} maxLines={1} ellipsis>
              {title}
            </Text>
            <Text variant="caption" color="textDim" maxLines={1} ellipsis>
              {caption}
            </Text>
          </Column>
        </Row>
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
    focus: { index: 0, cardIndex: 0, zone: "cards", fullscreen: false },
    media: null,
    clock: "",
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
        // The now-playing caption and the live-card highlight read
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
    /** The minute-aligned wall clock push (the runtime's tick). */
    clock: defineAction<PlayerState, string>({
      run({ input, state }) {
        state.clock = input;
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
    const zone = state.focus.zone;
    // The CARD cursor (kept by the runtime even while the ring is on
    // the tabs or the rail) drives the windows and the hero preview.
    const cardIdx = state.focus.cardIndex;
    const tvWinStart = Math.max(0, Math.min(cardIdx - 2, count - CARDS_VISIBLE));
    const cardWindow = state.channels.slice(tvWinStart, tvWinStart + CARDS_VISIBLE);
    const phoneWinStart = Math.max(0, Math.min(cardIdx - 2, count - PHONE_ROWS));
    const phoneWindow = state.channels.slice(phoneWinStart, phoneWinStart + PHONE_ROWS);
    // The focused card — the idle video slot previews it (tile + title),
    // so the placeholder reads as the about-to-play channel.
    const focusedChannel = count > 0 ? state.channels[cardIdx] : undefined;
    const hints: Record<typeof zone, string> = {
      rail: "↑↓ rail · OK open · → tabs",
      tabs: "←→ group · ↓ cards · ↑ rail",
      cards: "←→ channels · OK watch · ↑ tabs",
    };

    // Fullscreen playback: the video overlay covers the screen — the
    // scene renders nothing while frames are on air (any scene op
    // would sit off-screen beside the full-bleed rect). When they are
    // NOT (idle / error / the preview's fail-closed stub), paint the
    // placeholder INSIDE the rect: the video covers it whenever frames
    // render, and a zap that fails in fullscreen stays visible instead
    // of a bare black screen. Any key returns to browse (runtime).
    if (state.form === "tv" && state.focus.fullscreen) {
      if (onAir(state.media)) return <Scaffold />;
      return (
        <Scaffold>
          <SizedBox width={FULLSCREEN_RECT.w} height={FULLSCREEN_RECT.h}>
            <VideoPlaceholder
              media={state.media}
              now={state.now}
              h={FULLSCREEN_RECT.h}
              channel={focusedChannel ?? null}
              no={count > 0 ? channelNo(cardIdx) : null}
            />
          </SizedBox>
        </Scaffold>
      );
    }

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
              <VideoPlaceholder
                media={state.media}
                now={state.now}
                h={VIDEO_RECT_PHONE.h}
                channel={focusedChannel ?? null}
                no={count > 0 ? channelNo(cardIdx) : null}
              />
            </SizedBox>
            <Column padding="md" gap="md">
              <Row gap="md" align="center" justify="between">
                <Column gap="sm">
                  <Text variant="label" color="text">
                    NusaTV
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
                focusedChip={zone === "tabs" ? state.focus.index : null}
                perRow={2}
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
                {phoneWindow.map((channel, k) => {
                  const i = phoneWinStart + k;
                  return (
                    <GestureDetector key={channel.url} onTap={() => actions.select(i)}>
                      <ChannelRow
                        channel={channel}
                        index={i}
                        focused={i === cardIdx}
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
        <Row>
          {/* The icon rail — brand tile + Live/Set (the reference's
              left edge); focusable via the runtime's rail zone. */}
          <Rail focusedItem={zone === "rail" ? state.focus.index : null} />
          {/* The content column: hero → tabs → cards → status. */}
          <Column padding="md" gap="sm">
            {/* The video hero — exactly VIDEO_RECT. On device the
                native TextureView composites here; the placeholder
                shows through whenever no frames render. */}
            <SizedBox width={VIDEO_RECT.w} height={VIDEO_RECT.h}>
              <VideoPlaceholder
                media={state.media}
                now={state.now}
                h={VIDEO_RECT.h}
                channel={focusedChannel ?? null}
                no={count > 0 ? channelNo(cardIdx) : null}
              />
            </SizedBox>
            {/* The group tabs — the wall clock on the right (the
                reference's top-right time; the active group is already
                the highlighted chip); switching groups NEVER interrupts
                playback. */}
            <Row justify="between" align="center">
              <GroupChips
                groups={state.groups}
                activeGroup={state.activeGroup}
                focusedChip={zone === "tabs" ? state.focus.index : null}
              />
              {state.clock !== "" && (
                <Text variant="label" color="text">
                  {state.clock}
                </Text>
              )}
            </Row>
            {/* The horizontal channel cards — ALWAYS visible under the
                hero; the window slides with the card cursor. */}
            {count === 0 ? (
              <Text variant="body" color="textDim">
                Playlist empty — rail → Set to load one
              </Text>
            ) : (
              <Row gap="sm">
                {cardWindow.map((channel, k) => {
                  const i = tvWinStart + k;
                  return (
                    <ChannelCard
                      key={channel.url}
                      channel={channel}
                      index={i}
                      focused={zone === "cards" && i === state.focus.index}
                      live={
                        liveVisible !== null &&
                        liveVisible !== undefined &&
                        channel.url === liveVisible.url
                      }
                    />
                  );
                })}
              </Row>
            )}
            {/* Status line — state + now playing left (the full width
                keeps long titles readable), count + key hints right. */}
            <Row justify="between">
              <Text variant="caption" color={pill.color} maxLines={1} ellipsis>
                {state.now
                  ? `${pill.text} · ${channelNo(state.now.index)} · ${state.now.title}`
                  : `NusaTV · ${pill.text}`}
              </Text>
              <Text variant="caption" color="textDim" maxLines={1} ellipsis>
                {`${count} CHANNEL${count === 1 ? "" : "S"} · ${hints[zone]}`}
              </Text>
            </Row>
          </Column>
        </Row>
      </Scaffold>
    );
  },
});

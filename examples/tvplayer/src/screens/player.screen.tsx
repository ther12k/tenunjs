import { defineAction, defineScreen } from "@tenunjs/core";
import { Column, Container, GestureDetector, Row, Scaffold, SizedBox, Text } from "@tenunjs/widgets";
import {
  DESIGN_HEIGHT,
  FULLSCREEN_RECT,
  HEADER_H,
  RAIL_W,
  ROW_H,
  SIDEBAR_VISIBLE,
  SIDEBAR_W,
  VIDEO_RECT,
  VIDEO_RECT_PHONE,
  buildSidebarRows,
  type FocusState,
  type FormFactor,
  type NowPlaying,
} from "../layout";
import { groupColor } from "../theme";
import type { MediaStatus } from "@tenunjs/platform";
import type { PlaylistEntry } from "../playlist";

/**
 * TN-196 player screen — the NusaTV web Studio shape, remote-first: a
 * narrow icon RAIL on the left, the category-accordion SIDEBAR (the
 * web's collapsible groups walked with ↑↓, OK toggles/plays), and the
 * VIDEO hero filling the remaining width.
 *
 * Geometry is DERIVED (layout.ts): VIDEO_RECT — what the runtime
 * asserts via media.setRect and the native TextureView occupies — is
 * exactly the hero slot the scene draws around. ADR-0028 ceiling: one
 * static rect (browse hero ↔ fullscreen pair on navigation).
 *
 * All state arrives via push channels (the runtime owns reality):
 *   "form"/"channels" (visible list + groups + expanded)/"channel"/
 *   "focus"/"media"
 */
export interface PlayerState {
  form: FormFactor;
  channels: readonly PlaylistEntry[];
  groups: readonly string[];
  activeGroup: string | null;
  /** TV accordion: which groups are expanded (all by default). */
  expanded: readonly string[];
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
 * ensure-visible API in v1), so the sidebar renders as a WINDOWED list
 * — the window slides with the cursor and keeps TRUE channel numbers.
 * The phone form keeps its vertical 5-row window below the video.
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
 * The phone group chips: [All, …groups]; focus/active styling per chip.
 * `perRow` wraps long chip sets (the scene has no flex-wrap in v1, so
 * the chunks are explicit). TV has no chips — the sidebar accordion IS
 * the group navigation there.
 */
function GroupChips(props: {
  groups: readonly string[];
  activeGroup: string | null;
  perRow: number;
  onPick: (group: string | null) => void;
}) {
  const { groups, activeGroup, perRow, onPick } = props;
  const chips: Array<string | null> = [null, ...groups]; // null = All
  const rows: Array<Array<string | null>> = [];
  for (let i = 0; i < chips.length; i += perRow) rows.push(chips.slice(i, i + perRow));
  return (
    <Column gap="sm">
      {rows.map((row, r) => (
        <Row key={r} gap="sm">
          {row.map((group) => {
            const active = (group ?? null) === activeGroup;
            const chip = (
              <Container
                color={active ? "secondaryContainer" : "surface"}
                radius={14}
                padding="sm"
                borderColor={active ? "accent" : undefined}
                borderWidth={active ? 2 : 0}
              >
                <Text variant="caption" color={active ? "onSecondaryContainer" : "textDim"}>
                  {group ?? "Semua"}
                </Text>
              </Container>
            );
            return (
              <GestureDetector key={group ?? "__all__"} onTap={() => onPick(group ?? null)}>
                {chip}
              </GestureDetector>
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

/**
 * The TV category-accordion sidebar — the web ChannelList's D-pad
 * translation. One flat column of windowed rows: group HEADERS
 * (chevron + title + count, ● when the live channel plays inside) and
 * the expanded groups' CHANNEL rows (number tile + title). Focus is
 * the runtime's list cursor; OK on a header collapses/expands, OK on a
 * channel watches it fullscreen (the runtime decides — the screen only
 * paints).
 */
function Sidebar(props: {
  channels: readonly PlaylistEntry[];
  expanded: readonly string[];
  listIndex: number;
  focused: boolean;
  liveUrl: string | null;
  liveGroup: string | null;
}) {
  const { channels, expanded, listIndex, focused, liveUrl, liveGroup } = props;
  const rows = buildSidebarRows(channels, new Set(expanded));
  const winStart = Math.max(0, Math.min(listIndex - 2, rows.length - SIDEBAR_VISIBLE));
  const window = rows.slice(winStart, winStart + SIDEBAR_VISIBLE);
  return (
    <Container width={SIDEBAR_W} height={DESIGN_HEIGHT} color="surface">
      <Column padding="sm" gap="sm">
        {window.map((row, k) => {
          const i = winStart + k;
          const isFocused = focused && i === listIndex;
          if (row.type === "header") {
            const isOpen = expanded.includes(row.group);
            const count = channels.filter((c) => (c.group || "") === row.group).length;
            return (
              <Container
                key={`h:${row.group}`}
                color={isFocused ? "accent" : "surfaceRaised"}
                radius={10}
                width={SIDEBAR_W - 16}
                height={HEADER_H}
              >
                <Row gap="sm" align="center" padding="sm">
                  <Text variant="caption" color={isFocused ? "onPrimaryContainer" : "textDim"}>
                    {isOpen ? "▾" : "▸"}
                  </Text>
                  <Text
                    variant="caption"
                    color={isFocused ? "onPrimaryContainer" : "text"}
                    maxLines={1}
                    ellipsis
                  >
                    {row.group === "" ? "Lainnya" : row.group}
                  </Text>
                  <Text variant="caption" color={isFocused ? "onPrimaryContainer" : "textDim"}>
                    {`${count}`}
                  </Text>
                  {liveGroup === row.group && (
                    <Text variant="caption" color={isFocused ? "onPrimaryContainer" : "accent"}>
                      ●
                    </Text>
                  )}
                </Row>
              </Container>
            );
          }
          const live = liveUrl !== null && row.channel.url === liveUrl;
          return (
            <Container
              key={row.channel.url}
              color={isFocused ? "accent" : "background"}
              radius={10}
              width={SIDEBAR_W - 16}
              height={ROW_H}
              borderColor={live && !isFocused ? "accent" : undefined}
              borderWidth={live && !isFocused ? 2 : 0}
            >
              <Row gap="sm" align="center" padding="sm">
                <Container color={groupColor(row.group)} radius={8} width={28} height={28}>
                  <Column align="center" justify="center">
                    <Text variant="caption" color="#FFFFFF">
                      {channelNo(row.index)}
                    </Text>
                  </Column>
                </Container>
                <Text
                  variant="caption"
                  color={isFocused ? "onPrimaryContainer" : live ? "accent" : "text"}
                  maxLines={1}
                  ellipsis
                >
                  {row.channel.title}
                </Text>
              </Row>
            </Container>
          );
        })}
      </Column>
    </Container>
  );
}

/**
 * The idle/error placeholder painted inside the video slot — the
 * reference's "now watching" block: the channel's GROUP-COLORED number
 * tile beside its title and state caption. Idle, it previews the
 * FOCUSED row's channel so the slot reads as the about-to-play
 * channel, not a dead box. Height is a prop — the same placeholder
 * paints the hero, the phone slot, and the fullscreen rect.
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
    expanded: [],
    index: 0,
    now: null,
    focus: { index: 0, listIndex: 0, zone: "list", fullscreen: false },
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
      {
        channels: readonly PlaylistEntry[];
        groups: readonly string[];
        activeGroup: string | null;
        expanded: readonly string[];
      }
    >({
      run({ input, state }) {
        state.channels = input.channels;
        state.groups = input.groups;
        state.activeGroup = input.activeGroup;
        state.expanded = input.expanded;
      },
    }),
    channel: defineAction<PlayerState, NowPlaying>({
      run({ input, state }) {
        state.now = input;
        // The now-playing caption and the live-row highlight read
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
    // The list cursor (kept by the runtime even while the ring is on
    // the rail) drives the sidebar/phone windows and the hero preview.
    const listIdx = state.focus.listIndex;
    const phoneWinStart = Math.max(0, Math.min(listIdx - 2, count - PHONE_ROWS));
    const phoneWindow = state.channels.slice(phoneWinStart, phoneWinStart + PHONE_ROWS);
    const hints: Record<typeof zone, string> = {
      rail: "↑↓ rail · OK open · → list",
      list: "↑↓ channels · OK watch/collapse · ← rail",
    };

    // The focused sidebar row's channel — the idle video slot previews
    // it (tile + title), so the placeholder reads as the about-to-play
    // channel. A focused HEADER previews its group's first channel.
    const tvRows = buildSidebarRows(state.channels, new Set(state.expanded));
    const focusedRow = tvRows[listIdx];
    const previewChannel =
      focusedRow === undefined
        ? null
        : focusedRow.type === "channel"
          ? focusedRow.channel
          : (state.channels.find((c) => (c.group || "") === focusedRow.group) ?? null);
    const previewNo =
      focusedRow !== undefined && focusedRow.type === "channel"
        ? channelNo(focusedRow.index)
        : previewChannel
          ? channelNo(state.channels.indexOf(previewChannel))
          : null;

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
              channel={previewChannel ?? null}
              no={previewNo}
            />
          </SizedBox>
        </Scaffold>
      );
    }

    if (state.form === "phone") {
      const focusedPhone = count > 0 ? state.channels[listIdx] : undefined;
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
                channel={focusedPhone ?? null}
                no={count > 0 ? channelNo(listIdx) : null}
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
                        focused={i === listIdx}
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

    // TV browse: rail | accordion sidebar | video hero + status.
    return (
      <Scaffold>
        <Row>
          {/* The icon rail — brand tile + Live/Set (the reference's
              left edge); focusable via the runtime's rail zone. */}
          <Rail focusedItem={zone === "rail" ? state.focus.index : null} />
          {/* The category accordion — the web ChannelList's D-pad
              translation (headers toggle with OK; rows watch). */}
          <Sidebar
            channels={state.channels}
            expanded={state.expanded}
            listIndex={listIdx}
            focused={zone === "list"}
            liveUrl={liveVisible?.url ?? null}
            liveGroup={liveVisible ? (liveVisible.group || "") : null}
          />
          {/* The content column: hero → status. */}
          <Column padding="md" gap="sm">
            {/* The wall clock (the reference's top-right time). */}
            {state.clock !== "" && (
              <Row justify="end">
                <Text variant="label" color="text">
                  {state.clock}
                </Text>
              </Row>
            )}
            {/* The video hero — exactly VIDEO_RECT. On device the
                native TextureView composites here; the placeholder
                shows through whenever no frames render. */}
            <SizedBox width={VIDEO_RECT.w} height={VIDEO_RECT.h}>
              <VideoPlaceholder
                media={state.media}
                now={state.now}
                h={VIDEO_RECT.h}
                channel={previewChannel ?? null}
                no={previewNo}
              />
            </SizedBox>
            {/* Status block — the pill + now-playing caption gets the
                full row (the narrower hero elided the old single-line
                pair into "NusaTV ·…"), count + key hints below. */}
            <Column gap="sm">
              <Row justify="between">
                <Text variant="caption" color={pill.color} maxLines={1} ellipsis>
                  {state.now
                    ? `${pill.text} · ${channelNo(state.now.index)} · ${state.now.title}`
                    : `NusaTV · ${pill.text}`}
                </Text>
                {count > 0 && (
                  <Text variant="caption" color="textDim">
                    {`${count} CH`}
                  </Text>
                )}
              </Row>
              <Text variant="caption" color="textDim" maxLines={1} ellipsis>
                {count === 0
                  ? "Playlist empty — rail → Set to load one"
                  : hints[zone]}
              </Text>
            </Column>
          </Column>
        </Row>
      </Scaffold>
    );
  },
});

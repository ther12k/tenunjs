import { defineAction, defineScreen } from "@tenunjs/core";
import { Column, Container, Expanded, GestureDetector, Positioned, Row, Scaffold, SizedBox, Stack, Text, TextField } from "@tenunjs/widgets";
import {
  DESIGN_HEIGHT,
  FAVORITES_GROUP,
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
  /** Favorited urls + whether the "★ Favorit" filter is active (the
   *  phone chip / the TV accordion's pinned section). */
  favorites: readonly string[];
  favoriteOnly: boolean;
  /** "Lanjut Nonton" urls, most-recent-first (phone rail). */
  recents: readonly string[];
  /** Search overlay: open flag (runtime-owned via services so BACK can
   *  close it) + the local query the results filter by. */
  searchOpen: boolean;
  query: string;
  /** TV number-pad zap bubble ("1", "12"; null = hidden). */
  zapEntry: string | null;
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
 *  — the window slides with the cursor and keeps TRUE channel numbers.
 * The phone form keeps its vertical window below the video: dense 44-unit
 * rows (8 visible) + a single-row category rail, phone-app proportions.
 */
const PHONE_ROWS = 8;

/** The left icon rail: brand tile + nav items (the reference's left
 *  edge). Items are [Live, Settings, Cari]; focus comes from the
 *  runtime's rail zone (focus.index 0..2). Glyphs are text — the scene
 *  has no image op in v1. */
function Rail(props: { focusedItem: number | null }) {
  const items: Array<{ glyph: string; label: string }> = [
    { glyph: "▶", label: "Live" },
    { glyph: "≡", label: "Set" },
    { glyph: "⌕", label: "Cari" },
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
/**
 * The phone category rail: ONE horizontal row (the streaming-app pattern),
 * windowed to what fits the 390-unit width and re-centered on the active
 * chip. "★ Favorit" pins first (TiviMate) — tapping it switches to the
 * favorites-only filter; any group chip clears it.
 */
function ChipRail(props: {
  groups: readonly string[];
  activeGroup: string | null;
  favoriteOnly: boolean;
  onFavorites: () => void;
  onPick: (group: string | null) => void;
}) {
  const { groups, activeGroup, favoriteOnly, onFavorites, onPick } = props;
  const chips: Array<string | null> = [FAVORITES_GROUP, null, ...groups];
  const activeIdx = favoriteOnly
    ? 0
    : Math.max(
        1,
        chips.findIndex((g) => g !== null && g !== FAVORITES_GROUP && (g ?? null) === activeGroup)
      );
  const VISIBLE = 4;
  const start = Math.max(0, Math.min(activeIdx - 1, chips.length - VISIBLE));
  const window = chips.slice(start, start + VISIBLE);
  return (
    <Row gap={6}>
      {window.map((group, k) => {
        const isFav = group === FAVORITES_GROUP;
        const active = isFav ? favoriteOnly : !favoriteOnly && (group ?? null) === activeGroup;
        return (
          <GestureDetector
            key={group ?? `__all__${k}`}
            onTap={() => (isFav ? onFavorites() : onPick(group ?? null))}
          >
            <Container
              color={active ? "secondaryContainer" : "surface"}
              radius={14}
              padding={7}
              borderColor={active ? "accent" : undefined}
              borderWidth={active ? 2 : 0}
            >
              <Text variant="caption" color={active ? "onSecondaryContainer" : "textDim"}>
                {group ?? "Semua"}
              </Text>
            </Container>
          </GestureDetector>
        );
      })}
    </Row>
  );
}

/** One phone-list row: group-colored number tile + title. */
/** The phone channel row: dense (44-unit) touch target — the streaming-app
 *  list rhythm. TWO SIBLING tap regions (not nested — a parent
 *  GestureDetector's region registers after its child's and wins the
 *  topmost hit test): the body plays, the star toggles the favorite. The
 *  playing row gets a trailing ● dot (Vidio's on-air marker). */
function ChannelRow(props: {
  channel: PlaylistEntry;
  index: number;
  focused: boolean;
  live: boolean;
  favorite: boolean;
  onSelect: () => void;
  onToggleFavorite: () => void;
}) {
  const { channel, index, focused, live, favorite, onSelect, onToggleFavorite } = props;
  return (
    <Container
      color={focused ? "accent" : "surface"}
      radius={10}
      padding={6}
      borderColor={live && !focused ? "accent" : undefined}
      borderWidth={live && !focused ? 2 : 0}
    >
      <Row gap={6}>
        <Expanded>
          <GestureDetector onTap={onSelect}>
            <Row gap={10} align="center">
              <Container color={groupColor(channel.group)} radius={8} width={30} height={30}>
                <Column align="center" justify="center">
                  <Text variant="caption" color="#FFFFFF">
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
              {live && (
                <Text variant="caption" color={focused ? "onPrimaryContainer" : "success"}>
                  ●
                </Text>
              )}
            </Row>
          </GestureDetector>
        </Expanded>
        <GestureDetector onTap={onToggleFavorite}>
          <Container color="transparent" radius={8} width={36} height={30}>
            <Column align="center" justify="center">
              <Text variant="label" color={favorite ? "accent" : "outline"}>
                {favorite ? "★" : "☆"}
              </Text>
            </Column>
          </Container>
        </GestureDetector>
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
  favorites: readonly string[];
}) {
  const { channels, expanded, listIndex, focused, liveUrl, liveGroup, favorites } = props;
  const favSet = new Set(favorites);
  const rows = buildSidebarRows(channels, new Set(expanded), favSet);
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
            const count =
              row.group === FAVORITES_GROUP
                ? favSet.size
                : channels.filter((c) => (c.group || "") === row.group).length;
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
 * The search overlay (the streaming-app pattern): a full-screen scrim +
 * a card with the search field and live-filtered results. A real
 * widget tree (NOT a Canvas paint closure) because the TextField's
 * text-input ops can only come from placeTextField. Rendered as the
 * Stack's last child — topmost tap region wins, so the scrim's
 * containment tap dismisses while the card's own regions act.
 */
function SearchOverlay(props: {
  query: string;
  channels: readonly PlaylistEntry[];
  compact: boolean;
  onQuery: (q: string) => void;
  onClose: () => void;
  onSelect: (url: string) => void;
}) {
  const { query, channels, compact, onQuery, onClose, onSelect } = props;
  const q = query.trim().toLowerCase();
  const results =
    q === ""
      ? []
      : channels.filter((c) => c.title.toLowerCase().includes(q)).slice(0, 8);
  const width = compact ? 358 : 620;
  const screenW = compact ? 390 : 960;
  const cardLeft = Math.round((screenW - width) / 2);
  const cardTop = compact ? 56 : 48;
  return (
    <Positioned top={0} left={0} right={0} bottom={0}>
      <Stack>
        {/* Scrim layer: tap anywhere OUTSIDE the card closes. The scrim's
            GD must NOT wrap the card — a wrapping GD registers after its
            children and would swallow every tap inside the card. */}
        <GestureDetector onTap={onClose}>
          <Container color="#B3000000" width={screenW} height={540} />
        </GestureDetector>
        {/* The card — a SIBLING above the scrim, so its regions register
            after the scrim's and win the topmost hit test. */}
        <Positioned top={cardTop} left={cardLeft}>
          <Container
            color="surfaceContainerHigh"
            radius={16}
            padding="md"
            width={width}
            borderColor="outlineVariant"
            borderWidth={1}
          >
            <Column gap="sm">
              <Text variant="label" color="text">
                Cari channel
              </Text>
              <TextField
                id="search"
                value={query}
                onChanged={onQuery}
                placeholder="nama channel…"
                label="Cari"
              />
              {q === "" ? (
                <Text variant="caption" color="textDim">
                  Ketik untuk mencari — hasil muncul di sini.
                </Text>
              ) : results.length === 0 ? (
                <Text variant="caption" color="textDim">
                  Tidak ada hasil untuk “{query.trim()}”.
                </Text>
              ) : (
                <Column gap={4}>
                  {results.map((c) => {
                    const i = channels.indexOf(c);
                    return (
                      <GestureDetector key={c.url} onTap={() => onSelect(c.url)}>
                        <Container color="surface" radius={10} padding={6}>
                          <Row gap={10} align="center">
                            <Container color={groupColor(c.group)} radius={8} width={30} height={30}>
                              <Column align="center" justify="center">
                                <Text variant="caption" color="#FFFFFF">
                                  {channelNo(i)}
                                </Text>
                              </Column>
                            </Container>
                            <Text variant="body" color="text" maxLines={1} ellipsis>
                              {c.title}
                            </Text>
                          </Row>
                        </Container>
                      </GestureDetector>
                    );
                  })}
                </Column>
              )}
            </Column>
          </Container>
        </Positioned>
      </Stack>
    </Positioned>
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
  /** Phone form: smaller tile, touch vocabulary ("Tap to play"). */
  compact?: boolean;
}) {
  const { media, now, h, channel, no, compact } = props;
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
        ? compact
          ? "Tap to play"
          : "OK to watch"
        : compact
          ? "Pick a channel below"
          : "OK opens the channel list";
  const tile = compact ? 48 : 72;
  return (
    <Container color="surfaceRaised" radius={16} height={h}>
      <Column align="center" justify="center" gap="md">
        <Row gap="md" align="center">
          <Container color={tileColor} radius={compact ? 12 : 16} width={tile} height={tile}>
            <Column align="center" justify="center">
              <Text variant={compact ? "label" : "title"} color="#FFFFFF">
                {tileText}
              </Text>
            </Column>
          </Container>
          <Column gap="sm" align="start">
            <Text variant={isErr ? "title" : compact ? "label" : "headline"} color={isErr ? "danger" : "text"} maxLines={1} ellipsis>
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
    favorites: [],
    favoriteOnly: false,
    recents: [],
    searchOpen: false,
    query: "",
    zapEntry: null,
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
        favorites: readonly string[];
        favoriteOnly: boolean;
        recents: readonly string[];
      }
    >({
      run({ input, state }) {
        state.channels = input.channels;
        state.groups = input.groups;
        state.activeGroup = input.activeGroup;
        state.expanded = input.expanded;
        state.favorites = input.favorites;
        state.favoriteOnly = input.favoriteOnly;
        state.recents = input.recents;
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
    /** Row star tap: favorite/unfavorite this channel. */
    toggleFavorite: defineAction<PlayerState, string>({
      run({ input, services }) {
        (services as { toggleFavorite?: (url: string) => void }).toggleFavorite?.(input);
      },
    }),
    /** "★ Favorit" chip: favorites-only filter on. */
    setFavoriteFilter: defineAction<PlayerState, boolean>({
      run({ input, services }) {
        (services as { setFavoriteFilter?: (on: boolean) => void }).setFavoriteFilter?.(input);
      },
    }),
    /** Recents rail + search result tap: zap by url. */
    selectUrl: defineAction<PlayerState, string>({
      run({ input, services }) {
        (services as { selectUrl?: (url: string) => void }).selectUrl?.(input);
        (services as { setSearchOpen?: (on: boolean) => void }).setSearchOpen?.(false);
      },
    }),
    /** Hero tap: pause/resume (or play the focused row when idle). */
    playToggle: defineAction<PlayerState, void>({
      run({ services }) {
        (services as { playToggle?: () => void }).playToggle?.();
      },
    }),
    /** Search overlay: open (field auto-focuses via the runtime) … */
    searchOpen: defineAction<PlayerState, void>({
      run({ services }) {
        (services as { setSearchOpen?: (on: boolean) => void }).setSearchOpen?.(true);
      },
    }),
    /** … close (BACK or scrim tap; the query resets). */
    searchClose: defineAction<PlayerState, void>({
      run({ services }) {
        (services as { setSearchOpen?: (on: boolean) => void }).setSearchOpen?.(false);
      },
    }),
    /** The runtime-owned open flag (BACK close / replayed on mount). */
    search: defineAction<PlayerState, boolean>({
      run({ input, state }) {
        state.searchOpen = input;
        if (!input) state.query = "";
      },
    }),
    /** The search TextField's onChanged (IME edits land here). */
    searchQuery: defineAction<PlayerState, string>({
      run({ input, state }) {
        state.query = input;
      },
    }),
    /** TV number-pad zap bubble (string digits; null = hidden). */
    zapEntry: defineAction<PlayerState, string | null>({
      run({ input, state }) {
        state.zapEntry = input;
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
      list: "↑↓ channels · OK watch · ← rail · MENU fav",
    };
    const favorites = new Set(state.favorites);

    // The focused sidebar row's channel — the idle video slot previews
    // it (tile + title), so the placeholder reads as the about-to-play
    // channel. A focused HEADER previews its group's first channel.
    const tvRows = buildSidebarRows(state.channels, new Set(state.expanded), favorites);
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
      // Phone: video hero on top (full-bleed 16:9, tap = play/pause), then
      // a compact chrome row (brand + search + count), the one-row
      // category rail (favorites pinned first), the "Lanjut Nonton" rail
      // and the dense tappable list. The remote is optional — rows and
      // chips are tapped directly; ↑/↓/OK still work with a keyboard.
      const main = (
        <Scaffold>
          <Column gap={10}>
            {/* The video slot — exactly VIDEO_RECT_PHONE. On device the
                native TextureView composites here; the placeholder
                shows through whenever no frames render. Tap = play/
                pause. */}
            <GestureDetector onTap={() => actions.playToggle()}>
              <SizedBox width={VIDEO_RECT_PHONE.w} height={VIDEO_RECT_PHONE.h}>
                <VideoPlaceholder
                  media={state.media}
                  now={state.now}
                  h={VIDEO_RECT_PHONE.h}
                  channel={focusedPhone ?? null}
                  no={count > 0 ? channelNo(listIdx) : null}
                  compact
                />
              </SizedBox>
            </GestureDetector>
            <Column padding={12} gap={10}>
              <Row align="center" justify="between">
                <Text variant="label" color="text">
                  NusaTV
                </Text>
                <Row gap={10} align="center">
                  <GestureDetector onTap={() => actions.searchOpen()}>
                    <Text variant="label" color="textDim">
                      ⌕
                    </Text>
                  </GestureDetector>
                  <Text variant="caption" color="textDim">
                    {`${count} · ${state.favoriteOnly ? FAVORITES_GROUP : state.activeGroup ?? "Semua"}`}
                  </Text>
                </Row>
              </Row>
              <ChipRail
                groups={state.groups}
                activeGroup={state.activeGroup}
                favoriteOnly={state.favoriteOnly}
                onFavorites={() => actions.setFavoriteFilter(true)}
                onPick={(g) => actions.setGroup(g)}
              />
              {!state.favoriteOnly && state.recents.length > 0 && (
                <Column gap={4}>
                  <Text variant="caption" color="textDim">
                    Lanjut Nonton
                  </Text>
                  <Row gap={6}>
                    {state.recents.slice(0, 3).map((url) => {
                      const ch = state.channels.find((c) => c.url === url);
                      if (!ch) return null;
                      return (
                        <GestureDetector key={url} onTap={() => actions.selectUrl(url)}>
                          <Container color="surfaceRaised" radius={12} padding={8}>
                            <Text variant="caption" color="text" maxLines={1} ellipsis>
                              {ch.title}
                            </Text>
                          </Container>
                        </GestureDetector>
                      );
                    })}
                  </Row>
                </Column>
              )}
              {count === 0 && (
                <Text variant="body" color="textDim">
                  Playlist empty — open Settings to load one
                </Text>
              )}
              <Column gap={6}>
                {phoneWindow.map((channel, k) => {
                  const i = phoneWinStart + k;
                  return (
                    <ChannelRow
                      key={channel.url}
                      channel={channel}
                      index={i}
                      focused={i === listIdx}
                      live={liveVisible !== null && liveVisible !== undefined && channel.url === liveVisible.url}
                      favorite={favorites.has(channel.url)}
                      onSelect={() => actions.select(i)}
                      onToggleFavorite={() => actions.toggleFavorite(channel.url)}
                    />
                  );
                })}
              </Column>
              {/* Clears the system nav bar — the list window runs to the
                  bottom edge on tall phones. */}
              <SizedBox height={16} />
            </Column>
          </Column>
        </Scaffold>
      );
      return (
        <Stack>
          {main}
          {state.searchOpen && (
            <SearchOverlay
              query={state.query}
              channels={state.channels}
              compact
              onQuery={(q) => actions.searchQuery(q)}
              onClose={() => actions.searchClose()}
              onSelect={(url) => actions.selectUrl(url)}
            />
          )}
        </Stack>
      );
    }

    // TV browse: rail | accordion sidebar | video hero + status.
    const main = (
      <Scaffold>
        <Row>
          {/* The icon rail — brand tile + Live/Set/Cari (the reference's
              left edge); focusable via the runtime's rail zone. */}
          <Rail focusedItem={zone === "rail" ? state.focus.index : null} />
          {/* The category accordion — the web ChannelList's D-pad
              translation (headers toggle with OK; rows watch); the
              favorites section pins above the groups when non-empty. */}
          <Sidebar
            channels={state.channels}
            expanded={state.expanded}
            listIndex={listIdx}
            focused={zone === "list"}
            liveUrl={liveVisible?.url ?? null}
            liveGroup={liveVisible ? (liveVisible.group || "") : null}
            favorites={state.favorites}
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
                shows through whenever no frames render. Tap = play/
                pause (mouse/web preview convenience). */}
            <GestureDetector onTap={() => actions.playToggle()}>
              <SizedBox width={VIDEO_RECT.w} height={VIDEO_RECT.h}>
                <VideoPlaceholder
                  media={state.media}
                  now={state.now}
                  h={VIDEO_RECT.h}
                  channel={previewChannel ?? null}
                  no={previewNo}
                />
              </SizedBox>
            </GestureDetector>
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
    // Overlays ride the SAME Stack wrap as the phone form: the search
    // dialog (rail ⌕ / Cari) and the number-pad zap bubble.
    return (
      <Stack>
        {main}
        {state.searchOpen && (
          <SearchOverlay
            query={state.query}
            channels={state.channels}
            compact={false}
            onQuery={(q) => actions.searchQuery(q)}
            onClose={() => actions.searchClose()}
            onSelect={(url) => actions.selectUrl(url)}
          />
        )}
        {state.zapEntry !== null && (
          <Positioned bottom={12} right={16}>
            <Container color="inverseSurface" radius={12} padding={10}>
              <Text variant="headline" color="onInverseSurface">
                {state.zapEntry}
              </Text>
            </Container>
          </Positioned>
        )}
      </Stack>
    );
  },
});

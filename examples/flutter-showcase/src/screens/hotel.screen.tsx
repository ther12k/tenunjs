import { defineScreen } from "@tenunjs/core";
import {
  Button,
  Card,
  Center,
  Column,
  Container,
  GestureDetector,
  Icon,
  Positioned,
  Row,
  Scaffold,
  SizedBox,
  Stack,
  Text,
  Wrap,
} from "@tenunjs/widgets";
import type { WidgetNode } from "@tenunjs/jsx-runtime";
import {
  AlertDialog,
  Avatar,
  Carousel,
  CanvasBox,
  Chip,
  IconButton,
  ModalBottomSheet,
  SearchBar,
  StarRating,
} from "@tenunjs-examples/ui-kit";
import { HOTEL_CATEGORIES, HOTELS, type Hotel } from "../categories/hotel";

const DESTINATIONS = ["Bali", "Lisbon", "Paris"] as const;
const HOTEL_CARD_W = 328;
const HOTEL_CARD_H = 300;

/**
 * The migration-demo card: composed from the structural tier the way its
 * Flutter original would be — a positioned Stack over an invisible sized
 * base, a Container hero, Icon glyph, and a bottom-anchored Row — with the
 * two translucent circles kept as a CanvasBox decoration layer (the
 * CustomPaint escape hatch).
 */
function HotelCard(props: { hotel: Hotel; selected: boolean; onSelect: () => void }): WidgetNode {
  const { hotel } = props;
  const tint = props.selected ? "primaryContainer" : hotel.tint;
  return (
    <GestureDetector onTap={props.onSelect}>
      <Stack>
        <SizedBox width={HOTEL_CARD_W} height={HOTEL_CARD_H} />
        <Positioned top={0} left={0} right={0}>
          <Container height={172} radius={22} color={tint} shadow={6}>
            <CanvasBox
              width={HOTEL_CARD_W}
              height={172}
              paint={(origin, put) => {
                put({ op: "circle", cx: origin.w - 54, cy: 52, r: 62, color: "#22FFFFFF" });
                put({ op: "circle", cx: 58, cy: 128, r: 48, color: "#16FFFFFF" });
              }}
            />
          </Container>
        </Positioned>
        <Positioned top={40} left={0} right={0}>
          <Center>
            <Icon glyph={hotel.glyph} size={72} color="#FFFFFF" />
          </Center>
        </Positioned>
        <Positioned top={187} left={0}>
          <Text variant="title">{hotel.name}</Text>
        </Positioned>
        <Positioned top={224} left={0}>
          <Text variant="caption" color="onSurfaceVariant">{hotel.place}</Text>
        </Positioned>
        <Positioned left={0} right={0} bottom={19}>
          <Row justify="between" align="center">
            <Text variant="body" color="success">${hotel.price} / night</Text>
            <Text variant="caption" color="warning">{hotel.rating} ★</Text>
          </Row>
        </Positioned>
      </Stack>
    </GestureDetector>
  );
}

export interface HotelState {
  destination: number;
  category: number;
  featured: number;
  selectedHotel: string | null;
  filterOpen: boolean;
  filters: { breakfast: boolean; oceanView: boolean; under150: boolean };
  guests: number;
  nights: number;
  booked: boolean;
}

export const HotelScreen = defineScreen({
  name: "HotelBooking",

  initialState: (): HotelState => ({
    destination: 0,
    category: 0,
    featured: 0,
    selectedHotel: null,
    filterOpen: false,
    filters: { breakfast: true, oceanView: false, under150: false },
    guests: 2,
    nights: 3,
    booked: false,
  }),

  actions: {
    cycleSearch({ state }: { state: HotelState }) {
      state.destination = (state.destination + 1) % DESTINATIONS.length;
    },
    setDestination({ state, input }: { state: HotelState; input: number }) {
      state.destination = Math.max(0, Math.min(DESTINATIONS.length - 1, Math.floor(input)));
    },
    setCategory({ state, input }: { state: HotelState; input: number }) {
      state.category = Math.max(0, Math.min(HOTEL_CATEGORIES.length - 1, Math.floor(input)));
    },
    cycleFeatured({ state, input }: { state: HotelState; input: number }) {
      state.featured = (state.featured + input + HOTELS.length) % HOTELS.length;
    },
    selectFeatured({ state, input }: { state: HotelState; input: number }) {
      state.featured = Math.max(0, Math.min(HOTELS.length - 1, Math.floor(input)));
      state.selectedHotel = HOTELS[state.featured]!.id;
    },
    selectHotel({ state, input }: { state: HotelState; input: string }) {
      state.selectedHotel = input;
      const index = HOTELS.findIndex((hotel) => hotel.id === input);
      if (index >= 0) state.featured = index;
      state.booked = false;
    },
    openFilters({ state }: { state: HotelState }) {
      state.filterOpen = true;
    },
    dismissFilters({ state }: { state: HotelState }) {
      state.filterOpen = false;
    },
    toggleFilter({ state, input }: { state: HotelState; input: number }) {
      if (input === 0) state.filters = { ...state.filters, breakfast: !state.filters.breakfast };
      if (input === 1) state.filters = { ...state.filters, oceanView: !state.filters.oceanView };
      if (input === 2) state.filters = { ...state.filters, under150: !state.filters.under150 };
    },
    applyFilters({ state }: { state: HotelState }) {
      state.filterOpen = false;
    },
    adjustGuests({ state, input }: { state: HotelState; input: number }) {
      state.guests = Math.max(1, Math.min(6, state.guests + Math.floor(input)));
    },
    adjustNights({ state, input }: { state: HotelState; input: number }) {
      state.nights = Math.max(1, Math.min(14, state.nights + Math.floor(input)));
    },
    bookRoom({ state }: { state: HotelState }) {
      if (state.selectedHotel) state.booked = true;
    },
    dismissBooking({ state }: { state: HotelState }) {
      state.booked = false;
    },
  },

  view({ state, actions }) {
    const selected = state.selectedHotel ? HOTELS.find((hotel) => hotel.id === state.selectedHotel) : null;
    const activeCategory = HOTEL_CATEGORIES[state.category]!;
    const visibleHotels = HOTELS.filter((hotel) => activeCategory === "All" || hotel.category === activeCategory)
      .filter((hotel) => !state.filters.under150 || hotel.price < 150)
      .filter((hotel) => !state.filters.oceanView || hotel.tags.includes("Ocean view"));
    const rows: WidgetNode[] = [];
    for (let index = 0; index < visibleHotels.length; index += 2) {
      rows.push(
        <Row key={`hotel-row-${index}`} gap="md">
          {visibleHotels.slice(index, index + 2).map((hotel) => (
            <HotelCard
              key={hotel.id}
              hotel={hotel}
              selected={hotel.id === state.selectedHotel}
              onSelect={() => actions.selectHotel(hotel.id)}
            />
          ))}
        </Row>,
      );
    }
    const total = selected ? selected.price * state.nights : 0;

    return (
      <Scaffold>
        <Column padding="lg" gap="lg">
          <Row justify="between" align="center">
            <Column gap="xs">
              <Text variant="caption" color="#AEB8C8">YOUR NEXT ESCAPE</Text>
              <Text variant="title">Stay somewhere special</Text>
            </Column>
            <Avatar label="TR" size={48} color="#F5A56B" textColor="#241A17" />
          </Row>

          <SearchBar
            hint={`Search stays in ${DESTINATIONS[state.destination]}`}
            avatar="TR"
            onTap={() => actions.cycleSearch()}
          />

          <Row justify="between" align="center">
            <Text variant="body" color="#AEB8C8">Handpicked places for slow mornings.</Text>
            <Button variant="secondary" onPress={() => actions.openFilters()}>Filters</Button>
          </Row>

          <Carousel
            items={HOTELS.map((hotel) => ({
              glyph: hotel.glyph,
              title: hotel.name,
              subtitle: `${hotel.place} · $${hotel.price} · ${hotel.rating} ★`,
              tint: hotel.tint,
            }))}
            active={state.featured}
            onCycle={(direction) => actions.cycleFeatured(direction)}
            onSelect={(index) => actions.selectFeatured(index)}
          />

          <Wrap spacing="sm">
            {HOTEL_CATEGORIES.map((category, index) => (
              <Chip key={category} label={category} selected={state.category === index} onSelect={() => actions.setCategory(index)} />
            ))}
          </Wrap>

          {selected ? (
            <Card padding="lg" radius="lg" background="surfaceRaised">
              <Column gap="md">
                <Row justify="between" align="center">
                  <Column gap="xs">
                    <Text variant="title">{selected.name}</Text>
                    <Text variant="body" color="#AEB8C8">{selected.place}</Text>
                  </Column>
                  <StarRating value={selected.rating} size={15} />
                </Row>
                <Text variant="caption" color="#AEB8C8">{selected.tags.join(" · ")} · flexible cancellation</Text>
                <Row justify="between" align="center">
                  <Column gap="xs">
                    <Text variant="caption" color="#AEB8C8">Guests</Text>
                    <Row gap="xs" align="center">
                      <IconButton glyph="−" variant="outlined" size={40} glyphSize={20} onPress={() => actions.adjustGuests(-1)} />
                      <Text variant="title">{state.guests}</Text>
                      <IconButton glyph="+" variant="outlined" size={40} glyphSize={20} onPress={() => actions.adjustGuests(1)} />
                    </Row>
                  </Column>
                  <Column gap="xs">
                    <Text variant="caption" color="#AEB8C8">Nights</Text>
                    <Row gap="xs" align="center">
                      <IconButton glyph="−" variant="outlined" size={40} glyphSize={20} onPress={() => actions.adjustNights(-1)} />
                      <Text variant="title">{state.nights}</Text>
                      <IconButton glyph="+" variant="outlined" size={40} glyphSize={20} onPress={() => actions.adjustNights(1)} />
                    </Row>
                  </Column>
                </Row>
                <Row justify="between" align="center">
                  <Column gap="xs">
                    <Text variant="caption" color="#AEB8C8">Estimated total</Text>
                    <Text variant="headline">${total}</Text>
                  </Column>
                  <Button variant="primary" onPress={() => actions.bookRoom()}>Book this stay</Button>
                </Row>
              </Column>
            </Card>
          ) : null}

          <Row justify="between" align="center">
            <Text variant="title">Stay picks</Text>
            <Text variant="caption" color="#AEB8C8">{visibleHotels.length} available</Text>
          </Row>
          {rows.length > 0 ? <Column gap="md">{rows}</Column> : <Card padding="lg" radius="lg" background="surfaceRaised"><Text variant="body" color="#AEB8C8">No stays match these filters.</Text></Card>}

          <ModalBottomSheet
            open={state.filterOpen}
            title="Filter stays"
            options={[
              { glyph: "☕", label: "Breakfast included", selected: state.filters.breakfast },
              { glyph: "◒", label: "Ocean view", selected: state.filters.oceanView },
              { glyph: "$", label: "Under $150 / night", selected: state.filters.under150 },
            ]}
            onToggle={(index) => actions.toggleFilter(index)}
            confirmLabel="Apply filters"
            onConfirm={() => actions.applyFilters()}
            onDismiss={() => actions.dismissFilters()}
          />

          <AlertDialog
            open={state.booked}
            glyph="✦"
            title="Stay reserved"
            body={selected ? `${selected.name} is waiting for ${state.guests} guest${state.guests === 1 ? "" : "s"} for ${state.nights} night${state.nights === 1 ? "" : "s"}.` : "Your stay is reserved."}
            dismissLabel="Keep browsing"
            confirmLabel="Done"
            onDismiss={() => actions.dismissBooking()}
            onConfirm={() => actions.dismissBooking()}
          />
        </Column>
      </Scaffold>
    );
  },
});

import { defineScreen } from "@tenunjs/core";
import {
  Button,
  Card,
  Column,
  Row,
  Scaffold,
  Text,
} from "@tenunjs/widgets";
import type { WidgetNode } from "@tenunjs/jsx-runtime";
import {
  Avatar,
  Badge,
  CanvasBox,
  IconButton,
  NavigationBar,
  TextField,
  textWidth,
} from "@tenunjs-examples/ui-kit";

/**
 * Plant shop — the "Plant App" dribbble family, one of the most recreated
 * Flutter UIs on GitHub (flutter-ui-plant-app, plant-shop challenges, and
 * the e-commerce template home pages): greeting header, search, category
 * icon row, a two-column product grid with favorites and add-to-cart, and a
 * bottom navigation bar.
 */

interface Category {
  id: string;
  glyph: string;
  label: string;
}

const CATEGORIES: Category[] = [
  { id: "all", glyph: "🌐", label: "All" },
  { id: "cactus", glyph: "🌵", label: "Cactus" },
  { id: "greens", glyph: "🌿", label: "Greens" },
  { id: "blooms", glyph: "🌸", label: "Blooms" },
  { id: "pots", glyph: "🪴", label: "Pots" },
];

interface Plant {
  id: string;
  name: string;
  latin: string;
  price: number;
  glyph: string;
  tint: string;
  cat: string;
}

const PLANTS: Plant[] = [
  { id: "monstera", name: "Monstera", latin: "Monstera deliciosa", price: 24, glyph: "🌿", tint: "#1E3A2F", cat: "greens" },
  { id: "candelabra", name: "Candelabra", latin: "Euphorbia trigona", price: 19, glyph: "🌵", tint: "#3A2F1E", cat: "cactus" },
  { id: "peace-lily", name: "Peace lily", latin: "Spathiphyllum", price: 27, glyph: "🌸", tint: "#3A2430", cat: "blooms" },
  { id: "snake", name: "Snake plant", latin: "Sansevieria", price: 21, glyph: "🌾", tint: "#22303A", cat: "greens" },
  { id: "golden-barrel", name: "Golden barrel", latin: "Echinocactus", price: 32, glyph: "🌵", tint: "#3A351E", cat: "cactus" },
  { id: "anthurium", name: "Anthurium", latin: "Anthurium andraeanum", price: 29, glyph: "🌺", tint: "#3A2230", cat: "blooms" },
];

/** Two-column grid cell: 672 content width minus one sm gap. */
const CARD_W = 332;
const CARD_H = 320;

function PlantCard(props: {
  plant: Plant;
  favorite: boolean;
  qty: number;
  onFavorite: () => void;
  onAdd: () => void;
}): WidgetNode {
  const { plant } = props;
  return CanvasBox({
    width: CARD_W,
    height: CARD_H,
    paint: (origin, put, tap) => {
      const w = origin.w;
      // Photo placeholder: tonal panel with the plant glyph — the image
      // slot of the reference design, expressed in flat ops.
      put({ op: "rect", x: 0, y: 0, w, h: 196, r: 20, color: plant.tint, shadow: 6 });
      put({ op: "circle", cx: w / 2, cy: 98, r: 64, color: "#14FFFFFF" });
      put({
        op: "text",
        x: (w - textWidth(plant.glyph, 80)) / 2,
        y: 98 + 80 * 0.36,
        text: plant.glyph,
        size: 80,
        weight: 600,
        color: "#FFFFFF",
      });
      // Favorite heart, top-right on the photo.
      put({
        op: "text",
        x: w - 62,
        y: 20 + 30 * 0.36,
        text: props.favorite ? "♥" : "♡",
        size: 30,
        weight: 700,
        color: props.favorite ? "#FF5A5F" : "#B0FFFFFF",
      });
      tap({ x: w - 76, y: 8, w: 68, h: 64 }, props.onFavorite);
      // Name, latin name, price + add.
      put({ op: "text", x: 0, y: 232, text: plant.name, size: 17, weight: 600, color: "#F2F2F7" });
      put({ op: "text", x: 0, y: 258, text: plant.latin, size: 13, weight: 400, color: "#9AA3B2" });
      if (props.qty > 0) {
        put({
          op: "text",
          x: 0,
          y: 296,
          text: `$${plant.price} · ${props.qty} in cart`,
          size: 16,
          weight: 700,
          color: "#3DD68C",
        });
      } else {
        put({ op: "text", x: 0, y: 296, text: `$${plant.price}`, size: 16, weight: 700, color: "#3DD68C" });
      }
      put({ op: "circle", cx: w - 34, cy: 288, r: 24, color: "#4C8DFF" });
      put({
        op: "text",
        x: w - 34 - textWidth("+", 24) / 2,
        y: 288 + 24 * 0.36,
        text: "+",
        size: 24,
        weight: 700,
        color: "#FFFFFF",
      });
      tap({ x: w - 64, y: 256, w: 64, h: 64 }, props.onAdd);
    },
  }) as unknown as WidgetNode;
}

function CategoryPill(props: {
  glyph: string;
  label: string;
  active: boolean;
  onSelect: () => void;
}): WidgetNode {
  return CanvasBox({
    width: 104,
    height: 108,
    paint: (origin, put, tap) => {
      put({
        op: "circle",
        cx: 52,
        cy: 44,
        r: 38,
        color: props.active ? "#30354A" : "#232330",
      });
      put({
        op: "text",
        x: 52 - textWidth(props.glyph, 26) / 2,
        y: 44 + 26 * 0.36,
        text: props.glyph,
        size: 26,
        weight: 600,
        color: props.active ? "#DCE4FF" : "#9AA3B2",
      });
      put({
        op: "text",
        x: (104 - textWidth(props.label, 13)) / 2,
        y: 104,
        text: props.label,
        size: 13,
        weight: props.active ? 700 : 500,
        color: props.active ? "#F2F2F7" : "#9AA3B2",
      });
      tap({ x: 0, y: 0, w: 104, h: 108 }, props.onSelect);
    },
  }) as unknown as WidgetNode;
}

export interface PlantsState {
  category: number;
  favorites: string[];
  cart: Record<string, number>;
  ordered: boolean;
  nav: number;
  searchFocused: boolean;
}

export const PlantsScreen = defineScreen({
  name: "PlantShop",

  initialState: (): PlantsState => ({
    category: 0,
    favorites: [],
    cart: {},
    ordered: false,
    nav: 1,
    searchFocused: false,
  }),

  actions: {
    setCategory({ state, input }: { state: PlantsState; input: number }) {
      state.category = input;
    },
    toggleFavorite({ state, input }: { state: PlantsState; input: string }) {
      state.favorites = state.favorites.includes(input)
        ? state.favorites.filter((id) => id !== input)
        : [...state.favorites, input];
    },
    addToCart({ state, input }: { state: PlantsState; input: string }) {
      state.cart = { ...state.cart, [input]: (state.cart[input] ?? 0) + 1 };
    },
    checkout({ state }: { state: PlantsState }) {
      if (Object.keys(state.cart).length > 0) {
        state.cart = {};
        state.ordered = true;
      }
    },
    dismissOrder({ state }: { state: PlantsState }) {
      state.ordered = false;
    },
    setNav({ state, input }: { state: PlantsState; input: number }) {
      state.nav = input;
    },
    focusSearch({ state }: { state: PlantsState }) {
      state.searchFocused = !state.searchFocused;
    },
  },

  view({ state, actions }) {
    const activeCategory = CATEGORIES[state.category]!.id;
    const visible = activeCategory === "all" ? PLANTS : PLANTS.filter((p) => p.cat === activeCategory);
    const cartCount = Object.values(state.cart).reduce((sum, qty) => sum + qty, 0);
    const cartTotal = Object.entries(state.cart).reduce(
      (sum, [id, qty]) => sum + (PLANTS.find((p) => p.id === id)?.price ?? 0) * qty,
      0
    );

    const rows: WidgetNode[] = [];
    for (let i = 0; i < visible.length; i += 2) {
      const pair = visible.slice(i, i + 2).map((plant) => (
        <PlantCard
          key={plant.id}
          plant={plant}
          favorite={state.favorites.includes(plant.id)}
          qty={state.cart[plant.id] ?? 0}
          onFavorite={() => actions.toggleFavorite(plant.id)}
          onAdd={() => actions.addToCart(plant.id)}
        />
      ));
      rows.push(<Row key={`row-${i}`} gap="sm">{pair}</Row>);
    }

    return (
      <Scaffold>
        <Column padding="lg" gap="lg">
          <Row justify="between" align="center">
            <Column gap="xs">
              <Text variant="caption" color="#9AA3B2">Good morning ☀️</Text>
              <Text variant="title">Find your plant</Text>
            </Column>
            <Avatar label="RZ" size={48} />
          </Row>

          <TextField
            label="Search plants"
            leading="🔍"
            focused={state.searchFocused}
            onFocusChange={() => actions.focusSearch()}
          />

          <Row gap="md" justify="between">
            {CATEGORIES.map((category, index) => (
              <CategoryPill
                key={category.id}
                glyph={category.glyph}
                label={category.label}
                active={index === state.category}
                onSelect={() => actions.setCategory(index)}
              />
            ))}
          </Row>

          <Row justify="between" align="center">
            <Text variant="title">Popular plants</Text>
            {/* Badge only: a text label here squeezes the title into wrapping. */}
            {cartCount > 0 ? <Badge count={cartCount} /> : <Text variant="body" color="#9AA3B2">See all</Text>}
          </Row>

          {state.ordered ? (
            <Card padding="lg" radius="lg" background="surfaceRaised">
              <Column gap="md">
                <Text variant="headline">Order placed 🎉</Text>
                <Text variant="body" color="#9AA3B2">
                  Your greens ship tomorrow morning. Care cards included.
                </Text>
                <Button variant="text" onPress={() => actions.dismissOrder()}>
                  Keep browsing
                </Button>
              </Column>
            </Card>
          ) : null}

          {rows.length > 0 ? (
            <Column gap="md">{rows}</Column>
          ) : (
            <Card padding="lg" radius="lg" background="surfaceRaised">
              <Text variant="body" color="#9AA3B2">Nothing in this category yet.</Text>
            </Card>
          )}

          {cartCount > 0 && !state.ordered ? (
            <Card padding="md" radius="lg" background="surfaceRaised">
              <Row justify="between" align="center">
                <Column gap="xs">
                  <Text variant="title">${cartTotal} · {cartCount} plant{cartCount === 1 ? "" : "s"}</Text>
                  <Text variant="caption" color="#9AA3B2">Free delivery over $50</Text>
                </Column>
                <Button variant="primary" onPress={() => actions.checkout()}>
                  Checkout
                </Button>
              </Row>
            </Card>
          ) : null}

          <Row gap="sm" justify="center">
            <IconButton glyph="❓" variant="standard" size={44} glyphSize={20} color="#9AA3B2" />
            <Text variant="caption" color="#9AA3B2">
              Every plant card runs real actions: hearts and cart update state.
            </Text>
          </Row>

          <NavigationBar
            items={[
              { glyph: "🏠", label: "Home" },
              { glyph: "🌿", label: "Plants" },
              { glyph: "🪴", label: "Garden" },
              { glyph: "👤", label: "Profile" },
            ]}
            active={state.nav}
            onSelect={(index) => actions.setNav(index)}
          />
        </Column>
      </Scaffold>
    );
  },
});

import { defineAction, defineScreen } from "@tenunjs/core";
import {
  AppBar,
  Button,
  Card,
  Column,
  Row,
  Scaffold,
  Text,
} from "@tenunjs/widgets";
import { Avatar, Chip, Divider, ListTile } from "@tenunjs-examples/ui-kit";

/**
 * Shrine-style store module: category chips, a product list with icon
 * avatars, and a live cart with a running total — the classic Flutter
 * retail reference layout.
 */
export interface Product {
  readonly id: string;
  readonly name: string;
  readonly category: "Home" | "Tech" | "Wear";
  readonly price: number;
}

export interface StoreState {
  readonly products: readonly Product[];
  readonly category: "All" | Product["category"];
  readonly cart: ReadonlyArray<{ id: string; name: string; price: number; qty: number }>;
}

export const StoreScreen = defineScreen({
  name: "Store",

  initialState: (): StoreState => ({
    products: [
      { id: "lamp", name: "Woven lamp", category: "Home", price: 89.0 },
      { id: "chair", name: "Rattan chair", category: "Home", price: 249.0 },
      { id: "buds", name: "Studio buds", category: "Tech", price: 129.0 },
      { id: "watch", name: "Field watch", category: "Tech", price: 310.0 },
      { id: "scarf", name: "Ikat scarf", category: "Wear", price: 45.0 },
      { id: "tote", name: "Canvas tote", category: "Wear", price: 32.0 },
    ],
    category: "All",
    cart: [],
  }),

  actions: {
    setCategory: defineAction<StoreState, StoreState["category"]>({
      run({ input, state }) {
        (state as unknown as { category: StoreState["category"] }).category = input;
      },
    }),

    addToCart: defineAction<StoreState, string>({
      run({ input, state }) {
        const product = state.products.find((p) => p.id === input);
        if (!product) return;
        const existing = state.cart.find((c) => c.id === input);
        const cart = existing
          ? state.cart.map((c) => (c.id === input ? { ...c, qty: c.qty + 1 } : c))
          : [...state.cart, { id: product.id, name: product.name, price: product.price, qty: 1 }];
        (state as unknown as { cart: StoreState["cart"] }).cart = cart;
      },
    }),

    removeFromCart: defineAction<StoreState, string>({
      run({ input, state }) {
        (state as unknown as { cart: StoreState["cart"] }).cart = state.cart.filter((c) => c.id !== input);
      },
    }),

    checkout: defineAction<StoreState, void>({
      run({ state }) {
        (state as unknown as { cart: StoreState["cart"] }).cart = [];
      },
    }),
  },

  view({ state, actions }) {
    const categories: Array<StoreState["category"]> = ["All", "Home", "Tech", "Wear"];
    const visible = state.products.filter(
      (p) => state.category === "All" || p.category === state.category
    );
    const total = state.cart.reduce((sum, c) => sum + c.price * c.qty, 0);

    return (
      <Scaffold appBar={<AppBar title="Store" />}>
        <Column padding="lg" gap="lg">
          <Row gap="sm">
            {categories.map((category) => (
              <Chip
                key={category}
                label={category}
                selected={state.category === category}
                onSelect={() => actions.setCategory(category)}
              />
            ))}
          </Row>

          <Column gap="sm">
            {visible.map((product) => (
              <ListTile
                key={product.id}
                leading={<Avatar label={product.name.slice(0, 1)} color="#33261A" textColor="#F5A623" />}
                title={product.name}
                subtitle={`${product.category} · ${product.price.toFixed(2)}`}
                trailing={
                  <Button variant="secondary" onPress={() => actions.addToCart(product.id)}>
                    Add
                  </Button>
                }
              />
            ))}
          </Column>

          <Card padding="md" radius="md" background="surfaceRaised">
            <Column gap="sm">
              <Text variant="title">Cart</Text>
              {state.cart.length === 0 ? (
                <Text variant="body" color="#9AA3B2">Your cart is empty.</Text>
              ) : (
                <Column gap="xs">
                  {state.cart.map((line) => (
                    <Column key={line.id} gap="xs">
                      <Row gap="sm" justify="between">
                        <Text variant="body">
                          {line.qty} × {line.name}
                        </Text>
                        <Button variant="danger" onPress={() => actions.removeFromCart(line.id)}>
                          Remove
                        </Button>
                      </Row>
                      <Divider />
                    </Column>
                  ))}
                  <Text variant="title">Total: {total.toFixed(2)}</Text>
                  <Button variant="primary" onPress={() => actions.checkout()}>
                    Checkout
                  </Button>
                </Column>
              )}
            </Column>
          </Card>
        </Column>
      </Scaffold>
    );
  },
});

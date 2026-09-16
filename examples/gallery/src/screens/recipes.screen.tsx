import { defineAction, defineScreen } from "@tenunjs/core";
import {
  AppBar,
  Card,
  Column,
  Row,
  Scaffold,
  Text,
} from "@tenunjs/widgets";
import { Avatar, Chip, HeroCard, IconButton, ListTile } from "@tenunjs-examples/ui-kit";

/**
 * Recipes module — the food-app pattern: category chips, a featured
 * gradient dish hero with adjustable servings, and a browsable recipe list
 * with favorite hearts and ratings. Servings ± and favorites are real
 * actions on typed state.
 */
export interface Recipe {
  readonly id: string;
  readonly name: string;
  readonly category: "Breakfast" | "Lunch" | "Dinner" | "Dessert";
  readonly minutes: number;
  readonly rating: number;
  readonly glyph: string;
  readonly favorite: boolean;
}

export interface RecipesState {
  readonly category: "All" | Recipe["category"];
  readonly servings: number;
  readonly recipes: readonly Recipe[];
}

export const RecipesScreen = defineScreen({
  name: "Recipes",

  initialState: (): RecipesState => ({
    category: "All",
    servings: 2,
    recipes: [
      { id: "nasi-lemak", name: "Nasi lemak", category: "Breakfast", minutes: 25, rating: 4.9, glyph: "🍚", favorite: true },
      { id: "laksa", name: "Sarawak laksa", category: "Lunch", minutes: 40, rating: 4.8, glyph: "🍜", favorite: false },
      { id: "satay", name: "Chicken satay", category: "Dinner", minutes: 35, rating: 4.7, glyph: "🍢", favorite: false },
      { id: "rendang", name: "Beef rendang", category: "Dinner", minutes: 90, rating: 4.9, glyph: "🍲", favorite: true },
      { id: "pisang", name: "Pisang goreng", category: "Dessert", minutes: 15, rating: 4.6, glyph: "🍌", favorite: false },
      { id: "cendol", name: "Cendol", category: "Dessert", minutes: 20, rating: 4.5, glyph: "🧊", favorite: false },
    ],
  }),

  actions: {
    setCategory: defineAction<RecipesState, RecipesState["category"]>({
      run({ input, state }) {
        (state as unknown as { category: RecipesState["category"] }).category = input;
      },
    }),

    toggleFavorite: defineAction<RecipesState, string>({
      run({ input, state }) {
        const recipes = state.recipes.map((r) =>
          r.id === input ? { ...r, favorite: !r.favorite } : r
        );
        (state as unknown as { recipes: Recipe[] }).recipes = recipes;
      },
    }),

    addServing: defineAction<RecipesState, void>({
      run({ state }) {
        (state as unknown as { servings: number }).servings = Math.min(state.servings + 1, 8);
      },
    }),

    removeServing: defineAction<RecipesState, void>({
      run({ state }) {
        (state as unknown as { servings: number }).servings = Math.max(state.servings - 1, 1);
      },
    }),
  },

  view({ state, actions }) {
    const categories: Array<RecipesState["category"]> = ["All", "Breakfast", "Lunch", "Dinner", "Dessert"];
    const visible = state.recipes.filter(
      (r) => state.category === "All" || r.category === state.category
    );
    const featured = state.recipes.find((r) => r.id === "rendang")!;

    return (
      <Scaffold appBar={<AppBar title="Recipes" />}>
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

          <HeroCard
            title={`FEATURED · ${featured.category.toUpperCase()} · ${featured.minutes} MIN`}
            headline={`${featured.glyph} ${featured.name}`}
            caption={`★ ${featured.rating} · serves ${state.servings}`}
            from="#4A3320"
            to="#161310"
          />

          <Row gap="sm" justify="center">
            <Chip label="− serve" onSelect={() => actions.removeServing()} />
            <Text variant="title">{state.servings} servings</Text>
            <Chip label="+ serve" onSelect={() => actions.addServing()} />
          </Row>

          <Column gap="sm">
            <Text variant="title">{state.category === "All" ? "All recipes" : state.category}</Text>
            {visible.map((recipe) => (
              <ListTile
                key={recipe.id}
                leading={<Avatar label={recipe.glyph} size={48} color="#33261A" textColor="#F5A623" />}
                title={recipe.name}
                subtitle={`${recipe.minutes} min · ★ ${recipe.rating} · ${recipe.category}`}
                trailing={
                  <IconButton
                    glyph={recipe.favorite ? "♥" : "♡"}
                    size={48}
                    glyphSize={22}
                    color={recipe.favorite ? "#FF5A5F" : "#9AA3B2"}
                    onPress={() => actions.toggleFavorite(recipe.id)}
                  />
                }
              />
            ))}
          </Column>
        </Column>
      </Scaffold>
    );
  },
});

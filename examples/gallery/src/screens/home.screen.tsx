import { defineScreen } from "@tenunjs/core";
import {
  AppBar,
  Button,
  Card,
  Column,
  Row,
  Scaffold,
  Text,
} from "@tenunjs/widgets";
import { Avatar, HeroCard, ListTile } from "@tenunjs-examples/ui-kit";

/**
 * Gallery hub — the all-in-one entry point, styled after Flutter's
 * showcase hubs: a gradient hero, then one rich list tile per module with
 * an icon avatar and an Open action.
 */
export interface HomeState {
  opened: string | null;
}

export const HomeScreen = defineScreen({
  name: "GalleryHome",

  initialState: (): HomeState => ({
    opened: null,
  }),

  actions: {
    open({ input, state }: { input: string; state: HomeState }) {
      state.opened = input;
    },
  },

  view({ state, actions }) {
    const modules: Array<{ route: string; title: string; blurb: string; glyph: string }> = [
      {
        route: "views",
        title: "Widget showcase",
        blurb: "The M3 kit live: buttons, chips, sliders, tabs, nav bar.",
        glyph: "🎨",
      },
      {
        route: "banking",
        title: "Rally-style banking",
        blurb: "Dark financial dashboard: balance card, accounts, bills.",
        glyph: "🏦",
      },
      {
        route: "smartHome",
        title: "Smart home dashboard",
        blurb: "Rooms, live device tiles, and scene shortcuts.",
        glyph: "🏠",
      },
      {
        route: "fitness",
        title: "Fitness tracker",
        blurb: "Gamified rings, weekly steps, and today's workout.",
        glyph: "🏃",
      },
      {
        route: "store",
        title: "Shrine-style store",
        blurb: "Category chips, product grid, and a live cart.",
        glyph: "🛍️",
      },
      {
        route: "settings",
        title: "Grouped settings",
        blurb: "Account, preferences, and about sections.",
        glyph: "⚙️",
      },
      {
        route: "weather",
        title: "Weather forecast",
        blurb: "Sky hero, hourly strip, 7-day ranges, condition rings.",
        glyph: "⛅",
      },
      {
        route: "music",
        title: "Music player",
        blurb: "Now playing, seek bar, transport controls, and a queue.",
        glyph: "🎧",
      },
      {
        route: "chat",
        title: "Chat & messaging",
        blurb: "Bubbles, presence header, quick replies, and a composer.",
        glyph: "💬",
      },
      {
        route: "recipes",
        title: "Recipes & cooking",
        blurb: "Category chips, featured dish hero, servings, favorites.",
        glyph: "🍳",
      },
      {
        route: "crypto",
        title: "Crypto portfolio",
        blurb: "Value hero, timeframes, sparklines, and a market list.",
        glyph: "📈",
      },
    ];

    return (
      <Scaffold appBar={<AppBar title="Tenun Gallery" />}>
        <Column padding="lg" gap="lg">
          <HeroCard
            title="TENUNJS UI LAB"
            headline="Tenun Gallery"
            caption="Eleven Flutter-inspired reference layouts, one app."
          />

          <Card padding="lg" radius="lg" background="surfaceRaised">
            <Column gap="xs">
              <Text variant="title">Flutter-inspired UI/UX modules</Text>
              <Text variant="body" color="#9AA3B2">
                Every tile below runs real screen state and typed actions.
              </Text>
              {state.opened ? (
                <Text variant="body" color="#9AA3B2">Last opened: {state.opened}</Text>
              ) : null}
            </Column>
          </Card>

          <Column gap="md">
            {modules.map((module) => (
              <ListTile
                key={module.route}
                leading={<Avatar label={module.glyph} size={48} />}
                title={module.title}
                subtitle={module.blurb}
                trailing={
                  <Button variant="secondary" onPress={() => actions.open(module.route)}>
                    Open {module.title}
                  </Button>
                }
              />
            ))}
          </Column>

          <Row gap="sm">
            <Text variant="body" color="#9AA3B2">
              State is owned by screens; every tap is a typed action.
            </Text>
          </Row>
        </Column>
      </Scaffold>
    );
  },
});

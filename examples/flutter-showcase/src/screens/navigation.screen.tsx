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
import {
  Avatar,
  HeroCard,
  ListTile,
  ModalDrawer,
  NavigationBar,
} from "@tenunjs-examples/ui-kit";
import { DESTINATIONS } from "../categories/navigation";

export interface NavigationStudyState {
  active: number;
  drawerOpen: boolean;
  saved: boolean;
}

export const NavigationStudyScreen = defineScreen({
  name: "CustomDrawerStudy",

  initialState: (): NavigationStudyState => ({
    active: 0,
    drawerOpen: false,
    saved: false,
  }),

  actions: {
    setDrawer({ state, input }: { state: NavigationStudyState; input: boolean }) {
      state.drawerOpen = input;
    },
    selectDestination({ state, input }: { state: NavigationStudyState; input: number }) {
      state.active = Math.max(0, Math.min(DESTINATIONS.length - 1, Math.floor(input)));
      state.drawerOpen = false;
    },
    toggleSaved({ state }: { state: NavigationStudyState }) {
      state.saved = !state.saved;
    },
  },

  view({ state, actions }) {
    const destination = DESTINATIONS[state.active]!;
    return (
      <Scaffold appBar={<AppBar title="Custom drawer" onMenu={() => actions.setDrawer(true)} />}>
        <Column padding="lg" gap="lg">
          <HeroCard
            title="NAVIGATION STUDY"
            headline={destination.title}
            caption={destination.body}
            from={state.active === 0 ? "#53352B" : "#294A58"}
            to="#141821"
            height={180}
          />
          <Card padding="lg" radius="lg" background="surfaceRaised">
            <Column gap="md">
              <Row justify="between" align="center">
                <Column gap="xs"><Text variant="caption" color="#AEB8C8">CURRENT DESTINATION</Text><Text variant="title">{destination.label}</Text></Column><Avatar label={destination.glyph} size={52} color="#F5C26B" textColor="#281F13" />
              </Row>
              <Text variant="body" color="#AEB8C8">The drawer is a fixed viewport layer, so it stays usable while this page scrolls underneath.</Text>
              <Row gap="sm"><Button variant="primary" onPress={() => actions.setDrawer(true)}>Open drawer</Button><Button variant="secondary" onPress={() => actions.toggleSaved()}>{state.saved ? "Saved" : "Save pattern"}</Button></Row>
            </Column>
          </Card>
          <Column gap="sm">
            <Text variant="title">Destination preview</Text>
            <ListTile leading={<Avatar label={destination.glyph} size={48} />} title={destination.title} subtitle={destination.body} trailing={<Text variant="caption" color="#70D6A2">Active</Text>} />
            {DESTINATIONS.filter((_, index) => index !== state.active).map((item, index) => <ListTile key={item.label} leading={<Avatar label={item.glyph} size={48} color="#27394B" />} title={item.label} subtitle={`Open the ${item.label.toLowerCase()} surface`} trailing={<Button variant="text" onPress={() => actions.selectDestination(DESTINATIONS.findIndex((candidate) => candidate.label === item.label))}>Open</Button>} />)}
          </Column>
          <NavigationBar items={DESTINATIONS.slice(0, 4).map((item) => ({ glyph: item.glyph, label: item.label }))} active={Math.min(state.active, 3)} onSelect={(index) => actions.selectDestination(index)} />
          <ModalDrawer
            open={state.drawerOpen}
            heading="Move through the app"
            items={DESTINATIONS.map((item) => ({ glyph: item.glyph, label: item.label }))}
            active={state.active}
            onSelect={(index) => actions.selectDestination(index)}
            onDismiss={() => actions.setDrawer(false)}
          />
        </Column>
      </Scaffold>
    );
  },
});

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
import { DIRECTORY } from "../data/directory";

const TEAMS = ["All", "Loom", "Dye", "Ship"] as const;

export interface HomeState {
  team: string;
}

export const HomeScreen = defineScreen({
  name: "Home",

  initialState: (): HomeState => ({
    team: "All",
  }),

  actions: {
    setTeam: defineAction<HomeState, string>({
      run({ input, state }) {
        state.team = input;
      },
    }),
  },

  view({ state, actions }) {
    const members = DIRECTORY.filter(
      (member) => state.team === "All" || member.team === state.team
    );

    return (
      <Scaffold appBar={<AppBar title="Weavers Guild" />}>
        <Column padding="lg" gap="md">
          <Row gap="sm">
            {TEAMS.map((team) => (
              <Button
                variant={state.team === team ? "primary" : "secondary"}
                onPress={() => actions.setTeam(team)}
              >
                {team}
              </Button>
            ))}
          </Row>

          <Column gap="sm">
            {members.map((member) => (
              <Card
                padding="md"
                radius="md"
                background="surfaceRaised"
              >
                <Column gap="xs">
                  <Text variant="title">{member.name}</Text>
                  <Text variant="body">
                    {member.role} · {member.team} team
                  </Text>
                </Column>
              </Card>
            ))}
          </Column>
        </Column>
      </Scaffold>
    );
  },
});

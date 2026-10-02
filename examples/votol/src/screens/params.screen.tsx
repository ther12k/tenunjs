import { defineAction, defineScreen } from "@tenunjs/core";
import { AppBar, Button, Card, Column, Scaffold, Text } from "@tenunjs/widgets";
import { ListTile } from "@tenunjs-examples/ui-kit";
import { groupParams, type VotolSnapshot } from "../snapshot";

/**
 * Parameters: all decoded controller fields grouped by packet (P1..P7),
 * read-only — same posture as the web dashboard's config pages.
 */
export const ParamsScreen = defineScreen({
  name: "Params",

  initialState: (): { snapshot: VotolSnapshot | null } => ({ snapshot: null }),

  actions: {
    sync: defineAction<{ snapshot: VotolSnapshot | null }, VotolSnapshot>({
      run({ input, state }) {
        (state as unknown as { snapshot: VotolSnapshot }).snapshot = input;
      },
    }),
    readParams: defineAction<{ snapshot: VotolSnapshot | null }, void>({
      run({ services }) {
        (services as { command?: (action: string) => void }).command?.("read_params");
      },
    }),
  },

  view({ state, actions }) {
    const snap = state.snapshot;
    const cmd = { command: (action: string) => actions.readParams() };
    const groups = snap ? groupParams(snap.params) : [];

    return (
      <Scaffold appBar={<AppBar title="Parameters" />}>
        <Column padding="lg" gap="lg">
          {groups.length === 0 ? (
            <Card padding="md" radius="md">
              <Text variant="title">No parameters loaded</Text>
              <Text variant="body" color="#9AA3B2">
                connect the bridge, then press "Read parameters" — decoded
                controller fields (P1..P7) appear here, read-only.
              </Text>
            </Card>
          ) : (
            groups.map((group) => (
              <Card key={group.packet} padding="md" radius="md" background="surfaceRaised">
                <Column gap="sm">
                  <Text variant="title" color="#F59E0B">
                    {group.packet} · {group.rows.length} fields
                  </Text>
                  {group.rows.map(([field, value]) => (
                    <ListTile key={field} title={field} subtitle={value} />
                  ))}
                </Column>
              </Card>
            ))
          )}

          <Button variant="primary" onPress={() => cmd.command?.("read_params")}>
            ↻ Read from controller
          </Button>
          <Text variant="caption">
            read-only by design — parameter WRITING is deliberately not offered
          </Text>
        </Column>
      </Scaffold>
    );
  },
});

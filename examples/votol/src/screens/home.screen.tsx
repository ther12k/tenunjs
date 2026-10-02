import { defineAction, defineScreen } from "@tenunjs/core";
import { AppBar, Button, Card, Column, Row, Scaffold, Text } from "@tenunjs/widgets";
import { ListTile } from "@tenunjs-examples/ui-kit";
import type { VotolSnapshot } from "../snapshot";

/**
 * Home: link status, the three headline telemetry numbers, and navigation
 * to the telemetry / keyless / parameters surfaces. Live data comes from
 * the snapshot service — views read it on every render.
 */
export const HomeScreen = defineScreen({
  name: "Home",

  initialState: (): { snapshot: VotolSnapshot | null } => ({ snapshot: null }),

  actions: {
    sync: defineAction<{ snapshot: VotolSnapshot | null }, VotolSnapshot>({
      run({ input, state }) {
        (state as unknown as { snapshot: VotolSnapshot }).snapshot = input;
      },
    }),
    // services reach action RUNS, not views — navigation goes through here
    go: defineAction<{ snapshot: VotolSnapshot | null }, string>({
      run({ input, services }) {
        (services as { navigate?: (route: string) => void }).navigate?.(input);
      },
    }),
  },

  view({ state, actions }) {
    const snap = state.snapshot;
    const nav = { navigate: (route: string) => actions.go(route) };
    const t = snap?.telemetry ?? null;

    return (
      <Scaffold appBar={<AppBar title="VOTOL" />}>
        <Column padding="lg" gap="lg">
          <Card padding="md" radius="md" background="surfaceRaised">
            <Column gap="xs">
              <Row gap="sm">
                <Text variant="label">BRIDGE </Text>
                <Text variant="body" color={snap?.link.online ? "#10B981" : "#EF4444"}>
                  {snap?.link.online
                    ? `online · ${snap.link.host}:${snap.link.port}`
                    : "offline"}
                </Text>
              </Row>
              <Row gap="sm">
                <Text variant="label">FRAMES </Text>
                <Text variant="body">
                  {snap
                    ? `${snap.link.framesRx} rx · last ${snap.link.lastFrameAgeS ?? "—"} s ago`
                    : "waiting for data…"}
                </Text>
              </Row>
              <Row gap="sm">
                <Text variant="label">ALARM </Text>
                <Text
                  variant="body"
                  color={
                    !snap?.keyless.configured
                      ? "#9AA3B2"
                      : snap.keyless.armed
                        ? "#EF4444"
                        : "#10B981"
                  }
                >
                  {!snap?.keyless.configured
                    ? "not configured"
                    : snap.keyless.reachable
                      ? snap.keyless.armed
                        ? "🔒 ARMED"
                        : "🔓 disarmed"
                      : "module offline"}
                </Text>
              </Row>
            </Column>
          </Card>

          <Row gap="sm">
            <Card padding="md" radius="md">
              <Column gap="xs">
                <Text variant="label" color="#F59E0B">VOLTAGE</Text>
                <Text variant="headline" color="#F59E0B">
                  {t?.voltage_v != null ? t.voltage_v.toFixed(1) : "–"}
                </Text>
                <Text variant="caption">V</Text>
              </Column>
            </Card>
            <Card padding="md" radius="md">
              <Column gap="xs">
                <Text variant="label" color="#3B82F6">CURRENT</Text>
                <Text variant="headline" color="#3B82F6">
                  {t?.current_a != null ? t.current_a.toFixed(1) : "–"}
                </Text>
                <Text variant="caption">A</Text>
              </Column>
            </Card>
            <Card padding="md" radius="md">
              <Column gap="xs">
                <Text variant="label" color="#8B5CF6">RPM</Text>
                <Text variant="headline" color="#8B5CF6">
                  {t?.rpm != null ? Math.round(t.rpm) : "–"}
                </Text>
                <Text variant="caption">rpm</Text>
              </Column>
            </Card>
          </Row>

          <Column gap="sm">
            <ListTile
              title="Live telemetry"
              subtitle="LOCAL observe mode · never drives the motor"
              trailing={
                <Button variant="tonal" onPress={() => nav.navigate?.("telemetry")}>
                  Open
                </Button>
              }
            />
            <ListTile
              title="Keyless & alarm"
              subtitle="arm / disarm / panic · fob status"
              trailing={
                <Button variant="tonal" onPress={() => nav.navigate?.("keyless")}>
                  Open
                </Button>
              }
            />
            <ListTile
              title="Parameters"
              subtitle={`${snap?.params.length ?? 0} fields from the controller`}
              trailing={
                <Button variant="tonal" onPress={() => nav.navigate?.("params")}>
                  Open
                </Button>
              }
            />
          </Column>

          <Button
            variant={snap?.link.monitor ? "secondary" : "primary"}
            onPress={() => nav.navigate?.("telemetry")}
          >
            {snap?.link.monitor ? "Monitoring live — open telemetry" : "Start monitoring"}
          </Button>
          <Text variant="caption">
            data flows: controller → ESP32 bridge → dashboard backend → this app
          </Text>
        </Column>
      </Scaffold>
    );
  },
});

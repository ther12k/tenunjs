import { defineAction, defineScreen } from "@tenunjs/core";
import { AppBar, Button, Card, Column, Row, Scaffold, Text } from "@tenunjs/widgets";
import { Chip, ProgressRing, Switch } from "@tenunjs-examples/ui-kit";
import type { VotolSnapshot } from "../snapshot";

/**
 * Live telemetry: activity rings for the three headline numbers (scaled to
 * the dashboard's auto-ranges), temperature rings, status flags, and the
 * monitor switch. Read-only by protocol: the backend polls with SHOW in
 * LOCAL mode (0xAA) and never drives the motor.
 */
/** Gauge goals mirror the web dashboard's initial ranges (fixed for v1). */
const MAX_V = 120;
const MAX_A = 100;
const MAX_R = 6000;

export const TelemetryScreen = defineScreen({
  name: "Telemetry",

  initialState: (): { snapshot: VotolSnapshot | null } => ({ snapshot: null }),

  actions: {
    sync: defineAction<{ snapshot: VotolSnapshot | null }, VotolSnapshot>({
      run({ input, state }) {
        (state as unknown as { snapshot: VotolSnapshot }).snapshot = input;
      },
    }),
    toggleMonitor: defineAction<{ snapshot: VotolSnapshot | null }, boolean>({
      run({ input, services }) {
        (services as { command?: (action: string) => void }).command?.(input ? "monitor_on" : "monitor_off");
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
    const t = snap?.telemetry ?? null;

    const statusColor =
      t?.status === "FAULT" ? "#EF4444" : t?.status === "RUN" ? "#10B981" : "#9AA3B2";

    return (
      <Scaffold appBar={<AppBar title="Live telemetry" />}>
        <Column padding="lg" gap="lg">
          <Card padding="md" radius="md" background="surfaceRaised">
            <Row gap="lg">
              <ProgressRing
                value={t?.voltage_v ?? 0}
                goal={MAX_V}
                color="#F59E0B"
                caption={`${t?.voltage_v?.toFixed(1) ?? "–"} V`}
              />
              <ProgressRing
                value={t?.current_a ?? 0}
                goal={MAX_A}
                color="#3B82F6"
                caption={`${t?.current_a?.toFixed(1) ?? "–"} A`}
              />
              <ProgressRing
                value={t?.rpm ?? 0}
                goal={MAX_R}
                color="#8B5CF6"
                caption={`${t?.rpm != null ? Math.round(t.rpm) : "–"} rpm`}
              />
            </Row>
          </Card>

          <Row gap="sm">
            <Chip label={`gear ${t?.gear ?? "–"}`} selected={t?.gear != null} />
            <Chip label={t?.status ?? "state –"} selected={t?.status === "RUN"} />
            <Chip label={`fault ${t?.fault_code ?? 0}`} selected={(t?.fault_code ?? 0) > 0} />
          </Row>
          <Row gap="sm">
            <Chip label="brake" selected={t?.brake === true} />
            <Chip label="reverse" selected={t?.reverse === true} />
            <Chip label="regen" selected={t?.regen === true} />
          </Row>

          {t != null && t.fault_code != null && t.fault_code > 0 ? (
            <Card padding="md" radius="md" background="#2A1115">
              <Text variant="title" color="#EF4444">⚠ fault {t.fault_code}</Text>
              <Text variant="body" color="#F5F7FB">
                controller reports fault code {t.fault_code} — check the wiring guide
              </Text>
            </Card>
          ) : null}

          <Row gap="lg">
            <Card padding="md" radius="md">
              <Column gap="xs">
                <Text variant="label">CONTROLLER</Text>
                <Text variant="title" color={(t?.controller_temp_c ?? 0) >= 70 ? "#EF4444" : "#10B981"}>
                  {t?.controller_temp_c != null ? `${t.controller_temp_c} °C` : "–"}
                </Text>
              </Column>
            </Card>
            <Card padding="md" radius="md">
              <Column gap="xs">
                <Text variant="label">MOTOR</Text>
                <Text variant="title" color={(t?.motor_temp_c ?? 0) >= 70 ? "#EF4444" : "#10B981"}>
                  {t?.motor_temp_c != null ? `${t.motor_temp_c} °C` : "–"}
                </Text>
              </Column>
            </Card>
          </Row>

          <Card padding="md" radius="md" background="surfaceRaised">
            <Row gap="md">
              <Switch
                on={snap?.link.monitor === true}
                onChange={(next) => actions.toggleMonitor(next)}
              />
              <Column gap="xs">
                <Text variant="title">{snap?.link.monitor ? "Monitoring" : "Monitor off"}</Text>
                <Text variant="body" color="#9AA3B2">
                  {snap?.link.answering == null
                    ? "no valid frames yet"
                    : snap.link.answering
                      ? `controller answering · last frame ${snap.link.lastFrameAgeS ?? "–"} s ago`
                      : "link up but frames are stale"}
                </Text>
              </Column>
            </Row>
          </Card>

          <Button variant="secondary" onPress={() => cmd.command?.("read_params")}>
            Read parameters
          </Button>
          <Text variant="caption">status {t?.status ?? "–"} · LOCAL observe — never drives the motor</Text>
        </Column>
      </Scaffold>
    );
  },
});

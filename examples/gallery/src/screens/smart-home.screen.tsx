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
import { Avatar, Chip, ListTile } from "@tenunjs-examples/ui-kit";

/**
 * Smart home dashboard module: scene chips, grouped rooms, and live device
 * tiles with icon avatars and on/off actions — the classic Flutter home
 * automation reference layout.
 */
export interface Device {
  readonly name: string;
  readonly room: "Living room" | "Kitchen" | "Bedroom";
  readonly kind: "light" | "speaker" | "thermostat" | "lock";
  readonly on: boolean;
}

export interface SmartHomeState {
  readonly devices: readonly Device[];
  readonly activeScene: "Morning" | "Movie" | "Away" | null;
}

const GLYPHS: Record<Device["kind"], string> = {
  light: "💡",
  speaker: "🔊",
  thermostat: "🌊",
  lock: "🔒",
};

export const SmartHomeScreen = defineScreen({
  name: "SmartHome",

  initialState: (): SmartHomeState => ({
    devices: [
      { name: "Ceiling light", room: "Living room", kind: "light", on: true },
      { name: "Speaker", room: "Living room", kind: "speaker", on: false },
      { name: "Coffee maker", room: "Kitchen", kind: "thermostat", on: false },
      { name: "Bedside lamp", room: "Bedroom", kind: "light", on: false },
    ],
    activeScene: null,
  }),

  actions: {
    toggle: defineAction<SmartHomeState, string>({
      run({ input, state }) {
        const devices = state.devices.map((d) =>
          d.name === input ? { ...d, on: !d.on } : d
        );
        (state as unknown as { devices: Device[] }).devices = devices;
      },
    }),

    applyScene: defineAction<SmartHomeState, SmartHomeState["activeScene"]>({
      run({ input, state }) {
        const scene = input;
        (state as unknown as { activeScene: SmartHomeState["activeScene"] }).activeScene = scene;
        const devices = state.devices.map((d) => {
          if (scene === "Morning") {
            return d.room === "Kitchen" || d.kind === "light" ? { ...d, on: true } : { ...d, on: false };
          }
          if (scene === "Movie") {
            return d.room === "Living room" ? { ...d, on: true } : { ...d, on: false };
          }
          // Away: everything off.
          return { ...d, on: false };
        });
        (state as unknown as { devices: Device[] }).devices = devices;
      },
    }),
  },

  view({ state, actions }) {
    const rooms = ["Living room", "Kitchen", "Bedroom"] as const;
    const scenes: Array<NonNullable<SmartHomeState["activeScene"]>> = [
      "Morning",
      "Movie",
      "Away",
    ];

    return (
      <Scaffold appBar={<AppBar title="Smart home" />}>
        <Column padding="lg" gap="lg">
          <Card padding="md" radius="md" background="surfaceRaised">
            <Column gap="sm">
              <Text variant="title">Scenes</Text>
              <Row gap="sm">
                {scenes.map((scene) => (
                  <Chip
                    key={scene}
                    label={scene}
                    selected={state.activeScene === scene}
                    onSelect={() => actions.applyScene(scene)}
                  />
                ))}
              </Row>
              {state.activeScene ? (
                <Text variant="body" color="#9AA3B2">Active scene: {state.activeScene}</Text>
              ) : (
                <Text variant="body" color="#9AA3B2">No scene active</Text>
              )}
            </Column>
          </Card>

          {rooms.map((room) => {
            const devices = state.devices.filter((d) => d.room === room);
            if (devices.length === 0) return null;
            return (
              <Column key={room} gap="sm">
                <Text variant="title">{room}</Text>
                {devices.map((device) => (
                  <ListTile
                    key={device.name}
                    leading={
                      <Avatar
                        label={GLYPHS[device.kind]!}
                        color={device.on ? "#173327" : "#232F49"}
                        textColor={device.on ? "#3DD68C" : "#4C8DFF"}
                      />
                    }
                    title={device.name}
                    subtitle={`${device.kind} · ${device.on ? "on" : "off"}`}
                    trailing={
                      <Button
                        variant={device.on ? "primary" : "secondary"}
                        onPress={() => actions.toggle(device.name)}
                      >
                        {device.on ? "Turn off" : "Turn on"}
                      </Button>
                    }
                  />
                ))}
              </Column>
            );
          })}
        </Column>
      </Scaffold>
    );
  },
});

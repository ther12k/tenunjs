import { defineAction, defineScreen } from "@tenunjs/core";
import { Center, Column, Container, GestureDetector, Row, Scaffold, Text, TextField } from "@tenunjs/widgets";
import { TV_PALETTE } from "../theme";
import { RemoteButton } from "../widgets";

export interface DiscoveredTv {
  name: string;
  serviceType: string;
  domain: string;
  host?: string;
  port?: number;
  paired?: boolean;
}

export interface DiscoverState {
  scanning: boolean;
  devices: DiscoveredTv[];
  manualHost: string;
  manualPort: string;
  statusMessage: string;
}

export interface DiscoverServices {
  navigate(route: string): void;
  startDiscovery(): void;
  selectDevice(device: DiscoveredTv): void;
  connectManual(host: string, port: number): void;
}

export const DiscoverScreen = defineScreen({
  name: "Discover",

  initialState: (): DiscoverState => ({
    scanning: false,
    devices: [],
    manualHost: "192.168.1.100",
    manualPort: "6467",
    statusMessage: "Scanning for Android TV on LAN...",
  }),

  actions: {
    scan: defineAction<DiscoverState, void, DiscoverServices>({
      run: ({ state, services }) => {
        services.startDiscovery();
        return { ...state, scanning: true, statusMessage: "Browsing _androidtvremote2._tcp..." };
      },
    }),

    setManualHost: defineAction<DiscoverState, string>({
      run: ({ state, payload }) => ({
        ...state,
        manualHost: payload,
      }),
    }),

    setManualPort: defineAction<DiscoverState, string>({
      run: ({ state, payload }) => ({
        ...state,
        manualPort: payload,
      }),
    }),

    connectManual: defineAction<DiscoverState, void, DiscoverServices>({
      run: ({ state, services }) => {
        const port = parseInt(state.manualPort, 10) || 6467;
        services.connectManual(state.manualHost.trim(), port);
        return { ...state, statusMessage: `Connecting to ${state.manualHost}:${port}...` };
      },
    }),

    selectDevice: defineAction<DiscoverState, DiscoveredTv, DiscoverServices>({
      run: ({ state, payload, services }) => {
        services.selectDevice(payload);
        return { ...state, statusMessage: `Selected ${payload.name}...` };
      },
    }),
  },

  view: ({ state, dispatch }) => {
    return (
      <Scaffold background={TV_PALETTE.bg}>
        <Column padding={20} gap={16}>
          {/* Header */}
          <Column gap={4}>
            <Text variant="title" color={TV_PALETTE.text}>
              Android TV Remote
            </Text>
            <Text variant="body" color={TV_PALETTE.textMuted}>
              Select a TV discovered on your local network or enter its IP address.
            </Text>
          </Column>

          {/* Action Row */}
          <Row gap={12}>
            <RemoteButton
              label={state.scanning ? "Scanning..." : "Scan LAN"}
              color={TV_PALETTE.blue}
              textColor="#FFFFFF"
              width={120}
              height={44}
              onPress={() => dispatch("scan", undefined)}
              disabled={state.scanning}
            />
            <Center>
              <Text variant="caption" color={TV_PALETTE.textMuted}>
                {state.devices.length} TV(s) found
              </Text>
            </Center>
          </Row>

          {/* Discovered Devices List */}
          <Column gap={8}>
            <Text variant="label" color={TV_PALETTE.textMuted}>
              DISCOVERED DEVICES
            </Text>
            {state.devices.length === 0 ? (
              <Container
                color={TV_PALETTE.card}
                radius={12}
                padding={16}
                borderColor={TV_PALETTE.border}
                borderWidth={1}
              >
                <Center>
                  <Text variant="body" color={TV_PALETTE.textMuted}>
                    {state.statusMessage}
                  </Text>
                </Center>
              </Container>
            ) : (
              state.devices.map((tv) => (
                <GestureDetector
                  key={tv.name}
                  onTap={() => dispatch("selectDevice", tv)}
                >
                  <Container
                    color={TV_PALETTE.cardHighlight}
                    radius={12}
                    padding={16}
                    borderColor={tv.paired ? TV_PALETTE.emerald : TV_PALETTE.border}
                    borderWidth={1}
                  >
                    <Row gap={12}>
                      <Column gap={2}>
                        <Text variant="label" color={TV_PALETTE.text}>
                          📺 {tv.name}
                        </Text>
                        <Text variant="caption" color={TV_PALETTE.textMuted}>
                          {tv.host ? `${tv.host}:${tv.port ?? 6467}` : tv.serviceType}
                        </Text>
                      </Column>
                      <Container width={1} height={1} />
                      <Center>
                        <Text variant="label" color={tv.paired ? TV_PALETTE.emerald : TV_PALETTE.blue}>
                          {tv.paired ? "PAIRED" : "PAIR"}
                        </Text>
                      </Center>
                    </Row>
                  </Container>
                </GestureDetector>
              ))
            )}
          </Column>

          {/* Manual Entry Fallback */}
          <Column gap={8}>
            <Text variant="label" color={TV_PALETTE.textMuted}>
              MANUAL IP CONNECTION (FALLBACK)
            </Text>
            <Container
              color={TV_PALETTE.card}
              radius={12}
              padding={16}
              borderColor={TV_PALETTE.border}
              borderWidth={1}
            >
              <Column gap={12}>
                <Row gap={8}>
                  <Column gap={4}>
                    <Text variant="caption" color={TV_PALETTE.textMuted}>TV IP Address</Text>
                    <TextField
                      id="manual-host"
                      value={state.manualHost}
                      onChanged={(v: string) => dispatch("setManualHost", v)}
                    />
                  </Column>
                  <Column gap={4}>
                    <Text variant="caption" color={TV_PALETTE.textMuted}>Port</Text>
                    <TextField
                      id="manual-port"
                      value={state.manualPort}
                      onChanged={(v: string) => dispatch("setManualPort", v)}
                    />
                  </Column>
                </Row>
                <RemoteButton
                  label="Connect by IP"
                  color={TV_PALETTE.cardHighlight}
                  width={200}
                  height={40}
                  onPress={() => dispatch("connectManual", undefined)}
                />
              </Column>
            </Container>
          </Column>
        </Column>
      </Scaffold>
    );
  },
});

import { defineAction, defineScreen } from "@tenunjs/core";
import { Center, Column, Container, Row, Scaffold, Text, TextField } from "@tenunjs/widgets";
import { TV_PALETTE } from "../theme";
import { RemoteButton } from "../widgets";

export interface PairingState {
  tvName: string;
  host: string;
  port: number;
  pin: string;
  phase: "connecting" | "awaiting_pin" | "verifying" | "success" | "error";
  statusText: string;
  errorMessage: string | null;
}

export interface PairingServices {
  navigate(route: string): void;
  submitPin(pin: string): void;
  cancelPairing(): void;
  proceedToRemote(): void;
}

/** The runtime injects services as unknown; narrow to the screen's seam. */
const svc = (services: unknown): PairingServices => services as PairingServices;

export const PairingScreen = defineScreen({
  name: "Pairing",

  initialState: (): PairingState => ({
    tvName: "Android TV",
    host: "192.168.1.100",
    port: 6467,
    pin: "",
    phase: "connecting",
    statusText: "Initiating TLS handshake with TV...",
    errorMessage: null,
  }),

  actions: {
    setPin: defineAction<PairingState, string>({
      run: ({ state, input }) => ({
        ...state,
        pin: input.toUpperCase().slice(0, 6),
        errorMessage: null,
      }),
    }),

    submitPin: defineAction<PairingState, void>({
      run: ({ state, services }) => {
        const pin = state.pin.trim();
        if (pin.length !== 6 || !/^[0-9A-F]{6}$/i.test(pin)) {
          return { ...state, errorMessage: "PIN must be exactly 6 hex characters (e.g. A1B2C3)" };
        }
        svc(services).submitPin(pin);
        return { ...state, phase: "verifying", statusText: "Verifying PIN with TV..." };
      },
    }),

    cancel: defineAction<PairingState, void>({
      run: ({ state, services }) => {
        svc(services).cancelPairing();
        svc(services).navigate("discover");
        return state;
      },
    }),

    continueToRemote: defineAction<PairingState, void>({
      run: ({ state, services }) => {
        svc(services).proceedToRemote();
        svc(services).navigate("remote");
        return state;
      },
    }),
  },

  view: ({ state, actions }) => {
    return (
      <Scaffold>
        <Column padding={24} gap={20}>
          {/* Header */}
          <Column gap={6}>
            <Text variant="title" color={TV_PALETTE.text}>
              Pair with {state.tvName}
            </Text>
            <Text variant="body" color={TV_PALETTE.textMuted}>
              Target: {state.host}:{state.port}
            </Text>
          </Column>

          {/* Status Box */}
          <Container
            color={TV_PALETTE.card}
            radius={14}
            padding={20}
            borderColor={state.phase === "error" ? TV_PALETTE.red : TV_PALETTE.border}
            borderWidth={1}
          >
            <Column gap={12}>
              <Center>
                <Text
                  variant="label"
                  color={
                    state.phase === "success"
                      ? TV_PALETTE.emerald
                      : state.phase === "error"
                      ? TV_PALETTE.red
                      : TV_PALETTE.blue
                  }
                >
                  {state.statusText}
                </Text>
              </Center>

              {state.errorMessage ? (
                <Center>
                  <Text variant="caption" color={TV_PALETTE.red}>
                    {state.errorMessage}
                  </Text>
                </Center>
              ) : null}

              {/* PIN Entry Field when awaiting code */}
              {state.phase === "awaiting_pin" || state.phase === "verifying" || state.phase === "error" ? (
                <Column gap={12}>
                  <Text variant="body" color={TV_PALETTE.textMuted}>
                    Enter the 6-character code shown on your TV screen:
                  </Text>
                  <TextField
                    id="pairing-pin"
                    value={state.pin}
                    onChanged={(v: string) => actions.setPin(v)}
                  />
                  <Row gap={12}>
                    <RemoteButton
                      label="Submit PIN"
                      color={TV_PALETTE.blue}
                      textColor="#FFFFFF"
                      width={140}
                      height={46}
                      onPress={() => actions.submitPin(undefined)}
                      disabled={state.phase === "verifying" || state.pin.length !== 6}
                    />
                    <RemoteButton
                      label="Cancel"
                      color={TV_PALETTE.cardHighlight}
                      width={100}
                      height={46}
                      onPress={() => actions.cancel(undefined)}
                    />
                  </Row>
                </Column>
              ) : null}

              {/* Success Button */}
              {state.phase === "success" ? (
                <RemoteButton
                  label="Open Remote Control"
                  color={TV_PALETTE.emerald}
                  textColor="#FFFFFF"
                  width={200}
                  height={46}
                  onPress={() => actions.continueToRemote(undefined)}
                />
              ) : null}
            </Column>
          </Container>
        </Column>
      </Scaffold>
    );
  },
});

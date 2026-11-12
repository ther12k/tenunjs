import { defineAction, defineScreen } from "@tenunjs/core";
import { Center, Column, Container, Row, Scaffold, Text, TextField } from "@tenunjs/widgets";
import { TV_PALETTE } from "../theme";
import { AppTile, DPad, RemoteButton, VolumeRow } from "../widgets";
import { RemoteKeyCode, RemoteDirection, type RemoteDirectionVal } from "../protocol";

export interface RemoteState {
  tvName: string;
  connected: boolean;
  linkPhase: "offline" | "searching" | "linked";
  currentApp: string;
  volumeLevel: number;
  volumeMax: number;
  volumeMuted: boolean;
  inputText: string;
  lastAction: string;
}

export interface RemoteServices {
  navigate(route: string): void;
  sendKey(keyCode: number, direction: RemoteDirectionVal): void;
  sendText(text: string): void;
  launchApp(appLink: string): void;
  disconnect(): void;
}

/** The runtime injects services as unknown; narrow to the screen's seam. */
const svc = (services: unknown): RemoteServices => services as RemoteServices;

export const RemoteScreen = defineScreen({
  name: "Remote",

  initialState: (): RemoteState => ({
    tvName: "Living Room TV",
    connected: true,
    linkPhase: "linked",
    currentApp: "com.google.android.tvlauncher",
    volumeLevel: 20,
    volumeMax: 100,
    volumeMuted: false,
    inputText: "",
    lastAction: "Ready",
  }),

  actions: {
    keyTap: defineAction<RemoteState, number>({
      run: ({ state, input, services }) => {
        svc(services).sendKey(input, RemoteDirection.SHORT);
        return { ...state, lastAction: `Tap key ${input}` };
      },
    }),

    keyPressDown: defineAction<RemoteState, number>({
      run: ({ state, input, services }) => {
        // START_LONG begins held key repeat on the TV
        svc(services).sendKey(input, RemoteDirection.START_LONG);
        return { ...state, lastAction: `Hold start key ${input}` };
      },
    }),

    keyPressUp: defineAction<RemoteState, number>({
      run: ({ state, input, services }) => {
        // END_LONG terminates held key repeat on the TV
        svc(services).sendKey(input, RemoteDirection.END_LONG);
        return { ...state, lastAction: `Hold end key ${input}` };
      },
    }),

    setInputText: defineAction<RemoteState, string>({
      run: ({ state, input }) => ({
        ...state,
        inputText: input,
      }),
    }),

    submitText: defineAction<RemoteState, void>({
      run: ({ state, services }) => {
        const text = state.inputText.trim();
        if (!text) return state;
        svc(services).sendText(text);
        return { ...state, inputText: "", lastAction: `Sent text: "${text}"` };
      },
    }),

    launchApp: defineAction<RemoteState, string>({
      run: ({ state, input, services }) => {
        svc(services).launchApp(input);
        return { ...state, lastAction: `Launching ${input}...` };
      },
    }),

    volUp: defineAction<RemoteState, void>({
      run: ({ state, services }) => {
        svc(services).sendKey(RemoteKeyCode.KEYCODE_VOLUME_UP, RemoteDirection.SHORT);
        return {
          ...state,
          volumeLevel: Math.min(state.volumeMax, state.volumeLevel + 1),
          lastAction: "Volume Up",
        };
      },
    }),

    volDown: defineAction<RemoteState, void>({
      run: ({ state, services }) => {
        svc(services).sendKey(RemoteKeyCode.KEYCODE_VOLUME_DOWN, RemoteDirection.SHORT);
        return {
          ...state,
          volumeLevel: Math.max(0, state.volumeLevel - 1),
          lastAction: "Volume Down",
        };
      },
    }),

    toggleMute: defineAction<RemoteState, void>({
      run: ({ state, services }) => {
        svc(services).sendKey(RemoteKeyCode.KEYCODE_VOLUME_MUTE, RemoteDirection.SHORT);
        return {
          ...state,
          volumeMuted: !state.volumeMuted,
          lastAction: state.volumeMuted ? "Unmute" : "Mute",
        };
      },
    }),

    power: defineAction<RemoteState, void>({
      run: ({ state, services }) => {
        svc(services).sendKey(RemoteKeyCode.KEYCODE_POWER, RemoteDirection.SHORT);
        return { ...state, lastAction: "Power toggle" };
      },
    }),

    backToDiscover: defineAction<RemoteState, void>({
      run: ({ state, services }) => {
        svc(services).disconnect();
        svc(services).navigate("discover");
        return state;
      },
    }),
  },

  view: ({ state, actions }) => {
    const isOnline = state.linkPhase === "linked";
    const statusColor =
      state.linkPhase === "linked"
        ? TV_PALETTE.emerald
        : state.linkPhase === "searching"
        ? TV_PALETTE.amber
        : TV_PALETTE.red;

    return (
      <Scaffold>
        <Column padding={16} gap={16}>
          {/* Top Bar: TV Name, Connection Badge, Power */}
          <Row gap={12}>
            <Column gap={2}>
              <Text variant="title" color={TV_PALETTE.text}>
                📺 {state.tvName}
              </Text>
              <Row gap={6}>
                <Container
                  color={statusColor}
                  radius={4}
                  width={8}
                  height={8}
                />
                <Text variant="caption" color={statusColor}>
                  {state.linkPhase.toUpperCase()}
                </Text>
                <Text variant="caption" color={TV_PALETTE.textMuted}>
                  • {state.lastAction}
                </Text>
              </Row>
            </Column>
            <Container width={1} height={1} />
            <RemoteButton
              label="DISCONNECT"
              width={96}
              height={36}
              radius={8}
              color={TV_PALETTE.card}
              textColor={TV_PALETTE.textMuted}
              onPress={() => actions.backToDiscover(undefined)}
            />
            <RemoteButton
              label="⏻ POWER"
              width={80}
              height={36}
              radius={8}
              color={TV_PALETTE.red}
              textColor="#FFFFFF"
              onPress={() => actions.power(undefined)}
              disabled={!isOnline}
            />
          </Row>

          {/* Active App Banner */}
          <Container
            color={TV_PALETTE.card}
            radius={10}
            padding={10}
            borderColor={TV_PALETTE.border}
            borderWidth={1}
          >
            <Row gap={8}>
              <Text variant="caption" color={TV_PALETTE.textMuted}>Active TV App:</Text>
              <Text variant="label" color={TV_PALETTE.blue}>
                {state.currentApp.replace("com.google.android.", "")}
              </Text>
            </Row>
          </Container>

          {/* D-PAD (with explicit press, hold start, and hold end) */}
          <Center>
            <DPad
              onUp={() => actions.keyTap(RemoteKeyCode.KEYCODE_DPAD_UP)}
              onUpHoldStart={() => actions.keyPressDown(RemoteKeyCode.KEYCODE_DPAD_UP)}
              onUpHoldEnd={() => actions.keyPressUp(RemoteKeyCode.KEYCODE_DPAD_UP)}
              onDown={() => actions.keyTap(RemoteKeyCode.KEYCODE_DPAD_DOWN)}
              onDownHoldStart={() => actions.keyPressDown(RemoteKeyCode.KEYCODE_DPAD_DOWN)}
              onDownHoldEnd={() => actions.keyPressUp(RemoteKeyCode.KEYCODE_DPAD_DOWN)}
              onLeft={() => actions.keyTap(RemoteKeyCode.KEYCODE_DPAD_LEFT)}
              onLeftHoldStart={() => actions.keyPressDown(RemoteKeyCode.KEYCODE_DPAD_LEFT)}
              onLeftHoldEnd={() => actions.keyPressUp(RemoteKeyCode.KEYCODE_DPAD_LEFT)}
              onRight={() => actions.keyTap(RemoteKeyCode.KEYCODE_DPAD_RIGHT)}
              onRightHoldStart={() => actions.keyPressDown(RemoteKeyCode.KEYCODE_DPAD_RIGHT)}
              onRightHoldEnd={() => actions.keyPressUp(RemoteKeyCode.KEYCODE_DPAD_RIGHT)}
              onCenter={() => actions.keyTap(RemoteKeyCode.KEYCODE_DPAD_CENTER)}
              disabled={!isOnline}
            />
          </Center>

          {/* Nav Row: Back, Home, Menu */}
          <Center>
            <Row gap={16}>
              <RemoteButton
                label="↩ BACK"
                width={88}
                height={48}
                onPress={() => actions.keyTap(RemoteKeyCode.KEYCODE_BACK)}
                disabled={!isOnline}
              />
              <RemoteButton
                label="⌂ HOME"
                width={88}
                height={48}
                color={TV_PALETTE.cardHighlight}
                onPress={() => actions.keyTap(RemoteKeyCode.KEYCODE_HOME)}
                disabled={!isOnline}
              />
              <RemoteButton
                label="⚙ MENU"
                width={88}
                height={48}
                onPress={() => actions.keyTap(RemoteKeyCode.KEYCODE_SETTINGS)}
                disabled={!isOnline}
              />
            </Row>
          </Center>

          {/* Volume Control */}
          <Center>
            <VolumeRow
              onVolDown={() => actions.volDown(undefined)}
              onMute={() => actions.toggleMute(undefined)}
              onVolUp={() => actions.volUp(undefined)}
              level={state.volumeLevel}
              max={state.volumeMax}
              muted={state.volumeMuted}
              disabled={!isOnline}
            />
          </Center>

          {/* Text Input to TV */}
          <Column gap={6}>
            <Text variant="label" color={TV_PALETTE.textMuted}>
              KEYBOARD / SEARCH INPUT TO TV
            </Text>
            <Row gap={8}>
              <Container width={240} height={42}>
                <TextField
                  id="remote-input"
                  value={state.inputText}
                  onChanged={(v: string) => actions.setInputText(v)}
                />
              </Container>
              <RemoteButton
                label="Send Text"
                color={TV_PALETTE.blue}
                textColor="#FFFFFF"
                width={90}
                height={42}
                onPress={() => actions.submitText(undefined)}
                disabled={!isOnline || !state.inputText.trim()}
              />
            </Row>
          </Column>

          {/* Quick App Launchers */}
          <Column gap={8}>
            <Text variant="label" color={TV_PALETTE.textMuted}>
              QUICK LAUNCH APPS
            </Text>
            <Row gap={8}>
              <AppTile
                name="YouTube"
                color="#7F1D1D"
                onLaunch={() => actions.launchApp("https://www.youtube.com")}
                disabled={!isOnline}
              />
              <AppTile
                name="Netflix"
                color="#450A0A"
                onLaunch={() => actions.launchApp("https://www.netflix.com/title")}
                disabled={!isOnline}
              />
              <AppTile
                name="Prime"
                color="#1E3A8A"
                onLaunch={() => actions.launchApp("https://app.primevideo.com")}
                disabled={!isOnline}
              />
              <AppTile
                name="Spotify"
                color="#064E3B"
                onLaunch={() => actions.launchApp("spotify:")}
                disabled={!isOnline}
              />
            </Row>
          </Column>
        </Column>
      </Scaffold>
    );
  },
});

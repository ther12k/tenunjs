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
    keyTap: defineAction<RemoteState, number, RemoteServices>({
      run: ({ state, payload, services }) => {
        services.sendKey(payload, RemoteDirection.SHORT);
        return { ...state, lastAction: `Tap key ${payload}` };
      },
    }),

    keyPressDown: defineAction<RemoteState, number, RemoteServices>({
      run: ({ state, payload, services }) => {
        // START_LONG begins held key repeat on the TV
        services.sendKey(payload, RemoteDirection.START_LONG);
        return { ...state, lastAction: `Hold start key ${payload}` };
      },
    }),

    keyPressUp: defineAction<RemoteState, number, RemoteServices>({
      run: ({ state, payload, services }) => {
        // END_LONG terminates held key repeat on the TV
        services.sendKey(payload, RemoteDirection.END_LONG);
        return { ...state, lastAction: `Hold end key ${payload}` };
      },
    }),

    setInputText: defineAction<RemoteState, string>({
      run: ({ state, payload }) => ({
        ...state,
        inputText: payload,
      }),
    }),

    submitText: defineAction<RemoteState, void, RemoteServices>({
      run: ({ state, services }) => {
        const text = state.inputText.trim();
        if (!text) return state;
        services.sendText(text);
        return { ...state, inputText: "", lastAction: `Sent text: "${text}"` };
      },
    }),

    launchApp: defineAction<RemoteState, string, RemoteServices>({
      run: ({ state, payload, services }) => {
        services.launchApp(payload);
        return { ...state, lastAction: `Launching ${payload}...` };
      },
    }),

    volUp: defineAction<RemoteState, void, RemoteServices>({
      run: ({ state, services }) => {
        services.sendKey(RemoteKeyCode.KEYCODE_VOLUME_UP, RemoteDirection.SHORT);
        return {
          ...state,
          volumeLevel: Math.min(state.volumeMax, state.volumeLevel + 1),
          lastAction: "Volume Up",
        };
      },
    }),

    volDown: defineAction<RemoteState, void, RemoteServices>({
      run: ({ state, services }) => {
        services.sendKey(RemoteKeyCode.KEYCODE_VOLUME_DOWN, RemoteDirection.SHORT);
        return {
          ...state,
          volumeLevel: Math.max(0, state.volumeLevel - 1),
          lastAction: "Volume Down",
        };
      },
    }),

    toggleMute: defineAction<RemoteState, void, RemoteServices>({
      run: ({ state, services }) => {
        services.sendKey(RemoteKeyCode.KEYCODE_VOLUME_MUTE, RemoteDirection.SHORT);
        return {
          ...state,
          volumeMuted: !state.volumeMuted,
          lastAction: state.volumeMuted ? "Unmute" : "Mute",
        };
      },
    }),

    power: defineAction<RemoteState, void, RemoteServices>({
      run: ({ state, services }) => {
        services.sendKey(RemoteKeyCode.KEYCODE_POWER, RemoteDirection.SHORT);
        return { ...state, lastAction: "Power toggle" };
      },
    }),

    backToDiscover: defineAction<RemoteState, void, RemoteServices>({
      run: ({ state, services }) => {
        services.disconnect();
        services.navigate("discover");
        return state;
      },
    }),
  },

  view: ({ state, dispatch }) => {
    const isOnline = state.linkPhase === "linked";
    const statusColor =
      state.linkPhase === "linked"
        ? TV_PALETTE.emerald
        : state.linkPhase === "searching"
        ? TV_PALETTE.amber
        : TV_PALETTE.red;

    return (
      <Scaffold background={TV_PALETTE.bg}>
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
              onPress={() => dispatch("backToDiscover", undefined)}
            />
            <RemoteButton
              label="⏻ POWER"
              width={80}
              height={36}
              radius={8}
              color={TV_PALETTE.red}
              textColor="#FFFFFF"
              onPress={() => dispatch("power", undefined)}
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
              onUp={() => dispatch("keyTap", RemoteKeyCode.KEYCODE_DPAD_UP)}
              onUpHoldStart={() => dispatch("keyPressDown", RemoteKeyCode.KEYCODE_DPAD_UP)}
              onUpHoldEnd={() => dispatch("keyPressUp", RemoteKeyCode.KEYCODE_DPAD_UP)}
              onDown={() => dispatch("keyTap", RemoteKeyCode.KEYCODE_DPAD_DOWN)}
              onDownHoldStart={() => dispatch("keyPressDown", RemoteKeyCode.KEYCODE_DPAD_DOWN)}
              onDownHoldEnd={() => dispatch("keyPressUp", RemoteKeyCode.KEYCODE_DPAD_DOWN)}
              onLeft={() => dispatch("keyTap", RemoteKeyCode.KEYCODE_DPAD_LEFT)}
              onLeftHoldStart={() => dispatch("keyPressDown", RemoteKeyCode.KEYCODE_DPAD_LEFT)}
              onLeftHoldEnd={() => dispatch("keyPressUp", RemoteKeyCode.KEYCODE_DPAD_LEFT)}
              onRight={() => dispatch("keyTap", RemoteKeyCode.KEYCODE_DPAD_RIGHT)}
              onRightHoldStart={() => dispatch("keyPressDown", RemoteKeyCode.KEYCODE_DPAD_RIGHT)}
              onRightHoldEnd={() => dispatch("keyPressUp", RemoteKeyCode.KEYCODE_DPAD_RIGHT)}
              onCenter={() => dispatch("keyTap", RemoteKeyCode.KEYCODE_DPAD_CENTER)}
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
                onPress={() => dispatch("keyTap", RemoteKeyCode.KEYCODE_BACK)}
                disabled={!isOnline}
              />
              <RemoteButton
                label="⌂ HOME"
                width={88}
                height={48}
                color={TV_PALETTE.cardHighlight}
                onPress={() => dispatch("keyTap", RemoteKeyCode.KEYCODE_HOME)}
                disabled={!isOnline}
              />
              <RemoteButton
                label="⚙ MENU"
                width={88}
                height={48}
                onPress={() => dispatch("keyTap", RemoteKeyCode.KEYCODE_SETTINGS)}
                disabled={!isOnline}
              />
            </Row>
          </Center>

          {/* Volume Control */}
          <Center>
            <VolumeRow
              onVolDown={() => dispatch("volDown", undefined)}
              onMute={() => dispatch("toggleMute", undefined)}
              onVolUp={() => dispatch("volUp", undefined)}
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
                  onChanged={(v: string) => dispatch("setInputText", v)}
                />
              </Container>
              <RemoteButton
                label="Send Text"
                color={TV_PALETTE.blue}
                textColor="#FFFFFF"
                width={90}
                height={42}
                onPress={() => dispatch("submitText", undefined)}
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
                onLaunch={() => dispatch("launchApp", "https://www.youtube.com")}
                disabled={!isOnline}
              />
              <AppTile
                name="Netflix"
                color="#450A0A"
                onLaunch={() => dispatch("launchApp", "https://www.netflix.com/title")}
                disabled={!isOnline}
              />
              <AppTile
                name="Prime"
                color="#1E3A8A"
                onLaunch={() => dispatch("launchApp", "https://app.primevideo.com")}
                disabled={!isOnline}
              />
              <AppTile
                name="Spotify"
                color="#064E3B"
                onLaunch={() => dispatch("launchApp", "spotify:")}
                disabled={!isOnline}
              />
            </Row>
          </Column>
        </Column>
      </Scaffold>
    );
  },
});

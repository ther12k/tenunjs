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
import { Avatar, Divider, ListTile, Switch } from "@tenunjs-examples/ui-kit";

/**
 * Grouped settings module: account header, preference tiles with real
 * switches, and an about section — the classic Flutter settings reference
 * layout.
 */
export interface SettingsState {
  readonly account: { name: string; plan: string };
  readonly preferences: {
    readonly darkMode: boolean;
    readonly notifications: boolean;
    readonly analytics: boolean;
    readonly haptics: boolean;
  };
  readonly about: { version: string; license: string };
}

export const SettingsScreen = defineScreen({
  name: "Settings",

  initialState: (): SettingsState => ({
    account: { name: "Rizky", plan: "Weaver Pro" },
    preferences: {
      darkMode: true,
      notifications: false,
      analytics: false,
      haptics: true,
    },
    about: { version: "0.1.0-alpha", license: "MIT" },
  }),

  actions: {
    togglePreference: defineAction<SettingsState, keyof SettingsState["preferences"]>({
      run({ input, state }) {
        const current = state.preferences[input];
        const preferences = { ...state.preferences, [input]: !current };
        (state as unknown as { preferences: SettingsState["preferences"] }).preferences = preferences;
      },
    }),

    resetToDefaults: defineAction<SettingsState, void>({
      run({ state }) {
        (state as unknown as { preferences: SettingsState["preferences"] }).preferences = {
          darkMode: true,
          notifications: false,
          analytics: false,
          haptics: true,
        };
      },
    }),
  },

  view({ state, actions }) {
    const { preferences } = state;
    const toggles: Array<{ key: keyof SettingsState["preferences"]; label: string; hint: string }> = [
      { key: "darkMode", label: "Dark mode", hint: "Use the dark Rally-style theme" },
      { key: "notifications", label: "Notifications", hint: "Bill reminders and goal nudges" },
      { key: "analytics", label: "Share analytics", hint: "Anonymous usage statistics" },
      { key: "haptics", label: "Haptics", hint: "Vibrate on interactions" },
    ];

    return (
      <Scaffold appBar={<AppBar title="Settings" />}>
        <Column padding="lg" gap="lg">
          <ListTile
            leading={<Avatar label={state.account.name.slice(0, 1)} size={52} color="#4C8DFF" textColor="#FFFFFF" />}
            title={state.account.name}
            subtitle={state.account.plan}
          />

          <Column gap="sm">
            <Text variant="title">Preferences</Text>
            {toggles.map((toggle) => {
              const on = preferences[toggle.key];
              return (
                <ListTile
                  key={toggle.key}
                  title={toggle.label}
                  subtitle={toggle.hint}
                  trailing={<Switch on={on} onChange={() => actions.togglePreference(toggle.key)} />}
                />
              );
            })}
          </Column>

          <Row gap="sm">
            <Button variant="secondary" onPress={() => actions.resetToDefaults()}>
              Reset to defaults
            </Button>
          </Row>

          <Card padding="md" radius="md" background="surfaceRaised">
            <Column gap="xs">
              <Text variant="title">About</Text>
              <Text variant="body" color="#9AA3B2">
                Tenun Gallery {state.about.version} · {state.about.license} license
              </Text>
              <Text variant="body" color="#9AA3B2">
                Reference layouts inspired by public Flutter design studies.
              </Text>
              <Divider />
              <Text variant="body" color="#9AA3B2">
                Rendered by the TenunJS prototype display list.
              </Text>
            </Column>
          </Card>
        </Column>
      </Scaffold>
    );
  },
});

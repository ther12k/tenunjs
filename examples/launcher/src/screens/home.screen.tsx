import {
  defineAction,
  defineScreen,
  type ScreenActionContext,
} from "@tenunjs/core";
import type { LauncherAppEntry, LauncherCapability } from "@tenunjs/platform";

import {
  AppBar,
  Button,
  Card,
  Column,
  GestureDetector,
  Scaffold,
  SizedBox,
  Text,
  Wrap,
} from "@tenunjs/widgets";

/**
 * The services context this screen binds. Hosts compose the TN-147
 * capability into the runtime's services (defineHostCapabilities or a
 * direct object); a host without it leaves `launcher` undefined and the
 * screen renders its degradation surface instead of a broken grid.
 */
export interface LauncherServices {
  launcher?: LauncherCapability;
}

export interface LauncherHomeState {
  /** Apps from the host, in host order (commonly label-sorted). */
  apps: LauncherAppEntry[];
  /** "loading" until the first listApps settles. */
  status: "loading" | "ready" | "failed";
  /** CapabilityFailureKind of the last listApps/launch failure, if any. */
  failureKind: string | null;
  /** Long-press target: the app whose options panel is open. */
  optionsFor: LauncherAppEntry | null;
  /** Observable launch effect — the appId of the last ok launch. */
  lastLaunched: string | null;
}

/** v1 tile glyph: the host's glyph, else a label monogram. */
function tileGlyph(app: LauncherAppEntry): string {
  if (app.iconGlyph !== null && app.iconGlyph !== "") return app.iconGlyph;
  const monogram = app.label.trim().charAt(0).toUpperCase();
  return monogram === "" ? "▣" : monogram;
}

async function loadAppsInto(
  state: LauncherHomeState,
  services: LauncherServices
): Promise<void> {
  const launcher = services.launcher;
  if (launcher === undefined) {
    state.status = "failed";
    state.failureKind = "unsupported";
    return;
  }
  const result = await launcher.listApps();
  if (result.ok) {
    state.apps = [...result.value];
    state.status = "ready";
    state.failureKind = null;
  } else {
    state.status = "failed";
    state.failureKind = result.failure.kind;
  }
}

export const HomeScreen = defineScreen({
  name: "LauncherHome",

  initialState: (): LauncherHomeState => ({
    apps: [],
    status: "loading",
    failureKind: null,
    optionsFor: null,
    lastLaunched: null,
  }),

  actions: {
    /** Mount-time enumeration; safe to re-run as a refresh. */
    loadApps: defineAction<LauncherHomeState, void>({
      run: async ({ state, services }) => {
        await loadAppsInto(state, services as LauncherServices);
      },
    }),

    /** Runs the launch the tap performed; records the observable effect. */
    launchApp: defineAction<LauncherHomeState, LauncherAppEntry>({
      run: async ({ state, services, input }) => {
        const app: LauncherAppEntry = input;
        const launcher = (services as LauncherServices).launcher;
        if (launcher === undefined) {
          state.failureKind = "unsupported";
          return;
        }
        const result = await launcher.launch(app.appId);
        if (result.ok) {
          state.lastLaunched = app.appId;
          state.failureKind = null;
        } else {
          state.failureKind = result.failure.kind;
        }
      },
    }),

    /** The long-press target (TN-148): open this app's options panel. */
    openOptions: defineAction<LauncherHomeState, LauncherAppEntry>({
      run: ({ state, input }) => {
        state.optionsFor = input;
      },
    }),

    closeOptions: defineAction<LauncherHomeState, void>({
      run: ({ state }) => {
        state.optionsFor = null;
      },
    }),
  },

  view({ state, actions }) {
    return (
      <Scaffold appBar={<AppBar title="Apps" />}>
        <Column padding="md" gap="md">
          {state.optionsFor !== null ? (
            <Card padding="md" radius="md" background="surfaceRaised">
              <Column gap="sm">
                <Text variant="title">{state.optionsFor.label}</Text>
                <Text variant="body">{state.optionsFor.appId}</Text>
                <Button onPress={actions.closeOptions}>Close</Button>
              </Column>
            </Card>
          ) : null}

          {state.status === "failed" ? (
            <Card padding="md" radius="md" background="surfaceRaised">
              <Column gap="sm">
                <Text variant="title">Apps unavailable</Text>
                <Text variant="body">
                  {state.failureKind === "denied"
                    ? "App-list permission was refused. Grant it in system settings and reopen the drawer."
                    : `This host cannot list apps (${state.failureKind ?? "unknown"}).`}
                </Text>
                <Button onPress={() => actions.loadApps()}>Retry</Button>
              </Column>
            </Card>
          ) : null}

          {state.status === "loading" ? <Text variant="body">Loading apps…</Text> : null}

          {state.status === "ready" && state.apps.length === 0 ? (
            <Text variant="body">No launchable apps found.</Text>
          ) : null}

          <Wrap spacing="md" runSpacing="md">
            {state.apps.map((app) => (
              <GestureDetector
                key={app.appId}
                onTap={() => actions.launchApp(app)}
                onLongPress={() => actions.openOptions(app)}
              >
                <SizedBox width={156}>
                  <Column gap="xs" align="center">
                    <Text variant="title">{tileGlyph(app)}</Text>
                    <Text variant="body">{app.label}</Text>
                  </Column>
                </SizedBox>
              </GestureDetector>
            ))}
          </Wrap>
        </Column>
      </Scaffold>
    );
  },
});

import { defineScreen } from "@tenunjs/core";
import {
  AppBar,
  Button,
  Column,
  Row,
  Scaffold,
  Text,
} from "@tenunjs/widgets";
import type { WidgetNode } from "@tenunjs/jsx-runtime";
import { CanvasBox, ModalDrawer, textWidth } from "@tenunjs-examples/ui-kit";
import { SHOWCASE_APPS, type ShowcaseAppEntry } from "../data";

/**
 * The launcher home: an app-icon grid, the way a device home screen shows
 * every installed app at a glance. Tapping an icon is the whole selection
 * gesture — the host adapter promotes it to an app-session transition.
 */
export interface ShowcaseHomeState {
  opened: string | null;
  drawerOpen: boolean;
}

const CELL_W = 208;
const ICON = 116;

/** One home-screen icon: gradient tile, glyph, label — tap anywhere on it. */
function AppIcon(props: { app: ShowcaseAppEntry; onOpen: () => void }): WidgetNode {
  const { app } = props;
  const height = ICON + 64;
  return CanvasBox({
    width: CELL_W,
    height,
    paint: (origin, put, tap) => {
      const ix = (origin.w - ICON) / 2;
      put({ op: "rect", x: ix - 5, y: 6, w: ICON + 10, h: ICON + 12, r: 34, color: "#33000000" });
      put({ op: "gradient", x: ix, y: 0, w: ICON, h: ICON, r: 30, color: app.accent, colorTo: "#141821" });
      put({ op: "circle", cx: ix + ICON * 0.72, cy: ICON * 0.26, r: ICON * 0.3, color: "#22FFFFFF" });
      put({
        op: "text",
        x: ix + (ICON - textWidth(app.glyph, 52)) / 2,
        y: ICON / 2 + 52 * 0.36,
        text: app.glyph,
        size: 52,
        weight: 600,
        color: "#FFFFFF",
      });
      put({
        op: "text",
        x: (origin.w - textWidth(app.title, 15)) / 2,
        y: ICON + 36,
        text: app.title,
        size: 15,
        weight: 600,
        color: "#F5F7FB",
      });
      tap({ x: 0, y: 0, w: origin.w, h: height }, props.onOpen);
    },
  });
}

export const LauncherScreen = defineScreen({
  name: "FlutterShowcaseLauncher",

  initialState: (): ShowcaseHomeState => ({
    opened: null,
    drawerOpen: false,
  }),

  actions: {
    open({ state, input }: { state: ShowcaseHomeState; input: string }) {
      state.opened = input;
      state.drawerOpen = false;
    },
    setDrawer({ state, input }: { state: ShowcaseHomeState; input: boolean }) {
      state.drawerOpen = input;
    },
  },

  view({ state, actions }) {
    const rows: ShowcaseAppEntry[][] = [];
    for (let index = 0; index < SHOWCASE_APPS.length; index += 3) {
      rows.push(SHOWCASE_APPS.slice(index, index + 3));
    }
    return (
      <Scaffold appBar={<AppBar title="Launcher" onMenu={() => actions.setDrawer(true)} />}>
        <Column padding="lg" gap="lg">
          <Column gap="xs">
            <Text variant="caption" color="#F5A56B">TENUNJS LAUNCHER</Text>
            <Text variant="display">Beautiful by design</Text>
            <Text variant="body" color="#AEB8C8">
              {SHOWCASE_APPS.length} independent studies — open one, close it, and its state is still there.
            </Text>
            {state.opened ? (
              <Text variant="caption" color="#70D6A2">Last opened: {state.opened}</Text>
            ) : null}
          </Column>

          <Column gap="lg">
            {rows.map((row, rowIndex) => (
              <Row key={`launcher-row-${rowIndex}`} justify="between">
                {row.map((app) => (
                  <AppIcon key={app.id} app={app} onOpen={() => actions.open(app.id)} />
                ))}
              </Row>
            ))}
          </Column>

          <Row justify="between" align="center">
            <Text variant="caption" color="#AEB8C8">MIT-inspired reference, TenunJS-native implementation.</Text>
            <Button variant="text" onPress={() => actions.setDrawer(true)}>All apps</Button>
          </Row>

          <ModalDrawer
            open={state.drawerOpen}
            heading="Installed studies"
            items={SHOWCASE_APPS.map((app) => ({ glyph: app.glyph, label: app.title }))}
            active={state.opened ? Math.max(0, SHOWCASE_APPS.findIndex((app) => app.id === state.opened)) : -1}
            onSelect={(index) => actions.open(SHOWCASE_APPS[index]!.id)}
            onDismiss={() => actions.setDrawer(false)}
          />
        </Column>
      </Scaffold>
    );
  },
});

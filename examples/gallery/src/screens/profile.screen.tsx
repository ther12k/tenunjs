import { defineScreen } from "@tenunjs/core";
import {
  Button,
  Card,
  Column,
  Row,
  Scaffold,
  Text,
} from "@tenunjs/widgets";
import {
  Avatar,
  CanvasBox,
  ListTile,
  SegmentedButton,
  Sparkline,
  StarRating,
  Switch,
  Tabs,
  textWidth,
} from "@tenunjs-examples/ui-kit";

/**
 * Profile & account — the classic e-commerce template profile page (the
 * profile/account family in abuanwar072's E-commerce-Complete-Flutter-UI
 * and mitesh77's Best-Flutter-UI-Templates): gradient hero with avatar and
 * handle, a three-up stats row, tabs, and grouped settings with a logout.
 */

export interface ProfileState {
  tab: number;
  darkMode: boolean;
  units: number;
  loggedOut: boolean;
}

export const ProfileScreen = defineScreen({
  name: "ProfileAccount",

  initialState: (): ProfileState => ({
    tab: 0,
    darkMode: true,
    units: 0,
    loggedOut: false,
  }),

  actions: {
    setTab({ state, input }: { state: ProfileState; input: number }) {
      state.tab = input;
    },
    toggleDark({ state }: { state: ProfileState }) {
      state.darkMode = !state.darkMode;
    },
    setUnits({ state, input }: { state: ProfileState; input: number }) {
      state.units = input;
    },
    logOut({ state }: { state: ProfileState }) {
      state.loggedOut = true;
    },
    signIn({ state }: { state: ProfileState }) {
      state.loggedOut = false;
    },
  },

  view({ state, actions }) {
    if (state.loggedOut) {
      return (
        <Scaffold>
          <Column padding="lg" gap="lg">
            <Card padding="lg" radius="lg" background="surfaceRaised">
              <Column gap="md">
                <Text variant="headline">You're signed out</Text>
                <Text variant="body" color="#9AA3B2">
                  Your garden keeps growing while you're away.
                </Text>
                <Button variant="primary" onPress={() => actions.signIn()}>
                  Sign back in
                </Button>
              </Column>
            </Card>
          </Column>
        </Scaffold>
      );
    }

    return (
      <Scaffold>
        <Column padding="lg" gap="lg">
          {/* Gradient hero with the avatar drawn in-canvas — the template
              profile header, in display-list ops. */}
          <CanvasBox
            height={316}
            paint={(origin, put) => {
              const w = origin.w;
              put({ op: "gradient", x: 0, y: 0, w, h: 316, r: 28, color: "#24345C", colorTo: "#141A2B" });
              put({ op: "circle", cx: w - 70, cy: 60, r: 84, color: "#224C8DFF" });
              put({ op: "circle", cx: 52, cy: 264, r: 56, color: "#22FFFFFF" });
              // Avatar with a soft on-hero ring.
              put({ op: "circle", cx: w / 2, cy: 104, r: 56, color: "#33FFFFFF" });
              put({ op: "circle", cx: w / 2, cy: 104, r: 50, color: "#223354" });
              put({
                op: "text",
                x: w / 2 - textWidth("RZ", 36) / 2,
                y: 104 + 36 * 0.36,
                text: "RZ",
                size: 36,
                weight: 700,
                color: "#D6E4FF",
              });
              put({
                op: "text",
                x: (w - textWidth("Rizky Zulkarnaen", 26)) / 2,
                y: 196,
                text: "Rizky Zulkarnaen",
                size: 26,
                weight: 700,
                color: "#F2F2F7",
              });
              put({
                op: "text",
                x: (w - textWidth("@rizky · Jakarta, ID", 15)) / 2,
                y: 230,
                text: "@rizky · Jakarta, ID",
                size: 15,
                weight: 400,
                color: "#9AA3B2",
              });
              const chip = "🪴 Member since 2024";
              const chipW = textWidth(chip, 13) + 32;
              put({ op: "rect", x: (w - chipW) / 2, y: 258, w: chipW, h: 36, r: 18, color: "#30354A" });
              put({
                op: "text",
                x: (w - textWidth(chip, 13)) / 2,
                y: 258 + 18 + 13 * 0.36,
                text: chip,
                size: 13,
                weight: 600,
                color: "#DCE4FF",
              });
            }}
          />

          {/* Stats row: the three-up grid every template profile has. */}
          <Row gap="sm">
            <Card padding="md" radius="lg" background="surfaceRaised">
              <Column gap="xs" align="center">
                <Text variant="headline">128</Text>
                <Text variant="caption" color="#9AA3B2">Orders</Text>
              </Column>
            </Card>
            <Card padding="md" radius="lg" background="surfaceRaised">
              <Column gap="xs" align="center">
                <Text variant="headline">2.4k</Text>
                <Text variant="caption" color="#9AA3B2">Points</Text>
              </Column>
            </Card>
            <Card padding="md" radius="lg" background="surfaceRaised">
              <Column gap="xs" align="center">
                <Text variant="headline">4.9</Text>
                <StarRating value={4.9} size={12} />
              </Column>
            </Card>
          </Row>

          <Tabs
            tabs={["Profile", "Activity", "Settings"]}
            active={state.tab}
            onSelect={(index) => actions.setTab(index)}
          />

          {state.tab === 0 ? (
            <Column gap="sm">
              <ListTile
                leading={<Avatar label="✏️" size={48} />}
                title="Edit profile"
                subtitle="Name, photo, and bio"
                trailing={<Text variant="body" color="#474B5A">›</Text>}
              />
              <ListTile
                leading={<Avatar label="📍" size={48} />}
                title="Shipping address"
                subtitle="Jl. Kenanga 12, Jakarta"
                trailing={<Text variant="body" color="#474B5A">›</Text>}
              />
              <ListTile
                leading={<Avatar label="💳" size={48} />}
                title="Payment methods"
                subtitle="2 cards linked"
                trailing={<Avatar label="2" size={36} color="#FF5A5F" />}
              />
              <ListTile
                leading={<Avatar label="❓" size={48} />}
                title="Help center"
                subtitle="FAQ and live chat"
                trailing={<Text variant="body" color="#474B5A">›</Text>}
              />
            </Column>
          ) : null}

          {state.tab === 1 ? (
            <Column gap="sm">
              <Card padding="lg" radius="lg" background="surfaceRaised">
                <Column gap="sm">
                  <Row justify="between" align="center">
                    <Text variant="title">This week</Text>
                    <Text variant="caption" color="#3DD68C">+18%</Text>
                  </Row>
                  <Sparkline data={[12, 14, 10, 18, 22, 16, 24]} dot />
                  <Text variant="caption" color="#9AA3B2">Plants watered per day</Text>
                </Column>
              </Card>
              <ListTile
                variant="elevated"
                leading={<Avatar label="📦" size={48} />}
                title="Order #1042"
                subtitle="Monstera · delivered"
                trailing={<Text variant="caption" color="#3DD68C">Done</Text>}
              />
              <ListTile
                variant="elevated"
                leading={<Avatar label="⭐" size={48} />}
                title="Review posted"
                subtitle="Golden barrel — five stars"
                trailing={<StarRating value={5} size={13} />}
              />
            </Column>
          ) : null}

          {state.tab === 2 ? (
            <Column gap="md">
              <Card padding="lg" radius="lg" background="surfaceRaised">
                <Column gap="md">
                  <Row justify="between" align="center">
                    <Column gap="xs">
                      <Text variant="body">Dark theme</Text>
                      <Text variant="caption" color="#9AA3B2">Follow the garden at night</Text>
                    </Column>
                    <Switch on={state.darkMode} onChange={() => actions.toggleDark()} />
                  </Row>
                  <Column gap="sm">
                    <Text variant="body">Units</Text>
                    <SegmentedButton
                      options={["Metric", "Imperial"]}
                      selected={state.units}
                      onSelect={(index) => actions.setUnits(index)}
                    />
                  </Column>
                </Column>
              </Card>
              <Button variant="danger" onPress={() => actions.logOut()}>
                Log out
              </Button>
            </Column>
          ) : null}
        </Column>
      </Scaffold>
    );
  },
});

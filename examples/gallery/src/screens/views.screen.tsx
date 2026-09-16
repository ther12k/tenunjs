import { defineScreen } from "@tenunjs/core";
import {
  AppBar,
  Button,
  Card,
  Column,
  Row,
  Scaffold,
  Text,
} from "@tenunjs/widgets";
import {
  Avatar,
  Badge,
  Checkbox,
  Chip,
  Divider,
  FAB,
  IconButton,
  ListTile,
  NavigationBar,
  ProgressBar,
  ProgressRing,
  SegmentedButton,
  Slider,
  SnackBar,
  Switch,
  Tabs,
  TextField,
} from "@tenunjs-examples/ui-kit";

/**
 * Widget showcase — the whole upgraded kit on one scrollable page, the
 * TenunJS answer to Flutter's widget catalog. Every control is live:
 * tabs switch, chips filter, sliders move, checkboxes toggle, the nav
 * bar swaps sections.
 */
export interface ViewsState {
  tab: number;
  chips: number[];
  slider: number;
  segment: number;
  checkboxes: { news: boolean; sync: boolean };
  alertsOn: boolean;
  field: { value: string; focused: boolean };
  nav: number;
  snack: boolean;
  ring: number;
}

export const ViewsScreen = defineScreen({
  name: "WidgetViews",

  initialState: (): ViewsState => ({
    tab: 0,
    chips: [1],
    slider: 0.42,
    segment: 0,
    checkboxes: { news: true, sync: false },
    alertsOn: true,
    field: { value: "Inline edit", focused: false },
    nav: 0,
    snack: false,
    ring: 72,
  }),

  actions: {
    setTab({ state, input }: { state: ViewsState; input: number }) {
      state.tab = input;
    },
    toggleChip({ state, input }: { state: ViewsState; input: number }) {
      state.chips = state.chips.includes(input)
        ? state.chips.filter((c) => c !== input)
        : [...state.chips, input];
    },
    setSlider({ state, input }: { state: ViewsState; input: number }) {
      state.slider = input;
    },
    setSegment({ state, input }: { state: ViewsState; input: number }) {
      state.segment = input;
    },
    toggleNews({ state }: { state: ViewsState }) {
      state.checkboxes = { ...state.checkboxes, news: !state.checkboxes.news };
    },
    toggleSync({ state }: { state: ViewsState }) {
      state.checkboxes = { ...state.checkboxes, sync: !state.checkboxes.sync };
    },
    toggleAlerts({ state }: { state: ViewsState }) {
      state.alertsOn = !state.alertsOn;
    },
    focusField({ state }: { state: ViewsState }) {
      state.field = { value: state.field.value, focused: !state.field.focused };
    },
    setNav({ state, input }: { state: ViewsState; input: number }) {
      state.nav = input;
    },
    showSnack({ state }: { state: ViewsState }) {
      state.snack = true;
    },
    dismissSnack({ state }: { state: ViewsState }) {
      state.snack = false;
    },
    pulseRing({ state }: { state: ViewsState }) {
      state.ring = state.ring >= 100 ? 24 : state.ring + 14;
    },
  },

  view({ state, actions }) {
    return (
      <Scaffold appBar={<AppBar title="Widget showcase" />}>
        <Column padding="lg" gap="lg">
          {/* --- Buttons: the M3 family -------------------------------- */}
          <Card padding="lg" radius="lg" background="surfaceRaised">
            <Column gap="md">
              <Text variant="title">Buttons</Text>
              <Row gap="sm">
                <Button variant="primary" onPress={() => actions.showSnack()}>
                  Filled
                </Button>
                <Button variant="tonal" onPress={() => actions.showSnack()}>
                  Tonal
                </Button>
              </Row>
              <Row gap="sm">
                <Button variant="secondary" onPress={() => actions.showSnack()}>
                  Outlined
                </Button>
                <Button variant="text" onPress={() => actions.showSnack()}>
                  Text button
                </Button>
                <Button variant="danger" onPress={() => actions.showSnack()}>
                  Delete
                </Button>
              </Row>
              <Row gap="sm" justify="between">
                <IconButton glyph="+" variant="filled" onPress={() => actions.pulseRing()} />
                <IconButton glyph="♡" variant="tonal" />
                <IconButton glyph="⚙" variant="outlined" />
                <IconButton glyph="⋯" variant="standard" />
                <FAB glyph="✦" label="Compose" onPress={() => actions.showSnack()} />
              </Row>
            </Column>
          </Card>

          {/* --- Selection controls ------------------------------------ */}
          <Card padding="lg" radius="lg" background="surfaceRaised">
            <Column gap="md">
              <Text variant="title">Selection</Text>
              <Column gap="md">
                <Checkbox
                  checked={state.checkboxes.news}
                  onToggle={() => actions.toggleNews()}
                  label="Newsletter"
                />
                <Checkbox
                  checked={state.checkboxes.sync}
                  onToggle={() => actions.toggleSync()}
                  label="Sync account"
                />
              </Column>
              <Column gap="sm">
                <Text variant="label" color="#9AA3B2">FILTERS</Text>
                <Row gap="sm">
                  {["All", "Music", "Photo", "Video"].map((label, index) => (
                    <Chip
                      key={label}
                      label={label}
                      selected={state.chips.includes(index)}
                      onSelect={() => actions.toggleChip(index)}
                    />
                  ))}
                </Row>
              </Column>
              <Column gap="sm">
                <Text variant="label" color="#9AA3B2">SEGMENTED</Text>
                <SegmentedButton
                  options={["Day", "Week", "Month"]}
                  selected={state.segment}
                  onSelect={(index) => actions.setSegment(index)}
                />
              </Column>
              <Row gap="lg" justify="between">
                <Column gap="xs">
                  <Text variant="body">Push alerts</Text>
                </Column>
                <Switch on={state.alertsOn} onChange={() => actions.toggleAlerts()} />
              </Row>
            </Column>
          </Card>

          {/* --- Sliders and progress ---------------------------------- */}
          <Card padding="lg" radius="lg" background="surfaceRaised">
            <Column gap="md">
              <Text variant="title">Sliders & progress</Text>
              <Slider value={state.slider} onChange={(value) => actions.setSlider(value)} />
              <Text variant="label" color="#9AA3B2">
                VALUE {Math.round(state.slider * 100)}%
              </Text>
              <ProgressBar value={state.slider * 100} max={100} />
              <Row gap="lg" justify="between">
                <ProgressRing
                  value={state.ring}
                  goal={100}
                  size={96}
                  caption="daily goal"
                  color="#4C8DFF"
                />
                <Column gap="sm">
                  <Row gap="xs">
                    <Badge count={3} />
                    <Text variant="body">unread</Text>
                  </Row>
                  <Row gap="xs">
                    <Badge />
                    <Text variant="body">presence dot</Text>
                  </Row>
                </Column>
              </Row>
            </Column>
          </Card>

          {/* --- Text inputs ------------------------------------------- */}
          <Card padding="lg" radius="lg" background="surfaceRaised">
            <Column gap="md">
              <Text variant="title">Text fields</Text>
              <TextField
                label="Display name"
                value={state.field.value}
                focused={state.field.focused}
                onFocusChange={() => actions.focusField()}
              />
              <TextField label="Search" value="" leading="⌕" />
            </Column>
          </Card>

          {/* --- Tabs --------------------------------------------------- */}
          <Card padding="lg" radius="lg" background="surfaceRaised">
            <Column gap="md">
              <Tabs
                tabs={["Overview", "Specs", "Reviews"]}
                active={state.tab}
                onSelect={(index) => actions.setTab(index)}
              />
              <Text variant="body" color="#9AA3B2">
                Showing the {["overview", "specs", "reviews"][state.tab]} pane — tabs are a
                single canvas component with per-column hit regions.
              </Text>
            </Column>
          </Card>

          {/* --- Lists --------------------------------------------------- */}
          <Column gap="md">
            <Text variant="title">Lists</Text>
            <ListTile
              variant="elevated"
              leading={<Avatar label="🕹" size={48} />}
              title="Elevated tile"
              subtitle="Layered elevation under a raised card"
              trailing={null}
            />
            <ListTile
              variant="outlined"
              leading={<Avatar label="📐" size={48} />}
              title="Outlined tile"
              subtitle="Hairline border on the surface"
              trailing={null}
            />
            <ListTile
              leading={<Avatar label="★" size={48} />}
              title="Filled tile"
              subtitle="The raised-card default"
              trailing={null}
            />
          </Column>

          <Divider />

          {/* --- SnackBar ------------------------------------------------ */}
          {state.snack ? (
            <SnackBar
              message="Saved to your library."
              actionLabel="UNDO"
              onAction={() => actions.dismissSnack()}
            />
          ) : (
            <Button variant="text" onPress={() => actions.showSnack()}>
              Show snack bar
            </Button>
          )}

          {/* --- Navigation bar ------------------------------------------ */}
          <NavigationBar
            items={[
              { glyph: "⌂", label: "Home" },
              { glyph: "◑", label: "Browse" },
              { glyph: "♡", label: "Saved" },
              { glyph: "⚙", label: "Settings" },
            ]}
            active={state.nav}
            onSelect={(index) => actions.setNav(index)}
          />
        </Column>
      </Scaffold>
    );
  },
});

import { defineScreen } from "@tenunjs/core";
import type { WidgetNode } from "@tenunjs/jsx-runtime";
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
  Badge,
  CanvasBox,
  Checkbox,
  Chip,
  colorSchemeFromSeed,
  FAB,
  IconButton,
  PageIndicator,
  ProgressBar,
  ProgressRing,
  SegmentedButton,
  Slider,
  StarRating,
  Switch,
  Tabs,
  TextField,
  ThemeScopeBox,
  textWidth,
  type SchemeRoles,
} from "@tenunjs-examples/ui-kit";

/**
 * Theme lab — the kit's answer to Flutter's ThemeData / ColorScheme
 * .fromSeed: one seed color generates a full Material-3 role set (tonal
 * palettes in OKLCH), and ThemeScope applies a scheme to a whole subtree —
 * the TenunJS version of wrapping a widget branch in `Theme(data: ...)`.
 * Pick a seed, flip light/dark, and every panel re-tones live.
 */

const SEEDS: Array<{ seed: string; label: string }> = [
  { seed: "#4C8DFF", label: "Sky" },
  { seed: "#3DD68C", label: "Leaf" },
  { seed: "#F5A623", label: "Amber" },
  { seed: "#A78BFA", label: "Violet" },
];

function SeedSwatch(props: {
  glyph: string;
  seed: string;
  selected: boolean;
  onSelect: () => void;
}): WidgetNode {
  return CanvasBox({
    width: 132,
    height: 108,
    paint: (origin, put, tap) => {
      put({ op: "circle", cx: 66, cy: 40, r: 34, color: props.seed });
      if (props.selected) {
        put({ op: "circle", cx: 66, cy: 40, r: 40, color: "#00FFFFFF" });
        put({ op: "circle", cx: 66, cy: 40, r: 38, color: "#22FFFFFF" });
        put({ op: "circle", cx: 66, cy: 40, r: 34, color: props.seed });
        put({ op: "circle", cx: 92, cy: 16, r: 12, color: "#3DD68C" });
        put({
          op: "text",
          x: 92 - textWidth("✓", 16) / 2,
          y: 16 + 16 * 0.36,
          text: "✓",
          size: 16,
          weight: 700,
          color: "#0F241C",
        });
      }
      put({
        op: "text",
        x: (132 - textWidth(props.glyph, 13)) / 2,
        y: 100,
        text: props.glyph,
        size: 13,
        weight: props.selected ? 700 : 500,
        color: props.selected ? "#F2F2F7" : "#9AA3B2",
      });
      tap({ x: 0, y: 0, w: 132, h: 108 }, props.onSelect);
    },
  }) as unknown as WidgetNode;
}

/** The same standard widget panel, rendered under whatever scope wraps it. */
function SchemePanel(): WidgetNode {
  return (
    <Column gap="md">
      <Row gap="sm">
        <Button variant="primary" onPress={() => undefined}>
          Filled
        </Button>
        <Button variant="tonal" onPress={() => undefined}>
          Tonal
        </Button>
        <Button variant="secondary" onPress={() => undefined}>
          Outlined
        </Button>
      </Row>
      <Row gap="sm" align="center">
        <Chip label="Filter" selected={true} />
        <Chip label="Quiet" />
        <Badge count={7} />
        <Switch on={true} />
      </Row>
      <Row gap="md" align="center">
        <ProgressRing value={72} goal={100} size={84} caption="tonal" />
        <Column gap="sm">
          <ProgressBar value={64} max={100} />
          <StarRating value={4} size={15} />
        </Column>
      </Row>
      <Tabs tabs={["One", "Two", "Three"]} active={0} />
      <Slider value={0.55} />
      <Row gap="sm" align="center" justify="between">
        <FAB glyph="✨" label="Compose" size={72} onPress={() => undefined} />
        <IconButton glyph="💡" variant="tonal" size={56} onPress={() => undefined} />
        <PageIndicator count={3} active={1} />
      </Row>
      <TextField label="Label" />
    </Column>
  );
}

function PanelCard(props: { heading: string; scheme: SchemeRoles }): WidgetNode {
  return (
    <ThemeScopeBox scheme={props.scheme}>
      <Card padding="lg" radius="lg" background="surfaceRaised">
        <Column gap="md">
          <Text variant="title" color="onSurface">{props.heading}</Text>
          <SchemePanel />
        </Column>
      </Card>
    </ThemeScopeBox>
  );
}

export interface ThemeLabState {
  seedIndex: number;
  dark: boolean;
  toggles: number;
}

export const ThemeLabScreen = defineScreen({
  name: "ThemeLab",

  initialState: (): ThemeLabState => ({
    seedIndex: 0,
    dark: false,
    toggles: 0,
  }),

  actions: {
    setSeed({ state, input }: { state: ThemeLabState; input: number }) {
      state.seedIndex = input;
    },
    setMode({ state, input }: { state: ThemeLabState; input: number }) {
      state.dark = input === 1;
    },
    countToggle({ state }: { state: ThemeLabState }) {
      state.toggles += 1;
    },
  },

  view({ state, actions }) {
    const seed = SEEDS[state.seedIndex]!.seed;
    const current = colorSchemeFromSeed(seed, state.dark);
    const baseline = colorSchemeFromSeed("#6750A4", state.dark);
    const inverted = colorSchemeFromSeed(seed, !state.dark);

    return (
      <Scaffold appBar={<AppBar title="Theme lab" />}>
        <Column padding="lg" gap="lg">
          <Card padding="lg" radius="lg" background="surfaceRaised">
            <Column gap="md">
              <Text variant="title">One seed, every role</Text>
              <Text variant="body" color="onSurfaceVariant">
                {"Tonality is generated in OKLCH from the seed hue, then the M3 tone map fills every role — "}
                {"the TenunJS take on ColorScheme.fromSeed."}
              </Text>
              <Row gap="sm" justify="between">
                {SEEDS.map((entry, index) => (
                  <SeedSwatch
                    key={entry.label}
                    glyph={entry.label}
                    seed={entry.seed}
                    selected={index === state.seedIndex}
                    onSelect={() => actions.setSeed(index)}
                  />
                ))}
              </Row>
              <SegmentedButton
                options={["Light", "Dark"]}
                selected={state.dark ? 1 : 0}
                onSelect={(index) => actions.setMode(index)}
              />
            </Column>
          </Card>

          <PanelCard
            heading={state.dark ? "Dark · your seed" : "Light · your seed"}
            scheme={current}
          />
          <PanelCard
            heading={state.dark ? "Dark · M3 baseline" : "Light · M3 baseline"}
            scheme={baseline}
          />
          <PanelCard
            heading={state.dark ? "Dark · inverted mode" : "Light · inverted mode"}
            scheme={inverted}
          />

          <Card padding="lg" radius="lg" background="surfaceRaised">
            <Column gap="md">
              <Text variant="title">Ambient theme, untouched</Text>
              <Text variant="body" color="#9AA3B2">
                This card lives outside any ThemeScope, so it keeps the app
                theme — the boundary every Flutter theming demo draws.
              </Text>
              <Checkbox
                checked={state.toggles % 2 === 1}
                onToggle={() => actions.countToggle()}
                label="Counted toggles"
              />
            </Column>
          </Card>
        </Column>
      </Scaffold>
    );
  },
});

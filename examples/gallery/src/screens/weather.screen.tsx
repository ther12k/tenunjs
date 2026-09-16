import { defineAction, defineScreen } from "@tenunjs/core";
import {
  AppBar,
  Card,
  Column,
  Row,
  Scaffold,
  Text,
} from "@tenunjs/widgets";
import {
  CanvasBox,
  Chip,
  HeroCard,
  ProgressRing,
  ProgressBar,
  textWidth,
} from "@tenunjs-examples/ui-kit";

/**
 * Weather module — the classic Cupertino-style weather app: sky-gradient
 * hero with the current temperature, an hourly strip, a 7-day range list,
 * and condition rings (humidity / wind / UV). Unit toggle exercises real
 * state conversion; refresh rotates the forecast deterministically.
 */
export interface HourPoint {
  readonly time: string;
  readonly glyph: string;
  readonly tempC: number;
}

export interface DayPoint {
  readonly day: string;
  readonly glyph: string;
  readonly lowC: number;
  readonly highC: number;
}

export interface WeatherState {
  readonly unit: "C" | "F";
  readonly tick: number;
  readonly currentC: number;
  readonly condition: string;
  readonly glyph: string;
  readonly hourly: readonly HourPoint[];
  readonly daily: readonly DayPoint[];
  readonly details: { readonly humidity: number; readonly windKph: number; readonly uv: number };
}

function toUnit(celsius: number, unit: "C" | "F"): number {
  return unit === "C" ? celsius : Math.round((celsius * 9) / 5 + 32);
}

export const WeatherScreen = defineScreen({
  name: "Weather",

  initialState: (): WeatherState => ({
    unit: "C",
    tick: 0,
    currentC: 29,
    condition: "Partly cloudy",
    glyph: "⛅",
    hourly: [
      { time: "Now", glyph: "⛅", tempC: 29 },
      { time: "15", glyph: "☀️", tempC: 31 },
      { time: "16", glyph: "☀️", tempC: 31 },
      { time: "17", glyph: "🌤️", tempC: 30 },
      { time: "18", glyph: "🌦️", tempC: 28 },
      { time: "19", glyph: "🌧️", tempC: 27 },
    ],
    daily: [
      { day: "Today", glyph: "⛅", lowC: 24, highC: 31 },
      { day: "Wed", glyph: "🌧️", lowC: 23, highC: 28 },
      { day: "Thu", glyph: "⛈️", lowC: 23, highC: 27 },
      { day: "Fri", glyph: "🌤️", lowC: 24, highC: 30 },
      { day: "Sat", glyph: "☀️", lowC: 25, highC: 32 },
    ],
    details: { humidity: 0.68, windKph: 14, uv: 6 },
  }),

  actions: {
    toggleUnit: defineAction<WeatherState, void>({
      run({ state }) {
        (state as unknown as { unit: "C" | "F" }).unit = state.unit === "C" ? "F" : "C";
      },
    }),

    /** Rotates the hourly strip and nudges the current temperature. */
    refresh: defineAction<WeatherState, void>({
      run({ state }) {
        const tick = state.tick + 1;
        (state as unknown as { tick: number }).tick = tick;
        (state as unknown as { currentC: number }).currentC =
          29 + Math.round(Math.sin(tick * 0.7) * 2);
        const [first, ...rest] = state.hourly;
        (state as unknown as { hourly: HourPoint[] }).hourly = [...rest, first!];
      },
    }),
  },

  view({ state, actions }) {
    const u = state.unit;
    const weekLow = Math.min(...state.daily.map((d) => d.lowC));
    const weekHigh = Math.max(...state.daily.map((d) => d.highC));

    return (
      <Scaffold appBar={<AppBar title="Weather" />}>
        <Column padding="lg" gap="lg">
          <HeroCard
            title="KUALA LUMPUR · MALAYSIA"
            headline={`${state.glyph} ${toUnit(state.currentC, u)}°`}
            caption={`${state.condition} · H:${toUnit(31, u)}° L:${toUnit(24, u)}°`}
            from="#274B6F"
            to="#10131C"
          />

          <Row gap="sm">
            <Chip label={`°${u}`} selected={true} onSelect={() => actions.toggleUnit()} />
            <Chip label="Refresh" onSelect={() => actions.refresh()} />
          </Row>

          <Card padding="md" radius="md" background="surfaceRaised">
            <Column gap="sm">
              <Text variant="body" color="#9AA3B2">Hourly forecast</Text>
              <Row gap="sm">
                {state.hourly.map((hour) => (
                  <HourCell key={hour.time} time={hour.time} glyph={hour.glyph} temp={`${toUnit(hour.tempC, u)}°`} />
                ))}
              </Row>
            </Column>
          </Card>

          <Column gap="sm">
            <Text variant="title">7-day forecast</Text>
            {state.daily.map((day) => (
              <Card key={day.day} padding="md" radius="md" background="surfaceRaised">
                <Column gap="xs">
                  <Row gap="sm" justify="between">
                    <Text variant="body">{day.glyph} {day.day}</Text>
                    <Text variant="body" color="#9AA3B2">
                      {toUnit(day.lowC, u)}° — {toUnit(day.highC, u)}°
                    </Text>
                  </Row>
                  <RangeBar low={(day.lowC - weekLow) / (weekHigh - weekLow)} high={(day.highC - weekLow) / (weekHigh - weekLow)} />
                </Column>
              </Card>
            ))}
          </Column>

          <Card padding="lg" radius="lg" background="surfaceRaised">
            <Column gap="sm">
              <Text variant="title">Conditions</Text>
              <Row gap="lg">
                <ProgressRing value={state.details.humidity} goal={1} caption="humidity" color="#4C8DFF" />
                <ProgressRing value={state.details.windKph} goal={40} caption="wind" color="#3DD68C" />
                <ProgressRing value={state.details.uv} goal={11} caption="UV" color="#F5A623" />
              </Row>
              <ProgressBar value={state.details.uv} max={11} color="#F5A623" />
              <Text variant="body" color="#9AA3B2">
                Wind {state.details.windKph} km/h · UV index {state.details.uv} of 11
              </Text>
            </Column>
          </Card>
        </Column>
      </Scaffold>
    );
  },
});

/** One centered hourly cell: time / glyph / temperature. */
function HourCell(props: { time: string; glyph: string; temp: string }) {
  const w = 88;
  const h = 96;
  return (
    <CanvasBox
      height={h}
      width={w}
      paint={(origin, put) => {
        const cx = (text: string, size: number, y: number, color: string) =>
          put({ op: "text", x: (origin.w - textWidth(text, size)) / 2, y, text, size, weight: 500, color });
        cx(props.time, 13, 14, "#9AA3B2");
        cx(props.glyph, 24, 48, "#F2F2F7");
        cx(props.temp, 17, 84, "#F2F2F7");
      }}
    />
  );
}

/** Temperature-range bar: track with a fill segment between low..high. */
function RangeBar(props: { low: number; high: number }) {
  return (
    <CanvasBox
      height={10}
      paint={(origin, put) => {
        put({ op: "rect", x: 0, y: 0, w: origin.w, h: 10, r: 5, color: "#2A2A35" });
        const x = props.low * origin.w;
        const w = Math.max((props.high - props.low) * origin.w, 10);
        put({ op: "rect", x, y: 0, w, h: 10, r: 5, color: "#4C8DFF" });
      }}
    />
  );
}

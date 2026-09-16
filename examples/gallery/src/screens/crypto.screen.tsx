import { defineAction, defineScreen } from "@tenunjs/core";
import {
  AppBar,
  Card,
  Column,
  Row,
  Scaffold,
  Text,
} from "@tenunjs/widgets";
import { Chip, HeroCard, ListTile, Sparkline } from "@tenunjs-examples/ui-kit";

/**
 * Crypto portfolio module — the finance-dashboard pattern: portfolio hero
 * with 24h change, timeframe chips, holdings with deterministic sparklines,
 * and a market watchlist with colored 24h moves. Refresh applies a seeded,
 * deterministic price walk — no randomness, so tests pin exact values.
 */
export interface Holding {
  readonly sym: string;
  readonly name: string;
  readonly amount: number;
  readonly priceUsd: number;
  readonly seed: number;
}

export interface MarketRow {
  readonly sym: string;
  readonly priceUsd: number;
  readonly changePct: number;
}

export interface CryptoState {
  readonly timeframe: "1D" | "1W" | "1M" | "1Y";
  readonly refreshCount: number;
  readonly holdings: readonly Holding[];
  readonly market: readonly MarketRow[];
}

const POINTS: Record<CryptoState["timeframe"], number> = { "1D": 24, "1W": 7, "1M": 30, "1Y": 52 };

/** Deterministic wiggle: two sines on a seed. No RNG anywhere. */
export function seriesFor(seed: number, timeframe: CryptoState["timeframe"]): number[] {
  const n = POINTS[timeframe];
  const points: number[] = [];
  for (let i = 0; i < n; i++) {
    points.push(50 + Math.sin(i * 0.35 + seed) * 28 + Math.sin(i * 0.11 + seed * 2) * 14);
  }
  return points;
}

function signed(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

export const CryptoScreen = defineScreen({
  name: "Crypto",

  initialState: (): CryptoState => ({
    timeframe: "1D",
    refreshCount: 0,
    holdings: [
      { sym: "BTC", name: "Bitcoin", amount: 0.18, priceUsd: 61250.0, seed: 1 },
      { sym: "ETH", name: "Ethereum", amount: 2.6, priceUsd: 3380.0, seed: 2 },
      { sym: "SOL", name: "Solana", amount: 24.0, priceUsd: 148.0, seed: 3 },
      { sym: "LINK", name: "Chainlink", amount: 320.0, priceUsd: 17.4, seed: 4 },
    ],
    market: [
      { sym: "BTC", priceUsd: 61250.0, changePct: 2.41 },
      { sym: "ETH", priceUsd: 3380.0, changePct: 1.87 },
      { sym: "SOL", priceUsd: 148.0, changePct: -0.92 },
      { sym: "LINK", priceUsd: 17.4, changePct: 3.15 },
      { sym: "DOT", priceUsd: 6.82, changePct: -1.44 },
      { sym: "AVAX", priceUsd: 34.1, changePct: 0.66 },
    ],
  }),

  actions: {
    setTimeframe: defineAction<CryptoState, CryptoState["timeframe"]>({
      run({ input, state }) {
        (state as unknown as { timeframe: CryptoState["timeframe"] }).timeframe = input;
      },
    }),

    /** Deterministic walk: every symbol moves by a seed+step-derived step. */
    refreshPrices: defineAction<CryptoState, void>({
      run({ state }) {
        const step = state.refreshCount + 1;
        const drift = (seed: number): number =>
          ((((seed * 7 + step * 3) % 11) - 5) / 100) * 0.6; // ±3% bounded
        const holdings = state.holdings.map((h) => ({
          ...h,
          priceUsd: Math.round(h.priceUsd * (1 + drift(h.seed)) * 100) / 100,
        }));
        const market = state.market.map((m) => {
          const holding = state.holdings.find((h) => h.sym === m.sym);
          const priceUsd = holding ? holdings.find((h) => h.sym === m.sym)!.priceUsd : m.priceUsd;
          const changePct = Math.round((m.changePct + drift(holding?.seed ?? 0) * 100) * 100) / 100;
          return { ...m, priceUsd, changePct };
        });
        (state as unknown as { holdings: Holding[] }).holdings = holdings;
        (state as unknown as { market: MarketRow[] }).market = market;
        (state as unknown as { refreshCount: number }).refreshCount = step;
      },
    }),
  },

  view({ state, actions }) {
    const total = state.holdings.reduce((sum, h) => sum + h.amount * h.priceUsd, 0);
    const changePct = state.market.find((m) => m.sym === "BTC")?.changePct ?? 0;
    const up = changePct >= 0;
    const timeframes: Array<CryptoState["timeframe"]> = ["1D", "1W", "1M", "1Y"];

    return (
      <Scaffold appBar={<AppBar title="Portfolio" />}>
        <Column padding="lg" gap="lg">
          <HeroCard
            title="PORTFOLIO VALUE"
            headline={`$${total.toLocaleString("en-US", { maximumFractionDigits: 0 })}`}
            caption={`${signed(changePct)} past 24h`}
            from={up ? "#173327" : "#331A1D"}
            to="#10131C"
          />

          <Row gap="sm" justify="center">
            {timeframes.map((frame) => (
              <Chip
                key={frame}
                label={frame}
                selected={state.timeframe === frame}
                onSelect={() => actions.setTimeframe(frame)}
              />
            ))}
            <Chip label="↻ Refresh" onSelect={() => actions.refreshPrices()} />
          </Row>

          <Column gap="sm">
            <Text variant="title">Holdings</Text>
            {state.holdings.map((holding) => {
              const trend = seriesFor(holding.seed, state.timeframe);
              const rising = trend[trend.length - 1]! >= trend[0]!;
              return (
                <ListTile
                  key={holding.sym}
                  title={`${holding.amount} ${holding.sym}`}
                  subtitle={`$${holding.priceUsd.toLocaleString("en-US")} · ${holding.name}`}
                  trailing={
                    <Sparkline data={trend} width={128} color={rising ? "#3DD68C" : "#FF5A5F"} dot={true} />
                  }
                />
              );
            })}
          </Column>

          <Column gap="sm">
            <Text variant="title">Market</Text>
            {state.market.map((row) => (
              <ListTile
                key={row.sym}
                title={row.sym}
                subtitle={`$${row.priceUsd.toLocaleString("en-US")}`}
                trailing={
                  <Text variant="title" color={row.changePct >= 0 ? "#3DD68C" : "#FF5A5F"}>
                    {signed(row.changePct)}
                  </Text>
                }
              />
            ))}
          </Column>
        </Column>
      </Scaffold>
    );
  },
});

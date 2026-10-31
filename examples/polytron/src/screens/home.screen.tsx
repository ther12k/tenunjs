import { defineAction, defineScreen } from "@tenunjs/core";
import { Column, Scaffold, Text } from "@tenunjs/widgets";
import { SnackBar } from "@tenunjs-examples/ui-kit";
import {
  ActivitySummaryCard,
  BannerCard,
  ChromeSpacer,
  FunctionGrid,
  LinkHeader,
  MetricTilesRow,
  ProgramHero,
  ProgramPillRow,
  ProgressRingCard,
  StepChips,
  fmtAgo,
  modeIcon,
  type FunctionDef,
} from "../widgets";
import type { BleLinkState, LogRow } from "../runtime";
import {
  PROGRAM_SLOTS,
  fmtActivityLine,
  fmtClock,
  fmtDurationS,
  parseProgramSteps,
  MODE_LABELS,
  type WashStatus,
} from "../protocol";
import { modeColor } from "../theme";

/**
 * Home — the mockup's Beranda (01) and Proses aktif (03) as one screen:
 *
 *  idle     → status header, green "Siap mencuci" banner, navy PROGRAM
 *             TERSIMPAN hero with the teal Mulai button, the six-function
 *             grid, STOP, activity trail.
 *  running  → status header ("Sedang mencuci"), the big ring hero
 *             (Sisa waktu + %), the step chip timeline, the stage card,
 *             the water wave card, "fungsi lain terkunci", solid STOP.
 *
 * The screen knows no Bluetooth: link/status/usage arrive as pushed
 * state; the LinkHeader row is the connect/cancel/disconnect control.
 */
export interface HomeState {
  link: BleLinkState;
  status: WashStatus | null;
  /** Receive time (ms) of the last ST: — null while no status. */
  statusAt: number | null;
  /** True after a drop left the machine possibly mid-cycle (BLE loss
   *  never stops the washer) until a fresh non-running ST: clears it. */
  mayrun: boolean;
  rows: LogRow[];
  usage: Record<string, number>;
  /** Machine-side values ("SET k v"), for the hero program card + chips. */
  values: Record<string, string>;
  pending: string | null;
  /** Last FAILED command explanation, cleared by the next command. */
  err: string | null;
}

const FUNCTIONS: ReadonlyArray<FunctionDef & { cmd: string }> = [
  { label: "Cuci", cmd: "WASH", icon: "wash", color: "#007F79" },
  { label: "Peras", cmd: "SPIN", icon: "spin", color: "#0B2D5B" },
  { label: "Buang", cmd: "DRAIN", icon: "drain", color: "#0079B8" },
  { label: "Isi", cmd: "FILL", icon: "droplet", color: "#087F5B" },
  { label: "Bilas", cmd: "RINSE", icon: "waves", color: "#0079B8" },
  { label: "Bilas ND", cmd: "RINSEND", icon: "wavesSlash", color: "#3DA9FF" },
];

export const HomeScreen = defineScreen({
  name: "Home",

  initialState: (): HomeState => ({
    link: { supported: false, connecting: false, connected: false, name: null },
    status: null,
    statusAt: null,
    mayrun: false,
    rows: [],
    usage: {},
    values: {},
    pending: null,
    err: null,
  }),

  actions: {
    link: defineAction<HomeState, Partial<BleLinkState>>({
      run({ input, state }) {
        const s = state as unknown as HomeState;
        s.link = { ...s.link, ...input };
      },
    }),
    status: defineAction<HomeState, WashStatus | null>({
      run({ input, state }) {
        (state as unknown as HomeState).status = input;
      },
    }),
    statusAt: defineAction<HomeState, number | null>({
      run({ input, state }) {
        (state as unknown as HomeState).statusAt = input;
      },
    }),
    mayrun: defineAction<HomeState, boolean>({
      run({ input, state }) {
        (state as unknown as HomeState).mayrun = input;
      },
    }),
    /** Heartbeat repaint channel — no state of its own; the delivery
     *  itself re-renders so age/staleness labels keep advancing while
     *  connected even when the radio goes silent. */
    tick: defineAction<HomeState, number>({
      run() {
        /* invalidation-only by design */
      },
    }),
    log: defineAction<HomeState, LogRow>({
      run({ input, state }) {
        const s = state as unknown as HomeState;
        s.rows = [input, ...s.rows].slice(0, 12);
      },
    }),
    usage: defineAction<HomeState, Record<string, number>>({
      run({ input, state }) {
        (state as unknown as HomeState).usage = input;
      },
    }),
    settings: defineAction<HomeState, Record<string, string>>({
      run({ input, state }) {
        (state as unknown as HomeState).values = input;
      },
    }),
    /** Replies clear the matching pending tile; failures also surface as
     *  a snack under STOP — the activity feed alone was below the fold. */
    result: defineAction<HomeState, { ok: boolean; busy: boolean; msg: string }>({
      run({ input, state }) {
        const s = state as unknown as HomeState;
        s.pending = null;
        s.err = input.ok ? null : `${input.busy ? "BUSY" : "ERR"} · ${input.msg}`;
      },
    }),
    clearErr: defineAction<HomeState, void>({
      run({ state }) {
        (state as unknown as HomeState).err = null;
      },
    }),
    clearMayrun: defineAction<HomeState, void>({
      run({ state }) {
        (state as unknown as HomeState).mayrun = false;
      },
    }),
    connect: defineAction<HomeState, void>({
      run({ state, services }) {
        const s = state as unknown as HomeState;
        s.link = { ...s.link, connecting: true };
        const svc = services as { ble?: { connect(): Promise<boolean> } };
        void svc.ble?.connect();
      },
    }),
    disconnect: defineAction<HomeState, void>({
      run({ services }) {
        const svc = services as { ble?: { disconnect(): void } };
        svc.ble?.disconnect();
      },
    }),
    start: defineAction<HomeState, string>({
      run({ input, state, services }) {
        const s = state as unknown as HomeState;
        // Never ready before the machine has spoken; stale telemetry gates
        // NEW starts. STOP is pinned chrome now and bypasses this action.
        if (!s.link.connected || s.status === null) return;
        if (s.statusAt !== null && Date.now() - s.statusAt > 15_000) return;
        if (s.pending !== null) return;
        s.pending = input;
        s.err = null;
        (services as { send?: (cmd: string) => void }).send?.(input);
      },
    }),
    goPrograms: defineAction<HomeState, void>({
      run({ services }) {
        (services as { navigate?: (route: string) => void }).navigate?.("programs");
      },
    }),
  },

  view({ state, actions }) {
    const s = state as unknown as HomeState;
    const st = s.status;
    const now = Date.now();

    const offline = !s.link.connected;
    const waiting = !offline && st === null;
    const staleFor = offline || waiting || s.statusAt === null ? 0 : Math.max(0, Math.round((now - s.statusAt) / 1000));
    const stale = !offline && !waiting && staleFor > 15;
    const running = st?.running === true;
    const done = st !== null && !running && st.prog.startsWith("DONE");
    const total = (st?.elapsedS ?? 0) + (st?.remainS ?? 0);
    const pct = offline || waiting ? null : done ? 1 : running && total > 0 ? Math.min(1, st!.elapsedS / total) : null;
    const accent = offline || waiting ? "#8DA0B5" : stale ? "#C77700" : running ? modeColor(st!.mode) : done ? "#087F5B" : "#007F79";

    // --- link header data ---
    const headerTitle = running ? "Sedang mencuci" : done ? "Siklus selesai" : "Polytron Wash";
    const headerPress = () => {
      if (s.link.connected || s.link.connecting) actions.disconnect();
      else actions.connect();
    };

    // --- step chips: derive the program's sequence when it is a known slot ---
    const slotIdx = st ? PROGRAM_SLOTS.findIndex((p) => st.prog.startsWith(p.name)) : -1;
    const slotTokens = slotIdx >= 0 ? s.values[PROGRAM_SLOTS[slotIdx]!.key] : undefined;
    const parsedSteps = slotTokens ? parseProgramSteps(slotTokens) : [];
    const chips =
      running && parsedSteps.length > 0
        ? parsedSteps.map((ps, i) => ({
            label: MODE_LABELS[ps.mode] ?? ps.mode,
            icon: modeIcon(ps.mode),
            color: modeColor(ps.mode),
            active: i === st!.step - 1,
          }))
        : running
          ? [
              {
                label: MODE_LABELS[st!.mode] ?? st!.mode,
                icon: modeIcon(st!.mode),
                color: modeColor(st!.mode),
                active: true,
              },
            ]
          : [];

    // --- idle hero: first configured program slot ---
    const heroIdx =
      PROGRAM_SLOTS.findIndex((p) => (s.values[p.key] ?? "").trim().length > 0) >= 0
        ? PROGRAM_SLOTS.findIndex((p) => (s.values[p.key] ?? "").trim().length > 0)
        : 0;
    const heroSlot = PROGRAM_SLOTS[heroIdx]!;
    const heroTokens = s.values[heroSlot.key] ?? "";
    const heroParsed = parseProgramSteps(heroTokens);
    const heroTotalS = heroParsed.reduce((a, ps) => a + ps.s, 0);
    const heroMeta =
      heroParsed.length > 0
        ? `±${fmtDurationS(heroTotalS)} · ${heroParsed.length} tahap`
        : offline
          ? "sambungkan untuk membaca"
          : "belum dimuat";

    const activeCmd = running ? st!.mode : null;
    const functionCards: FunctionDef[] = FUNCTIONS.map((f) => ({
      ...f,
      // Only a real last-run is worth a sub label — no "belum pernah" noise.
      sub: s.usage[f.cmd] !== undefined ? fmtAgo(s.usage[f.cmd], now) : undefined,
      disabled: offline || stale || waiting,
      pending: s.pending === f.cmd,
      active: activeCmd === f.cmd,
      onPress: () => actions.start(f.cmd),
    }));

    // Compact activity summary: the latest meaningful event only.
    const latestRow = s.rows.find((r) => !r.line.startsWith("ST:")) ?? null;

    return (
      <Scaffold>
        <Column padding="md" gap="lg">
          <LinkHeader
            title={headerTitle}
            supported={s.link.supported}
            connected={s.link.connected}
            connecting={s.link.connecting}
            phase={s.link.phase}
            name={s.link.name}
            statusAgeS={s.statusAt === null ? null : staleFor}
            stale={stale}
            onPress={headerPress}
          />

          {s.mayrun ? (
            <SnackBar
              message="Mesin MUNGKIN masih berjalan — pakai tombol fisik"
              actionLabel="OK"
              onAction={() => actions.clearMayrun()}
            />
          ) : null}

          {running && st ? (
            <Column gap="lg">
              <ProgramPillRow name={parsedSteps.length > 0 ? st.prog : st.mode} onPress={() => actions.goPrograms()} />
              <ProgressRingCard
                time={fmtClock(st.remainS ?? 0)}
                caption="Sisa waktu"
                pct={pct}
                accent={accent}
              />
              {chips.length > 0 ? <StepChips steps={chips} /> : null}
              <BannerCard
                icon={modeIcon(st.mode)}
                tone="acc"
                title={MODE_LABELS[st.mode] ?? st.mode}
                sub={`Tahap ${st.step} dari ${st.steps}${parsedSteps.length > 0 ? ` · ${st.prog}` : ""}`}
              />
              <MetricTilesRow
                left={{ label: "Berlalu", value: fmtClock(st.elapsedS ?? 0) }}
                right={{ label: "Air", value: st.waterPct === null ? "—" : `${st.waterPct}%`, accent: st.waterPct === null ? undefined : "#3DA9FF" }}
              />
              <Text variant="label">Fungsi lain terkunci selama proses</Text>
            </Column>
          ) : (
            <Column gap="lg">
              {done && st ? (
                <BannerCard icon="check" tone="ok" title={`Siklus selesai · ${st.prog.replace(/^DONE /, "")}`} />
              ) : stale ? (
                <BannerCard icon="clock" tone="warn" title="Data mesin beku" sub={`tidak diperbarui ${staleFor}s — dekati mesin`} />
              ) : waiting ? (
                <BannerCard icon="clock" tone="info" title="Menunggu status…" sub="menunggu kabar pertama dari mesin" />
              ) : !offline ? (
                <BannerCard icon="check" tone="ok" title="Siap mencuci" sub="Pilih program atau fungsi mesin" />
              ) : null}

              {stale ? null : (
                <ProgramHero
                  name={heroSlot.name}
                  meta={heroMeta}
                  state={
                    offline
                      ? "locked"
                      : s.pending === `PROG ${heroIdx}`
                        ? "pending"
                        : "idle"
                  }
                  onStart={heroParsed.length > 0 ? () => actions.start(`PROG ${heroIdx}`) : undefined}
                  onEdit={() => actions.goPrograms()}
                />
              )}

              <Column gap="sm">
                <Text variant="label">Fungsi mesin</Text>
                <FunctionGrid functions={functionCards} />
              </Column>

              <Column gap="sm">
                <Text variant="label">Aktivitas terakhir</Text>
                <ActivitySummaryCard
                  line={latestRow ? fmtActivityLine(latestRow.line) : null}
                  at={latestRow?.t ?? null}
                />
              </Column>
            </Column>
          )}

          {s.err ? (
            <SnackBar message={s.err} actionLabel="OK" onAction={() => actions.clearErr()} />
          ) : null}

          <ChromeSpacer />
        </Column>
      </Scaffold>
    );
  },
});

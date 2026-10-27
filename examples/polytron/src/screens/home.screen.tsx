import { defineAction, defineScreen } from "@tenunjs/core";
import { Column, Scaffold, Text } from "@tenunjs/widgets";
import { SnackBar } from "@tenunjs-examples/ui-kit";
import {
  ActivityList,
  FunctionGrid,
  ListRow,
  StatusStrip,
  StopBar,
  fmtAgo,
  type FunctionDef,
} from "../widgets";
import type { BleLinkState, LogRow } from "../runtime";
import { fmtActivityLine, fmtClock, type WashStatus } from "../protocol";
import { modeColor } from "../theme";

/**
 * Home — one phone screen, NO scrolling to reach the controls: a slim
 * status strip (status + SISA + thin progress — the minimized cycle
 * presentation), directly under it the six-function icon grid (every
 * action visible, no paging) and the red STOP. Programs live on the
 * Programs tab; activity trails below the fold.
 *
 * The screen knows no Bluetooth: link/status/usage arrive as pushed
 * state, replies land in the activity feed. Connection state lives in
 * the shell header's link pill — no per-tab banner. Failed commands
 * surface as a snack right under STOP (the feed is below the fold).
 */
export interface HomeState {
  link: BleLinkState;
  status: WashStatus | null;
  rows: LogRow[];
  usage: Record<string, number>;
  pending: string | null;
  /** Last FAILED command explanation, cleared by the next command. */
  err: string | null;
}

const FUNCTIONS: ReadonlyArray<FunctionDef & { cmd: string }> = [
  { label: "CUCI", cmd: "WASH", icon: "wash", color: "#00B7FD" },
  { label: "PERAS", cmd: "SPIN", icon: "spin", color: "#BB86FC" },
  { label: "BUANG", cmd: "DRAIN", icon: "drain", color: "#00FFC8" },
  { label: "ISI", cmd: "FILL", icon: "droplet", color: "#00FF80" },
  { label: "BILAS", cmd: "RINSE", icon: "waves", color: "#38BDF8" },
  { label: "BILAS ND", cmd: "RINSEND", icon: "wavesSlash", color: "#7DD3FC" },
];

/** Activity dot color by line kind (HA timeline semantics). */
function rowColor(line: string): string {
  if (line.startsWith(">")) return "#00B7FD";
  if (line.startsWith("OK")) return "#00FF80";
  if (line.startsWith("ERR")) return "#FF3838";
  if (line.startsWith("BUSY")) return "#FCB518";
  return "#9DB2C7";
}

export const HomeScreen = defineScreen({
  name: "Home",

  initialState: (): HomeState => ({
    link: { supported: false, connecting: false, connected: false, name: null },
    status: null,
    rows: [],
    usage: {},
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
    disconnect: defineAction<HomeState, void>({
      run({ services }) {
        const svc = services as { ble?: { disconnect(): void } };
        svc.ble?.disconnect();
      },
    }),
    start: defineAction<HomeState, string>({
      run({ input, state, services }) {
        const s = state as unknown as HomeState;
        if (!s.link.connected) return;
        // STOP always fires (safety) — only other commands single-flight
        if (input !== "STOP" && s.pending !== null) return;
        s.pending = input;
        s.err = null;
        (services as { send?: (cmd: string) => void }).send?.(input);
      },
    }),
  },

  view({ state, actions }) {
    const s = state as unknown as HomeState;
    const st = s.status;
    const now = Date.now();

    // The dashboard ALWAYS renders — no Web Bluetooth or no link just
    // disables every control (HA look). Connected-but-no-status-yet is
    // its own honest state: NEVER "ready" before the machine has spoken.
    const offline = !s.link.connected;
    const waiting = !offline && st === null;
    const running = st?.running === true;
    const done = st !== null && !running && st.prog.startsWith("DONE");
    const total = (st?.elapsedS ?? 0) + (st?.remainS ?? 0);
    const pct = offline || waiting ? null : done ? 1 : running && total > 0 ? Math.min(1, st!.elapsedS / total) : null;
    const accent = offline || waiting ? "#9DB2C7" : running ? modeColor(st!.mode) : done ? "#00FF80" : "#00B7FD";
    const status = offline
      ? "OFFLINE"
      : waiting
        ? "MENUNGGU STATUS…"
        : running
          ? `${st!.mode} · LANGKAH ${st!.step}/${st!.steps}`
          : done
            ? `SELESAI — ${st.prog.replace(/^DONE /, "")}`
            : "SIAP MENCUCI";
    const right = running
      ? `SISA ${fmtClock(st!.remainS ?? 0)}`
      : waiting
        ? "—"
        : st?.waterPct != null
          ? `AIR ${st.waterPct}%`
          : offline
            ? "—"
            : "SIAP";
    // Offline, the header pill already explains the situation — the strip
    // reports state ("OFFLINE") without repeating the connect instruction.
    const caption = offline
      ? undefined
      : waiting
        ? "menunggu status pertama dari mesin"
        : running
          ? `berlalu ${fmtClock(st!.elapsedS ?? 0)} · ${st.prog}`
          : done
            ? "siklus selesai"
            : "pilih fungsi di bawah · program ada di tab Programs";

    const activeCmd = running ? st!.mode : null;
    const functionCards: FunctionDef[] = FUNCTIONS.map((f) => ({
      ...f,
      sub: fmtAgo(s.usage[f.cmd], now),
      disabled: offline,
      pending: s.pending === f.cmd,
      active: activeCmd === f.cmd,
      onPress: () => actions.start(f.cmd),
    }));

    return (
      <Scaffold>
        <Column padding="md" gap="lg">
          <StatusStrip status={status} accent={accent} pct={pct} right={right} caption={caption} />

          <Column gap="sm">
            <Text variant="label">FUNGSI MESIN</Text>
            <FunctionGrid functions={functionCards} />
            <StopBar
              disabled={offline}
              pending={s.pending === "STOP"}
              onPress={() => actions.start("STOP")}
            />
          </Column>

          {s.err ? (
            <SnackBar message={s.err} actionLabel="OK" onAction={() => actions.clearErr()} />
          ) : null}

          <Column gap="sm">
            <Text variant="label">AKTIVITAS TERBARU</Text>
            <ActivityList
              rows={s.rows.map((r) => ({
                t: r.t,
                line: fmtActivityLine(r.line),
                color: rowColor(r.line),
              }))}
              now={now}
            />
          </Column>

          {offline ? null : (
            <ListRow
              label="Sambungan Bluetooth"
              sub="putuskan dari mesin"
              pill={{ label: "PUTUSKAN", onPress: () => actions.disconnect() }}
            />
          )}
        </Column>
      </Scaffold>
    );
  },
});

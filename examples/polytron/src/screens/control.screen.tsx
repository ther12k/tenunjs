import { defineAction, defineScreen } from "@tenunjs/core";
import { Column, Scaffold, Text } from "@tenunjs/widgets";
import { SnackBar } from "@tenunjs-examples/ui-kit";
import type { BleLinkState } from "../runtime";
import { fmtClock, type WashReply, type WashStatus } from "../protocol";
import { modeColor } from "../theme";
import { ListRow, RelayRow, SensorRow, StatusStrip, StopBar } from "../widgets";

/**
 * Controls tab — live device reality: relay rows (MOTOR A/B, BUANG, ISI),
 * the mode strip, the battery-style AIR meter, STOP and the device info
 * probes (WATER raw, VER). Read-mostly by design: v4 exposes no
 * per-relay BLE switches; everything dangerous stays on Home.
 * Connection state lives in the shell header.
 */
export interface ControlsState {
  link: BleLinkState;
  status: WashStatus | null;
  /** Receive time (ms) of the last ST: — drives the stale-data flag. */
  statusAt: number | null;
  pending: string | null;
  snack: WashReply | null;
}

export const ControlsScreen = defineScreen({
  name: "Controls",

  initialState: (): ControlsState => ({
    link: { supported: false, connecting: false, connected: false, name: null },
    status: null,
    statusAt: null,
    pending: null,
    snack: null,
  }),

  actions: {
    link: defineAction<ControlsState, Partial<BleLinkState>>({
      run({ input, state }) {
        const s = state as unknown as ControlsState;
        s.link = { ...s.link, ...input };
      },
    }),
    status: defineAction<ControlsState, WashStatus | null>({
      run({ input, state }) {
        (state as unknown as ControlsState).status = input;
      },
    }),
    statusAt: defineAction<ControlsState, number | null>({
      run({ input, state }) {
        (state as unknown as ControlsState).statusAt = input;
      },
    }),
    /** Heartbeat repaint channel — invalidation-only by design. */
    tick: defineAction<ControlsState, number>({
      run() {
        /* invalidation-only by design */
      },
    }),
    result: defineAction<ControlsState, WashReply>({
      run({ input, state }) {
        const s = state as unknown as ControlsState;
        s.pending = null;
        s.snack = input;
      },
    }),
    clearSnack: defineAction<ControlsState, void>({
      run({ state }) {
        (state as unknown as ControlsState).snack = null;
      },
    }),
    goHome: defineAction<ControlsState, void>({
      run({ services }) {
        (services as { navigate?: (route: string) => void }).navigate?.("home");
      },
    }),
    send1: defineAction<ControlsState, string>({
      run({ input, state, services }) {
        const s = state as unknown as ControlsState;
        if (!s.link.connected) return;
        if (input !== "STOP" && s.pending !== null) return; // STOP always fires
        s.pending = input;
        s.snack = null;
        (services as { send?: (cmd: string) => void }).send?.(input);
      },
    }),
  },

  view({ state, actions }) {
    const s = state as unknown as ControlsState;
    const st = s.status;
    const offline = !s.link.connected;
    const waiting = !offline && st === null;
    const now = Date.now();
    const staleFor =
      offline || waiting || s.statusAt === null ? 0 : Math.max(0, Math.round((now - s.statusAt) / 1000));
    const stale = !offline && !waiting && staleFor > 15;

    const relays: ReadonlyArray<{ icon: "motorA" | "motorB" | "drain" | "droplet"; name: string; on: boolean | null; color: string }> = [
      { icon: "motorA", name: "MOTOR A", on: st ? st.motorA : null, color: "#00B7FD" },
      { icon: "motorB", name: "MOTOR B", on: st ? st.motorB : null, color: "#BB86FC" },
      { icon: "drain", name: "BUANG", on: st ? st.drain : null, color: "#00FFC8" },
      { icon: "droplet", name: "ISI", on: st ? st.inlet : null, color: "#00FF80" },
    ];
    const running = st?.running === true;
    const water = st?.waterPct ?? null;
    const total = (st?.elapsedS ?? 0) + (st?.remainS ?? 0);
    const pct = running && total > 0 ? Math.min(1, st!.elapsedS / total) : null;

    return (
      <Scaffold>
        <Column padding="md" gap="lg">
          <StatusStrip
            status={
              offline
                ? "OFFLINE"
                : waiting
                  ? "MENUNGGU STATUS…"
                  : stale
                    ? `${st!.mode} · DATA BEKU`
                    : running
                      ? `${st!.mode} · LANGKAH ${st!.step}/${st!.steps}`
                      : st!.prog.startsWith("DONE")
                        ? `SELESAI — ${st!.prog.replace(/^DONE /, "")}`
                        : st!.mode
            }
            accent={offline || waiting ? "#9DB2C7" : stale ? "#FCB518" : running ? modeColor(st!.mode) : "#00B7FD"}
            pct={pct}
            right={stale ? `BEKU ${staleFor}s` : running ? `SISA ${fmtClock(st!.remainS ?? 0)}` : offline || waiting ? "—" : "SIAP"}
            caption={
              offline
                ? "offline · belum ada data"
                : waiting
                  ? "menunggu status pertama dari mesin"
                  : stale
                    ? `data mesin tidak diperbarui · terakhir ${staleFor} dtk lalu`
                    : running
                      ? `Ketuk untuk ke Home · ${st!.prog}`
                      : st?.prog ?? "menunggu status pertama dari mesin"
            }
            spin={waiting || running}
            onPress={running ? () => actions.goHome() : undefined}
          />

          <Column gap="sm">
            <Text variant="label">RELAI — INDIKATOR, BUKAN TOMBOL</Text>
            {relays.map((r) => (
              <RelayRow key={r.name} icon={r.icon} iconColor={r.color} label={r.name} on={r.on} />
            ))}
          </Column>

          <Column gap="sm">
            <Text variant="label">SENSOR</Text>
            <SensorRow
              pct={water}
              caption={
                water === null
                  ? offline
                    ? "offline · belum terbaca"
                    : "belum terbaca"
                  : "level air dalam tangki"
              }
            />
          </Column>

          <StopBar
            disabled={offline}
            pending={s.pending === "STOP"}
            onPress={() => actions.send1("STOP")}
          />
          {offline ? (
            <Text variant="label">STOP aplikasi butuh sambungan — gunakan tombol fisik di mesin</Text>
          ) : null}

          <Column gap="sm">
            <Text variant="label">PERANGKAT</Text>
            <ListRow
              icon="droplet"
              iconColor="#00FFC8"
              label="Cek air (raw)"
              sub="WATER — adc mentah + ema + pct"
              pill={
                offline
                  ? undefined
                  : { label: "KIRIM", busy: s.pending === "WATER", onPress: () => actions.send1("WATER") }
              }
              locked={offline ? "offline" : undefined}
            />
            <ListRow
              icon="power"
              iconColor="#9DB2C7"
              label="Versi firmware"
              sub={`heap ${st?.heapKB ?? "—"} KB · ${s.link.name ?? "polytron"}`}
              pill={
                offline
                  ? undefined
                  : { label: "KIRIM", busy: s.pending === "VER", onPress: () => actions.send1("VER") }
              }
              locked={offline ? "offline" : undefined}
            />
          </Column>

          {s.snack ? (
            <SnackBar
              message={`${s.snack.ok ? "OK" : s.snack.busy ? "BUSY" : "ERR"} · ${s.snack.msg}`}
              actionLabel="OK"
              onAction={() => actions.clearSnack()}
            />
          ) : null}
        </Column>
      </Scaffold>
    );
  },
});

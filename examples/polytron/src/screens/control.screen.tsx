import { defineAction, defineScreen } from "@tenunjs/core";
import { Column, Scaffold, Text } from "@tenunjs/widgets";
import { SnackBar } from "@tenunjs-examples/ui-kit";
import type { BleLinkState } from "../runtime";
import { fmtClock, type WashReply, type WashStatus } from "../protocol";
import { modeColor } from "../theme";
import { BannerCard, LinkHeader, ListRow, RelayRow, StopBar, WaveFillCard } from "../widgets";

/**
 * Mesin tab — the mockup's screen 04: live device reality as read-only
 * monitoring. Running banner (teal, tap → Home), the water wave card,
 * the relay indicator list ("Indikator, bukan tombol"), device probes
 * and the fresh-data caption. Everything dangerous stays on Home.
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
    connect: defineAction<ControlsState, void>({
      run({ state, services }) {
        const s = state as unknown as ControlsState;
        s.link = { ...s.link, connecting: true };
        const svc = services as { ble?: { connect(): Promise<boolean> } };
        void svc.ble?.connect();
      },
    }),
    disconnect: defineAction<ControlsState, void>({
      run({ services }) {
        const svc = services as { ble?: { disconnect(): void } };
        svc.ble?.disconnect();
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
    const running = st?.running === true;

    const relays: ReadonlyArray<{ icon: "motorA" | "motorB" | "drain" | "droplet"; name: string; on: boolean | null; color: string }> = [
      { icon: "motorA", name: "Motor A", on: st ? st.motorA : null, color: "#0E9F8C" },
      { icon: "motorB", name: "Motor B", on: st ? st.motorB : null, color: "#7C5CE0" },
      { icon: "drain", name: "Buang", on: st ? st.drain : null, color: "#2E90FA" },
      { icon: "droplet", name: "Isi", on: st ? st.inlet : null, color: "#17A673" },
    ];

    const headerPress = () => {
      if (s.link.connected || s.link.connecting) actions.disconnect();
      else actions.connect();
    };

    return (
      <Scaffold>
        <Column padding="md" gap="lg">
          <LinkHeader
            title="Mesin"
            supported={s.link.supported}
            connected={s.link.connected}
            connecting={s.link.connecting}
            phase={s.link.phase}
            name={s.link.name}
            statusAgeS={s.statusAt === null ? null : staleFor}
            stale={stale}
            onPress={headerPress}
          />

          {offline ? (
            <BannerCard icon="power" tone="warn" title="Belum tersambung" sub="sambungkan di header atas untuk memantau" />
          ) : waiting ? (
            <BannerCard icon="clock" tone="info" title="Menunggu status…" sub="menunggu kabar pertama dari mesin" />
          ) : stale ? (
            <BannerCard icon="clock" tone="warn" title="Data mesin beku" sub={`tidak diperbarui ${staleFor}s — dekati mesin`} />
          ) : running ? (
            <BannerCard
              icon="wash"
              tone="acc"
              title={`Mencuci · ${fmtClock(st!.remainS ?? 0)}`}
              sub={`${st!.prog} · ketuk untuk ke Beranda`}
              onPress={() => actions.goHome()}
            />
          ) : st!.prog.startsWith("DONE") ? (
            <BannerCard icon="check" tone="ok" title={`Selesai · ${st!.prog.replace(/^DONE /, "")}`} />
          ) : (
            <BannerCard icon="check" tone="ok" title="Siap" sub={st!.prog || "mesin siap"} />
          )}

          <WaveFillCard
            pct={st?.waterPct ?? null}
            caption={
              st === null
                ? offline
                  ? "offline · belum terbaca"
                  : "belum terbaca"
                : st.waterPct == null
                  ? "sensor belum terkalibrasi"
                  : "level air dalam tangki"
            }
          />

          <Column gap="sm">
            <Text variant="label">Status relai</Text>
            <Text variant="caption">Indikator, bukan tombol</Text>
            {relays.map((r) => (
              <RelayRow key={r.name} icon={r.icon} iconColor={r.color} label={r.name} on={r.on} />
            ))}
          </Column>

          <StopBar
            disabled={offline}
            pending={s.pending === "STOP"}
            emphasis={running}
            onPress={() => actions.send1("STOP")}
          />
          {offline ? (
            <Text variant="caption">STOP aplikasi butuh sambungan — gunakan tombol fisik di mesin</Text>
          ) : null}

          <Column gap="sm">
            <Text variant="label">Diagnostik perangkat</Text>
            <ListRow
              icon="droplet"
              iconColor="#2E90FA"
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
              iconColor="#8AA3B2"
              label="Versi firmware"
              sub={`heap ${st?.heapKB ?? "—"} KB · ${s.link.name ?? "polytron"}`}
              pill={
                offline
                  ? undefined
                  : { label: "KIRIM", busy: s.pending === "VER", onPress: () => actions.send1("VER") }
              }
              locked={offline ? "offline" : undefined}
            />
            <Text variant="caption">
              {offline ? "Data diperbarui —" : `Data diperbarui ${staleFor}s lalu`}
            </Text>
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

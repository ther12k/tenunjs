import { defineAction, defineScreen } from "@tenunjs/core";
import { Column, Scaffold, Text } from "@tenunjs/widgets";
import { SnackBar } from "@tenunjs-examples/ui-kit";
import { BannerCard, LinkHeader, ProgramCard, StepEditor } from "../widgets";
import type { BleLinkState } from "../runtime";
import {
  PROGRAM_SLOTS,
  fmtProgramSummary,
  formatProgramSteps,
  parseProgramSteps,
  type ProgramStep,
  type WashReply,
  type WashStatus,
} from "../protocol";

/**
 * Programs tab — the mockup's screen 02: the three stored programs
 * (CEPAT / NORMAL / KUSTOM) as light cards, and a real in-canvas step
 * editor (numbered steps, duration steppers, quick-add chips, duration
 * estimate, Simpan program) replacing the raw native text dialog as the
 * primary editing surface. Connection lives in the LinkHeader.
 */
export interface ProgramsState {
  link: BleLinkState;
  status: WashStatus | null;
  /** Receive time (ms) of the last ST: — header freshness label. */
  statusAt: number | null;
  values: Record<string, string>;
  pending: string | null;
  snack: WashReply | null;
  /** Non-null while the visual step editor is open for a slot. */
  editing: { slot: number; steps: ProgramStep[] } | null;
}

export const ProgramsScreen = defineScreen({
  name: "Programs",

  initialState: (): ProgramsState => ({
    link: { supported: false, connecting: false, connected: false, name: null },
    status: null,
    statusAt: null,
    values: {},
    pending: null,
    snack: null,
    editing: null,
  }),

  actions: {
    link: defineAction<ProgramsState, Partial<BleLinkState>>({
      run({ input, state }) {
        const s = state as unknown as ProgramsState;
        s.link = { ...s.link, ...input };
      },
    }),
    status: defineAction<ProgramsState, WashStatus | null>({
      run({ input, state }) {
        (state as unknown as ProgramsState).status = input;
      },
    }),
    statusAt: defineAction<ProgramsState, number | null>({
      run({ input, state }) {
        (state as unknown as ProgramsState).statusAt = input;
      },
    }),
    settings: defineAction<ProgramsState, Record<string, string>>({
      run({ input, state }) {
        (state as unknown as ProgramsState).values = input;
      },
    }),
    result: defineAction<ProgramsState, WashReply>({
      run({ input, state }) {
        const s = state as unknown as ProgramsState;
        s.pending = null;
        s.snack = input;
      },
    }),
    clearSnack: defineAction<ProgramsState, void>({
      run({ state }) {
        (state as unknown as ProgramsState).snack = null;
      },
    }),
    goHome: defineAction<ProgramsState, void>({
      run({ services }) {
        (services as { navigate?: (route: string) => void }).navigate?.("home");
      },
    }),
    connect: defineAction<ProgramsState, void>({
      run({ state, services }) {
        const s = state as unknown as ProgramsState;
        s.link = { ...s.link, connecting: true };
        const svc = services as { ble?: { connect(): Promise<boolean> } };
        void svc.ble?.connect();
      },
    }),
    disconnect: defineAction<ProgramsState, void>({
      run({ services }) {
        const svc = services as { ble?: { disconnect(): void } };
        svc.ble?.disconnect();
      },
    }),
    start: defineAction<ProgramsState, string>({
      run({ input, state, services }) {
        const s = state as unknown as ProgramsState;
        // No starts (and no single-flight leak) while a cycle runs.
        if (!s.link.connected || s.pending !== null || s.status?.running === true) return;
        s.pending = input;
        s.snack = null;
        (services as { send?: (cmd: string) => void }).send?.(input);
      },
    }),
    /** Open the visual editor pre-filled with the slot's current tokens
     *  (empty when the machine's values have not been read yet). */
    edit: defineAction<ProgramsState, number>({
      run({ input, state }) {
        const s = state as unknown as ProgramsState;
        if (!PROGRAM_SLOTS[input] || s.status?.running === true) return;
        const tokens = s.values[PROGRAM_SLOTS[input]!.key] ?? "";
        s.editing = { slot: input, steps: parseProgramSteps(tokens) };
      },
    }),
    stepBump: defineAction<ProgramsState, { index: number; dir: 1 | -1 }>({
      run({ input, state }) {
        const s = state as unknown as ProgramsState;
        if (!s.editing) return;
        const steps = s.editing.steps.map((st, i) =>
          i === input.index ? { ...st, s: Math.max(10, st.s + input.dir * 30) } : st,
        );
        s.editing = { ...s.editing, steps };
      },
    }),
    stepAdd: defineAction<ProgramsState, string>({
      run({ input, state }) {
        const s = state as unknown as ProgramsState;
        if (!s.editing) return;
        if (s.editing.steps.length >= 8) return; // firmware run_seq bound
        s.editing = {
          ...s.editing,
          steps: [...s.editing.steps, { mode: input.toUpperCase(), s: 300 }],
        };
      },
    }),
    stepRemove: defineAction<ProgramsState, { index: number }>({
      run({ input, state }) {
        const s = state as unknown as ProgramsState;
        if (!s.editing) return;
        s.editing = { ...s.editing, steps: s.editing.steps.filter((_, i) => i !== input.index) };
      },
    }),
    editCancel: defineAction<ProgramsState, void>({
      run({ state }) {
        (state as unknown as ProgramsState).editing = null;
      },
    }),
    /** Compile the steps back to firmware tokens and SET the slot — the
     *  same wire path the native dialog used (optimistic cache + ack). */
    editSave: defineAction<ProgramsState, void>({
      run({ state, services }) {
        const s = state as unknown as ProgramsState;
        if (!s.editing || !s.link.connected || s.status?.running === true) return;
        const slot = PROGRAM_SLOTS[s.editing.slot];
        if (!slot || s.editing.steps.length === 0) return;
        const tokens = formatProgramSteps(s.editing.steps);
        s.editing = null;
        s.pending = `SET ${slot.key}`;
        s.snack = null;
        (services as { send?: (cmd: string) => void }).send?.(`SET ${slot.key} ${tokens}`);
      },
    }),
  },

  view({ state, actions }) {
    const s = state as unknown as ProgramsState;
    const st = s.status;
    const running = st?.running === true;
    const offline = !s.link.connected;
    const now = Date.now();
    const staleFor = offline || s.statusAt === null ? 0 : Math.max(0, Math.round((now - s.statusAt) / 1000));
    const slotColors = ["#0E9F8C", "#17A673", "#7C5CE0"];

    const headerPress = () => {
      if (s.link.connected || s.link.connecting) actions.disconnect();
      else actions.connect();
    };

    return (
      <Scaffold>
        <Column padding="md" gap="lg">
          <LinkHeader
            title="Program"
            supported={s.link.supported}
            connected={s.link.connected}
            connecting={s.link.connecting}
            phase={s.link.phase}
            name={s.link.name}
            statusAgeS={s.statusAt === null ? null : staleFor}
            stale={false}
            onPress={headerPress}
          />

          {running ? (
            <BannerCard
              icon="clock"
              tone="warn"
              title="Mesin sedang berjalan"
              sub={`${st!.prog} · ketuk untuk ke Beranda`}
              onPress={() => actions.goHome()}
            />
          ) : null}

          {s.editing ? (
            <StepEditor
              slotName={PROGRAM_SLOTS[s.editing.slot]?.name ?? "?"}
              steps={s.editing.steps}
              onBump={(index, dir) => actions.stepBump({ index, dir })}
              onRemove={(index) => actions.stepRemove({ index })}
              onAdd={(mode) => actions.stepAdd(mode)}
              onSave={() => actions.editSave()}
              onCancel={() => actions.editCancel()}
            />
          ) : (
            <Column gap="sm">
              <Text variant="label">Program tersimpan</Text>
              {PROGRAM_SLOTS.map((slot, i) => (
                <ProgramCard
                  key={slot.key}
                  name={slot.name}
                  color={slotColors[i] ?? "#0E9F8C"}
                  line={
                    s.values[slot.key] !== undefined
                      ? fmtProgramSummary(s.values[slot.key]) || "(belum dikonfigurasi)"
                      : offline
                        ? "tersimpan di mesin · sambungkan untuk membaca"
                        : "belum dimuat — sambungkan untuk membaca"
                  }
                  state={offline ? "locked" : running ? "busy" : s.pending === `PROG ${i}` ? "pending" : "idle"}
                  onStart={() => actions.start(`PROG ${i}`)}
                  onEdit={running ? undefined : () => actions.edit(i)}
                />
              ))}
            </Column>
          )}

          {!s.editing ? (
            <Column gap="sm">
              <Text variant="label">Pemeliharaan</Text>
              <ProgramCard
                name="TUB CLEAN"
                color="#F5A524"
                icon="tub"
                line="Cuci 15 mnt · Buang 1 mnt · Peras 5 mnt"
                state={offline ? "locked" : running ? "busy" : s.pending === "TUB" ? "pending" : "idle"}
                onStart={() => actions.start("TUB")}
              />
            </Column>
          ) : null}

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

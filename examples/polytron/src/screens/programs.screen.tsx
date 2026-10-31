import { defineAction, defineScreen } from "@tenunjs/core";
import { Column, Scaffold, Text } from "@tenunjs/widgets";
import { SnackBar } from "@tenunjs-examples/ui-kit";
import {
  BannerCard,
  ChromeSpacer,
  LinkHeader,
  ListRow,
  ProgramCard,
  SegmentedControl,
  StepEditor,
  sentenceCase,
} from "../widgets";
import type { BleLinkState } from "../runtime";
import {
  PROGRAM_SLOTS,
  formatProgramSteps,
  parseProgramSteps,
  type ProgramStep,
  type WashReply,
  type WashStatus,
} from "../protocol";

/**
 * Programs tab — the reference's screen 02: a Cepat/Normal/Kustom
 * segmented selector with the selected slot's step editor ALWAYS visible
 * (numbered steps, ±30 s steppers in honest minutes:seconds, quick-add
 * chips, duration estimate, Mulai/Simpan). TUB CLEAN stays as a compact
 * maintenance card. The connection lives in the LinkHeader; STOP lives in
 * the pinned chrome.
 */
export interface ProgramsState {
  link: BleLinkState;
  status: WashStatus | null;
  /** Receive time (ms) of the last ST: — header freshness label. */
  statusAt: number | null;
  values: Record<string, string>;
  pending: string | null;
  snack: WashReply | null;
  /** Selected slot index of the segmented control. */
  selected: number;
  /** Local, unsaved editor steps per slot — initialized from the machine's
   *  tokens on first touch, kept when switching segments, consumed by
   *  Simpan (SET) or discarded on revert-to-machine values. */
  drafts: Record<number, ProgramStep[]>;
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
    selected: 0,
    drafts: {},
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
    selectSlot: defineAction<ProgramsState, number>({
      run({ input, state }) {
        const s = state as unknown as ProgramsState;
        if (!PROGRAM_SLOTS[input]) return;
        s.selected = input;
      },
    }),
    start: defineAction<ProgramsState, string>({
      run({ input, state, services }) {
        const s = state as unknown as ProgramsState;
        // No starts before the machine has spoken, while a cycle runs, or
        // with a command already in flight.
        if (!s.link.connected || s.status === null || s.status.running === true || s.pending !== null) return;
        if (s.statusAt !== null && Date.now() - s.statusAt > 15_000) return;
        s.pending = input;
        s.snack = null;
        (services as { send?: (cmd: string) => void }).send?.(input);
      },
    }),
    stepBump: defineAction<ProgramsState, { index: number; dir: 1 | -1 }>({
      run({ input, state }) {
        const s = state as unknown as ProgramsState;
        const steps = s.drafts[s.selected] ?? parseProgramSteps(s.values[PROGRAM_SLOTS[s.selected]!.key] ?? "");
        s.drafts = {
          ...s.drafts,
          [s.selected]: steps.map((st, i) =>
            i === input.index ? { ...st, s: Math.max(10, st.s + input.dir * 30) } : st,
          ),
        };
      },
    }),
    stepAdd: defineAction<ProgramsState, string>({
      run({ input, state }) {
        const s = state as unknown as ProgramsState;
        const steps = s.drafts[s.selected] ?? parseProgramSteps(s.values[PROGRAM_SLOTS[s.selected]!.key] ?? "");
        if (steps.length >= 8) return; // firmware run_seq bound
        s.drafts = {
          ...s.drafts,
          [s.selected]: [...steps, { mode: input.toUpperCase(), s: 300 }],
        };
      },
    }),
    stepRemove: defineAction<ProgramsState, { index: number }>({
      run({ input, state }) {
        const s = state as unknown as ProgramsState;
        const steps = s.drafts[s.selected] ?? parseProgramSteps(s.values[PROGRAM_SLOTS[s.selected]!.key] ?? "");
        s.drafts = { ...s.drafts, [s.selected]: steps.filter((_, i) => i !== input.index) };
      },
    }),
    /** Compile the draft back to firmware tokens and SET the slot — the
     *  same wire path as before (optimistic cache + ack). */
    editSave: defineAction<ProgramsState, void>({
      run({ state, services }) {
        const s = state as unknown as ProgramsState;
        const slot = PROGRAM_SLOTS[s.selected];
        if (!slot || !s.link.connected || s.status?.running === true) return;
        const steps = s.drafts[s.selected] ?? parseProgramSteps(s.values[slot.key] ?? "");
        if (steps.length === 0) return;
        const tokens = formatProgramSteps(steps);
        // The draft is consumed by the send: accepted → the optimistic SET
        // cache already shows the new steps; rejected → the machine's
        // rolled-back tokens re-render. Either way the editor mirrors the
        // wire truth, never a private diverged copy.
        const drafts = { ...s.drafts };
        delete drafts[s.selected];
        s.drafts = drafts;
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
    const waiting = !offline && st === null;
    const staleFor = offline || s.statusAt === null ? 0 : Math.max(0, Math.round((now - s.statusAt) / 1000));
    const stale = !offline && !waiting && staleFor > 15;

    const headerPress = () => {
      if (s.link.connected || s.link.connecting) actions.disconnect();
      else actions.connect();
    };

    const selectedSlot = PROGRAM_SLOTS[s.selected] ?? PROGRAM_SLOTS[0]!;
    const steps = s.drafts[s.selected] ?? parseProgramSteps(s.values[selectedSlot.key] ?? "");

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
            stale={stale}
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

          <Column gap="sm">
            <Text variant="label">Program tersimpan</Text>
            <SegmentedControl
              options={PROGRAM_SLOTS.map((slot) => sentenceCase(slot.name))}
              selected={s.selected}
              disabled={running || offline}
              onSelect={(i) => actions.selectSlot(i)}
            />
          </Column>

          {offline ? (
            <ListRow
              icon="lock"
              iconColor="#8DA0B5"
              label="Tersimpan di mesin"
              sub="sambungkan untuk melihat dan mengubah langkah"
              locked="offline"
            />
          ) : (
            <StepEditor
              steps={steps}
              canStart={!running && steps.length > 0}
              onBump={(index, dir) => actions.stepBump({ index, dir })}
              onRemove={(index) => actions.stepRemove({ index })}
              onAdd={(mode) => actions.stepAdd(mode)}
              onSave={() => actions.editSave()}
              onStart={running ? undefined : () => actions.start(`PROG ${s.selected}`)}
            />
          )}

          <Column gap="sm">
            <Text variant="label">Pemeliharaan</Text>
            <ProgramCard
              name="Tub clean"
              color="#C77700"
              icon="tub"
              line="Cuci 15 mnt · Buang 1 mnt · Peras 5 mnt"
              state={offline ? "locked" : running ? "busy" : s.pending === "TUB" ? "pending" : "idle"}
              onStart={() => actions.start("TUB")}
            />
          </Column>

          {s.snack ? (
            <SnackBar
              message={`${s.snack.ok ? "OK" : s.snack.busy ? "BUSY" : "ERR"} · ${s.snack.msg}`}
              actionLabel="OK"
              onAction={() => actions.clearSnack()}
            />
          ) : null}

          <ChromeSpacer />
        </Column>
      </Scaffold>
    );
  },
});

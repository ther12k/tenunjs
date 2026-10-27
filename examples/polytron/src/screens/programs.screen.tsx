import { defineAction, defineScreen } from "@tenunjs/core";
import { Column, Scaffold, Text } from "@tenunjs/widgets";
import { SnackBar } from "@tenunjs-examples/ui-kit";
import { ProgramCard, StatusStrip } from "../widgets";
import type { BleLinkState } from "../runtime";
import { PROGRAM_SLOTS, fmtProgramSummary, type WashReply, type WashStatus } from "../protocol";

/**
 * Programs tab — the three stored programs (CEPAT / NORMAL / KUSTOM with
 * their token strings, editable through the host overlay) plus the
 * built-in TUB CLEAN card. Connection state lives in the shell header.
 */
export interface ProgramsState {
  link: BleLinkState;
  status: WashStatus | null;
  values: Record<string, string>;
  pending: string | null;
  snack: WashReply | null;
}

export const ProgramsScreen = defineScreen({
  name: "Programs",

  initialState: (): ProgramsState => ({
    link: { supported: false, connecting: false, connected: false, name: null },
    status: null,
    values: {},
    pending: null,
    snack: null,
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
    start: defineAction<ProgramsState, string>({
      run({ input, state, services }) {
        const s = state as unknown as ProgramsState;
        // The strip says "STOP dulu di Home" — the actions must agree:
        // no starts (and no single-flight leak) while a cycle runs.
        if (!s.link.connected || s.pending !== null || s.status?.running === true) return;
        s.pending = input;
        s.snack = null;
        (services as { send?: (cmd: string) => void }).send?.(input);
      },
    }),
    edit: defineAction<ProgramsState, number>({
      run({ input, state, services }) {
        const s = state as unknown as ProgramsState;
        const slot = PROGRAM_SLOTS[input];
        if (!slot || !s.link.connected || s.status?.running === true) return;
        void (services as { editProgram?: (i: number, cur: string) => Promise<string | null> })
          .editProgram?.(input, s.values[slot.key] ?? "")
          .then((next) => {
            if (next !== null) {
              (services as { send?: (cmd: string) => void }).send?.(`SET ${slot.key} ${next}`);
            }
          });
      },
    }),
  },

  view({ state, actions }) {
    const s = state as unknown as ProgramsState;
    const st = s.status;
    const running = st?.running === true;
    const offline = !s.link.connected;
    const slotColors = ["#00B7FD", "#00FF80", "#BB86FC"];

    return (
      <Scaffold>
        <Column padding="md" gap="lg">
          {running ? (
            <StatusStrip
              status="SEDANG BERJALAN"
              accent="#FCB518"
              pct={null}
              right={st!.mode}
              caption={`Ketuk untuk ke Home · ${st!.prog}`}
              onPress={() => actions.goHome()}
            />
          ) : null}

          <Column gap="sm">
            <Text variant="label">PROGRAM TERSIMPAN</Text>
            {PROGRAM_SLOTS.map((slot, i) => (
              <ProgramCard
                key={slot.key}
                name={slot.name}
                color={slotColors[i] ?? "#00B7FD"}
                line={
                  s.values[slot.key] !== undefined
                    ? // Human summary ("Cuci 10 mnt · Peras 5 mnt") — raw
                      // tokens live only in the edit overlay.
                      fmtProgramSummary(s.values[slot.key]) || "(belum dikonfigurasi)"
                    : offline
                      ? "tersimpan di mesin · sambungkan untuk membaca"
                      : "belum dimuat — tarik GET:ALL di Settings"
                }
                state={offline ? "locked" : running ? "busy" : s.pending === `PROG ${i}` ? "pending" : "idle"}
                onStart={() => actions.start(`PROG ${i}`)}
                onEdit={running ? undefined : () => actions.edit(i)}
              />
            ))}
          </Column>

          <Column gap="sm">
            <Text variant="label">PEMELIHARAAN</Text>
            <ProgramCard
              name="TUB CLEAN"
              color="#FF9F45"
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
        </Column>
      </Scaffold>
    );
  },
});

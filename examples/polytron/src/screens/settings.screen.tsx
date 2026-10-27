import { defineAction, defineScreen } from "@tenunjs/core";
import { Column, Scaffold, Text } from "@tenunjs/widgets";
import { SnackBar } from "@tenunjs-examples/ui-kit";
import type { BleLinkState } from "../runtime";
import {
  SETTING_DEFS,
  fmtSettingValue,
  type WashReply,
  type WashStatus,
} from "../protocol";
import { ChoiceRow, ListRow, SensorRow, SettingRow } from "../widgets";

/**
 * Settings: everything "SET …" reaches on the device — duration/tuning
 * steppers (the canvas host has no keyboard, so numeric values step in
 * the firmware's own clamp ranges), spin motor A/B, the LCD clock (set
 * from this phone) and the water-sensor calibration. Program strings
 * live on the Programs tab. Values arrive as pushed "SET k v" lines
 * (the host sends GET:ALL after connecting); stepper taps optimise
 * locally and send immediately. Connection state lives in the shell header.
 */
export interface SettingsState {
  link: BleLinkState;
  status: WashStatus | null;
  /** Latest device values ("SET k v" lines), newest-wins. */
  values: Record<string, string>;
  snack: WashReply | null;
}

export const SettingsScreen = defineScreen({
  name: "Settings",

  initialState: (): SettingsState => ({
    link: { supported: false, connecting: false, connected: false, name: null },
    status: null,
    values: {},
    snack: null,
  }),

  actions: {
    link: defineAction<SettingsState, Partial<BleLinkState>>({
      run({ input, state }) {
        const s = state as unknown as SettingsState;
        s.link = { ...s.link, ...input };
      },
    }),
    status: defineAction<SettingsState, WashStatus | null>({
      run({ input, state }) {
        (state as unknown as SettingsState).status = input;
      },
    }),
    settings: defineAction<SettingsState, Record<string, string>>({
      run({ input, state }) {
        (state as unknown as SettingsState).values = input;
      },
    }),
    result: defineAction<SettingsState, WashReply>({
      run({ input, state }) {
        (state as unknown as SettingsState).snack = input;
      },
    }),
    clearSnack: defineAction<SettingsState, void>({
      run({ state }) {
        (state as unknown as SettingsState).snack = null;
      },
    }),
    refresh: defineAction<SettingsState, void>({
      run({ state, services }) {
        const s = state as unknown as SettingsState;
        if (!s.link.connected) return;
        (services as { send?: (cmd: string) => void }).send?.("GET:ALL");
      },
    }),
    /** Step a numeric setting inside its firmware clamp range and SET it.
     *  Requires the machine's current value — stepping an unloaded value
     *  would silently jump from the firmware minimum, not the real one. */
    bump: defineAction<SettingsState, { key: string; dir: 1 | -1 }>({
      run({ input, state, services }) {
        const s = state as unknown as SettingsState;
        const def = SETTING_DEFS.find((d) => d.key === input.key);
        if (!def || !s.link.connected || s.values[def.key] === undefined) return;
        const raw = parseFloat(s.values[def.key] ?? "");
        const base = Number.isNaN(raw) ? def.min : raw;
        const next = Math.min(def.max, Math.max(def.min, base + def.step * input.dir));
        s.values = { ...s.values, [def.key]: fmtSettingValue(def, next) };
        (services as { send?: (cmd: string) => void }).send?.(`SET ${def.key} ${fmtSettingValue(def, next)}`);
      },
    }),
    spinMotor: defineAction<SettingsState, number>({
      run({ input, state, services }) {
        const s = state as unknown as SettingsState;
        if (!s.link.connected) return;
        const motor = input === 1 ? "B" : "A";
        s.values = { ...s.values, SPINMOTOR: motor };
        (services as { send?: (cmd: string) => void }).send?.(`SET SPINMOTOR ${motor}`);
      },
    }),
    /** "CLOCK hh:mm" from the host clock — no typing needed. */
    clock: defineAction<SettingsState, void>({
      run({ state, services }) {
        const s = state as unknown as SettingsState;
        if (!s.link.connected) return;
        const now = (services as { clockNow?: () => string | null }).clockNow?.() ?? null;
        if (!now) {
          s.snack = { ok: false, busy: false, msg: "waktu host tidak tersedia" };
          return;
        }
        (services as { send?: (cmd: string) => void }).send?.(`CLOCK ${now}`);
      },
    }),
    wcal: defineAction<SettingsState, string>({
      run({ input, state, services }) {
        if (!(state as unknown as SettingsState).link.connected) return;
        (services as { send?: (cmd: string) => void }).send?.(`WCAL ${input}`);
      },
    }),
    water: defineAction<SettingsState, void>({
      run({ state, services }) {
        if (!(state as unknown as SettingsState).link.connected) return;
        (services as { send?: (cmd: string) => void }).send?.("WATER");
      },
    }),
  },

  view({ state, actions }) {
    const s = state as unknown as SettingsState;
    const offline = !s.link.connected;
    const spinMotorIdx = s.values.SPINMOTOR === "B" ? 1 : s.values.SPINMOTOR === "A" ? 0 : -1;
    const waterPct = s.status?.waterPct ?? null;
    // Everyday durations above calibration above motor tuning — the
    // common controls must not be a scroll away.
    const everyday = SETTING_DEFS.filter((d) => !d.advanced);
    const advanced = SETTING_DEFS.filter((d) => d.advanced);

    const settingRows = (defs: readonly (typeof SETTING_DEFS[number])[]) =>
      defs.map((def) => (
        <SettingRow
          key={def.key}
          label={def.label}
          sub={def.key}
          value={s.values[def.key]}
          disabled={offline}
          unloaded={!offline && s.values[def.key] === undefined}
          onStep={(dir) => actions.bump({ key: def.key, dir })}
        />
      ));

    return (
      <Scaffold>
        <Column padding="md" gap="lg">
          <Column gap="sm">
            <Text variant="label">MESIN</Text>
            <ChoiceRow
              label="Motor peras"
              sub={spinMotorIdx < 0 ? (offline ? "tersimpan di mesin" : "belum dimuat") : `aktif: MOTOR ${s.values.SPINMOTOR}`}
              options={["A", "B"]}
              selected={spinMotorIdx < 0 ? 0 : spinMotorIdx}
              disabled={offline || spinMotorIdx < 0}
              onSelect={(i) => actions.spinMotor(i)}
            />
            <ListRow
              icon="clock"
              iconColor="#9DB2C7"
              label="Jam LCD"
              sub="samakan dengan jam ponsel ini"
              pill={offline ? undefined : { label: "SET CLOCK", onPress: () => actions.clock() }}
              locked={offline ? "offline" : undefined}
            />
          </Column>

          <Column gap="sm">
            <Text variant="label">DURASI</Text>
            {settingRows(everyday)}
          </Column>

          <Column gap="sm">
            <Text variant="label">SENSOR AIR</Text>
            <SensorRow
              pct={waterPct}
              caption={
                waterPct === null
                  ? offline
                    ? "offline · belum terbaca"
                    : "belum terbaca"
                  : "level air dalam tangki"
              }
            />
            <ListRow
              icon="droplet"
              iconColor="#00FFC8"
              label="Kalibrasi tangki kosong"
              sub="isi ulang referensi bawah (WCAL EMPTY)"
              pill={offline ? undefined : { label: "JALANKAN", onPress: () => actions.wcal("EMPTY") }}
              locked={offline ? "offline" : undefined}
            />
            <ListRow
              icon="droplet"
              iconColor="#00FFC8"
              label="Kalibrasi tangki penuh"
              sub="isi ulang referensi atas (WCAL FULL)"
              pill={offline ? undefined : { label: "JALANKAN", onPress: () => actions.wcal("FULL") }}
              locked={offline ? "offline" : undefined}
            />
            <ListRow
              label="Matikan mode kalibrasi"
              sub="WCAL OFF"
              pill={offline ? undefined : { label: "MATIKAN", onPress: () => actions.wcal("OFF") }}
              locked={offline ? "offline" : undefined}
            />
          </Column>

          <Column gap="sm">
            <Text variant="label">LANJUTAN</Text>
            {settingRows(advanced)}
          </Column>

          <ListRow
            label="Muat ulang pengaturan"
            sub="GET:ALL — baca semua nilai dari mesin"
            pill={offline ? undefined : { label: "GET:ALL", onPress: () => actions.refresh() }}
            locked={offline ? "offline" : undefined}
          />

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

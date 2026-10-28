/**
 * polytronwash v4 BLE GATT wire protocol — pure parsing and command
 * building, no host knowledge. Mirrors execCmd()/statusLine() in the
 * firmware (v4/src/main.cpp); the firmware is NOT touched by this app.
 *
 *  - service  9f6d1c30-…e001, cmd write …e002 (≤190 bytes)
 *  - status   …e003 read+notify, one line per event:
 *      "ST:MODE|prog|step|elapsedS|remainS|ABDI|heapKB|Wpct"
 *      (relays A/B/drain/inlet as 0/1 digits; W-1 = sensor uncalibrated;
 *       the water field is tolerated missing for older lines)
 *      "SET KEY value" x14 after GET, "OK …" / "BUSY - STOP first" /
 *      "ERR …" / info lines (CLOCK …, WATER …) as command replies
 *  - verbs: STOP · WASH|SPIN|DRAIN|FILL [s] · RINSE · RINSEND ·
 *    PROG 0..2 · TUB · CLOCK hh:mm · STAT · SET KEY VAL · GET:ALL ·
 *    WATER · WCAL EMPTY|FULL|OFF · VER
 */

export const BLE_SVC_UUID = "9f6d1c30-5f2e-4d8a-b7c3-00a1b2c3e001";
export const BLE_CMD_UUID = "9f6d1c30-5f2e-4d8a-b7c3-00a1b2c3e002";
export const BLE_STAT_UUID = "9f6d1c30-5f2e-4d8a-b7c3-00a1b2c3e003";
export const BLE_DEVICE_NAME = "Polytron Wash";

export type WashMode = "WASH" | "DRAIN" | "FILL" | "SPIN" | "WAIT" | "STOP" | "IDLE";

export interface WashStatus {
  readonly mode: WashMode | string;
  readonly prog: string;
  readonly step: number;
  readonly steps: number;
  readonly elapsedS: number;
  readonly remainS: number;
  readonly motorA: boolean;
  readonly motorB: boolean;
  readonly drain: boolean;
  readonly inlet: boolean;
  readonly heapKB: number;
  /** null = water sensor uncalibrated/absent (W-1 or field missing). */
  readonly waterPct: number | null;
  readonly running: boolean;
}

const IDLE_LIKE: ReadonlySet<string> = new Set(["IDLE", "STOP"]);

/** "ST:WASH|NORMAL|2/5|120|480|1010|142|W63" → WashStatus; null if not ST. */
export function parseStatus(line: string): WashStatus | null {
  if (!line.startsWith("ST:")) return null;
  const f = line.slice(3).split("|");
  if (f.length < 7) return null;
  const step = f[2]!.split("/");
  const rel = (f[5] ?? "0000").padEnd(4, "0");
  const waterField = f[7];
  let waterPct: number | null = null;
  if (waterField !== undefined && waterField.startsWith("W")) {
    const n = parseInt(waterField.slice(1), 10);
    if (!Number.isNaN(n) && n >= 0) waterPct = n; // W-1 stays null
  }
  const mode = f[0]!;
  return {
    mode,
    prog: f[1] ?? "",
    step: parseInt(step[0] ?? "0", 10) || 0,
    steps: parseInt(step[1] ?? "0", 10) || 0,
    elapsedS: Math.max(0, parseInt(f[3] ?? "0", 10) || 0),
    remainS: Math.max(0, parseInt(f[4] ?? "0", 10) || 0),
    motorA: rel[0] === "1",
    motorB: rel[1] === "1",
    drain: rel[2] === "1",
    inlet: rel[3] === "1",
    heapKB: parseInt(f[6] ?? "0", 10) || 0,
    waterPct,
    running: !IDLE_LIKE.has(mode),
  };
}

/** "SET WASHMIN 10" / "SET PROG2 WASH:600, DRAIN:30" → {key, value}. */
export function parseSetting(line: string): { key: string; value: string } | null {
  const m = /^SET (\S+) ?(.*)$/.exec(line);
  if (!m) return null;
  return { key: m[1]!, value: m[2] ?? "" };
}

export interface WashReply {
  readonly ok: boolean;
  /** True for "BUSY - STOP first" — worth a distinct warning treatment. */
  readonly busy: boolean;
  readonly msg: string;
}

/** OK…/ERR…/BUSY… → WashReply; informational lines (CLOCK…, WATER…) → null. */
export function parseReply(line: string): WashReply | null {
  if (line.startsWith("OK ")) return { ok: true, busy: false, msg: line.slice(3) };
  if (line === "OK") return { ok: true, busy: false, msg: "OK" };
  if (line.startsWith("ERR")) return { ok: false, busy: false, msg: line };
  if (line.startsWith("BUSY")) return { ok: false, busy: true, msg: line };
  return null;
}

/** Numeric settings the firmware clamps (setKey ranges) — stepper ranges.
 *  `advanced` rows are motor-tuning values most users never touch; they
 *  render in a separate LANJUTAN section at the bottom of Settings. */
export interface SettingDef {
  readonly key: string;
  readonly label: string;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  /** Display decimals (PULSES 0.1 s, DEADS 0.01 s). */
  readonly decimals: number;
  readonly advanced?: boolean;
}

export const SETTING_DEFS: readonly SettingDef[] = [
  { key: "WASHMIN", label: "Cuci min", min: 1, max: 60, step: 1, decimals: 0 },
  { key: "SPINMIN", label: "Peras min", min: 1, max: 30, step: 1, decimals: 0 },
  { key: "DRAINMIN", label: "Buang min", min: 1, max: 15, step: 1, decimals: 0 },
  { key: "FILLMIN", label: "Isi min", min: 1, max: 10, step: 1, decimals: 0 },
  { key: "RINSEMIN", label: "Bilas min", min: 1, max: 15, step: 1, decimals: 0 },
  { key: "SPINDRAINS", label: "Buang saat peras", min: 5, max: 300, step: 5, decimals: 0, advanced: true },
  { key: "RINSEDRAINS", label: "Buang saat bilas", min: 15, max: 180, step: 5, decimals: 0, advanced: true },
  { key: "STOPCOASTS", label: "Coast berhenti", min: 0, max: 60, step: 1, decimals: 0, advanced: true },
  { key: "PULSES", label: "Pulse putaran", min: 0.5, max: 10, step: 0.1, decimals: 1, advanced: true },
  { key: "DEADS", label: "Jeda antar-pulse", min: 0, max: 5, step: 0.05, decimals: 2, advanced: true },
];

export const PROGRAM_SLOTS: readonly { key: string; name: string }[] = [
  { key: "PROG0", name: "CEPAT" },
  { key: "PROG1", name: "NORMAL" },
  { key: "PROG2", name: "KUSTOM" },
];

/** Indonesian labels for program token modes (the user-facing wording —
 *  raw tokens stay in the edit overlay only). */
export const MODE_LABELS: Readonly<Record<string, string>> = {
  WASH: "Cuci",
  SPIN: "Peras",
  DRAIN: "Buang",
  FILL: "Isi",
  WAIT: "Tunggu",
  RINSE: "Bilas",
};

/** 600 → "10 mnt", 30 → "30 dtk" — step-readable durations. */
export function fmtDurationS(totalS: number): string {
  const s = Math.max(0, Math.floor(totalS));
  return s >= 60 ? `${Math.round(s / 60)} mnt` : `${s} dtk`;
}

/** "WASH:600, DRAIN:30, SPIN:300" → "Cuci 10 mnt · Buang 30 dtk · Peras 5 mnt".
 *  Unrecognized tokens pass through verbatim so nothing is hidden. */
export function fmtProgramSummary(tokens: string): string {
  const trimmed = tokens.trim();
  if (!trimmed) return "";
  const parts: string[] = [];
  for (const raw of trimmed.split(",")) {
    const piece = raw.trim();
    if (!piece) continue;
    const m = /^([A-Za-z]+):(\d+)$/.exec(piece);
    if (!m) return trimmed; // not token-shaped — show the machine's own text
    const label = MODE_LABELS[m[1]!.toUpperCase()] ?? m[1]!.toUpperCase();
    parts.push(`${label} ${fmtDurationS(parseInt(m[2]!, 10))}`);
  }
  return parts.length > 0 ? parts.join(" · ") : trimmed;
}

/** A single step in a program sequence. */
export interface ProgramStep {
  mode: string;
  s: number;
}

/** Parses raw tokens ("WASH:600, DRAIN:30") into structured steps. */
export function parseProgramSteps(tokens: string): ProgramStep[] {
  const trimmed = tokens.trim();
  if (!trimmed) return [];
  const steps: ProgramStep[] = [];
  for (const raw of trimmed.split(",")) {
    const piece = raw.trim();
    if (!piece) continue;
    const m = /^([A-Za-z]+):(\d+)$/.exec(piece);
    if (m) {
      steps.push({
        mode: m[1]!.toUpperCase(),
        s: Math.max(1, parseInt(m[2]!, 10) || 0),
      });
    }
  }
  return steps;
}

/** Formats structured steps back into standard firmware token string. */
export function formatProgramSteps(steps: readonly ProgramStep[]): string {
  return steps.map((st) => `${st.mode}:${Math.round(st.s)}`).join(", ");
}

/** Humanized formatting for Recent Activity rows on Home. */
export function fmtActivityLine(raw: string): string {
  const line = raw.trim();
  if (!line) return "";
  if (line.startsWith("> ")) {
    const cmd = line.slice(2).trim();
    if (cmd === "STOP") return "Minta stop";
    if (cmd.startsWith("PROG ")) {
      const idx = parseInt(cmd.slice(5), 10);
      const name = PROGRAM_SLOTS[idx]?.name ?? `Slot ${idx}`;
      return `Mulai program ${name}`;
    }
    if (cmd === "TUB") return "Mulai Tub Clean";
    if (cmd.startsWith("SET PROG")) {
      const idx = parseInt(cmd.slice(8), 10); // "SET PROG0 …" → slot index
      const name = PROGRAM_SLOTS[idx]?.name ?? "program";
      return `Edit program ${name}`;
    }
    if (cmd.startsWith("SET ")) {
      const key = cmd.slice(4).split(" ")[0] ?? "";
      return `Atur ${key}`;
    }
    const mode = MODE_LABELS[cmd] ?? cmd;
    return `Mulai ${mode}`;
  }
  if (line.startsWith("OK ")) {
    const msg = line.slice(3).trim();
    if (msg === "STOP") return "Mesin berhenti";
    if (msg.startsWith("PROG ") || msg === "TUB CLEAN") return `Program dimulai (${msg})`;
    if (msg.startsWith("SET ")) return `Tersimpan: ${msg.slice(4).split(" ")[0] ?? ""}`;
    const m = /^([A-Za-z]+)\s+(\d+)\s*s$/.exec(msg);
    if (m) {
      const mode = MODE_LABELS[m[1]!.toUpperCase()] ?? m[1]!;
      return `${mode} dimulai (${fmtDurationS(parseInt(m[2]!, 10))})`;
    }
    return `OK · ${msg}`;
  }
  if (line.startsWith("BUSY")) {
    return "Ditolak: mesin sedang berjalan";
  }
  if (line.startsWith("ERR ")) {
    return line;
  }
  return line;
}

/** mm:ss, clamp-negative — the LCD's SISA format. */
export function fmtClock(totalS: number): string {
  const s = Math.max(0, Math.floor(totalS));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Stepper formatting for a def (10 → "10", 1.5 → "1.5"). */
export function fmtSettingValue(def: SettingDef, v: number): string {
  return v.toFixed(def.decimals);
}

export function parseSettingValue(def: SettingDef, raw: string): number | null {
  const n = parseFloat(raw);
  if (Number.isNaN(n)) return null;
  return Math.min(def.max, Math.max(def.min, n));
}

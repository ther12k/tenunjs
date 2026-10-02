/**
 * Snapshot model: the esp-votol dashboard backend's /state.json normalized
 * into a defensive app-side shape. Every field is optional — the backend may
 * be down, the bridge offline, or the keyless module absent; the app renders
 * an honest "unknown" surface instead of crashing on missing data.
 */

export interface TelemetrySlice {
  readonly voltage_v: number | null;
  readonly current_a: number | null;
  readonly rpm: number | null;
  readonly controller_temp_c: number | null;
  readonly motor_temp_c: number | null;
  readonly gear: string | null;
  readonly status: string | null;
  readonly fault_code: number | null;
  readonly brake: boolean;
  readonly reverse: boolean;
  readonly regen: boolean;
}

export interface FobSlice {
  readonly count: number;
  readonly present: boolean;
  readonly rssi: number | null;
  readonly ageS: number | null;
  readonly mac: string;
}

export interface KeylessSlice {
  readonly configured: boolean;
  readonly reachable: boolean;
  readonly armed: boolean;
  readonly alarm: boolean;
  readonly fob: FobSlice;
  readonly ignition: "hot" | "cold" | "unknown";
  readonly bench: boolean;
  readonly masterOff: boolean;
}

export interface LinkSlice {
  readonly online: boolean;
  readonly host: string | null;
  readonly port: number | null;
  readonly monitor: boolean;
  readonly framesRx: number;
  readonly lastFrameAgeS: number | null;
  readonly answering: boolean | null;
}

export interface VotolSnapshot {
  readonly link: LinkSlice;
  readonly telemetry: TelemetrySlice | null;
  readonly keyless: KeylessSlice;
  readonly params: ReadonlyArray<readonly [string, string]>;
}

const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;
const str = (v: unknown): string | null =>
  typeof v === "string" && v.length > 0 ? v : null;
const bool = (v: unknown): boolean => v === true;

/** Normalize the raw backend JSON; never throws, never trusts shapes. */
export function normalizeSnapshot(raw: unknown): VotolSnapshot {
  const o = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const t = (typeof o.telemetry === "object" && o.telemetry !== null ? o.telemetry : null) as Record<string, unknown> | null;
  const k = (typeof o.keyless === "object" && o.keyless !== null ? o.keyless : null) as Record<string, unknown> | null;
  const fob = (k && typeof k.fob === "object" && k.fob !== null ? k.fob : {}) as Record<string, unknown>;

  const rawParams = Array.isArray(o.params) ? o.params : [];
  const params: Array<readonly [string, string]> = [];
  for (const row of rawParams) {
    if (Array.isArray(row) && typeof row[0] === "string") {
      params.push([row[0], String(row[1] ?? "—")]);
    }
  }

  const rxAge = num(o.rx_age_s);

  return {
    link: {
      online: bool(o.connected),
      host: str(o.host),
      port: num(o.port),
      monitor: bool(o.monitor),
      framesRx: num(o.rx) ?? 0,
      lastFrameAgeS: rxAge,
      answering:
        rxAge === null ? null : bool(o.connected) && rxAge < 10,
    },
    telemetry: t
      ? {
          voltage_v: num(t.voltage_v),
          current_a: num(t.current_a),
          rpm: num(t.rpm),
          controller_temp_c: num(t.controller_temp_c),
          motor_temp_c: num(t.motor_temp_c),
          gear: str(t.gear),
          status: str(t.status),
          fault_code: num(t.fault_code),
          brake: bool(t.brake),
          reverse: bool(t.reverse),
          regen: bool(t.regen),
        }
      : null,
    keyless: {
      configured: typeof o.keyless_host === "string" && o.keyless_host.length > 0,
      reachable: k !== null,
      armed: k ? bool(k.armed) : false,
      alarm: k ? bool(k.alarm) : false,
      fob: {
        count: num(fob.count) ?? 0,
        present: bool(fob.present),
        rssi: num(fob.rssi),
        ageS: num(fob.ageS),
        mac: str(fob.mac) ?? "",
      },
      ignition:
        k?.ignstate === "hot" || k?.ignstate === "cold"
          ? (k.ignstate as "hot" | "cold")
          : "unknown",
      bench: k ? bool(k.bench) : false,
      masterOff: k ? bool(k.master) : false,
    },
    params,
  };
}

/** Group parameter rows by their "P<n> · label" prefix. */
export interface ParamGroup {
  readonly packet: string;
  readonly rows: ReadonlyArray<readonly [string, string]>;
}

export function groupParams(rows: ReadonlyArray<readonly [string, string]>): ParamGroup[] {
  const groups: ParamGroup[] = [];
  const index = new Map<string, ParamGroup>();
  for (const [label, value] of rows) {
    const match = /^(P\d)\s*·\s*(.*)$/.exec(label);
    const packet = match?.[1] ?? "P?";
    const field = match?.[2] ?? label;
    let group = index.get(packet);
    if (!group) {
      group = { packet, rows: [] };
      index.set(packet, group);
      groups.push(group);
    }
    (group.rows as Array<readonly [string, string]>).push([field, value]);
  }
  return groups;
}

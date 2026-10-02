import { defineAction, defineScreen } from "@tenunjs/core";
import { AppBar, Button, Card, Column, Row, Scaffold, Text } from "@tenunjs/widgets";
import { Chip } from "@tenunjs-examples/ui-kit";
import type { VotolSnapshot } from "../snapshot";

/**
 * Keyless & alarm: armed state, fob presence, interlock statuses (ignition /
 * bench / master), and the arm / disarm / panic commands. The module's own
 * safety gate stays authoritative — a refused arm shows up as "still
 * disarmed" on the next sync, with the module-side reason in the log.
 */
export interface KeylessState {
  snapshot: VotolSnapshot | null;
  pending: string | null;
  lastResult: string | null;
}

export interface KeylessCommandResult {
  label: string;
  ok: boolean;
  msg: string | null;
}

export const KeylessScreen = defineScreen({
  name: "Keyless",

  initialState: (): KeylessState => ({ snapshot: null, pending: null, lastResult: null }),

  actions: {
    sync: defineAction<KeylessState, VotolSnapshot>({
      run({ input, state }) {
        (state as unknown as KeylessState).snapshot = input;
      },
    }),
    // services reach action RUNS, not views: the send action starts the
    // command; the host resolves it through services.keylessDone, which the
    // runtime routes back into this screen's `result` action.
    send: defineAction<KeylessState, { label: string; action: string }>({
      run({ input, state, services }) {
        const svc = services as {
          keyless?: (action: string) => Promise<KeylessCommandResult>;
          keylessDone?: (r: KeylessCommandResult) => void;
        };
        (state as unknown as KeylessState).pending = input.label;
        (state as unknown as KeylessState).lastResult = null;
        void svc.keyless?.(input.action).then((r) =>
          svc.keylessDone?.({ label: input.label, ok: r.ok, msg: r.msg }),
        );
      },
    }),
    result: defineAction<KeylessState, KeylessCommandResult>({
      run({ input, state }) {
        const s = state as unknown as KeylessState;
        s.pending = null;
        s.lastResult = input.ok
          ? `✓ ${input.label}`
          : `✗ ${input.label}${input.msg ? ` — ${input.msg}` : ""}`;
      },
    }),
  },

  view({ state, actions }) {
    const snap = state.snapshot;
    const k = snap?.keyless;

    const send = (label: string, action: string) => actions.send({ label, action });

    if (!k?.configured) {
      return (
        <Scaffold appBar={<AppBar title="Keyless & alarm" />}>
          <Column padding="lg" gap="lg">
            <Card padding="md" radius="md">
              <Text variant="title">Not configured</Text>
              <Text variant="body" color="#9AA3B2">
                set KEYLESS_HOST in webapp/app.py on the dashboard backend, then
                restart it — this panel appears automatically.
              </Text>
            </Card>
          </Column>
        </Scaffold>
      );
    }

    return (
      <Scaffold appBar={<AppBar title="Keyless & alarm" />}>
        <Column padding="lg" gap="lg">
          <Card
            padding="md"
            radius="md"
            background={k.armed ? "#2A1115" : "#10241C"}
          >
            <Row gap="md">
              <Text variant="display">{k.armed ? "🔒" : "🔓"}</Text>
              <Column gap="xs">
                <Text variant="headline" color={k.armed ? "#EF4444" : "#10B981"}>
                  {k.armed ? "ARMED" : "disarmed"}
                </Text>
                <Text variant="body" color="#9AA3B2">
                  {k.alarm
                    ? "🚨 SIREN ON"
                    : k.reachable
                      ? "module online"
                      : "module offline"}
                </Text>
              </Column>
            </Row>
          </Card>

          {k.alarm ? (
            <Card padding="md" radius="md" background="#2A1115">
              <Text variant="title" color="#EF4444">🚨 siren running</Text>
              <Text variant="body">vibration alarm is sounding at the bike</Text>
            </Card>
          ) : null}

          <Card padding="md" radius="md" background="surfaceRaised">
            <Column gap="xs">
              <Text variant="label">FOB</Text>
              <Text variant="body">
                {k.fob.count === 0
                  ? "none learned"
                  : k.fob.present
                    ? `present · ${k.fob.rssi ?? "–"} dBm${k.fob.mac ? ` · ${k.fob.mac}` : ""}`
                    : `absent · seen ${k.fob.ageS ?? "–"} s ago`}
              </Text>
              <Text variant="caption">
                {k.fob.count} learned · disarm while any fob is near
              </Text>
            </Column>
          </Card>

          <Row gap="sm">
            <Chip label="ignition ON" selected={k.ignition === "hot"} />
            <Chip label="sense unknown" selected={k.ignition === "unknown"} />
            <Chip label="bench mode" selected={k.bench} />
            <Chip label="master off" selected={k.masterOff} />
          </Row>

          <Row gap="sm">
            <Button variant="secondary" onPress={() => send("disarm", "keyless_disarm")}>
              🔓 Disarm
            </Button>
            <Button variant="primary" onPress={() => send("arm", "keyless_arm")}>
              🔒 Arm
            </Button>
            <Button variant="danger" onPress={() => send("panic", "keyless_panic")}>
              🚨 Panic
            </Button>
          </Row>

          {state.pending ? (
            <Text variant="body" color="#9AA3B2">⏳ {state.pending}…</Text>
          ) : null}
          {state.lastResult ? <Text variant="body">{state.lastResult}</Text> : null}
          <Text variant="caption">
            the module's safety gate is authoritative: arming is refused while the
            ignition is ON or the sense is not validated
          </Text>
        </Column>
      </Scaffold>
    );
  },
});

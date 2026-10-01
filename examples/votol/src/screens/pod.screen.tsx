import { defineAction, defineScreen } from "@tenunjs/core";
import { AppBar, Button, Card, Column, Row, Scaffold, Text } from "@tenunjs/widgets";
import { Chip } from "@tenunjs-examples/ui-kit";

/**
 * Pod direct link: a Bluetooth LE command channel straight to the tft-dash
 * display pod (service c9d01402-…). Pairing copies the 32-hex key shown as
 * a QR in the pod's SYS → SET tab; commands are "CMD:KEY" writes answered
 * over the status characteristic. The pod stays authoritative — its
 * replies (OK …/ERR …) and status line ("ARMED FON") render verbatim.
 *
 * The screen knows no Bluetooth: the host implements the `pod` service
 * seam (browser host = Web Bluetooth; Android host = native BLE module
 * when one exists). Link reality arrives via the `link` action the host
 * pushes through runtime.podSync().
 */
export type PodCmd = "ARM" | "DISARM" | "PANIC" | "STAT";

export interface PodLinkState {
  supported: boolean;
  paired: boolean;
  connected: boolean;
  /** null = unknown (not connected yet, or the pod never answered). */
  armed: boolean | null;
  fobNear: boolean | null;
  pending: PodCmd | "PAIR" | "CONNECT" | null;
  lastMsg: string | null;
}

export interface PodReply {
  ok: boolean;
  msg: string | null;
}

export const PodScreen = defineScreen({
  name: "Pod",

  initialState: (): PodLinkState => ({
    supported: false,
    paired: false,
    connected: false,
    armed: null,
    fobNear: null,
    pending: null,
    lastMsg: null,
  }),

  actions: {
    /** Host push: BLE link reality (pair/connect/disconnect, live status). */
    link: defineAction<PodLinkState, Partial<PodLinkState>>({
      run({ input, state }) {
        Object.assign(state as unknown as PodLinkState, input);
      },
    }),
    /** Open the host pairing flow (QR scan / paste key). */
    pair: defineAction<PodLinkState, void>({
      run({ state, services }) {
        const svc = services as { pod?: { pair(): Promise<boolean> } };
        (state as unknown as PodLinkState).pending = "PAIR";
        (state as unknown as PodLinkState).lastMsg = null;
        // the host resolves the overlay, saves the key and pushes `link`
        void svc.pod?.pair().then(() => {
          const s = state as unknown as PodLinkState;
          if (s.pending === "PAIR") s.pending = null;
        });
      },
    }),
    forget: defineAction<PodLinkState, void>({
      run({ services }) {
        const svc = services as { pod?: { forget(): void } };
        svc.pod?.forget();
      },
    }),
    /** Connect the BLE session (must be a user gesture in the browser). */
    connect: defineAction<PodLinkState, void>({
      run({ state, services }) {
        const svc = services as { pod?: { connect(): Promise<boolean> } };
        (state as unknown as PodLinkState).pending = "CONNECT";
        (state as unknown as PodLinkState).lastMsg = null;
        void svc.pod?.connect().then(() => {
          const s = state as unknown as PodLinkState;
          if (s.pending === "CONNECT") s.pending = null;
        });
      },
    }),
    // services reach action RUNS, not views: the send action starts the
    // command; the host resolves it through services.podDone, which the
    // runtime routes back into this screen's `result` action.
    send: defineAction<PodLinkState, PodCmd>({
      run({ input, state, services }) {
        const svc = services as {
          pod?: { send(cmd: PodCmd): Promise<PodReply> };
          podDone?: (r: PodReply) => void;
        };
        (state as unknown as PodLinkState).pending = input;
        (state as unknown as PodLinkState).lastMsg = null;
        void svc.pod?.send(input).then((r) => svc.podDone?.(r));
      },
    }),
    result: defineAction<PodLinkState, PodReply>({
      run({ input, state }) {
        const s = state as unknown as PodLinkState;
        s.pending = null;
        s.lastMsg = input.ok
          ? `✓ ${input.msg ?? "done"}`
          : `✗ ${input.msg ?? "failed"}`;
        // pod replies "OK ARM" / "OK DISARM" (and "ARMED FON" statuses)
        const m = /^(OK )?(ARMED|DISARM(?:ED)?|ARM)\b/.exec(input.msg ?? "");
        if (m) s.armed = m[2].startsWith("ARM");
      },
    }),
  },

  view({ state, actions }) {
    const s = state as unknown as PodLinkState;
    // Button has no disabled prop: the guard keeps a busy link single-flight
    const send = (cmd: PodCmd) => actions.send(cmd);
    const sendSafe = (cmd: PodCmd) => {
      if (s.pending === null) send(cmd);
    };

    if (!s.supported) {
      return (
        <Scaffold appBar={<AppBar title="Pod · direct link" />}>
          <Column padding="lg" gap="lg">
            <Card padding="md" radius="md">
              <Text variant="title">Bluetooth unavailable</Text>
              <Text variant="body" color="#9AA3B2">
                this host has no Web Bluetooth — open the app in Chrome on
                Android, standing near the bike.
              </Text>
            </Card>
          </Column>
        </Scaffold>
      );
    }

    if (!s.paired) {
      return (
        <Scaffold appBar={<AppBar title="Pod · direct link" />}>
          <Column padding="lg" gap="lg">
            <Card padding="md" radius="md">
              <Text variant="title">Pair with the pod</Text>
              <Text variant="body" color="#9AA3B2">
                wake the pod screen (fob near, or double-tap + PIN), open
                SYS → SET, and scan the QR — or type the 32-character key.
              </Text>
            </Card>
            <Button variant="primary" onPress={() => actions.pair()}>
              {s.pending === "PAIR" ? "pairing…" : "Scan QR / enter key"}
            </Button>
          </Column>
        </Scaffold>
      );
    }

    if (!s.connected) {
      return (
        <Scaffold appBar={<AppBar title="Pod · direct link" />}>
          <Column padding="lg" gap="lg">
            <Card padding="md" radius="md" background="surfaceRaised">
              <Row gap="md">
                <Text variant="display">🛰️</Text>
                <Column gap="xs">
                  <Text variant="headline">paired · offline</Text>
                  <Text variant="body" color="#9AA3B2">
                    connect when you are at the bike — the link is Bluetooth,
                    not internet
                  </Text>
                </Column>
              </Row>
            </Card>
            <Button variant="primary" onPress={() => actions.connect()}>
              {s.pending === "CONNECT" ? "connecting…" : "Connect"}
            </Button>
            <Button variant="text" onPress={() => actions.forget()}>
              forget this pod
            </Button>
            {s.lastMsg ? <Text variant="caption">{s.lastMsg}</Text> : null}
          </Column>
        </Scaffold>
      );
    }

    const armed = s.armed;
    return (
      <Scaffold appBar={<AppBar title="Pod · direct link" />}>
        <Column padding="lg" gap="lg">
          <Card
            padding="md"
            radius="md"
            background={armed === true ? "#2A1115" : armed === false ? "#10241C" : "surfaceRaised"}
          >
            <Row gap="md">
              <Text variant="display">{armed === true ? "🔒" : armed === false ? "🔓" : "❔"}</Text>
              <Column gap="xs">
                <Text variant="headline" color={armed === true ? "#EF4444" : armed === false ? "#10B981" : undefined}>
                  {armed === true ? "ARMED" : armed === false ? "disarmed" : "unknown"}
                </Text>
                <Text variant="body" color="#9AA3B2">
                  {s.pending && s.pending !== "PAIR" && s.pending !== "CONNECT"
                    ? `sending ${s.pending}…`
                    : "pod linked · tap an action"}
                </Text>
              </Column>
            </Row>
          </Card>

          <Row gap="sm">
            <Chip label="fob near" selected={s.fobNear === true} />
            <Chip label="fob away" selected={s.fobNear === false} />
            <Chip label="connected" selected={true} />
          </Row>

          <Column gap="sm">
            <Button variant="primary" onPress={() => sendSafe("DISARM")}>
              {s.pending === "DISARM" ? "disarming…" : "🔓 DISARM"}
            </Button>
            <Row gap="sm">
              <Button variant="secondary" onPress={() => sendSafe("ARM")}>
                {s.pending === "ARM" ? "arming…" : "🔒 ARM"}
              </Button>
              <Button variant="danger" onPress={() => sendSafe("PANIC")}>
                {s.pending === "PANIC" ? "siren…" : "🚨 PANIC"}
              </Button>
            </Row>
            <Button variant="text" onPress={() => sendSafe("STAT")}>
              refresh status
            </Button>
          </Column>

            {s.lastMsg ? <Text variant="caption">{s.lastMsg}</Text> : null}
        </Column>
      </Scaffold>
    );
  },
});

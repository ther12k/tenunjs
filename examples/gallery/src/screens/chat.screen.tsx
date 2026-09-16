import { defineAction, defineScreen } from "@tenunjs/core";
import {
  AppBar,
  Button,
  Card,
  Column,
  Row,
  Scaffold,
  Text,
} from "@tenunjs/widgets";
import { Avatar, Bubble, Chip, CanvasBox, IconButton } from "@tenunjs-examples/ui-kit";

/**
 * Chat module — the messaging pattern: conversation header with presence,
 * alternating bubbles (right = own, accent), an unread badge, quick-reply
 * chips that load the composer, and a send action. There is no IME in the
 * prototype hosts, so the composer is fed by chips — every displayed
 * message still went through the real send action.
 */
export interface ChatMessage {
  readonly from: "me" | "them";
  readonly text: string;
  readonly time: string;
}

export interface ChatState {
  readonly unread: number;
  readonly draft: string;
  readonly messages: readonly ChatMessage[];
  readonly replyCount: number;
}

const QUICK_REPLIES = ["Sounds good 👍", "On it!", "Shipping today 🚀", "Let's ship it 🎉"];
const BOT_REPLIES = ["Nice — the build is passing ✅", "Reviewing the PR now 👀", "Hot reload is delightful 🔥"];

export const ChatScreen = defineScreen({
  name: "Chat",

  initialState: (): ChatState => ({
    unread: 2,
    draft: "",
    replyCount: 0,
    messages: [
      { from: "them", text: "Morning! Did the gallery APK install on your phone?", time: "09:02" },
      { from: "me", text: "Yes — the dark Rally theme looks great on OLED 😍", time: "09:04" },
      { from: "them", text: "The activity rings animate smoothly too.", time: "09:05" },
      { from: "them", text: "Can you sanity-check the store checkout flow today?", time: "09:41" },
      { from: "them", text: "No rush — after standup is fine.", time: "09:41" },
    ],
  }),

  actions: {
    setDraft: defineAction<ChatState, string>({
      run({ input, state }) {
        (state as unknown as { draft: string }).draft = input;
      },
    }),

    send: defineAction<ChatState, void>({
      run({ state }) {
        const text = state.draft.trim();
        if (text.length === 0) return;
        const time = new Date().toISOString().slice(11, 16);
        (state as unknown as { messages: ChatMessage[] }).messages = [
          ...state.messages,
          { from: "me", text, time },
        ];
        (state as unknown as { draft: string }).draft = "";
      },
    }),

    /** Appends the next deterministic reply and raises the unread badge. */
    simulateReply: defineAction<ChatState, void>({
      run({ state }) {
        const reply = BOT_REPLIES[state.replyCount % BOT_REPLIES.length]!;
        const time = new Date().toISOString().slice(11, 16);
        (state as unknown as { messages: ChatMessage[] }).messages = [
          ...state.messages,
          { from: "them", text: reply, time },
        ];
        (state as unknown as { replyCount: number }).replyCount = state.replyCount + 1;
        (state as unknown as { unread: number }).unread = state.unread + 1;
      },
    }),

    markRead: defineAction<ChatState, void>({
      run({ state }) {
        (state as unknown as { unread: number }).unread = 0;
      },
    }),
  },

  view({ state, actions }) {
    return (
      <Scaffold appBar={<AppBar title="Chat" />}>
        <Column padding="lg" gap="md">
          <Card padding="md" radius="md" background="surfaceRaised">
            <Row gap="sm" justify="between">
              <Row gap="sm">
                <Avatar label="🎨" size={48} color="#33261A" textColor="#F5A623" />
                <Column gap="xs">
                  <Text variant="title">Design team</Text>
                  <Text variant="body" color="#3DD68C">3 online · active now</Text>
                </Column>
              </Row>
              {state.unread > 0 ? (
                <IconButton glyph={`(${state.unread})`} size={44} glyphSize={16} color="#FF5A5F" onPress={() => actions.markRead()} />
              ) : (
                <Text variant="body" color="#9AA3B2">All read</Text>
              )}
            </Row>
          </Card>

          <Column gap="sm">
            <Text variant="body" color="#9AA3B2">Today</Text>
            {state.messages.map((message, index) => (
              <Row key={index} gap="sm" justify={message.from === "me" ? "end" : "start"}>
                <Bubble text={message.text} mine={message.from === "me"} />
              </Row>
            ))}
          </Column>

          <Column gap="sm">
            <Text variant="body" color="#9AA3B2">Quick replies</Text>
            <Row gap="sm">
              {QUICK_REPLIES.map((reply) => (
                <Chip key={reply} label={reply} selected={state.draft === reply} onSelect={() => actions.setDraft(reply)} />
              ))}
            </Row>
          </Column>

          <Row gap="sm" justify="center">
            <Button variant="secondary" onPress={() => actions.simulateReply()}>
              Simulate incoming reply
            </Button>
          </Row>

          <Composer draft={state.draft} onSend={() => actions.send()} />
        </Column>
      </Scaffold>
    );
  },
});

/** Bottom composer bar: rounded field showing the draft + send button. */
function Composer(props: { draft: string; onSend: () => void }) {
  return (
    <CanvasBox
      height={64}
      paint={(origin, put, tap) => {
        put({ op: "rect", x: 0, y: 0, w: origin.w - 68, h: 64, r: 32, color: "#262631" });
        const hint = props.draft.length > 0 ? props.draft : "Pick a quick reply…";
        put({ op: "text", x: 28, y: 40, text: hint, size: 17, weight: 400, color: props.draft ? "#F2F2F7" : "#7A8194" });
        // Send: filled circle, only meaningful with a draft.
        const cx = origin.w - 32;
        put({ op: "circle", cx, cy: 32, r: 28, color: props.draft ? "#4C8DFF" : "#2A2A35" });
        put({ op: "text", x: cx - 7, y: 43, text: "▶", size: 20, weight: 600, color: props.draft ? "#FFFFFF" : "#7A8194" });
        tap({ x: origin.w - 64, y: 0, w: 64, h: 64 }, props.onSend);
      }}
    />
  );
}

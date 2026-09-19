import { defineScreen } from "@tenunjs/core";
import {
  Button,
  Card,
  Column,
  Row,
  Scaffold,
  Text,
} from "@tenunjs/widgets";
import {
  CanvasBox,
  Checkbox,
  HeroCard,
  PageIndicator,
  TextField,
  textWidth,
  wrapText,
} from "@tenunjs-examples/ui-kit";
import { INTRO_PAGES } from "../categories/intro";

export interface IntroState {
  page: number;
  done: boolean;
  signedUp: boolean;
  remember: boolean;
  emailFocused: boolean;
  passwordFocused: boolean;
}

export const IntroScreen = defineScreen({
  name: "FlutterIntroduction",

  initialState: (): IntroState => ({
    page: 0,
    done: false,
    signedUp: false,
    remember: true,
    emailFocused: false,
    passwordFocused: false,
  }),

  actions: {
    setPage({ state, input }: { state: IntroState; input: number }) {
      state.page = Math.max(0, Math.min(INTRO_PAGES.length - 1, Math.floor(input)));
    },
    next({ state }: { state: IntroState }) {
      if (state.page < INTRO_PAGES.length - 1) state.page += 1;
      else state.done = true;
    },
    skip({ state }: { state: IntroState }) {
      state.done = true;
    },
    focusEmail({ state }: { state: IntroState }) {
      state.emailFocused = !state.emailFocused;
      state.passwordFocused = false;
    },
    focusPassword({ state }: { state: IntroState }) {
      state.passwordFocused = !state.passwordFocused;
      state.emailFocused = false;
    },
    toggleRemember({ state }: { state: IntroState }) {
      state.remember = !state.remember;
    },
    signUp({ state }: { state: IntroState }) {
      state.signedUp = true;
    },
    restart({ state }: { state: IntroState }) {
      state.page = 0;
      state.done = false;
      state.signedUp = false;
      state.emailFocused = false;
      state.passwordFocused = false;
    },
  },

  view({ state, actions }) {
    if (state.done && state.signedUp) {
      return (
        <Scaffold>
          <Column padding="lg" gap="lg">
            <HeroCard
              title="WELCOME TO THE COLLECTION"
              headline="You're ready ✦"
              caption="Carry these patterns into your next TenunJS screen."
              from="#493E64"
              to="#211D32"
              height={178}
            />
            <Card padding="lg" radius="lg" background="surfaceRaised">
              <Column gap="md">
                <Text variant="title">A considered first step</Text>
                <Text variant="body" color="#AEB8C8">
                  This deterministic flow keeps the emotional rhythm of a polished Flutter onboarding without timers, network calls, or raster assets.
                </Text>
                <Button variant="primary" onPress={() => actions.restart()}>Start again</Button>
              </Column>
            </Card>
          </Column>
        </Scaffold>
      );
    }

    if (state.done) {
      return (
        <Scaffold>
          <Column padding="lg" gap="lg">
            <Card padding="lg" radius="lg" background="surfaceRaised">
              <Column gap="md">
                <CanvasBox
                  height={96}
                  paint={(origin, put) => {
                    const title = "Create your account";
                    const caption = "Two fields and you're exploring";
                    put({ op: "text", x: (origin.w - textWidth(title, 30)) / 2, y: 38, text: title, size: 30, weight: 700, color: "#F5F7FB" });
                    put({ op: "text", x: (origin.w - textWidth(caption, 15)) / 2, y: 76, text: caption, size: 15, weight: 400, color: "#AEB8C8" });
                  }}
                />
                <TextField label="Email" leading="✉" focused={state.emailFocused} onFocusChange={() => actions.focusEmail()} />
                <TextField label="Password" leading="⌘" focused={state.passwordFocused} onFocusChange={() => actions.focusPassword()} />
                <Checkbox
                  checked={state.remember}
                  label="Remember this device"
                  onToggle={(next) => { if (next !== state.remember) actions.toggleRemember(); }}
                />
                <Button variant="primary" onPress={() => actions.signUp()}>Create account</Button>
                <Button variant="text" onPress={() => actions.restart()}>Back to introduction</Button>
              </Column>
            </Card>
          </Column>
        </Scaffold>
      );
    }

    const page = INTRO_PAGES[state.page]!;
    return (
      <Scaffold>
        <Column padding="lg" gap="lg">
          <CanvasBox
            height={360}
            paint={(origin, put) => {
              put({ op: "gradient", x: 0, y: 0, w: origin.w, h: 360, r: 28, color: page.from, colorTo: page.to });
              put({ op: "circle", cx: origin.w - 68, cy: 64, r: 96, color: "#33" + page.accent.slice(1) });
              put({ op: "circle", cx: 48, cy: 312, r: 72, color: "#22FFFFFF" });
              put({ op: "circle", cx: origin.w - 42, cy: 304, r: 24, color: "#55" + page.accent.slice(1) });
              put({ op: "text", x: (origin.w - textWidth(page.glyph, 132)) / 2, y: 178, text: page.glyph, size: 132, weight: 600, color: "#FFFFFF" });
              put({ op: "text", x: 28, y: 326, text: "01 / 03", size: 13, weight: 700, color: "#CCFFFFFF" });
            }}
          />
          <CanvasBox
            height={142}
            paint={(origin, put) => {
              put({ op: "text", x: (origin.w - textWidth(page.title, 34)) / 2, y: 42, text: page.title, size: 34, weight: 700, color: "#F5F7FB" });
              wrapText(page.body, 17, origin.w - 64).forEach((line, index) => {
                put({ op: "text", x: (origin.w - textWidth(line, 17)) / 2, y: 86 + index * 24, text: line, size: 17, weight: 400, color: "#AEB8C8" });
              });
            }}
          />
          <Row justify="between" align="center">
            <Button variant="text" onPress={() => actions.skip()}>Skip</Button>
            <PageIndicator count={INTRO_PAGES.length} active={state.page} onSelect={(index) => actions.setPage(index)} />
            <Button variant="primary" onPress={() => actions.next()}>{state.page === INTRO_PAGES.length - 1 ? "Get started" : "Next"}</Button>
          </Row>
        </Column>
      </Scaffold>
    );
  },
});

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

/**
 * Onboarding walkthrough — the canonical first Flutter tutorial screen
 * (PageView + dot indicator + Skip/Next, as in mitesh77's
 * Best-Flutter-UI-Templates walkthrough and the community plant-app
 * onboardings). Finishing the pages reveals the equally-canonical
 * sign-up form.
 */

interface OnboardingPage {
  glyph: string;
  title: string;
  body: string;
  from: string;
  to: string;
  accent: string;
}

const PAGES: OnboardingPage[] = [
  {
    glyph: "🌱",
    title: "Grow your world",
    body: "Track every plant you own, learn its rhythm, and watch your corner of nature thrive.",
    from: "#1E4634",
    to: "#0F241C",
    accent: "#3DD68C",
  },
  {
    glyph: "📸",
    title: "Identify instantly",
    body: "Snap a photo of any leaf or bloom and get a confident match with care steps.",
    from: "#24345C",
    to: "#141A2B",
    accent: "#4C8DFF",
  },
  {
    glyph: "🔔",
    title: "Never forget again",
    body: "Watering reminders that adapt to seasons, light, and each plant's own rhythm.",
    from: "#4A3320",
    to: "#241708",
    accent: "#F5A623",
  },
];

export interface OnboardingState {
  page: number;
  done: boolean;
  signedUp: boolean;
  remember: boolean;
  emailFocused: boolean;
  passwordFocused: boolean;
}

export const OnboardingScreen = defineScreen({
  name: "OnboardingWalkthrough",

  initialState: (): OnboardingState => ({
    page: 0,
    done: false,
    signedUp: false,
    remember: true,
    emailFocused: false,
    passwordFocused: false,
  }),

  actions: {
    setPage({ state, input }: { state: OnboardingState; input: number }) {
      state.page = input;
    },
    next({ state }: { state: OnboardingState }) {
      if (state.page < PAGES.length - 1) state.page += 1;
      else state.done = true;
    },
    skip({ state }: { state: OnboardingState }) {
      state.done = true;
    },
    focusEmail({ state }: { state: OnboardingState }) {
      state.emailFocused = !state.emailFocused;
      state.passwordFocused = false;
    },
    focusPassword({ state }: { state: OnboardingState }) {
      state.passwordFocused = !state.passwordFocused;
      state.emailFocused = false;
    },
    toggleRemember({ state }: { state: OnboardingState }) {
      state.remember = !state.remember;
    },
    signUp({ state }: { state: OnboardingState }) {
      state.signedUp = true;
    },
    restart({ state }: { state: OnboardingState }) {
      state.page = 0;
      state.done = false;
      state.signedUp = false;
      state.emailFocused = false;
      state.passwordFocused = false;
    },
  },

  view({ state, actions }) {
    if (state.done) {
      return (
        <Scaffold>
          <Column padding="lg" gap="lg">
            {state.signedUp ? (
              <>
                <HeroCard
                  title="WELCOME ABOARD"
                  headline="You're in 🎉"
                  caption="Your plant journal starts now."
                  from="#1E4634"
                  to="#0F241C"
                />
                <Card padding="lg" radius="lg" background="surfaceRaised">
                  <Column gap="md">
                    <Text variant="title">First steps</Text>
                    <Text variant="body" color="#9AA3B2">
                      Add your first plant, pick a spot by the window, and
                      we'll tune the watering schedule for you.
                    </Text>
                    <Button variant="primary" onPress={() => actions.restart()}>
                      Start over
                    </Button>
                  </Column>
                </Card>
              </>
            ) : (
              <Card padding="lg" radius="lg" background="surfaceRaised">
                <Column gap="md">
                  <CanvasBox
                    height={96}
                    paint={(origin, put) => {
                      put({
                        op: "text",
                        x: (origin.w - textWidth("Create your account", 30)) / 2,
                        y: 38,
                        text: "Create your account",
                        size: 30,
                        weight: 700,
                        color: "#F2F2F7",
                      });
                      put({
                        op: "text",
                        x: (origin.w - textWidth("Two fields and you're growing", 15)) / 2,
                        y: 76,
                        text: "Two fields and you're growing",
                        size: 15,
                        weight: 400,
                        color: "#9AA3B2",
                      });
                    }}
                  />
                  <TextField
                    label="Email"
                    leading="✉️"
                    focused={state.emailFocused}
                    onFocusChange={() => actions.focusEmail()}
                  />
                  <TextField
                    label="Password"
                    leading="🔒"
                    focused={state.passwordFocused}
                    onFocusChange={() => actions.focusPassword()}
                  />
                  <Checkbox
                    checked={state.remember}
                    onToggle={(next) => {
                      if (next !== state.remember) actions.toggleRemember();
                    }}
                    label="Remember me"
                  />
                  <Button variant="primary" onPress={() => actions.signUp()}>
                    Create account
                  </Button>
                  <Button variant="text" onPress={() => actions.restart()}>
                    Back to walkthrough
                  </Button>
                </Column>
              </Card>
            )}
          </Column>
        </Scaffold>
      );
    }

    const page = PAGES[state.page]!;

    return (
      <Scaffold>
        <Column padding="lg" gap="lg">
          {/* Illustration: gradient art panel with decorative circles —
              the standard Flutter onboarding hero, minus the raster art. */}
          <CanvasBox
            height={340}
            paint={(origin, put) => {
              put({
                op: "gradient",
                x: 0,
                y: 0,
                w: origin.w,
                h: 340,
                r: 28,
                color: page.from,
                colorTo: page.to,
              });
              // Note: no `#` inside template literals — the static graph
              // scanner (typescript@7.0.2 unstable/ast) spins forever on
              // that construct, so tints are plain concatenation.
              put({ op: "circle", cx: origin.w - 64, cy: 62, r: 92, color: "#33" + page.accent.slice(1) });
              put({ op: "circle", cx: 44, cy: 296, r: 64, color: "#22FFFFFF" });
              put({ op: "circle", cx: origin.w - 40, cy: 286, r: 22, color: "#55" + page.accent.slice(1) });
              put({
                op: "text",
                x: (origin.w - textWidth(page.glyph, 128)) / 2,
                y: 150,
                text: page.glyph,
                size: 128,
                weight: 600,
                color: "#FFFFFF",
              });
            }}
          />

          {/* Headline + body, centered. */}
          <CanvasBox
            height={132}
            paint={(origin, put) => {
              put({
                op: "text",
                x: (origin.w - textWidth(page.title, 34)) / 2,
                y: 40,
                text: page.title,
                size: 34,
                weight: 700,
                color: "#F2F2F7",
              });
              const lines = wrapText(page.body, 17, origin.w - 64);
              lines.forEach((line, index) => {
                put({
                  op: "text",
                  x: (origin.w - textWidth(line, 17)) / 2,
                  y: 84 + index * 24,
                  text: line,
                  size: 17,
                  weight: 400,
                  color: "#9AA3B2",
                });
              });
            }}
          />

          <Row justify="between" align="center">
            <Button variant="text" onPress={() => actions.skip()}>
              Skip
            </Button>
            <PageIndicator count={PAGES.length} active={state.page} onSelect={(index) => actions.setPage(index)} />
            <Button variant="primary" onPress={() => actions.next()}>
              {state.page === PAGES.length - 1 ? "Get started" : "Next"}
            </Button>
          </Row>
        </Column>
      </Scaffold>
    );
  },
});

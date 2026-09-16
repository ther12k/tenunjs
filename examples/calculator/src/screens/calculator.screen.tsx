import { defineAction, defineScreen } from "@tenunjs/core";
import type { WidgetNode } from "@tenunjs/jsx-runtime";
import {
  AppBar,
  Button,
  Card,
  Column,
  Row,
  Scaffold,
  Text,
} from "@tenunjs/widgets";

type Op = "+" | "−" | "×" | "÷";

interface CalculatorState {
  /** What the display shows: the current entry, a result, or "Error". */
  display: string;
  accumulator: number | null;
  pendingOp: Op | null;
  /** True when the next digit starts a new entry instead of appending. */
  entryFresh: boolean;
}

const OPS: ReadonlySet<string> = new Set<Op>(["+", "−", "×", "÷"]);

function applyOp(a: number, b: number, op: Op): number {
  switch (op) {
    case "+":
      return a + b;
    case "−":
      return a - b;
    case "×":
      return a * b;
    case "÷":
      return b === 0 ? NaN : a / b;
  }
}

function format(value: number): string {
  if (!Number.isFinite(value)) return "Error";
  return String(Number(value.toFixed(10)));
}

function appendDigit(state: CalculatorState, input: string): void {
  if (state.display === "Error" || state.entryFresh) {
    state.display = input === "." ? "0." : input;
    state.entryFresh = false;
    return;
  }
  if (input === "." && state.display.includes(".")) return;
  if (state.display === "0" && input !== ".") {
    state.display = input;
  } else {
    state.display += input;
  }
}

function setOp(state: CalculatorState, op: Op): void {
  if (state.display === "Error") return;
  const current = Number(state.display);
  if (state.accumulator !== null && state.pendingOp !== null && !state.entryFresh) {
    state.accumulator = applyOp(state.accumulator, current, state.pendingOp);
    state.display = format(state.accumulator);
  } else if (state.accumulator === null) {
    state.accumulator = current;
  }
  state.pendingOp = op;
  state.entryFresh = true;
}

function equals(state: CalculatorState): void {
  if (state.accumulator === null || state.pendingOp === null || state.entryFresh) {
    return;
  }
  const result = applyOp(state.accumulator, Number(state.display), state.pendingOp);
  state.display = format(result);
  state.accumulator = null;
  state.pendingOp = null;
  state.entryFresh = true;
}

function reset(state: CalculatorState): void {
  state.display = "0";
  state.accumulator = null;
  state.pendingOp = null;
  state.entryFresh = true;
}

/**
 * A custom function widget: ordinary TSX composition, no React. It owns
 * no state — it only folds its props into the built-in Button widget.
 */
function CalcButton(props: {
  label: string;
  variant?: "primary" | "secondary" | "danger";
  onPress: () => void;
}): WidgetNode {
  return (
    <Button variant={props.variant} onPress={props.onPress}>
      {props.label}
    </Button>
  );
}

const KEYPAD: readonly (readonly string[])[] = [
  ["7", "8", "9", "÷"],
  ["4", "5", "6", "×"],
  ["1", "2", "3", "−"],
  ["0", ".", "=", "+"],
];

export const CalculatorScreen = defineScreen({
  name: "Calculator",

  initialState: (): CalculatorState => ({
    display: "0",
    accumulator: null,
    pendingOp: null,
    entryFresh: true,
  }),

  actions: {
    // One typed action drives the whole machine; the label is the input.
    press: defineAction<CalculatorState, string>({
      run({ input, state }) {
        if (input === "C") {
          reset(state);
        } else if (OPS.has(input)) {
          setOp(state, input as Op);
        } else if (input === "=") {
          equals(state);
        } else {
          appendDigit(state, input);
        }
      },
    }),
  },

  view({ state, actions }) {
    return (
      <Scaffold appBar={<AppBar title="Calculator" />}>
        <Column padding="lg" gap="lg" justify="end">
          <Card
            padding="lg"
            radius="lg"
            background="surfaceRaised"
            semantics={{ role: "group", label: "Calculator display" }}
          >
            <Row justify="end">
              <Text variant="display">{state.display}</Text>
            </Row>
          </Card>

          <CalcButton
            label="C"
            variant="danger"
            onPress={() => actions.press("C")}
          />

          <Column gap="sm">
            {KEYPAD.map((row) => (
              <Row gap="sm">
                {row.map((label) => (
                  <CalcButton
                    label={label}
                    variant={
                      label === "="
                        ? "primary"
                        : OPS.has(label)
                          ? "secondary"
                          : undefined
                    }
                    onPress={() => actions.press(label)}
                  />
                ))}
              </Row>
            ))}
          </Column>
        </Column>
      </Scaffold>
    );
  },
});

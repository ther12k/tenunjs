import { describe, expect, test } from "bun:test";
import { CalculatorScreen } from "../src/screens/calculator.screen";
import { mountScreen } from "@tenunjs-examples/test-support";

function pressAll(
  calc: { actions: { press: (key: string) => void } },
  keys: string[]
): void {
  for (const key of keys) calc.actions.press(key);
}

describe("CalculatorScreen", () => {
  test("mounts showing zero", () => {
    const calc = mountScreen(CalculatorScreen);
    expect(calc.state.display).toBe("0");
    expect(calc.render()).not.toBeNull();
  });

  test("evaluates a simple sum", () => {
    const calc = mountScreen(CalculatorScreen);
    pressAll(calc, ["1", "2", "+", "3", "4", "="]);
    expect(calc.state.display).toBe("46");
  });

  test("operator presses chain through the accumulator", () => {
    const calc = mountScreen(CalculatorScreen);
    pressAll(calc, ["2", "×", "3", "+", "4", "="]);
    expect(calc.state.display).toBe("10");
  });

  test("floating point noise is trimmed", () => {
    const calc = mountScreen(CalculatorScreen);
    pressAll(calc, ["0", ".", "1", "+", "0", ".", "2", "="]);
    expect(calc.state.display).toBe("0.3");
  });

  test("division by zero shows Error and the next entry recovers", () => {
    const calc = mountScreen(CalculatorScreen);
    pressAll(calc, ["8", "÷", "0", "="]);
    expect(calc.state.display).toBe("Error");

    pressAll(calc, ["5", "+", "5", "="]);
    expect(calc.state.display).toBe("10");
  });

  test("a second decimal point in one entry is ignored", () => {
    const calc = mountScreen(CalculatorScreen);
    pressAll(calc, ["1", ".", ".", "5"]);
    expect(calc.state.display).toBe("1.5");
  });

  test("clear resets everything", () => {
    const calc = mountScreen(CalculatorScreen);
    pressAll(calc, ["9", "×", "9", "="]);
    calc.actions.press("C");
    expect(calc.state.display).toBe("0");
    expect(calc.state.accumulator).toBeNull();
    expect(calc.state.pendingOp).toBeNull();
  });

  test("equals with nothing pending is a no-op", () => {
    const calc = mountScreen(CalculatorScreen);
    calc.actions.press("=");
    expect(calc.state.display).toBe("0");
  });
});

import { describe, expect, test } from "bun:test";
import { CounterScreen } from "../src/screens/counter.screen";
import { mountScreen } from "@tenunjs-examples/test-support";

describe("CounterScreen", () => {
  test("mounts at zero and renders through the Scaffold", () => {
    const counter = mountScreen(CounterScreen);
    expect(counter.state.count).toBe(0);
    // view() returns the widget node tree; the root kind is the Scaffold
    // function widget, which the reconciler (M3) will expand.
    expect(typeof counter.render()?.kind).toBe("function");
  });

  test("increment and decrement mutate the committed state", () => {
    const counter = mountScreen(CounterScreen);
    counter.actions.increment();
    counter.actions.increment();
    counter.actions.decrement();
    expect(counter.state.count).toBe(1);
  });

  test("reset returns to zero", () => {
    const counter = mountScreen(CounterScreen);
    counter.actions.increment();
    counter.actions.increment();
    counter.actions.reset();
    expect(counter.state.count).toBe(0);
  });
});

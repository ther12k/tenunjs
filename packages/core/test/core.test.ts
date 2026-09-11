import { describe, expect, test } from "bun:test";
import { HostWidgetKind } from "@tenunjs/protocol";
import {
  defineAction,
  defineController,
  defineScreen,
  jsx,
  runApp,
  type ScreenActionContext,
} from "../src/index";

describe("@tenunjs/core", () => {
  test("defineAction freezes config and preserves run method", async () => {
    let called = false;
    const action = defineAction<{ count: number }, number>({
      name: "increment",
      run: (ctx) => {
        called = true;
        ctx.state.count += ctx.input;
      },
    });

    expect(action.name).toBe("increment");
    const state = { count: 0 };
    await action.run({
      input: 5,
      state,
      services: {},
      signal: new AbortController().signal,
    });
    expect(called).toBe(true);
    expect(state.count).toBe(5);
  });

  test("defineAction fails closed without a run function", () => {
    expect(() => defineAction({} as any)).toThrow(TypeError);
  });

  test("defineController initializes state and defines actions", () => {
    const controller = defineController({
      initialState: () => ({ status: "idle", count: 0 }),
      actions: {
        reset({ state }: ScreenActionContext<{ status: string; count: number }>) {
          state.count = 0;
        },
      },
    });

    const state = controller.initialState();
    expect(state).toEqual({ status: "idle", count: 0 });
    expect(typeof controller.actions.reset).toBe("function");
  });

  test("defineScreen supports single-file screen definition (counter app example)", () => {
    interface CounterState {
      count: number;
    }

    const CounterScreen = defineScreen({
      name: "Counter",
      initialState: (): CounterState => ({ count: 0 }),
      actions: {
        increment({ state }: ScreenActionContext<CounterState>) {
          state.count += 1;
        },
        decrement({ state }: ScreenActionContext<CounterState>) {
          state.count -= 1;
        },
      },
      view({ state }) {
        return jsx(HostWidgetKind.COLUMN, {
          children: [
            jsx(HostWidgetKind.TEXT, { children: [`Count: ${state.count}`] }),
            jsx(HostWidgetKind.BUTTON, { children: ["Increase"] }),
          ],
        });
      },
    });

    expect(CounterScreen.name).toBe("Counter");
    const state = CounterScreen.initialState();
    expect(state.count).toBe(0);

    const rendered = CounterScreen.view({
      state,
      actions: {
        increment: () => {},
        decrement: () => {},
      } as any,
    });
    expect(rendered?.kind).toBe(HostWidgetKind.COLUMN);
    expect(rendered?.children.length).toBe(2);
  });

  test("defineScreen supports split controller/view screen definition", () => {
    interface ModelState {
      items: string[];
    }
    const ItemsController = defineController({
      initialState: (): ModelState => ({ items: ["Apple", "Banana"] }),
      actions: {
        addItem({ state, input }: ScreenActionContext<ModelState, string>) {
          state.items.push(input);
        },
      },
    });

    const ItemsScreen = defineScreen({
      controller: ItemsController,
      view({ state }) {
        return jsx(HostWidgetKind.COLUMN, {
          children: state.items.map((it) =>
            jsx(HostWidgetKind.TEXT, { children: [it] }, it)
          ),
        });
      },
    });

    expect("controller" in ItemsScreen).toBe(true);
    if ("controller" in ItemsScreen) {
      const state = ItemsScreen.controller.initialState();
      expect(state.items.length).toBe(2);
      const rendered = ItemsScreen.view({
        state,
        actions: {} as any,
      });
      expect(rendered?.children.length).toBe(2);
    }
  });

  test("defineScreen fails closed on invalid configuration", () => {
    expect(() => defineScreen({} as any)).toThrow(TypeError);
    expect(() => defineScreen({ name: "Bad" } as any)).toThrow(TypeError);
    expect(() =>
      defineScreen({
        name: "NoView",
        initialState: () => ({}),
        actions: {},
      } as any)
    ).toThrow(TypeError);
  });

  test("runApp boots and provides stopping capability", () => {
    const app = runApp({
      root: jsx(HostWidgetKind.ROOT, {}),
      config: { displayName: "Test App", diagnostics: true },
    });

    expect(app.config.displayName).toBe("Test App");
    expect(app.isRunning).toBe(true);
    app.stop();
    expect(app.isRunning).toBe(false);
  });
});

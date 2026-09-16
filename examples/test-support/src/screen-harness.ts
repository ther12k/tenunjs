/**
 * Shared screen harness for the example apps.
 *
 * Drives a screen definition the way the intended runtime will: fresh
 * state from initialState, actions invoked through a real action context
 * (state, services, signal), and view() rendered from the committed state.
 * No native engine and no reconciliation — this exercises the authoring
 * model of @tenunjs/core only.
 */

import type {
  ActionDefinition,
  ActionDispatchers,
  ScreenDefinition,
  SimpleActionHandler,
} from "@tenunjs/core";
import type { WidgetNode } from "@tenunjs/jsx-runtime";

type AnyAction =
  | ActionDefinition<any, any, any>
  | SimpleActionHandler<any, any>;

export interface ScreenHarness<S, A> {
  /** Live controller state; actions mutate it in place. */
  readonly state: S;
  /** Dispatchers shaped like the ones the runtime hands to view(). */
  readonly actions: A;
  /** Invokes one action by name and awaits async runs. */
  press(name: string, input?: unknown): Promise<void>;
  /** Renders view() against the current state. */
  render(): WidgetNode | null;
}

export function mountScreen<S, A extends Record<string, AnyAction>>(
  screen: ScreenDefinition<S, A>,
  options: { services?: Record<string, unknown> } = {}
): ScreenHarness<S, ActionDispatchers<A>> {
  const controller = "controller" in screen ? screen.controller : screen;
  const state = controller.initialState();
  const signal = new AbortController().signal;
  const services = options.services ?? {};

  const press = async (name: string, input?: unknown): Promise<void> => {
    const action = (controller.actions as Record<string, AnyAction>)[name];
    if (!action) {
      throw new Error(`Screen has no action named "${name}"`);
    }
    const ctx = { input, state, services, signal };
    await (typeof action === "function" ? action(ctx) : action.run(ctx));
  };

  const dispatchers: Record<string, (input?: unknown) => unknown> = {};
  for (const name of Object.keys(controller.actions)) {
    dispatchers[name] = (input?: unknown) => press(name, input);
  }
  const actions = dispatchers as ActionDispatchers<A>;

  return {
    state,
    actions,
    press,
    render: () => screen.view({ state, actions }),
  };
}

/**
 * @tenunjs/core
 *
 * Controller and typed action state model, screen definition, and application
 * entrypoint for TenunJS (ADR-0009, TN-055, TN-056, TN-057).
 */

import type { WidgetNode } from "@tenunjs/jsx-runtime";
export * from "@tenunjs/jsx-runtime";

export interface ActionContext<S = Record<string, unknown>, I = unknown> {
  input: I;
  state: S;
  services: Record<string, unknown>;
  signal: AbortSignal;
}

export type ScreenActionContext<S = Record<string, unknown>, I = unknown> = ActionContext<S, I>;

export interface ActionDefinition<S = Record<string, unknown>, I = unknown, R = unknown> {
  readonly name?: string;
  readonly input?: unknown;
  readonly run: (ctx: ActionContext<S, I>) => Promise<R> | R;
}

export type SimpleActionHandler<S = Record<string, unknown>, I = unknown> = (
  ctx: ScreenActionContext<S, I>
) => void | Promise<void>;

export function defineAction<S = Record<string, unknown>, I = unknown, R = unknown>(
  config: ActionDefinition<S, I, R>
): ActionDefinition<S, I, R> {
  if (typeof config.run !== "function") {
    throw new TypeError("defineAction requires a run function");
  }
  return Object.freeze({ ...config });
}

export interface ControllerContext<S = Record<string, unknown>> {
  state: S;
  services: Record<string, unknown>;
  signal: AbortSignal;
}

export interface ControllerDefinition<
  S = Record<string, unknown>,
  A extends Record<string, ActionDefinition<S, any, any> | SimpleActionHandler<S, any>> = Record<
    string,
    ActionDefinition<S, any, any> | SimpleActionHandler<S, any>
  >
> {
  readonly name?: string;
  readonly initialState: () => S;
  readonly load?: (ctx: ControllerContext<S>) => Promise<void> | void;
  readonly actions: A;
}

export function defineController<
  S = Record<string, unknown>,
  A extends Record<string, ActionDefinition<S, any, any> | SimpleActionHandler<S, any>> = Record<
    string,
    ActionDefinition<S, any, any> | SimpleActionHandler<S, any>
  >
>(config: ControllerDefinition<S, A>): ControllerDefinition<S, A> {
  if (typeof config.initialState !== "function") {
    throw new TypeError("defineController requires an initialState function");
  }
  return Object.freeze({
    ...config,
    actions: Object.freeze({ ...config.actions }),
  });
}

export type ActionDispatchers<A> = {
  [K in keyof A]: A[K] extends ActionDefinition<any, infer I, any>
    ? (input: I) => void
    : A[K] extends SimpleActionHandler<any, infer I>
    ? (input?: I) => void
    : () => void;
};

export interface SingleFileScreenConfig<
  S = Record<string, unknown>,
  A extends Record<string, ActionDefinition<S, any, any> | SimpleActionHandler<S, any>> = Record<
    string,
    ActionDefinition<S, any, any> | SimpleActionHandler<S, any>
  >
> {
  readonly name: string;
  readonly initialState: () => S;
  readonly actions: A;
  readonly view: (props: { state: S; actions: ActionDispatchers<A> }) => WidgetNode | null;
}

export interface SplitScreenConfig<
  S = Record<string, unknown>,
  A extends Record<string, ActionDefinition<S, any, any> | SimpleActionHandler<S, any>> = Record<
    string,
    ActionDefinition<S, any, any> | SimpleActionHandler<S, any>
  >
> {
  readonly controller: ControllerDefinition<S, A>;
  readonly view: (props: { state: S; actions: ActionDispatchers<A> }) => WidgetNode | null;
}

export type ScreenDefinition<
  S = Record<string, unknown>,
  A extends Record<string, ActionDefinition<S, any, any> | SimpleActionHandler<S, any>> = Record<
    string,
    ActionDefinition<S, any, any> | SimpleActionHandler<S, any>
  >
> = SingleFileScreenConfig<S, A> | SplitScreenConfig<S, A>;

export function defineScreen<
  S = Record<string, unknown>,
  A extends Record<string, ActionDefinition<S, any, any> | SimpleActionHandler<S, any>> = Record<
    string,
    ActionDefinition<S, any, any> | SimpleActionHandler<S, any>
  >
>(config: SingleFileScreenConfig<S, A>): SingleFileScreenConfig<S, A>;
export function defineScreen<
  S = Record<string, unknown>,
  A extends Record<string, ActionDefinition<S, any, any> | SimpleActionHandler<S, any>> = Record<
    string,
    ActionDefinition<S, any, any> | SimpleActionHandler<S, any>
  >
>(config: SplitScreenConfig<S, A>): SplitScreenConfig<S, A>;
export function defineScreen<
  S = Record<string, unknown>,
  A extends Record<string, ActionDefinition<S, any, any> | SimpleActionHandler<S, any>> = Record<
    string,
    ActionDefinition<S, any, any> | SimpleActionHandler<S, any>
  >
>(config: ScreenDefinition<S, A>): ScreenDefinition<S, A> {
  if ("controller" in config) {
    if (!config.controller || typeof config.controller.initialState !== "function") {
      throw new TypeError("Split screen requires a valid controller definition");
    }
    if (typeof config.view !== "function") {
      throw new TypeError("Split screen requires a view function");
    }
    return Object.freeze({ ...config });
  }

  if (typeof config.initialState !== "function") {
    throw new TypeError("Single-file screen requires an initialState function");
  }
  if (typeof config.view !== "function") {
    throw new TypeError("Single-file screen requires a view function");
  }
  return Object.freeze({ ...config });
}

export interface AppConfig {
  displayName?: string;
  diagnostics?: boolean;
}

export interface RunAppOptions {
  root: WidgetNode | null;
  config?: AppConfig;
}

export interface RunningAppInstance {
  readonly root: WidgetNode | null;
  readonly config: Readonly<AppConfig>;
  readonly isRunning: boolean;
  stop: () => void;
}

export function runApp(options: RunAppOptions): RunningAppInstance {
  if (!options || typeof options !== "object") {
    throw new TypeError("runApp requires options object");
  }
  const config = Object.freeze({ ...(options.config || {}) });
  let running = true;

  return {
    root: options.root,
    config,
    get isRunning() {
      return running;
    },
    stop() {
      running = false;
    },
  };
}

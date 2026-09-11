/**
 * @tenunjs/navigation
 *
 * Typed routes, route builders, and NavigationHost for TenunJS (ADR-0010, TN-062, TN-063).
 */

import { HostWidgetKind } from "@tenunjs/protocol";
import { jsx, type WidgetNode } from "@tenunjs/jsx-runtime";
import type { ScreenDefinition } from "@tenunjs/core";

export interface RouteConfig<P = Record<string, unknown>> {
  path: string;
  screen: ScreenDefinition<any, any>;
  paramsSchema?: unknown;
}

export interface RouteInstance<P = Record<string, unknown>> {
  readonly path: string;
  readonly screen: ScreenDefinition<any, any>;
  readonly params: Readonly<P>;
}

export type RouteBuilder<P = Record<string, unknown>> = (params?: P) => RouteInstance<P>;

export type RouteMap = Record<string, RouteConfig<any>>;

export type CompiledRoutes<R extends RouteMap> = {
  [K in keyof R]: RouteBuilder<R[K] extends RouteConfig<infer P> ? P : Record<string, unknown>>;
};

export function defineRoutes<R extends RouteMap>(routes: R): CompiledRoutes<R> {
  const result: Record<string, RouteBuilder<any>> = {};

  for (const [key, config] of Object.entries(routes)) {
    if (!config || typeof config.path !== "string") {
      throw new TypeError(`Route "${key}" must define a string path`);
    }
    if (!config.screen) {
      throw new TypeError(`Route "${key}" must define a screen`);
    }

    result[key] = (params?: Record<string, unknown>) => {
      return Object.freeze({
        path: config.path,
        screen: config.screen,
        params: Object.freeze({ ...(params || {}) }),
      });
    };
  }

  return Object.freeze(result) as CompiledRoutes<R>;
}

export interface NavigationHostProps {
  routes: Record<string, RouteBuilder<any>>;
  initial: RouteInstance<any>;
}

export function NavigationHost(props: NavigationHostProps): WidgetNode {
  if (!props.initial || !props.initial.screen) {
    throw new TypeError("NavigationHost requires an initial route instance");
  }

  return jsx(HostWidgetKind.ROOT, {
    navigation: true,
    initialPath: props.initial.path,
    initialParams: props.initial.params,
  });
}

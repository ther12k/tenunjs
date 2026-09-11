import { describe, expect, test } from "bun:test";
import { HostWidgetKind } from "@tenunjs/protocol";
import { defineScreen } from "@tenunjs/core";
import {
  NavigationHost,
  defineRoutes,
} from "../src/index";

describe("@tenunjs/navigation", () => {
  const DummyScreen = defineScreen({
    name: "Dummy",
    initialState: () => ({}),
    actions: {},
    view: () => null,
  });

  test("defineRoutes creates typed route builders", () => {
    const routes = defineRoutes({
      home: {
        path: "/",
        screen: DummyScreen,
      },
      detail: {
        path: "/details/:id",
        screen: DummyScreen,
      },
    });

    const homeRoute = routes.home();
    expect(homeRoute.path).toBe("/");
    expect(homeRoute.screen).toBe(DummyScreen);
    expect(homeRoute.params).toEqual({});

    const detailRoute = routes.detail({ id: "123" });
    expect(detailRoute.path).toBe("/details/:id");
    expect(detailRoute.params).toEqual({ id: "123" });
  });

  test("defineRoutes fails closed when route path or screen is missing", () => {
    expect(() =>
      defineRoutes({
        invalid: { screen: DummyScreen } as any,
      })
    ).toThrow(TypeError);

    expect(() =>
      defineRoutes({
        invalid: { path: "/test" } as any,
      })
    ).toThrow(TypeError);
  });

  test("NavigationHost renders Root widget with initial route properties", () => {
    const routes = defineRoutes({
      root: { path: "/", screen: DummyScreen },
    });

    const host = NavigationHost({
      routes,
      initial: routes.root(),
    });

    expect(host.kind).toBe(HostWidgetKind.ROOT);
    expect((host.props as any).navigation).toBe(true);
    expect((host.props as any).initialPath).toBe("/");
  });

  test("NavigationHost fails closed when initial route is invalid", () => {
    expect(() =>
      NavigationHost({
        routes: {} as any,
        initial: null as any,
      })
    ).toThrow(TypeError);
  });
});

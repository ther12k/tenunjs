import { describe, expect, test } from "bun:test";
import { HostWidgetKind } from "@tenunjs/protocol";
import {
  Fragment,
  JsxValidationError,
  jsx,
  jsxs,
  type WidgetNode,
} from "../src/index";

describe("@tenunjs/jsx-runtime", () => {
  test("creates a host widget node with props and children", () => {
    const node = jsx(HostWidgetKind.BUTTON, {
      title: "Click me",
      children: ["Button Text"],
    });

    expect(node.kind).toBe(HostWidgetKind.BUTTON);
    expect(node.props.title).toBe("Click me");
    expect(node.children).toEqual(["Button Text"]);
    expect(node.key).toBeNull();
  });

  test("handles explicit key parameter and key in props", () => {
    const node1 = jsx(HostWidgetKind.TEXT, { text: "Item" }, "item-1");
    expect(node1.key).toBe("item-1");

    const node2 = jsx(HostWidgetKind.TEXT, { text: "Item", key: "item-2" });
    expect(node2.key).toBe("item-2");
    expect((node2.props as any).key).toBeUndefined();
  });

  test("flattens and normalizes nested and nullable children", () => {
    const node = jsxs(HostWidgetKind.COLUMN, {
      children: [
        "First",
        null,
        undefined,
        false,
        ["Nested 1", ["Nested 2"]],
        jsx(HostWidgetKind.SPACER, {}),
      ],
    });

    expect(node.children.length).toBe(4);
    expect(node.children[0]).toBe("First");
    expect(node.children[1]).toBe("Nested 1");
    expect(node.children[2]).toBe("Nested 2");
    expect((node.children[3] as WidgetNode).kind).toBe(HostWidgetKind.SPACER);
  });

  test("handles Fragment as a virtual (non-host) node with identical normalization", () => {
    const frag = jsx(Fragment, {
      children: ["One", "Two"],
    });
    // Fragment is its own virtual kind — never a host widget kind.
    expect(frag.kind).toBe(Fragment);
    expect(frag.kind).not.toBe(HostWidgetKind.ROOT);
    expect(frag.children).toEqual(["One", "Two"]);
    // Children are extracted from props exactly like the host path.
    expect((frag.props as { children?: unknown }).children).toBeUndefined();
  });

  test("executes function widget returning a widget node", () => {
    interface CustomProps {
      heading: string;
    }
    const MyWidget = (props: CustomProps) => {
      return jsx(HostWidgetKind.TEXT, { variant: "title", children: [props.heading] });
    };

    const node = jsx(MyWidget, { heading: "Welcome" });
    expect(node.kind).toBe(MyWidget);
    expect(typeof node.kind).toBe("function");
    const evaluated = (node.kind as Function)(node.props);
    expect(evaluated.kind).toBe(HostWidgetKind.TEXT);
    expect(evaluated.children).toEqual(["Welcome"]);
  });

  test("fails closed on invalid element kinds", () => {
    expect(() => jsx("div" as any, {})).toThrow(JsxValidationError);
    expect(() => jsx(9999 as any, {})).toThrow(JsxValidationError);
    expect(() => jsx(null as any, {})).toThrow(JsxValidationError);
  });
});

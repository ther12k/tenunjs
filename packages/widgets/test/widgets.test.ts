import { describe, expect, test } from "bun:test";
import { HostWidgetKind } from "@tenunjs/protocol";
import {
  AppBar,
  Button,
  Card,
  Center,
  Column,
  Container,
  Expanded,
  GestureDetector,
  Icon,
  Positioned,
  Row,
  Scaffold,
  SizedBox,
  Spacer,
  Stack,
  Text,
  ThemeProvider,
  Wrap,
  CenterKind,
  ContainerKind,
  ExpandedKind,
  GestureDetectorKind,
  IconKind,
  PositionedKind,
  SizedBoxKind,
  StackKind,
  WrapKind,
  defineTheme,
} from "../src/index";

describe("@tenunjs/widgets", () => {
  test("defineTheme creates immutable theme config", () => {
    const theme = defineTheme({
      colors: {
        surface: "#FFFFFF",
        accent: "#007AFF",
      },
      spacing: {
        sm: 8,
        md: 16,
      },
    });

    expect(theme.colors?.surface).toBe("#FFFFFF");
    expect(theme.spacing?.md).toBe(16);
    expect(Object.isFrozen(theme)).toBe(true);
  });

  test("creates typed widget tree matching counter-app example layout", () => {
    const screen = Scaffold({
      appBar: AppBar({ title: "Counter" }),
      children: Column({
        padding: "lg",
        gap: "lg",
        align: "center",
        justify: "center",
        children: [
          Card({
            padding: "lg",
            children: Text({ variant: "display", children: ["42"] }),
          }),
          Row({
            gap: "md",
            children: [
              Button({ variant: "secondary", children: ["Decrease"] }),
              Button({ children: ["Increase"] }),
            ],
          }),
        ],
      }),
    });

    expect(screen.kind).toBe(HostWidgetKind.SCAFFOLD);
    expect(screen.children.length).toBe(2);

    const appBar = screen.children[0] as any;
    expect(appBar.kind).toBe(HostWidgetKind.APP_BAR);
    expect(appBar.props.title).toBe("Counter");

    const column = screen.children[1] as any;
    expect(column.kind).toBe(HostWidgetKind.COLUMN);
    expect(column.props.align).toBe("center");
    expect(column.children.length).toBe(2);

    const card = column.children[0] as any;
    expect(card.kind).toBe(HostWidgetKind.CARD);

    const row = column.children[1] as any;
    expect(row.kind).toBe(HostWidgetKind.ROW);
    expect(row.children.length).toBe(2);
  });

  test("ThemeProvider wraps widget tree in root kind with theme prop", () => {
    const theme = defineTheme({ colors: { surface: "#000000" } });
    const root = ThemeProvider({
      theme,
      children: Text({ children: ["Hello"] }),
    });

    expect(root.kind).toBe(HostWidgetKind.ROOT);
    expect((root.props as any).theme.colors.surface).toBe("#000000");
  });
});

describe("@tenunjs/widgets structural tier", () => {
  /** Symbol kinds are unique symbols, so compare through `unknown`. */
  function kindOf(node: { kind: unknown }): unknown {
    return node.kind;
  }

  test("layout widgets emit their virtual symbols with props preserved", () => {
    expect(kindOf(SizedBox({ width: 10, height: 20 })) === SizedBoxKind).toBe(true);
    expect(kindOf(Center({})) === CenterKind).toBe(true);
    const stack = Stack({ alignment: "center" });
    expect(kindOf(stack) === StackKind).toBe(true);
    expect((stack.props as any).alignment).toBe("center");
    const positioned = Positioned({ top: 4, left: 8, right: 12, bottom: 16 });
    expect(kindOf(positioned) === PositionedKind).toBe(true);
    expect((positioned.props as any).left).toBe(8);
    const expanded = Expanded({ flex: 3 });
    expect(kindOf(expanded) === ExpandedKind).toBe(true);
    expect((expanded.props as any).flex).toBe(3);
    expect(kindOf(Icon({ glyph: "★", size: 40 })) === IconKind).toBe(true);
    expect(kindOf(Container({ color: "primary", radius: 12 })) === ContainerKind).toBe(true);
    expect(kindOf(Wrap({ spacing: "sm" })) === WrapKind).toBe(true);
  });

  test("onTap is carried on the GestureDetector node", () => {
    const onTap = (): void => undefined;
    const node = GestureDetector({ onTap });
    expect(kindOf(node) === GestureDetectorKind).toBe(true);
    expect((node.props as any).onTap).toBe(onTap);
  });

  test("Flutter-style child prop and children both normalize onto the node", () => {
    const label = Text({ children: ["a"] });
    const byChild = SizedBox({ width: 5, child: label });
    expect(byChild.children.length).toBe(1);
    expect((byChild.children[0] as any).kind).toBe(HostWidgetKind.TEXT);
    const byChildren = SizedBox({ width: 5, children: [label, label] });
    expect(byChildren.children.length).toBe(2);
  });

  test("Spacer wraps the host spacer kind", () => {
    expect(Spacer({ size: "lg" }).kind).toBe(HostWidgetKind.SPACER);
    expect(Spacer({}).kind).toBe(HostWidgetKind.SPACER);
  });

  test("Icon resolves built-in names to glyphs and passes size/color through", () => {
    const named = Icon({ name: "star", size: 40, color: "warning" });
    expect((named.props as any).glyph).toBe("★");
    expect((named.props as any).size).toBe(40);
    expect((named.props as any).color).toBe("warning");
    const direct = Icon({ glyph: "✦" });
    expect((direct.props as any).glyph).toBe("✦");
  });

  test("Icon fails closed without glyph/name and on giving both", () => {
    expect(() => Icon({} as any)).toThrow(/TENUN_ICON_ERROR/);
    expect(() => Icon({ glyph: "✦", name: "star" } as any)).toThrow(/TENUN_ICON_ERROR/);
  });
});

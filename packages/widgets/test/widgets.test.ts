import { describe, expect, test } from "bun:test";
import { HostWidgetKind } from "@tenunjs/protocol";
import {
  AppBar,
  Button,
  Card,
  Column,
  Row,
  Scaffold,
  Text,
  ThemeProvider,
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

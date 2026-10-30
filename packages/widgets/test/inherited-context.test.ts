import { describe, expect, test } from "bun:test";
import { defineScreen } from "@tenunjs/core";
import { jsx } from "@tenunjs/jsx-runtime";
import {
  ApplicationRuntime, Button, Column, Text, ThemeScopeBox,
  currentWidgetContext, defineTheme, layoutScreen,
  type DisplayListScene, type WidgetContext, type WidgetNode,
} from "../src/index";

const theme = defineTheme({});
const viewport = { width: 320, height: 480 };

describe("Inherited widget context and environment (TN-068)", () => {
  test("default environment context is populated and accessible in components", () => {
    let capturedContext: WidgetContext | null = null;
    let hookContext: WidgetContext | null = null;

    function TestComponent(props: { title: string }, ctx?: WidgetContext): WidgetNode {
      capturedContext = ctx ?? null;
      hookContext = currentWidgetContext();
      return Text({ children: `${props.title} [${ctx?.locale}]` });
    }

    const { scene } = layoutScreen(theme, jsx(TestComponent, { title: "Hello" }), viewport);
    expect(capturedContext).not.toBeNull();
    expect(capturedContext!.locale).toBe("en-US");
    expect(capturedContext!.textScale).toBe(1.0);
    expect(capturedContext!.platform).toBe("android");
    expect(hookContext).toBe(capturedContext);

    const textOp = scene.ops.find((op) => op.op === "text") as { text: string };
    expect(textOp.text).toBe("Hello [en-US]");
  });

  test("currentWidgetContext() outside render throws INVALID_CONSTRAINT", () => {
    expect(() => currentWidgetContext()).toThrow(/currentWidgetContext/);
  });

  test("layoutScreen options set root environment context", () => {
    let captured: WidgetContext | null = null;
    function Comp(_props: Record<string, unknown>, ctx?: WidgetContext): WidgetNode {
      captured = ctx ?? null;
      return Text({ children: "content" });
    }

    layoutScreen(theme, jsx(Comp, {}), viewport, undefined, {
      locale: "id-ID",
      textScale: 1.25,
      platform: "ios",
    });

    expect(captured).not.toBeNull();
    expect(captured!.locale).toBe("id-ID");
    expect(captured!.textScale).toBe(1.25);
    expect(captured!.platform).toBe("ios");
  });

  test("ThemeScopeBox narrows environment context for descendants only", () => {
    let outerContext: WidgetContext | null = null;
    let innerContext: WidgetContext | null = null;
    let deepContext: WidgetContext | null = null;
    let siblingContext: WidgetContext | null = null;

    function OuterComp(_props: Record<string, unknown>, ctx?: WidgetContext): WidgetNode {
      outerContext = ctx ?? null;
      return Text({ children: "outer" });
    }
    function InnerComp(_props: Record<string, unknown>, ctx?: WidgetContext): WidgetNode {
      innerContext = ctx ?? null;
      return Text({ children: "inner" });
    }
    function DeepComp(_props: Record<string, unknown>, ctx?: WidgetContext): WidgetNode {
      deepContext = ctx ?? null;
      return Text({ children: "deep" });
    }
    function SiblingComp(_props: Record<string, unknown>, ctx?: WidgetContext): WidgetNode {
      siblingContext = ctx ?? null;
      return Text({ children: "sibling" });
    }

    layoutScreen(theme, Column({
      children: [
        jsx(OuterComp, {}),
        ThemeScopeBox({
          locale: "ja-JP",
          textScale: 1.5,
          children: [
            jsx(InnerComp, {}),
            ThemeScopeBox({
              locale: "fr-FR", // overrides locale only; textScale inherits 1.5
              children: [
                jsx(DeepComp, {}),
              ],
            }),
          ],
        }),
        jsx(SiblingComp, {}),
      ],
    }), viewport);

    expect(outerContext!.locale).toBe("en-US");
    expect(outerContext!.textScale).toBe(1.0);

    expect(innerContext!.locale).toBe("ja-JP");
    expect(innerContext!.textScale).toBe(1.5);
    expect(innerContext!.platform).toBe("android"); // inherited

    expect(deepContext!.locale).toBe("fr-FR"); // overridden
    expect(deepContext!.textScale).toBe(1.5); // inherited from enclosing scope
    expect(deepContext!.platform).toBe("android");

    expect(siblingContext!.locale).toBe("en-US"); // unaffected by scopes
    expect(siblingContext!.textScale).toBe(1.0);
  });

  test("textScale scales typography size, line height, and layout boxes", () => {
    const normalScene = layoutScreen(theme, Text({ variant: "body", children: "Hello World that wraps across multiple lines when measured at design width" }), 320).scene;
    const scaledScene = layoutScreen(theme, Text({ variant: "body", children: "Hello World that wraps across multiple lines when measured at design width" }), 320, undefined, {
      textScale: 2.0,
    }).scene;

    const normalOp = normalScene.ops.find((op) => op.op === "text") as { size: number; y: number };
    const scaledOp = scaledScene.ops.find((op) => op.op === "text") as { size: number; y: number };

    expect(scaledOp.size).toBe(normalOp.size * 2);
    expect(scaledScene.contentHeight).toBeGreaterThan(normalScene.contentHeight);
  });

  test("textScale scales Button measurement and placement", () => {
    const normal = layoutScreen(theme, Button({ children: "Submit" }), viewport).scene;
    const scaled = layoutScreen(theme, Button({ children: "Submit" }), viewport, undefined, {
      textScale: 1.5,
    }).scene;

    const normalBtn = normal.ops.find((op) => op.op === "text") as { size: number };
    const scaledBtn = scaled.ops.find((op) => op.op === "text") as { size: number };

    expect(scaledBtn.size).toBe(normalBtn.size * 1.5);
  });

  test("invalid locale, textScale, and platform fail visibly", () => {
    expect(() => layoutScreen(theme, Text({ children: "x" }), viewport, undefined, {
      locale: "   ",
    })).toThrow(/non-empty string/);

    expect(() => layoutScreen(theme, Text({ children: "x" }), viewport, undefined, {
      textScale: -1,
    })).toThrow(/positive finite number/);

    expect(() => layoutScreen(theme, Text({ children: "x" }), viewport, undefined, {
      textScale: NaN,
    })).toThrow(/positive finite number/);

    expect(() => layoutScreen(theme, Text({ children: "x" }), viewport, undefined, {
      platform: "windows" as any,
    })).toThrow(/"android", "ios", or "web"/);

    expect(() => layoutScreen(theme, ThemeScopeBox({
      textScale: 0,
      children: Text({ children: "x" }),
    }), viewport)).toThrow(/positive finite number/);

    expect(() => layoutScreen(theme, ThemeScopeBox({
      platform: "unknown" as any,
      children: Text({ children: "x" }),
    }), viewport)).toThrow(/"android", "ios", or "web"/);
  });

  test("ApplicationRuntime manages environment context and notifies on changes", () => {
    let staleCount = 0;
    const screen = defineScreen({
      name: "home",
      initialState: () => ({ count: 0 }),
      actions: {},
      view({ state }) {
        const ctx = currentWidgetContext();
        return Text({ children: `locale:${ctx.locale} scale:${ctx.textScale} plat:${ctx.platform}` });
      },
    });

    const runtime = new ApplicationRuntime({
      screens: { home: screen },
      initial: "home",
      theme,
      locale: "de-DE",
      textScale: 1.2,
      platform: "web",
    });

    expect(runtime.getLocale()).toBe("de-DE");
    expect(runtime.getTextScale()).toBe(1.2);
    expect(runtime.getPlatform()).toBe("web");

    const firstScene = runtime.render().scene;
    const firstText = firstScene.ops.find((op) => op.op === "text") as { text: string };
    expect(firstText.text).toBe("locale:de-DE scale:1.2 plat:web");

    runtime.onStateInvalidation(() => { staleCount++; });

    runtime.setLocale("it-IT");
    expect(staleCount).toBe(1);
    expect(runtime.getLocale()).toBe("it-IT");
    const secondText = runtime.render().scene.ops.find((op) => op.op === "text") as { text: string };
    expect(secondText.text).toBe("locale:it-IT scale:1.2 plat:web");

    runtime.setTextScale(1.8);
    expect(staleCount).toBe(2);
    expect(runtime.getTextScale()).toBe(1.8);

    runtime.setPlatform("ios");
    expect(staleCount).toBe(3);
    expect(runtime.getPlatform()).toBe("ios");
    const thirdText = runtime.render().scene.ops.find((op) => op.op === "text") as { text: string };
    expect(thirdText.text).toBe("locale:it-IT scale:1.8 plat:ios");

    expect(() => runtime.setLocale("")).toThrow(/non-empty/);
    expect(() => runtime.setTextScale(0)).toThrow(/positive/);
    expect(() => runtime.setPlatform("linux" as any)).toThrow(/"android", "ios", or "web"/);

    runtime.dispose();
    expect(() => runtime.setLocale("es-ES")).toThrow(/disposed/);
  });
});

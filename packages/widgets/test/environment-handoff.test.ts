import { describe, expect, test } from "bun:test";
import { defineScreen } from "@tenunjs/core";
import {
  ApplicationRuntime, Column, Text, currentWidgetContext, defineTheme, installHostHandoff,
  type DisplayListScene,
} from "../src/index";

const theme = defineTheme({});

function fixture() {
  const screen = defineScreen({
    name: "Env",
    initialState: () => ({ n: 0 }),
    actions: {},
    view() {
      const ctx = currentWidgetContext();
      return Column({ children: [
        Text({ children: `loc:${ctx.locale}` }),
        Text({ variant: "body", children: `scale:${ctx.textScale}` }),
      ] });
    },
  });
  const app = new ApplicationRuntime({ screens: { env: screen }, initial: "env", theme, viewport: { width: 320, height: 480 } });
  const commits: string[] = [];
  const handoff = installHostHandoff({ app, commit: (json) => { commits.push(json); } });
  return { app, handoff, commits };
}

const textOps = (json: string): Array<{ text: string; size: number }> =>
  (JSON.parse(json) as DisplayListScene).ops
    .filter((op): op is Extract<DisplayListScene["ops"][number], { op: "text" }> => op.op === "text")
    .map((op) => ({ text: op.text, size: op.size }));

describe("host ENVIRONMENT dispatch (TN-187)", () => {
  test("an ENVIRONMENT dispatch re-renders under the new environment", () => {
    const { handoff, commits } = fixture();
    const before = textOps(commits.at(-1)!);
    const bodySize = before.find((op) => op.text.startsWith("scale:"))!.size;

    handoff.dispatch("ENVIRONMENT", JSON.stringify({ locale: "id-ID", textScale: 2, platform: "web" }));

    const after = textOps(commits.at(-1)!);
    expect(after.find((op) => op.text.startsWith("loc:"))!.text).toBe("loc:id-ID");
    expect(after.find((op) => op.text.startsWith("scale:"))!.text).toBe("scale:2");
    // The host's font scale reaches committed geometry: the body text op
    // doubles (TN-068's typography scaling driven by the host verb).
    expect(after.find((op) => op.text.startsWith("scale:"))!.size).toBe(bodySize * 2);
  });

  test("partial updates keep unmentioned fields; identical values commit nothing new", () => {
    const { app, handoff, commits } = fixture();
    handoff.dispatch("ENVIRONMENT", JSON.stringify({ locale: "ja-JP", textScale: 1.5 }));
    expect(app.getLocale()).toBe("ja-JP");
    expect(app.getTextScale()).toBe(1.5);
    expect(app.getPlatform()).toBe("android"); // untouched default

    // Partial: only locale moves.
    handoff.dispatch("ENVIRONMENT", JSON.stringify({ locale: "fr-FR" }));
    expect(app.getLocale()).toBe("fr-FR");
    expect(app.getTextScale()).toBe(1.5);

    // Identical environment: no new commit (no invalidation).
    const count = commits.length;
    handoff.dispatch("ENVIRONMENT", JSON.stringify({ locale: "fr-FR", textScale: 1.5 }));
    expect(commits.length).toBe(count);
  });

  test("a malformed payload fails visibly and leaves the current environment intact", () => {
    const { app, handoff, commits } = fixture();
    handoff.dispatch("ENVIRONMENT", JSON.stringify({ locale: "de-DE" }));
    const count = commits.length;
    expect(() => handoff.dispatch("ENVIRONMENT", JSON.stringify({ textScale: -2 })))
      .toThrow(/positive finite number/);
    expect(app.getLocale()).toBe("de-DE");
    expect(app.getTextScale()).toBe(1);
    expect(commits.length).toBe(count);
  });

  test("a bundle without setEnvironment surfaces UNKNOWN_ACTION — the negotiation signal", () => {
    const screen = defineScreen({
      name: "Old", initialState: () => ({}), actions: {},
      view: () => Text({ children: "old bundle" }),
    });
    const app = new ApplicationRuntime({ screens: { old: screen }, initial: "old", theme, viewport: { width: 320, height: 480 } });
    const handoff = installHostHandoff({
      app: {
        render: () => app.render(),
        dispatch: (action, payload) => app.dispatch(action, payload),
        exportState: () => app.exportState(),
        stateSchema: () => app.stateSchema(),
        route: () => app.route(),
        // setEnvironment intentionally omitted: the pre-TN-187 bundle shape.
      },
    });
    expect(() => handoff.dispatch("ENVIRONMENT", JSON.stringify({ textScale: 1.5 })))
      .toThrow(/unknown dispatch verb/);
  });
});

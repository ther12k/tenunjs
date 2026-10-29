import { describe, expect, test } from "bun:test";
import { mountScreen } from "@tenunjs-examples/test-support";
import { PLAN_TASKS } from "../src/plan";
import { ProgressScreen } from "../src/screens/progress.screen";
import { TodayScreen } from "../src/screens/today.screen";

describe("Day Plan named actions", () => {
  test("completes only the known tasks and passes current progress to navigation", async () => {
    const navigation: unknown[][] = [];
    const screen = mountScreen(TodayScreen, { services: { navigate: (...args: unknown[]) => navigation.push(args) } });
    expect(screen.state.completed).toBe(0);
    await screen.press("completeTask");
    await screen.press("viewProgress");
    expect(navigation).toEqual([["progress", { completed: 1, planTitle: "Release day" }]]);
    for (let index = 0; index < 5; index++) await screen.press("completeTask");
    expect(screen.state.completed).toBe(PLAN_TASKS.length);
    expect(screen.render()).not.toBeNull();
  });

  test("title changes preserve Unicode and travel with progress without normalization", async () => {
    const navigation: unknown[][] = [];
    const screen = mountScreen(TodayScreen, { services: { navigate: (...args: unknown[]) => navigation.push(args) } });
    for (const value of ["Release 🎉", "かな", "Cafe\u0301", ""]) {
      await screen.press("changePlanTitle", value);
      expect(screen.state.planTitle).toBe(value);
      await screen.press("viewProgress");
      expect(navigation.at(-1)).toEqual(["progress", { completed: 0, planTitle: value }]);
    }
    await expect(screen.press("changePlanTitle", null)).rejects.toThrow("title");
    expect(screen.state.planTitle).toBe("");
  });

  test("progress data updates without resetting the screen's own disclosure state", async () => {
    const navigation: unknown[][] = [];
    const screen = mountScreen(ProgressScreen, { services: { navigate: (...args: unknown[]) => navigation.push(args) } });
    await screen.press("toggleDetails");
    await screen.press("receiveProgress", { completed: 2, planTitle: "Ship 🎉" });
    expect(screen.state).toEqual({ completed: 2, planTitle: "Ship 🎉", detailsVisible: true });
    await screen.press("backToToday");
    expect(navigation).toEqual([["today", undefined]]);
    expect(screen.render()).not.toBeNull();
  });

  test("invalid progress and missing navigation services fail without corrupting state", async () => {
    const screen = mountScreen(ProgressScreen);
    for (const value of [-1, 4, 1.5, "2", null]) {
      await expect(screen.press("receiveProgress", { completed: value, planTitle: "Invalid" })).rejects.toThrow("completion");
      expect(screen.state.completed).toBe(0);
      expect(screen.state.planTitle).toBe("Release day");
    }
    await expect(screen.press("receiveProgress", { completed: 1, planTitle: null })).rejects.toThrow("title");
    expect(screen.state).toEqual({ completed: 0, planTitle: "Release day", detailsVisible: false });
    await expect(screen.press("receiveProgress", null)).rejects.toThrow("progress");
    await expect(screen.press("backToToday")).rejects.toThrow("navigation service");
  });
});

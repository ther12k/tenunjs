import { describe, expect, test } from "bun:test";
import { TasksScreen } from "../src/screens/tasks.screen";
import { mountScreen } from "@tenunjs-examples/test-support";

describe("TasksScreen", () => {
  test("adds tasks with rotating sample titles", () => {
    const tasks = mountScreen(TasksScreen);
    tasks.actions.addTask();
    tasks.actions.addTask();

    expect(tasks.state.tasks).toHaveLength(2);
    expect(tasks.state.tasks[0].title).not.toBe(tasks.state.tasks[1].title);
    expect(tasks.render()).not.toBeNull();
  });

  test("toggle and remove address tasks by id", () => {
    const tasks = mountScreen(TasksScreen);
    tasks.actions.addTask();
    const id = tasks.state.tasks[0].id;

    tasks.actions.toggleTask(id);
    expect(tasks.state.tasks[0].done).toBe(true);

    tasks.actions.toggleTask(id);
    expect(tasks.state.tasks[0].done).toBe(false);

    tasks.actions.removeTask(id);
    expect(tasks.state.tasks).toHaveLength(0);
  });

  test("clearCompleted keeps open work and renders the empty state", () => {
    const tasks = mountScreen(TasksScreen);
    tasks.actions.addTask();
    tasks.actions.addTask();
    tasks.actions.toggleTask(tasks.state.tasks[0].id);

    tasks.actions.clearCompleted();
    expect(tasks.state.tasks).toHaveLength(1);
    expect(tasks.state.tasks[0].done).toBe(false);

    tasks.actions.removeTask(tasks.state.tasks[0].id);
    expect(tasks.render()).not.toBeNull();
  });
});

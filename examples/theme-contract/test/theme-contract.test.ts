import { describe, expect, test } from "bun:test";
import type { CapabilityResult } from "@tenunjs/platform";
import type { DisplayListScene } from "@tenunjs/widgets";
import {
  DARK_PALETTE,
  LIGHT_PALETTE,
  THEME_PREFERENCE_KEY,
  THEME_REFERENCE_SCENE,
  ThemeContractExample,
  ThemePreferenceError,
  type ThemePreferenceStorage,
} from "../src/main";

function memoryStorage(initial: string | null = null): ThemePreferenceStorage & { writes: string[] } {
  const values = new Map<string, string>();
  if (initial !== null) values.set(THEME_PREFERENCE_KEY, initial);
  const writes: string[] = [];
  return {
    writes,
    async get(key) {
      return { ok: true, value: values.get(key) ?? null };
    },
    async set(key, value) {
      values.set(key, value);
      writes.push(value);
      return { ok: true, value: undefined };
    },
  };
}

function sceneWithoutColors(scene: DisplayListScene): unknown {
  const { background: _background, ...rest } = scene;
  return {
    ...rest,
    ops: scene.ops.map((op) => {
      if (!("color" in op)) return op;
      const { color: _color, ...geometry } = op;
      return geometry;
    }),
  };
}

function paintColor(op: DisplayListScene["ops"][number]): string {
  if (!("color" in op)) throw new Error("The theme reference fixture must contain paint operations");
  return op.color;
}

describe("TN-143 persisted theme contract example", () => {
  test("rebakes the same semantic source and restores a persisted choice in a new instance", async () => {
    const storage = memoryStorage();
    const originalSource = JSON.stringify(THEME_REFERENCE_SCENE);
    const example = await ThemeContractExample.open(storage);
    const light = example.render();

    expect(example.mode).toBe("light");
    expect(storage.writes).toEqual([]);
    expect(light.background).toBe(LIGHT_PALETTE.background);
    expect(light.ops.map(paintColor)).toEqual([
      LIGHT_PALETTE.surface,
      LIGHT_PALETTE.outline,
      LIGHT_PALETTE.onSurface,
      LIGHT_PALETTE.onSurfaceVariant,
      LIGHT_PALETTE["app.brand"],
      LIGHT_PALETTE.primary,
      LIGHT_PALETTE.onPrimary,
    ]);

    const dark = await example.setMode("dark");
    expect(example.mode).toBe("dark");
    expect(storage.writes).toEqual(["dark"]);
    expect(dark.background).toBe(DARK_PALETTE.background);
    expect(dark.ops.map(paintColor)).toEqual([
      DARK_PALETTE.surface,
      DARK_PALETTE.outline,
      DARK_PALETTE.onSurface,
      DARK_PALETTE.onSurfaceVariant,
      DARK_PALETTE["app.brand"],
      DARK_PALETTE.primary,
      DARK_PALETTE.onPrimary,
    ]);
    for (let index = 0; index < light.ops.length; index++) {
      expect(paintColor(dark.ops[index]!)).not.toBe(paintColor(light.ops[index]!));
    }
    expect(sceneWithoutColors(dark)).toEqual(sceneWithoutColors(light));
    expect(JSON.stringify(THEME_REFERENCE_SCENE)).toBe(originalSource);
    expect(THEME_REFERENCE_SCENE.background).toEqual({ slot: "background" });

    const restored = await ThemeContractExample.open(storage);
    expect(restored.mode).toBe("dark");
    expect(restored.render()).toEqual(dark);
    expect(await restored.setMode("light")).toEqual(light);
    expect(JSON.stringify(THEME_REFERENCE_SCENE)).toBe(originalSource);
  });

  test("mutating a delivered scene cannot corrupt subsequent rebakes", async () => {
    const example = await ThemeContractExample.open(memoryStorage());
    const expected = example.render();
    const delivered = example.render();
    delivered.background = "#000000";
    const first = delivered.ops[0]!;
    if (!("color" in first)) throw new Error("The first reference op must paint a color");
    first.color = "#000000";
    delivered.taps[0]!.payload.id = 99;
    expect(example.render()).toEqual(expected);
  });

  test("a failed read prevents initialization and preserves the host failure", async () => {
    const failure = { kind: "unsupported" as const, message: "storage not installed" };
    let writes = 0;
    const attempt = ThemeContractExample.open({
      get: async () => ({ ok: false, failure }),
      set: async () => {
        writes++;
        return { ok: true, value: undefined };
      },
    });
    await expect(attempt).rejects.toMatchObject({
      code: "STORAGE_READ_FAILED",
      failure,
    });
    expect(writes).toBe(0);
  });

  test("a malformed stored choice is rejected without overwriting it", async () => {
    for (const value of ["", "system", "Dark", '{"mode":"dark"}']) {
      const storage = memoryStorage(value);
      await expect(ThemeContractExample.open(storage)).rejects.toMatchObject({
        code: "INVALID_STORED_PREFERENCE",
      });
      expect(storage.writes).toEqual([]);
      expect(await storage.get(THEME_PREFERENCE_KEY)).toEqual({ ok: true, value });
    }
  });

  test("failed persistence preserves the previous mode and scene, and a later switch can succeed", async () => {
    const storage = memoryStorage();
    const failure = { kind: "platform-error" as const, message: "disk full" };
    let failWrite = true;
    const example = await ThemeContractExample.open({
      get: storage.get,
      set: async (key, value) => failWrite ? { ok: false, failure } : storage.set(key, value),
    });
    const previous = example.render();
    await expect(example.setMode("dark")).rejects.toMatchObject({
      code: "STORAGE_WRITE_FAILED",
      failure,
    });
    expect(example.mode).toBe("light");
    expect(example.render()).toEqual(previous);
    expect(storage.writes).toEqual([]);

    failWrite = false;
    await example.setMode("dark");
    expect(example.mode).toBe("dark");
    expect(storage.writes).toEqual(["dark"]);
  });

  test("a second concurrent switch is explicitly busy and cannot race the persisted preference", async () => {
    const storage = memoryStorage();
    let finishWrite!: (result: CapabilityResult<void>) => void;
    let pendingValue: string | undefined;
    const example = await ThemeContractExample.open({
      get: storage.get,
      set: (_key, value) => {
        pendingValue = value;
        return new Promise((resolve) => { finishWrite = resolve; });
      },
    });
    const previous = example.render();
    const first = example.setMode("dark");
    await expect(example.setMode("light")).rejects.toMatchObject({ code: "SWITCH_BUSY" });
    expect(pendingValue).toBe("dark");
    expect(example.mode).toBe("light");
    expect(example.render()).toEqual(previous);

    await storage.set(THEME_PREFERENCE_KEY, pendingValue!);
    finishWrite({ ok: true, value: undefined });
    const published = await first;
    expect(example.mode).toBe("dark");
    expect(published.background).toBe(DARK_PALETTE.background);
    expect((await ThemeContractExample.open(storage)).mode).toBe("dark");
  });

  test("invalid live input does not touch storage or change the scene", async () => {
    const storage = memoryStorage();
    const example = await ThemeContractExample.open(storage);
    const previous = example.render();
    await expect(example.setMode("system" as never)).rejects.toBeInstanceOf(ThemePreferenceError);
    await expect(example.setMode("system" as never)).rejects.toMatchObject({ code: "INVALID_PREFERENCE" });
    expect(storage.writes).toEqual([]);
    expect(example.render()).toEqual(previous);
  });

  test("an unexpectedly rejected host write is surfaced and releases the busy guard", async () => {
    const storage = memoryStorage();
    const error = new Error("host transport rejected outside its result contract");
    let reject = true;
    const example = await ThemeContractExample.open({
      get: storage.get,
      set: async (key, value) => {
        if (reject) throw error;
        return storage.set(key, value);
      },
    });
    const previous = example.render();
    await expect(example.setMode("dark")).rejects.toBe(error);
    expect(example.render()).toEqual(previous);
    reject = false;
    await example.setMode("dark");
    expect(example.mode).toBe("dark");
  });
});

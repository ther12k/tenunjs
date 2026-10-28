/** Bun/Node file-storage host for the reference only; never imported by mobile code. */
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import {
  ThemeContractExample,
  type ThemeMode,
  type ThemePreferenceStorage,
} from "./src/main";

const [file, requestedMode] = process.argv.slice(2);
if (!file || (requestedMode !== undefined && requestedMode !== "light" && requestedMode !== "dark")) {
  console.error("Usage: bun examples/theme-contract/demo.ts <preference-file> [light|dark]");
  process.exit(1);
}

const storage: ThemePreferenceStorage = {
  async get() {
    try {
      return { ok: true, value: await readFile(file, "utf8") };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { ok: true, value: null };
      return { ok: false, failure: { kind: "platform-error", message: String(error) } };
    }
  },
  async set(_key, value) {
    const temporary = `${file}.tmp-${process.pid}`;
    try {
      await writeFile(temporary, value, "utf8");
      await rename(temporary, file);
      return { ok: true, value: undefined };
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => undefined);
      return { ok: false, failure: { kind: "platform-error", message: String(error) } };
    }
  },
};

const example = await ThemeContractExample.open(storage);
if (requestedMode !== undefined) await example.setMode(requestedMode as ThemeMode);
const scene = example.render();
console.log(JSON.stringify({
  mode: example.mode,
  background: scene.background,
  card: scene.ops[0]?.color,
  text: scene.ops[2]?.color,
  button: scene.ops[5]?.color,
  buttonText: scene.ops[6]?.color,
  operationCount: scene.ops.length,
  tapCount: scene.taps.length,
}, null, 2));

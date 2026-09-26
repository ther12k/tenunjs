/**
 * Headless host-contract harness (TN-133 browser-leg CI proof).
 *
 * Evaluates the built host bundle exactly the way a host would — a
 * tenun_commit recorder installed BEFORE eval, everything else through
 * the __tenun_dispatch_action protocol only — and asserts this external
 * application executes through the public contract:
 *
 *   initial scene → taps drive real actions → snapshot export →
 *   fail-closed dispatch on a foreign tap id.
 *
 * With --modified, asserts the APPLICATION-ONLY variant (label +
 * toggleAll behavior changed in src/, framework untouched): the
 * distinguishable outcome is toggleAll from a mixed "1 of 2 done" state —
 * the stock action sets ALL to done ("2 of 2"), the modified action
 * INVERTS each item ("1 of 2" stays, membership flips).
 */
import { readFileSync } from "node:fs";
import vm from "node:vm";

const modified = process.argv.includes("--modified");
const failures: string[] = [];
const ok = (label: string) => console.log(`  ✓ ${label}`);
const check = (label: string, condition: boolean) => {
  if (condition) ok(label);
  else failures.push(label);
};

type Scene = {
  ops: Array<{ op: string; text?: string; x?: number; y?: number; size?: number }>;
  taps: Array<{ x: number; y: number; w: number; h: number; payload: { id: number } }>;
};
type TextOp = { op: "text"; text: string; x: number; y: number };

const committed: string[] = [];
const g = globalThis as Record<string, unknown>;
g["tenun_commit"] = (json: string) => committed.push(json);
delete g["__tenun_dispatch_action"];
delete g["__tenun_last_scene"];

try {
  let code = readFileSync(".out/host-app.js", "utf-8");
  // Same defensive wrap as the monorepo's bundle smoke run: module syntax
  // must never reach the host's plain-script eval.
  if (/^\s*(import|export)\s/m.test(code)) {
    code = `(function(){\n${code}\n})();`;
  }
  vm.runInThisContext(code, { filename: "host-app.js" });
} catch (error) {
  console.error(`HOST-CONTRACT-FAILED: bundle did not boot: ${(error as Error).message}`);
  process.exit(1);
}
const dispatch = g["__tenun_dispatch_action"] as (a: string, p: string) => string;
if (typeof dispatch !== "function") {
  console.error("HOST-CONTRACT-FAILED: __tenun_dispatch_action not installed");
  process.exit(1);
}

function scene(): Scene {
  const raw = committed.at(-1);
  if (!raw) throw new Error("no committed scene");
  return JSON.parse(raw) as Scene;
}
function texts(s: Scene): string[] {
  return s.ops.filter((o) => o.op === "text").map((o) => (o as TextOp).text);
}
/** Region containing a text op's center — how a host aims at a labeled control. */
function tapFor(s: Scene, label: string, nth = 0): number {
  const candidates = s.ops
    .filter((o): o is TextOp => o.op === "text" && o.text === label)
    .sort((a, b) => a.y - b.y);
  const op = candidates[nth] ?? candidates[0];
  if (!op) throw new Error(`no text op "${label}"`);
  const cx = op.x + 20;
  const cy = op.y - 6;
  const hit = s.taps.find((t) => cx >= t.x && cx <= t.x + t.w && cy >= t.y && cy <= t.y + t.h);
  if (!hit) throw new Error(`no tap region covers "${label}"`);
  return hit.payload.id;
}
function tap(label: string, nth = 0): void {
  const before = committed.length;
  dispatch("tap", JSON.stringify({ id: tapFor(scene(), label, nth) }));
  if (committed.length === before) throw new Error(`tap "${label}" did not commit a new scene`);
}
function doneLine(): string | undefined {
  return texts(scene()).find((t) => /of \d+ done/.test(t));
}

// -- initial scene through the protocol only
const initial = texts(scene());
check("initial scene committed on load", committed.length >= 1);
check("empty state visible", initial.includes("No tasks yet. Press Add to begin."));
check(`clear-label is "${modified ? "Clear done" : "Clear completed"}"`,
  initial.includes(modified ? "Clear done" : "Clear completed") &&
  !initial.includes(modified ? "Clear completed" : "Clear done"));

// -- real action loop: two items, first one marked done
tap("Add"); tap("Add");
check("two adds land", doneLine() === "0 of 2 done");
tap("Done", 0);
check("first item done", doneLine() === "1 of 2 done");

// -- the application-only behavioral difference
tap("Toggle all");
check(
  `toggleAll from mixed state: ${modified ? "inverted (stays 1 of 2)" : "all done (2 of 2)"}`,
  doneLine() === (modified ? "1 of 2 done" : "2 of 2 done"),
);
const stockLabels = texts(scene()).filter((t) => t.startsWith("✓")).length;
check(
  `membership ${modified ? "flipped (second item now ✓)" : "both items ✓"}`,
  stockLabels === (modified ? 1 : 2),
);

// -- snapshot export through the protocol
const snapshot = JSON.parse(dispatch("__TENUN_EXPORT", "{}")) as {
  route: string;
  states: Record<string, { items: unknown[] }>;
  stateSchema: number;
};
check("export carries route/tasks/schema", snapshot.route === "tasks" &&
  snapshot.states.tasks.items.length === 2 && snapshot.stateSchema === 1);

// -- fail-closed: a foreign tap id must throw through the protocol
let threw = "";
try {
  dispatch("tap", JSON.stringify({ id: 4242 }));
} catch (error) {
  threw = (error as Error).message;
}
check("foreign tap id fails closed", threw.includes("TENUN_APP_ERROR"));

if (failures.length > 0) {
  console.error("HOST-CONTRACT-FAILED:\n" + failures.map((f) => `  ✗ ${f}`).join("\n"));
  process.exit(1);
}
console.log(`HOST-CONTRACT-OK (${modified ? "application-only variant" : "stock fixture"})`);

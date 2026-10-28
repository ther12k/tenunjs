/**
 * TN-157/TN-160 shared-bundle execution proof. A browser-compatible script host
 * records the action sequence and scenes; the C bridge replays those same
 * actions in real QuickJS. Comparison is structural, not pixel/device proof.
 */
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import vm from "node:vm";
import type { DisplayListScene, DisplayOp, TextInputOp } from "@tenunjs/widgets";

type TextOp = Extract<DisplayOp, { op: "text" }>;

function parseScene(json: string): DisplayListScene {
  const scene = JSON.parse(json) as DisplayListScene;
  assert.equal(scene.tenun, "display-list");
  assert.equal(scene.version, 1);
  assert.ok(Number.isFinite(scene.designWidth) && scene.designWidth > 0);
  assert.ok(Number.isFinite(scene.contentHeight) && scene.contentHeight > 0);
  assert.ok(Array.isArray(scene.ops) && Array.isArray(scene.taps));
  return scene;
}

function prepare(bundlePath: string, actionsPath: string, scenesPath: string): void {
  const commits: string[] = [];
  const context = vm.createContext({
    tenun_commit: (json: string) => { parseScene(json); commits.push(json); },
  });
  // The actual host loads plain script input; module syntax must fail here.
  vm.runInContext(readFileSync(bundlePath, "utf8"), context, { filename: bundlePath, timeout: 5000 });
  assert.equal(typeof context.__tenun_dispatch_action, "function");
  const dispatch = context.__tenun_dispatch_action as (action: string, payload: string) => string;
  assert.ok(commits.length > 0, "bundle must commit its first frame on load");
  const current = () => parseScene(commits.at(-1)!);
  const texts = () => current().ops.filter((op): op is TextOp => op.op === "text").map((op) => op.text);
  const transcript: string[] = [commits.at(-1)!];
  const commands: string[] = [];
  let rejected = 0;

  function accepted(verb: string, value: unknown): void {
    const payload = JSON.stringify(value);
    const before = commits.length;
    dispatch(verb, payload);
    assert.ok(commits.length > before, `${verb} did not commit a scene`);
    commands.push(`${verb}\t${payload}`);
    transcript.push(commits.at(-1)!);
  }

  function reject(verb: string, value: unknown, code: string): void {
    const payload = JSON.stringify(value);
    const before = current();
    assert.throws(() => dispatch(verb, payload), (error: unknown) =>
      typeof error === "object" && error !== null && "code" in error && error.code === code);
    assert.deepEqual(current(), before, `${code} must preserve authoritative scene state`);
    commands.push(`EXPECT_REJECT:${code}:${verb}\t${payload}`);
    transcript.push(commits.at(-1)!);
    rejected++;
  }

  const field = (): TextInputOp => {
    const op = current().ops.find((op): op is TextInputOp => op.op === "text-input" && op.id === "plan-title");
    assert.ok(op, "the ordinary TextField must emit its platform descriptor");
    return op;
  };
  const identity = (op = field()) => ({ id: op.id, sessionId: op.sessionId, baseRevision: op.revision });

  function focus(): void {
    const op = field();
    const x = op.x + op.w / 2;
    const y = op.y + op.h / 2;
    const hit = [...current().taps].reverse().find((region) => region.action === "tap" &&
      x >= region.x && x <= region.x + region.w && y >= region.y && y <= region.y + region.h);
    assert.ok(hit, "the editor must focus through its ordinary tap region");
    accepted("TAP", hit.payload);
    assert.equal(field().focused, true);
  }

  function tap(label: string): void {
    const scene = current();
    const text = scene.ops.find((op): op is TextOp => op.op === "text" && op.text === label);
    assert.ok(text, `missing control label: ${label}`);
    const x = text.x + 12;
    const y = text.y - 6;
    const hit = [...scene.taps].reverse().find((region) => region.action === "tap" &&
      x >= region.x && x <= region.x + region.w && y >= region.y && y <= region.y + region.h);
    assert.ok(hit, `no live tap region covers ${label}`);
    accepted("TAP", hit.payload);
  }

  assert.ok(texts().includes("Day Plan"));
  assert.equal(current().designWidth, 720);
  assert.equal(current().contentHeight, 1000);
  focus();
  accepted("TEXT_EDIT", { ...identity(), text: field().text,
    selection: { base: 0, extent: field().text.length }, composing: null });
  const firstComposition = { ...identity(), text: "に", selection: { base: 1, extent: 1 }, composing: { start: 0, end: 1 } };
  accepted("TEXT_EDIT", firstComposition);
  accepted("TEXT_EDIT", { ...identity(), text: "日本", selection: { base: 2, extent: 2 }, composing: { start: 0, end: 2 } });
  assert.deepEqual(field().composing, { start: 0, end: 2 });
  const title = "日本 🚀 e\u0301";
  accepted("TEXT_EDIT", { ...identity(), text: title,
    selection: { base: title.length, extent: title.length }, composing: null });
  const previousSession = identity();
  reject("TEXT_EDIT", firstComposition, "STALE_TEXT_REVISION");
  accepted("VIEWPORT", { width: 360, height: 640 });
  assert.equal(field().sessionId, previousSession.sessionId);
  assert.equal(field().text, title);
  tap("Complete task");
  tap("View progress");
  assert.ok(texts().includes("Progress"));
  assert.ok(texts().includes(title), "the ordinary progress screen must show the edited title");
  reject("TEXT_EDIT", { ...previousSession, text: "late navigation edit", selection: { base: 0, extent: 0 }, composing: null }, "STALE_TEXT_SESSION");
  const firstRing = current().ops.find((op) => op.op === "ring");
  assert.ok(firstRing?.op === "ring");
  assert.equal(firstRing.progress, 1 / 3);
  tap("Show details");
  tap("Back to today");
  assert.ok(texts().includes("Day Plan"));
  assert.equal(field().text, title);
  assert.equal(field().focused, false);
  focus();
  const preRestoreSession = identity();
  const saved = JSON.parse(dispatch("__TENUN_EXPORT", "{}"));
  assert.deepEqual(Object.keys(saved).sort(), ["route", "stateSchema", "states"]);
  assert.deepEqual(Object.keys(saved.states.today).sort(), ["completed", "planTitle"]);
  accepted("TENUN_RESTORE", saved);
  assert.equal(field().focused, false);
  reject("TEXT_EDIT", { ...preRestoreSession, text: "late restore edit", selection: { base: 0, extent: 0 }, composing: null }, "STALE_TEXT_SESSION");
  accepted("VIEWPORT", { width: 720, height: 1000 });
  tap("Complete task");
  tap("View progress");
  assert.ok(texts().includes("Hide details"), "progress screen session must survive navigation");
  const secondRing = current().ops.find((op) => op.op === "ring");
  assert.ok(secondRing?.op === "ring");
  assert.equal(secondRing.progress, 2 / 3);
  tap("Hide details");

  const snapshot = JSON.parse(dispatch("__TENUN_EXPORT", "{}"));
  assert.equal(snapshot.route, "progress");
  assert.equal(snapshot.states.today.completed, 2);
  assert.equal(snapshot.states.today.planTitle, title);
  assert.equal(snapshot.states.progress.completed, 2);
  assert.equal(snapshot.states.progress.planTitle, title);
  assert.equal(snapshot.states.progress.detailsVisible, false);
  assert.equal(snapshot.stateSchema, 1);
  const lastGood = commits.at(-1);
  assert.throws(() => dispatch("TAP", '{"id":99999}'), /TAP_TARGET_UNKNOWN|does not name a run/);
  assert.equal(commits.at(-1), lastGood, "rejected dispatch must preserve the previous commit");

  writeFileSync(actionsPath, `${commands.join("\n")}\n`);
  writeFileSync(scenesPath, `${transcript.join("\n")}\n`);
  assert.equal(commands.length, 19);
  assert.equal(rejected, 3);
  console.log(`FRAMEWORK-FEEL SCRIPT HOST PASS (${commands.length - rejected} accepted, ${rejected} expected rejections, ${transcript.length} scenes)`);
}

function compare(browserPath: string, nativePath: string): void {
  const read = (path: string) => readFileSync(path, "utf8").trim().split("\n").map(parseScene);
  const browser = read(browserPath);
  const native = read(nativePath);
  assert.equal(browser.length, 20, "initial scene plus 16 accepted and three rejected dispatches are required");
  assert.deepEqual(native, browser, "the same bundle/actions must commit the same geometry, text, colors and taps");
  console.log(`FRAMEWORK-FEEL STRUCTURAL PARITY PASS (${browser.length} scenes, script host / real QuickJS)`);
}

const [mode, first, second, third] = process.argv.slice(2);
if (mode === "prepare" && first && second && third) {
  prepare(first, second, third);
} else if (mode === "compare" && first && second && third === undefined) {
  compare(first, second);
} else {
  throw new Error("Usage: check-host-parity.ts prepare <bundle> <actions.tsv> <script-scenes.jsonl> | compare <script-scenes.jsonl> <native-scenes.jsonl>");
}

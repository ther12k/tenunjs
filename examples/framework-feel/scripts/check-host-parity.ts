/**
 * TN-157 shared-bundle execution proof. A browser-compatible script host
 * records the action sequence and scenes; the C bridge replays those same
 * actions in real QuickJS. Comparison is structural, not pixel/device proof.
 */
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import vm from "node:vm";
import type { DisplayListScene, DisplayOp } from "@tenunjs/widgets";

type TextOp = Extract<DisplayOp, { op: "text" }>;

function parseScene(json: string): DisplayListScene {
  const scene = JSON.parse(json) as DisplayListScene;
  assert.equal(scene.tenun, "display-list");
  assert.equal(scene.version, 1);
  assert.equal(scene.designWidth, 720);
  assert.equal(scene.contentHeight, 1000);
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

  function tap(label: string): void {
    const scene = current();
    const text = scene.ops.find((op): op is TextOp => op.op === "text" && op.text === label);
    assert.ok(text, `missing control label: ${label}`);
    const x = text.x + 12;
    const y = text.y - 6;
    const hit = [...scene.taps].reverse().find((region) => region.action === "tap" &&
      x >= region.x && x <= region.x + region.w && y >= region.y && y <= region.y + region.h);
    assert.ok(hit, `no live tap region covers ${label}`);
    const payload = JSON.stringify({ id: hit.payload.id });
    const before = commits.length;
    dispatch("TAP", payload);
    assert.ok(commits.length > before, `${label} did not commit a scene`);
    commands.push(`TAP\t${payload}`);
    transcript.push(commits.at(-1)!);
  }

  assert.ok(texts().includes("Day Plan"));
  tap("Complete task");
  tap("View progress");
  assert.ok(texts().includes("Progress"));
  const firstRing = current().ops.find((op) => op.op === "ring");
  assert.ok(firstRing?.op === "ring");
  assert.equal(firstRing.progress, 1 / 3);
  tap("Show details");
  tap("Back to today");
  assert.ok(texts().includes("Day Plan"));
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
  assert.equal(snapshot.states.progress.completed, 2);
  assert.equal(snapshot.states.progress.detailsVisible, false);
  assert.equal(snapshot.stateSchema, 1);
  const lastGood = commits.at(-1);
  assert.throws(() => dispatch("TAP", '{"id":99999}'), /TAP_TARGET_UNKNOWN|does not name a run/);
  assert.equal(commits.at(-1), lastGood, "rejected dispatch must preserve the previous commit");

  writeFileSync(actionsPath, `${commands.join("\n")}\n`);
  writeFileSync(scenesPath, `${transcript.join("\n")}\n`);
  console.log(`FRAMEWORK-FEEL SCRIPT HOST PASS (${commands.length} actions, ${transcript.length} scenes)`);
}

function compare(browserPath: string, nativePath: string): void {
  const read = (path: string) => readFileSync(path, "utf8").trim().split("\n").map(parseScene);
  const browser = read(browserPath);
  const native = read(nativePath);
  assert.equal(browser.length, 8, "initial scene plus seven action commits are required");
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

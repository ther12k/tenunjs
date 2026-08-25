// Flattens spikes/layout/corpus/*.json into a simple line format consumed by
// run_corpus.c so both candidates are driven by one identical C driver.
import { readdirSync, readFileSync } from "node:fs";

const dir = new URL("./corpus/", import.meta.url).pathname;
for (const f of readdirSync(dir).filter((x) => x.endsWith(".json")).sort()) {
  const c = JSON.parse(readFileSync(dir + f, "utf8"));
  console.log(`CASE ${c.case_id}`);
  console.log(`VIEWPORT ${c.viewport.width} ${c.viewport.height}`);
  const walk = (n) => {
    const s = n.style;
    const w = Number.isFinite(s.width) ? s.width : "nan";
    const h = Number.isFinite(s.height) ? s.height : "nan";
    let line = `NODE ${n.children.length} ${w} ${h} ${s.flex_grow ?? 0} ${s.direction === "column" ? 1 : 0} ${s.gap ?? 0} ${s.padding ?? 0} ${s.justify_content === "center" ? 1 : 0} ${s.align_items === "center" ? 1 : 0}`;
    if (n.measure) line += ` MEASURE ${n.measure.width} ${n.measure.height}`;
    console.log(line);
    for (const k of n.children) walk(k);
  };
  walk(c.root);
  for (const e of c.expected) console.log(`EXPECT ${e.x} ${e.y} ${e.width} ${e.height}`);
  console.log("END");
}

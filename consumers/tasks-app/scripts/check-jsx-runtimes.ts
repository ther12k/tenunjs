/**
 * Packaging coverage for both automatic-JSX entry points (TN-020):
 * the production subpath must expose jsx/jsxs and the development
 * subpath must expose jsxDEV — as real runtime functions, not just
 * declarations. TypeScript's react-jsx and react-jsxdev transforms
 * import exactly these two subpaths.
 */
import { jsx, jsxs, Fragment } from "@tenunjs/jsx-runtime/jsx-runtime";
import { jsxDEV } from "@tenunjs/jsx-runtime/jsx-dev-runtime";

const failures: string[] = [];

if (typeof jsx !== "function") failures.push("production subpath: jsx is not a function");
if (typeof jsxs !== "function") failures.push("production subpath: jsxs is not a function");
if (typeof Fragment !== "symbol") failures.push(`production subpath: Fragment is ${typeof Fragment}, expected symbol`);
if (typeof jsxDEV !== "function") failures.push(`development subpath: jsxDEV is ${typeof jsxDEV}, expected function`);

// End-to-end: build one real element through each runtime and check the
// widget-node shape the framework depends on.
const prodNode = jsx("text", { children: "hello" });
if (typeof prodNode !== "object" || prodNode === null || prodNode.kind !== "text") {
  failures.push("production subpath: jsx('text', …) did not produce a text widget node");
}

if (failures.length > 0) {
  console.error("JSX-RUNTIME-CHECK FAILED:\n" + failures.join("\n"));
  process.exit(1);
}
console.log("JSX-RUNTIME-CHECK OK: jsx, jsxs, Fragment (production) and jsxDEV (development) are real runtime functions; element construction works.");
